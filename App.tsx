import React, { useState, useEffect, useRef } from 'react';
import { BattleArena } from './components/BattleArena';
import { StatChart } from './components/StatChart';
import { ConfirmationModal } from './components/ConfirmationModal';
import { 
  Board, Disk, GameMode, StatPoint, Move, LearningData, WorkerOutputMessage, WorkerStatus
} from './types';
import { 
  createInitialBoard, 
  getValidMoves, 
  applyMove, 
  countScore
} from './services/gameLogic';
import { 
  loadBrain, 
  learnGame, 
  getBestMove,
  updateStats,
  saveBrain,
  trainBrain,
  importBrainData,
  setMemoryLimit
} from './services/learningService';
import { generateGeminiMove } from './services/geminiService';
import { STORAGE_KEY, DISK_COLORS } from './constants';

function App() {
  const [gameMode, setGameMode] = useState<GameMode>(GameMode.IDLE);
  const [board, setBoard] = useState<Board>(createInitialBoard());
  const [activeColor, setActiveColor] = useState<Disk>('Black'); 
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<StatPoint[]>([]);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  
  // UI Stats State
  const [patternCount, setPatternCount] = useState(0);
  const [memoryLimit, setMemoryLimitState] = useState(5000);

  // Default to (Cores - 1) to leave room for UI
  const hardwareCores = navigator.hardwareConcurrency || 4;
  const [concurrency, setConcurrency] = useState(Math.max(1, hardwareCores - 1));
  const [processedGames, setProcessedGames] = useState(0);
  
  // Rendering Control
  const [isVisualizing, setIsVisualizing] = useState(true);
  const [renderCount, setRenderCount] = useState(4);

  // Session Stats for Parallel Mode
  const [sessionStats, setSessionStats] = useState({ wins: 0, losses: 0, draws: 0 });
  const [matchLogs, setMatchLogs] = useState<{ id: number; text: string; win: boolean; score: string }[]>([]);
  
  // Workers State for Grid View
  const [workerStatuses, setWorkerStatuses] = useState<WorkerStatus[]>([]);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  // Refs
  const gameModeRef = useRef<GameMode>(GameMode.IDLE);
  const gameIdRef = useRef<number>(0); 
  const workersRef = useRef<Worker[]>([]); // Store real Worker instances
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gameHistoryRef = useRef<{ board: Board; move: Move; color: Disk }[]>([]);
  const trainingTimerRef = useRef<number | null>(null);

  // Derived State
  const isParallelView = concurrency > 1 && (gameMode === GameMode.TRAINING_RANDOM || gameMode === GameMode.TRAINING_SELF);

  useEffect(() => {
    refreshStats();
    return () => stopGame(); // Cleanup on unmount
  }, []);

  useEffect(() => {
      gameModeRef.current = gameMode;
  }, [gameMode]);

  const refreshStats = () => {
    const brain = loadBrain();
    
    // Update simple UI counters
    setPatternCount(Object.keys(brain.memory || {}).length);
    setMemoryLimitState(brain.maxMemoryLimit || 5000);

    if (brain.totalGames > 0) {
      setStats(prev => {
        const newPoint = { 
            game: brain.totalGames, 
            winRate: brain.totalGames ? Math.round((brain.wins / brain.totalGames) * 100) : 0, 
            experience: brain.experience 
        };
        const newStats = [...prev, newPoint];
        if (newStats.length > 20) return newStats.slice(newStats.length - 20);
        return newStats;
      });
    } else {
        setStats([]);
    }
  };

  const handleLimitBlur = () => {
      let val = memoryLimit;
      if (val < 100) val = 100;
      if (val > 1000000) val = 1000000; // Increased to 1,000,000
      
      setMemoryLimit(val);
      setMemoryLimitState(val);
      refreshStats();
  };

  const startTraining = (mode: GameMode) => {
    // 1. Reset Session
    gameIdRef.current += 1; 
    const currentId = gameIdRef.current;
    
    stopWorkers(); // Kill any old workers
    
    gameHistoryRef.current = [];
    setActiveColor(null); 
    gameModeRef.current = mode;

    setGameMode(mode);
    setProcessedGames(0);
    setSessionStats({ wins: 0, losses: 0, draws: 0 });
    setMatchLogs([]);
    
    // 2. Parallel Mode Setup
    const shouldRunParallel = concurrency > 1 && (mode === GameMode.TRAINING_RANDOM || mode === GameMode.TRAINING_SELF);

    if (shouldRunParallel) {
        const brain = loadBrain(); 
        
        // Init UI Status - Only create statuses for the ones we will render
        // But we need to track logic for all.
        // Actually, for UI performance, we only want to keep 'workerStatuses' state for the rendered ones.
        // But to calculate total wins, we use sessionStats.
        
        const numToRender = isVisualizing ? Math.min(renderCount, concurrency) : 0;
        const initialStatuses: WorkerStatus[] = Array(numToRender).fill(null).map((_, i) => ({
            id: i,
            winner: null,
            scores: { Black: 2, White: 2 },
            board: createInitialBoard(),
            gamesPlayed: 0
        }));
        setWorkerStatuses(initialStatuses);
        
        // 3. Spawn Real Workers
        const newWorkers: Worker[] = [];
        for (let i = 0; i < concurrency; i++) {
            try {
                const worker = new Worker('./services/simulationWorker.ts', { type: 'module' });
                
                worker.onmessage = (e) => handleWorkerMessage(e.data, mode, i, currentId);
                worker.onerror = (e) => {
                    console.error("Worker Error:", e);
                };
                
                // Determine if this worker should send visualization updates
                const reportUpdates = isVisualizing && i < renderCount;

                // Kickoff
                worker.postMessage({ type: 'START_GAME', mode, brain, reportUpdates });
                newWorkers.push(worker);
            } catch (err) {
                console.error("Failed to spawn worker:", err);
                break;
            }
        }
        workersRef.current = newWorkers;

    } else {
        startNewGame(mode);
    }
  };

  const stopWorkers = () => {
      workersRef.current.forEach(w => w.terminate());
      workersRef.current = [];
  };

  const handleWorkerMessage = (message: WorkerOutputMessage, mode: GameMode, workerIndex: number, sessionId: number) => {
      // Safety check: if we stopped/reset, ignore old messages
      if (gameIdRef.current !== sessionId) return;

      const isWatched = isVisualizing && workerIndex < renderCount;

      if (message.type === 'GAME_UPDATE') {
          if (!isWatched) return; // Should not happen if worker logic is correct, but safe guard
          
          setWorkerStatuses(prev => {
              // If the array is smaller than the index (e.g. dynamic resize), ignore
              if (!prev[workerIndex]) return prev;
              
              const next = [...prev];
              next[workerIndex] = {
                  ...next[workerIndex],
                  board: message.board,
                  scores: message.scores
              };
              return next;
          });
          return;
      }

      if (message.type === 'GAME_OVER') {
          const { history, winner, scores, finalBoard } = message;
     
          // 1. Synchronize Learning (Main Thread)
          // We load fresh brain, update it, save it, and pass it back.
          const currentBrain = loadBrain();
          const updatedBrain = trainBrain(currentBrain, history, winner);
          
          try {
            saveBrain(updatedBrain);
          } catch (e) {
             console.error("Memory quota exceeded?", e);
          }
          
          // 2. Update UI Stats
          setProcessedGames(prev => prev + 1);
          setSessionStats(prev => {
              const newStats = { ...prev };
              if (winner === 'Black') newStats.wins++;
              else if (winner === 'White') newStats.losses++;
              else newStats.draws++;
              return newStats;
          });

          if (isWatched) {
            setWorkerStatuses(prev => {
                if (!prev[workerIndex]) return prev;
                const next = [...prev];
                next[workerIndex] = {
                    ...next[workerIndex],
                    winner,
                    scores,
                    board: finalBoard,
                    gamesPlayed: next[workerIndex].gamesPlayed + 1
                };
                return next;
            });
          }

          // Log fewer messages if massive concurrency
          if (concurrency < 20 || workerIndex < 5) {
            setMatchLogs(prev => {
                const isBotWin = winner === 'Black';
                const logText = `CORE_${workerIndex} :: ${winner ? winner.toUpperCase() : 'DRAW'}`;
                const scoreText = `[${scores.Black} - ${scores.White}]`;
                const newLog = { 
                    id: Date.now() + Math.random(), 
                    text: logText, 
                    win: isBotWin,
                    score: scoreText
                };
                return [newLog, ...prev].slice(0, 5);
            });
          }

          if (winner) {
              const botIsBlack = mode === GameMode.TRAINING || mode === GameMode.TRAINING_RANDOM || mode === GameMode.TRAINING_SELF;
              const primaryBotWon = (botIsBlack && winner === 'Black');
              updateStats(primaryBotWon);
          }
          
          const total = updatedBrain.totalGames;
          // Refresh stats less frequently if super fast
          if (total % (concurrency > 50 ? 50 : 10) === 0) refreshStats();

          // 3. Loop: Send the updated brain back to THIS worker for the next game
          if (workersRef.current[workerIndex]) {
              const reportUpdates = isVisualizing && workerIndex < renderCount;
              workersRef.current[workerIndex].postMessage({ 
                  type: 'START_GAME', 
                  mode, 
                  brain: updatedBrain,
                  reportUpdates
              });
          }
      }
  };

  const stopGame = () => {
      gameIdRef.current += 1;
      gameModeRef.current = GameMode.IDLE;
      
      stopWorkers();
      
      setGameMode(GameMode.IDLE);
      setActiveColor(null);
      setBoard(createInitialBoard()); 
      setLastMove(null);
      setWorkerStatuses([]);
      
      if (trainingTimerRef.current) clearTimeout(trainingTimerRef.current);
  };

  const startNewGame = (mode: GameMode) => {
    gameIdRef.current += 1; 
    if (trainingTimerRef.current) clearTimeout(trainingTimerRef.current);
    
    setBoard(createInitialBoard());
    setActiveColor('Black');
    setLastMove(null);
    gameHistoryRef.current = [];
    setIsProcessing(false);
  };

  // Main Thread Game Loop (Single Thread / PVP)
  const handleGameOver = (checkGameId: number) => {
    if (gameIdRef.current !== checkGameId || gameModeRef.current === GameMode.IDLE) return;
    if (gameHistoryRef.current.length < 4) return;

    const scores = countScore(board);
    let winner: Disk = null;
    if (scores.Black > scores.White) winner = 'Black';
    else if (scores.White > scores.Black) winner = 'White';

    if (winner) {
       learnGame(gameHistoryRef.current, winner);
       
       const botIsBlack = gameMode === GameMode.TRAINING || gameMode === GameMode.TRAINING_RANDOM || gameMode === GameMode.TRAINING_SELF;
       const primaryBotWon = (botIsBlack && winner === 'Black') || (gameMode === GameMode.PVP && winner === 'White');
       updateStats(primaryBotWon);
       refreshStats();
    }

    setActiveColor(null);

    if (gameMode !== GameMode.PVP && gameMode !== GameMode.IDLE && !isParallelView) {
        const delay = gameMode === GameMode.TRAINING_SELF ? 200 : 2000;
        const nextGameIdCheck = gameIdRef.current; 
        setTimeout(() => {
            if (gameIdRef.current !== nextGameIdCheck || gameModeRef.current === GameMode.IDLE) return;
            startNewGame(gameMode);
        }, delay);
    } else if (gameMode === GameMode.PVP) {
        const pvpIdCheck = gameIdRef.current;
        setTimeout(() => {
            if (gameIdRef.current !== pvpIdCheck) return;
            alert(winner ? `${winner} Wins!` : "Draw!");
            setGameMode(GameMode.IDLE);
        }, 500);
    }
  };

  const executeMove = async (row: number, col: number) => {
    if (!activeColor) return;
    const currentId = gameIdRef.current;
    
    gameHistoryRef.current.push({ 
        board: JSON.parse(JSON.stringify(board)), 
        move: { row, col }, 
        color: activeColor 
    });

    const newBoard = applyMove(board, activeColor, row, col);
    setBoard(newBoard);
    setLastMove({ row, col });

    const nextColor: Disk = activeColor === 'Black' ? 'White' : 'Black';
    const nextMoves = getValidMoves(newBoard, nextColor);
    
    if (nextMoves.length > 0) {
        setActiveColor(nextColor);
    } else {
        const originalColorMoves = getValidMoves(newBoard, activeColor);
        if (originalColorMoves.length > 0) {
            // Pass
        } else {
            setBoard(newBoard); 
            setTimeout(() => {
                handleGameOver(currentId);
            }, 100);
            return;
        }
    }
  };

  useEffect(() => {
    if (gameMode === GameMode.IDLE || isParallelView || !activeColor || isProcessing) return;

    const runTurn = async () => {
        const currentId = gameIdRef.current;
        const currentMoves = getValidMoves(board, activeColor);
        
        if (currentMoves.length === 0) {
            if (gameHistoryRef.current.length === 0) return;
            handleGameOver(currentId);
            return;
        }

        let isBotTurn = false;
        let isGeminiTurn = false;
        let isRandomTurn = false;

        if (gameMode === GameMode.PVP) {
            if (activeColor === 'White') isBotTurn = true;
        } else {
            if (activeColor === 'Black') {
                isBotTurn = true;
            } else {
                if (gameMode === GameMode.TRAINING) isGeminiTurn = true;
                else if (gameMode === GameMode.TRAINING_RANDOM) isRandomTurn = true;
                else if (gameMode === GameMode.TRAINING_SELF) isBotTurn = true;
            }
        }

        if (isBotTurn) {
            setIsProcessing(true);
            const delay = gameMode === GameMode.TRAINING_SELF ? 50 : 500;
            setTimeout(() => {
                if (gameIdRef.current !== currentId) return;
                const bestMove = getBestMove(board, currentMoves);
                executeMove(bestMove.row, bestMove.col);
                setIsProcessing(false);
            }, delay);

        } else if (isGeminiTurn) {
            setIsProcessing(true);
            try {
                const geminiMove = await generateGeminiMove(board, 'White', currentMoves);
                if (gameIdRef.current === currentId) {
                    await executeMove(geminiMove.row, geminiMove.col);
                }
            } catch (e) {
                if (gameIdRef.current === currentId) {
                    const random = currentMoves[Math.floor(Math.random() * currentMoves.length)];
                    executeMove(random.row, random.col);
                }
            }
            if (gameIdRef.current === currentId) setIsProcessing(false);

        } else if (isRandomTurn) {
            setIsProcessing(true);
            setTimeout(() => {
                if (gameIdRef.current !== currentId) return;
                const random = currentMoves[Math.floor(Math.random() * currentMoves.length)];
                executeMove(random.row, random.col);
                setIsProcessing(false);
            }, 100);
        }
    };

    const isHumanTurn = gameMode === GameMode.PVP && activeColor === 'Black';
    if (!isHumanTurn) {
        trainingTimerRef.current = window.setTimeout(runTurn, 100);
    }

    return () => {
        if (trainingTimerRef.current) clearTimeout(trainingTimerRef.current);
    };
  }, [board, activeColor, gameMode]);

  const requestReset = () => {
      setIsResetModalOpen(true);
  };

  const confirmReset = () => {
      stopGame();
      localStorage.removeItem(STORAGE_KEY);
      setStats([]);
      setProcessedGames(0);
      setIsResetModalOpen(false);
  };

  const handleExport = () => {
      const data = loadBrain();
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `neuro_reversi_model_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
          const content = e.target?.result as string;
          if (importBrainData(content)) {
              alert("Model Imported Successfully!");
              refreshStats();
              stopGame(); 
          } else {
              alert("Invalid Model File.");
          }
      };
      reader.readAsText(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30">
      
      <header className="p-6 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-cyan-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.5)]">
               <span className="text-2xl">⚪</span>
             </div>
             <div>
               <h1 className="text-2xl font-display font-bold text-white tracking-wider">NEURO<span className="text-cyan-400">REVERSI</span></h1>
               <p className="text-xs text-slate-400 font-mono">GEN AI REINFORCEMENT LEARNING</p>
             </div>
          </div>
          <div className="flex gap-4">
            {gameMode !== GameMode.IDLE && (
              <button 
                onClick={stopGame}
                className="px-4 py-2 rounded border border-red-500/50 text-red-400 hover:bg-red-500/10 font-bold text-sm transition-colors"
              >
                STOP
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Panel */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-slate-900 rounded-xl border border-slate-700 p-6 shadow-lg">
            <h2 className="text-lg font-display text-white mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              AI CORE
            </h2>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-slate-800 rounded-lg border border-slate-700">
                <span className="text-slate-400 text-sm">Experience (XP)</span>
                <span className="font-mono text-cyan-400 font-bold">{loadBrain().experience}</span>
              </div>
              
              <div className="flex flex-col p-3 bg-slate-800 rounded-lg border border-slate-700">
                  <div className="flex justify-between items-center mb-1">
                     <span className="text-slate-400 text-sm">Learned Patterns</span>
                     <span className="font-mono text-purple-400 font-bold">{patternCount}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-slate-700 pt-2 mt-1">
                      <label className="text-[10px] text-slate-500 uppercase">Capacity (Limit)</label>
                      <div className="flex items-center gap-1">
                          <input 
                             type="number" 
                             className="w-20 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-xs text-right text-slate-300 focus:border-cyan-500 focus:outline-none"
                             value={memoryLimit}
                             onChange={(e) => setMemoryLimitState(parseInt(e.target.value) || 0)}
                             onBlur={handleLimitBlur}
                          />
                      </div>
                  </div>
              </div>

              {processedGames > 0 && (
                  <div className="flex justify-between items-center p-3 bg-cyan-900/30 rounded-lg border border-cyan-800 animate-pulse">
                    <span className="text-cyan-200 text-sm">Session Games</span>
                    <span className="font-mono text-cyan-400 font-bold">{processedGames}</span>
                  </div>
              )}
            </div>

            <div className="mt-6 space-y-4">
              
              {/* Concurrency Control */}
              <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 space-y-3">
                  <div>
                    <div className="flex justify-between mb-2">
                        <span className="text-xs font-bold text-slate-400 uppercase">CPU Core Allocation</span>
                        <span className="text-xs font-mono text-cyan-400">{concurrency} Threads</span>
                    </div>
                    <input 
                        type="range" 
                        min="1" 
                        max={hardwareCores * 50} 
                        step="1"
                        value={concurrency}
                        onChange={(e) => setConcurrency(parseInt(e.target.value))}
                        disabled={gameMode !== GameMode.IDLE}
                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                    <div className="text-[10px] text-slate-500 mt-1 text-center">
                        {concurrency > hardwareCores * 2 ? "High Load: Browser may slow down" : "Optimal range"}
                    </div>
                  </div>

                  <div className="h-px bg-slate-700"></div>

                  {/* Rendering Controls */}
                  <div className="flex flex-col gap-2">
                     <div className="flex items-center justify-between">
                         <span className="text-xs font-bold text-slate-400 uppercase">Visualize Games</span>
                         <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={isVisualizing}
                                onChange={(e) => setIsVisualizing(e.target.checked)}
                                disabled={gameMode !== GameMode.IDLE}
                            />
                            <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
                         </label>
                     </div>
                     
                     <div className={`transition-opacity duration-300 ${!isVisualizing ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-slate-500 uppercase">Max Rendered Grids</span>
                            <span className="text-[10px] font-mono text-cyan-400">{renderCount}</span>
                        </div>
                        <input 
                            type="range" 
                            min="1" 
                            max="32" 
                            step="1"
                            value={renderCount}
                            onChange={(e) => setRenderCount(parseInt(e.target.value))}
                            disabled={gameMode !== GameMode.IDLE}
                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                     </div>
                  </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => startTraining(GameMode.TRAINING_RANDOM)}
                    disabled={gameMode !== GameMode.IDLE}
                    className="py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg text-xs font-bold text-slate-300 border border-slate-700 transition-all flex flex-col items-center gap-1"
                  >
                    <span>VS RANDOM</span>
                    <span className="text-[10px] text-slate-500 font-mono">FASTEST</span>
                  </button>
                  
                  <button 
                    onClick={() => startTraining(GameMode.TRAINING_SELF)}
                    disabled={gameMode !== GameMode.IDLE}
                    className="py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg text-xs font-bold text-slate-300 border border-slate-700 transition-all flex flex-col items-center gap-1"
                  >
                    <span>VS SELF</span>
                    <span className="text-[10px] text-slate-500 font-mono">DEEP LEARN</span>
                  </button>
              </div>

              <button 
                onClick={() => startTraining(GameMode.TRAINING)}
                disabled={gameMode !== GameMode.IDLE || concurrency > 1}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg font-bold text-white shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 group relative overflow-hidden"
              >
                <div className="relative z-10 flex items-center gap-2">
                    <span>VS GEMINI (TEACHER)</span>
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                </div>
                {concurrency > 1 && <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center text-[10px]">Single Core Only</div>}
              </button>
              
              <div className="h-px bg-slate-800 my-2"></div>

              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Battle Mode</div>
              <button 
                onClick={() => startTraining(GameMode.PVP)}
                disabled={gameMode !== GameMode.IDLE}
                className="w-full py-4 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg font-bold text-white shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <span>CHALLENGE BOT</span>
              </button>

              <button 
                onClick={requestReset}
                disabled={gameMode !== GameMode.IDLE}
                className="w-full py-2 bg-transparent border border-slate-700 hover:border-red-500 hover:text-red-500 text-slate-500 rounded-lg text-xs transition-colors mt-2"
              >
                RESET BRAIN
              </button>
              
              <div className="grid grid-cols-2 gap-2 mt-2">
                    <button 
                    onClick={handleExport}
                    disabled={gameMode !== GameMode.IDLE}
                    className="py-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-cyan-400 disabled:opacity-50 rounded-lg text-xs transition-colors flex flex-col items-center justify-center"
                    >
                        <span>EXPORT MODEL</span>
                    </button>
                    <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={gameMode !== GameMode.IDLE}
                    className="py-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-fuchsia-400 disabled:opacity-50 rounded-lg text-xs transition-colors flex flex-col items-center justify-center"
                    >
                        <span>IMPORT MODEL</span>
                    </button>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleImport} 
                        className="hidden" 
                        accept=".json"
                    />
              </div>

            </div>
          </div>

          <StatChart data={stats} />
          
          <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800 text-xs text-slate-400 leading-relaxed">
            <p className="mb-2"><strong className="text-cyan-400">System Status:</strong></p>
            <ul className="list-disc pl-4 space-y-1 text-slate-500">
              <li><strong>Parallel Mode:</strong> Allocates {concurrency} real Worker threads.</li>
              <li><strong>Core Efficiency:</strong> Workers run at max CPU speed. Visual updates throttle main thread load.</li>
              <li><strong>Gemini:</strong> Single-session only (Rate Limit protection).</li>
            </ul>
          </div>
        </div>

        {/* Right Panel: Game Arena */}
        <div className="lg:col-span-8 min-h-[600px]">
          {isParallelView ? (
             <div className="h-full flex flex-col bg-slate-900/20 border border-slate-800 rounded-xl relative overflow-hidden p-6">
                
                {/* Session Header */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                   <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700 shadow-lg flex flex-col items-center justify-center">
                      <div className="text-[10px] text-slate-500 uppercase tracking-widest">Wins</div>
                      <div className="text-3xl font-mono font-bold text-cyan-400">{sessionStats.wins}</div>
                   </div>
                   <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700 shadow-lg flex flex-col items-center justify-center">
                      <div className="text-[10px] text-slate-500 uppercase tracking-widest">Losses</div>
                      <div className="text-3xl font-mono font-bold text-fuchsia-400">{sessionStats.losses}</div>
                   </div>
                   <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700 shadow-lg flex flex-col items-center justify-center">
                      <div className="text-[10px] text-slate-500 uppercase tracking-widest">Draws</div>
                      <div className="text-3xl font-mono font-bold text-slate-400">{sessionStats.draws}</div>
                   </div>
                </div>

                {/* Worker Grid */}
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                    {isVisualizing ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {workerStatuses.map((worker) => (
                                worker ? (
                                    <div 
                                        key={worker.id} 
                                        className={`
                                            bg-slate-900 p-3 rounded-lg border-2 flex flex-col items-center gap-2 transition-colors duration-300
                                            ${worker.winner === 'Black' ? 'border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 
                                            worker.winner === 'White' ? 'border-fuchsia-500/50 shadow-[0_0_10px_rgba(217,70,239,0.2)]' : 
                                            'border-slate-800'}
                                        `}
                                    >
                                        <div className="w-full flex justify-between items-center border-b border-slate-800 pb-1 mb-1">
                                            <span className="text-[10px] font-mono text-slate-500">CORE {worker.id}</span>
                                            <span className="text-[10px] font-mono text-slate-400">{worker.gamesPlayed} GAMES</span>
                                        </div>
                                        
                                        {/* Mini Board Visualization */}
                                        <div className="w-24 h-24 grid grid-cols-8 gap-[1px] bg-slate-800 border border-slate-800">
                                            {worker.board.map((row, r) => row.map((cell, c) => (
                                                <div key={`${r}-${c}`} className={`w-full h-full ${cell === 'Black' ? 'bg-cyan-500' : cell === 'White' ? 'bg-fuchsia-500' : 'bg-slate-900'}`}></div>
                                            )))}
                                        </div>

                                        <div className="font-mono font-bold text-sm mt-1">
                                            <span className="text-cyan-400">{worker.scores.Black}</span>
                                            <span className="text-slate-600 mx-2">-</span>
                                            <span className="text-fuchsia-400">{worker.scores.White}</span>
                                        </div>
                                    </div>
                                ) : null
                            ))}
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500">
                            <div className="animate-pulse text-4xl mb-4">⚡</div>
                            <p className="font-mono text-sm">HEADLESS SIMULATION RUNNING</p>
                            <p className="text-xs opacity-50">{concurrency} Threads Active</p>
                        </div>
                    )}
                </div>

                {/* Live Logs Small */}
                <div className="mt-4 pt-2 border-t border-slate-800 h-24 overflow-hidden text-[10px] font-mono opacity-70">
                     {matchLogs.map((log) => (
                        <div key={log.id} className="flex gap-2 text-slate-400">
                            <span>{new Date(log.id).toLocaleTimeString().split(' ')[0]}</span>
                            <span className={log.win ? "text-cyan-400" : "text-fuchsia-400"}>{log.text}</span>
                            <span>{log.score}</span>
                        </div>
                     ))}
                </div>

             </div>
          ) : gameMode === GameMode.IDLE ? (
             <div className="h-full flex flex-col items-center justify-center bg-slate-900/30 border border-slate-800 rounded-xl border-dashed">
                <div className="text-6xl mb-4 opacity-50">⚪⚫</div>
                <h3 className="text-xl font-display text-slate-500">SYSTEM IDLE</h3>
                <p className="text-slate-600 text-sm mt-2">Ready to initiate neural handshake.</p>
             </div>
          ) : (
             <BattleArena 
               board={board}
               validMoves={gameMode === GameMode.PVP && activeColor === 'Black' ? getValidMoves(board, 'Black') : []}
               onMove={executeMove}
               gameMode={gameMode}
               isProcessing={isProcessing}
               scores={countScore(board)}
               activeColor={activeColor}
               lastMove={lastMove}
             />
          )}
        </div>

      </main>

      <ConfirmationModal 
        isOpen={isResetModalOpen}
        title="DANGER: WIPE MEMORY?"
        message="You are about to delete all learned patterns and strategic weights. This action is irreversible and the Neural Brain will return to its infantile state. Are you sure you want to proceed?"
        onConfirm={confirmReset}
        onCancel={() => setIsResetModalOpen(false)}
      />

    </div>
  );
}

export default App;