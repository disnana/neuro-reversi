import { LearningData, Board, Move, Disk, Coordinate, LearnedMove, GameMode } from '../types';
import { STORAGE_KEY, INITIAL_WEIGHTS, BOARD_SIZE } from '../constants';
import { getValidMoves, applyMove, countScore } from './gameLogic';

const DEFAULT_MEMORY_LIMIT = 5000;
const DB_NAME = 'NeuroReversiDB';
const DB_VERSION = 1;
const STORE_NAME = 'brainStore';
const DATA_KEY = 'mainBrain';

const INITIAL_DATA: LearningData = {
  memory: {},
  weights: JSON.parse(JSON.stringify(INITIAL_WEIGHTS)), // Deep copy
  totalGames: 0,
  wins: 0,
  losses: 0,
  experience: 0,
  maxMemoryLimit: DEFAULT_MEMORY_LIMIT,
};

// --- IndexedDB Utilities ---

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

// --- Utilities ---

export const loadBrain = async (): Promise<LearningData> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(DATA_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (request.result) {
          // Validate and Migrate Data Structure if necessary for loaded IDB data
          const data = request.result;
          if (!data.weights) data.weights = JSON.parse(JSON.stringify(INITIAL_WEIGHTS));
          if (!data.memory) data.memory = {};
          if (!data.maxMemoryLimit) data.maxMemoryLimit = DEFAULT_MEMORY_LIMIT;

          // Data Migration: Ensure all memory entries have score and timestamp
          let migrated = false;
          for (const key in data.memory) {
            const entry = data.memory[key];
            if (typeof entry.score === 'undefined') {
              data.memory[key] = {
                ...entry,
                score: 1, // Default score
                timestamp: Date.now()
              };
              migrated = true;
            }
          }
          if (migrated) {
            // Save migrated data back to IDB
            saveBrain(data).then(() => console.log("Migrated old IDB data structure."));
          }

          resolve(data);
        } else {
          // Migration: Check localStorage if IDB is empty
          const localData = localStorage.getItem(STORAGE_KEY);
          if (localData) {
            try {
              console.log("Migrating data from localStorage to IndexedDB...");
              const parsed = JSON.parse(localData);
              // Ensure structure
              if (!parsed.weights) parsed.weights = JSON.parse(JSON.stringify(INITIAL_WEIGHTS));
              if (!parsed.memory) parsed.memory = {};
              if (!parsed.maxMemoryLimit) parsed.maxMemoryLimit = DEFAULT_MEMORY_LIMIT;

              // Save to IDB immediately
              saveBrain(parsed).then(() => {
                // Optional: Clear localStorage after successful migration? 
                // localStorage.removeItem(STORAGE_KEY); 
                console.log("Migration successful.");
              });
              resolve(parsed);
            } catch (e) {
              console.error("Failed to parse localStorage data during migration", e);
              resolve(INITIAL_DATA);
            }
          } else {
            resolve(INITIAL_DATA);
          }
        }
      };
    });
  } catch (e) {
    console.error("Failed to load brain from DB", e);
    return INITIAL_DATA;
  }
};

// Helper to prune memory based on limit
const pruneMemory = (data: LearningData, limit: number) => {
  const keys = Object.keys(data.memory);
  if (keys.length <= limit) return;

  // Convert to array for sorting
  const entries = keys.map(k => ({ key: k, ...data.memory[k] }));

  // Sort Logic:
  // 1. Keep High Score (High Confidence/Win Rate) -> Sort Descending by Score
  // 2. Keep Newer (Recency) -> Sort Descending by Timestamp
  entries.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return b.timestamp - a.timestamp;
  });

  // Keep only the top performing/newest memories
  const newMemory: Record<string, LearnedMove> = {};
  for (let i = 0; i < limit; i++) {
    const entry = entries[i];
    newMemory[entry.key] = {
      row: entry.row,
      col: entry.col,
      score: entry.score,
      timestamp: entry.timestamp
    };
  }
  data.memory = newMemory;
};

export const saveBrain = async (data: LearningData): Promise<void> => {
  // Prune only if significantly over limit to keep performance high
  // With IndexedDB we can be more relaxed, but we don't want memory object to crash JS heap
  const currentLimit = data.maxMemoryLimit || DEFAULT_MEMORY_LIMIT;
  if (Object.keys(data.memory).length > currentLimit * 1.1) { // Prune if 10% over limit
    pruneMemory(data, currentLimit);
  }

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(data, DATA_KEY);

      request.onerror = () => {
        console.error("IDB Save Failed:", request.error);
        reject(request.error);
      };
      request.onsuccess = () => resolve();
    });
  } catch (e) {
    console.error("Critical DB Error:", e);
  }
};

export const setMemoryLimit = async (limit: number) => {
  const data = await loadBrain();
  data.maxMemoryLimit = limit;
  // Prune proactively if the new limit is smaller than current usage
  if (Object.keys(data.memory).length > limit) {
    pruneMemory(data, limit);
  }
  await saveBrain(data);
};

export const importBrainData = async (jsonStr: string): Promise<boolean> => {
  try {
    const data = JSON.parse(jsonStr);
    // Basic structural validation
    if (
      typeof data.totalGames === 'number' &&
      Array.isArray(data.weights) &&
      typeof data.memory === 'object'
    ) {
      // Ensure maxMemoryLimit exists on import, defaulting to the imported size if larger than default
      const currentSize = Object.keys(data.memory).length;
      if (!data.maxMemoryLimit || data.maxMemoryLimit < currentSize) {
        data.maxMemoryLimit = Math.max(DEFAULT_MEMORY_LIMIT, currentSize);
      }

      await saveBrain(data);
      return true;
    }
    return false;
  } catch (e) {
    console.error("Import failed", e);
    return false;
  }
};

export const resetBrain = async (): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(DATA_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        // Also clear localStorage just in case
        localStorage.removeItem(STORAGE_KEY);
        resolve();
      };
    });
  } catch (e) {
    console.error("Failed to reset brain:", e);
  }
};

const getBoardHash = (board: Board): string => {
  return board.map(row => row.map(c => c === null ? '_' : c === 'Black' ? 'B' : 'W').join('')).join('');
};

// --- Advanced AI Logic ---

// Check if a move is dangerously close to an empty corner (X-square or C-square)
const isRiskyMove = (board: Board, row: number, col: number): boolean => {
  // Corners
  const corners = [
    { r: 0, c: 0 }, { r: 0, c: 7 }, { r: 7, c: 0 }, { r: 7, c: 7 }
  ];

  // If we are taking a corner, it's never risky.
  if ((row === 0 || row === 7) && (col === 0 || col === 7)) return false;

  // Check relationship to corners
  for (const corner of corners) {
    // If this corner is empty...
    if (board[corner.r][corner.c] === null) {
      // Calculate distance
      const dr = Math.abs(corner.r - row);
      const dc = Math.abs(corner.c - col);

      // X-square: distance 1,1 (diagonally adjacent) - EXTREMELY RISKY
      if (dr === 1 && dc === 1) return true;

      // C-square: distance 0,1 or 1,0 (orthogonally adjacent) - RISKY
      // Only risky if we don't control the edge, but simplified: risky.
      if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) return true;
    }
  }
  return false;
};

// Returns score: Positive = Good for 'color'
const evaluateBoard = (board: Board, color: Disk, learnedWeights: number[][]): number => {
  const opponent = color === 'Black' ? 'White' : 'Black';
  let score = 0;

  // 1. Game Phase Detection
  let emptyCount = 0;
  let myDisks = 0;
  let oppDisks = 0;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === null) emptyCount++;
      else if (board[r][c] === color) myDisks++;
      else oppDisks++;
    }
  }

  // Endgame: Just count disks (who has more wins)
  if (emptyCount === 0) {
    return (myDisks - oppDisks) * 10000;
  }

  // 2. Corner Stability & Risk Analysis
  const corners = [[0, 0], [0, 7], [7, 0], [7, 7]];
  let myCorners = 0;
  let oppCorners = 0;

  for (const [r, c] of corners) {
    if (board[r][c] === color) {
      myCorners++;
      score += 2000; // Massive bonus for securing corner
    } else if (board[r][c] === opponent) {
      oppCorners++;
      score -= 2000;
    } else {
      // Corner is empty. Check adjacent squares for "Donating Corner" risks.
      // This logic is partially handled by weights, but we enforce it here for dynamic evaluation.
    }
  }

  // 3. Mobility (The #1 strategy in midgame)
  // We want to maximize our moves and minimize opponent's moves.
  const myMoveCount = getValidMoves(board, color).length;
  const oppMoveCount = getValidMoves(board, opponent).length;

  // High weight on mobility in midgame
  score += (myMoveCount - oppMoveCount) * 50;

  // 4. Positional Weights (Learned + Heuristic)
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell === color) {
        score += learnedWeights[r][c];
      } else if (cell === opponent) {
        score -= learnedWeights[r][c];
      }
    }
  }

  return score;
};

// Minimax with Alpha-Beta Pruning
const minimax = (
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  maximizingPlayer: boolean,
  myColor: Disk,
  learnedWeights: number[][]
): number => {
  const opponent = myColor === 'Black' ? 'White' : 'Black';

  // Leaf node
  if (depth === 0) {
    return evaluateBoard(board, myColor, learnedWeights);
  }

  const currentColor = maximizingPlayer ? myColor : opponent;
  const validMoves = getValidMoves(board, currentColor);

  // Terminal node (No moves)
  if (validMoves.length === 0) {
    const oppMoves = getValidMoves(board, maximizingPlayer ? opponent : myColor);
    if (oppMoves.length === 0) {
      // Game Over: True Score
      const counts = countScore(board);
      const myCount = myColor === 'Black' ? counts.Black : counts.White;
      const oppCount = myColor === 'Black' ? counts.White : counts.Black;
      // Multiply by huge number to prioritize winning over positional score
      return (myCount - oppCount) * 100000;
    }
    // Pass turn
    return minimax(board, depth - 1, alpha, beta, !maximizingPlayer, myColor, learnedWeights);
  }

  // Optimization: Move Ordering
  validMoves.sort((a, b) => {
    const wa = learnedWeights[a.row][a.col];
    const wb = learnedWeights[b.row][b.col];
    return wb - wa; // Descending
  });

  if (maximizingPlayer) {
    let maxEval = -Infinity;
    for (const move of validMoves) {
      const nextBoard = applyMove(board, myColor, move.row, move.col);
      const evalScore = minimax(nextBoard, depth - 1, alpha, beta, false, myColor, learnedWeights);
      maxEval = Math.max(maxEval, evalScore);
      alpha = Math.max(alpha, evalScore);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of validMoves) {
      const nextBoard = applyMove(board, opponent, move.row, move.col);
      const evalScore = minimax(nextBoard, depth - 1, alpha, beta, true, myColor, learnedWeights);
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }
};

// Now accepts an optional 'injectedBrain' for Worker use
export const getBestMove = async (board: Board, validMoves: Move[], injectedBrain?: LearningData): Promise<Move> => {
  const data = injectedBrain || (await loadBrain());
  const hash = getBoardHash(board);

  // Determine who we are calculating for (Simple Inference)
  let aiColor: Disk = 'White';
  const testBlackMoves = getValidMoves(board, 'Black');
  if (testBlackMoves.some(m => m.row === validMoves[0].row && m.col === validMoves[0].col)) {
    aiColor = 'Black';
  }

  // 1. EXACT MEMORY (High Confidence Only)
  if (data.memory[hash]) {
    const memEntry = data.memory[hash];
    // Only use memory if it matches a valid move (rule check)
    if (validMoves.some(m => m.row === memEntry.row && m.col === memEntry.col)) {
      // Only follow memory if it has a positive score or we have little experience
      if (data.totalGames < 50 || memEntry.score > 0) {
        return { row: memEntry.row, col: memEntry.col };
      }
    }
  }

  // 2. ENDGAME SOLVER & MINIMAX
  const emptyCount = board.flat().filter(c => c === null).length;
  let depth = 4;

  if (emptyCount <= 12) {
    depth = 12; // Solve the game
  } else if (emptyCount <= 16) {
    depth = 6;
  }

  let bestMove = validMoves[0];
  let maxScore = -Infinity;

  // Filter out immediate suicide moves (X-squares) if we have other options
  let candidateMoves = validMoves;
  const safeMoves = validMoves.filter(m => !isRiskyMove(board, m.row, m.col));

  if (safeMoves.length > 0 && depth < 10) {
    candidateMoves = safeMoves;
  }

  for (const move of candidateMoves) {
    const nextBoard = applyMove(board, aiColor, move.row, move.col);
    const score = minimax(nextBoard, depth - 1, -Infinity, Infinity, false, aiColor, data.weights);

    if (score > maxScore) {
      maxScore = score;
      bestMove = move;
    } else if (score === maxScore) {
      if (Math.random() > 0.5) bestMove = move;
    }
  }

  return bestMove;
};

// Pure function to calculate updates without saving (for Worker aggregation)
export const trainBrain = (
  currentData: LearningData,
  gameHistory: { board: Board; move: Move; color: Disk }[],
  winner: Disk,
  mode: GameMode = GameMode.TRAINING
): LearningData => {
  // Create a shallow copy of structure, deep copy of weights to avoid mutation issues
  const newData: LearningData = {
    ...currentData,
    weights: currentData.weights.map(row => [...row]),
    memory: { ...currentData.memory }
  };

  if (!winner) return newData;

  // Update Weights
  gameHistory.forEach(turn => {
    const { row, col } = turn.move;
    if (turn.color === winner) {
      newData.weights[row][col] += 0.5;
    } else {
      newData.weights[row][col] -= 0.25;
    }
  });

  // Clamp weights
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (newData.weights[r][c] > 600) newData.weights[r][c] = 600;
      if (newData.weights[r][c] < -600) newData.weights[r][c] = -600;
    }
  }

  // Update Memory with Reinforcement
  if (gameHistory.length > 20) {
    const midGame = gameHistory.slice(15, -8); // Learn from midgame patterns
    midGame.forEach(turn => {
      // In VS SELF, we learn from BOTH sides (both are "Me")
      // In VS RANDOM (Bot=Black), we only trust our wins (Black). 
      // If White won in VS Random, it means Random beat us. We should punish Black steps? 
      // Current logic: "if (turn.color === winner)". 
      // This means we reinforce the WINNER's moves.
      // VS Random: If Black (Bot) wins, we reinforce Black. Correct.
      // VS Random: If White (Random) wins, we reinforce White... wait. White was random. 
      // Reinforcing Random moves that beat us is... sort of okay? It means "This was a good move". 
      // But we are storing it in OUR memory. If we play as Black, and we store White's winning moves,
      // can we use them? The board is symmetric? No.
      // 
      // User Question 2: "In VS Self, 2x data?". 
      // Yes, in VS Self, Black and White are both "Brain". 
      // So if Black wins, Black moves are good. If White wins, White moves are good.
      // The current logic `if (turn.color === winner)` ALREADY captures the winning side's moves.
      // So VS Self is already learning from the winner.
      //
      // What about stats?

      if (turn.color === winner) {
        const hash = getBoardHash(turn.board);
        const existing = newData.memory[hash];

        if (existing && existing.row === turn.move.row && existing.col === turn.move.col) {
          // Reinforcement: Strengthen existing winning pattern
          newData.memory[hash] = {
            ...existing,
            score: existing.score + 1,
            timestamp: Date.now()
          };
        } else {
          // New Pattern
          newData.memory[hash] = {
            row: turn.move.row,
            col: turn.move.col,
            score: 1,
            timestamp: Date.now()
          };
        }
      }
    });
  }

  newData.totalGames += 1;
  newData.experience += (winner ? 150 : 50);

  // --- STATS LOGIC FIX ---
  if (mode === GameMode.TRAINING_SELF) {
    // In Self Play, we are always the winner (we generated both sides).
    // Or rather, the "System" won.
    newData.wins += 1;
  } else if (mode === GameMode.TRAINING_RANDOM) {
    // Bot is Black. Random is White.
    if (winner === 'Black') newData.wins += 1;
    else newData.losses += 1;
  } else {
    // Standard Mode / PVP vs Bot
    // If Bot is Black... usually.
    if (winner === 'Black') newData.wins += 1;
    else newData.losses += 1;
  }

  return newData;
};

// Main thread wrapper
export const learnGame = async (
  gameHistory: { board: Board; move: Move; color: Disk }[],
  winner: Disk,
  mode: GameMode = GameMode.TRAINING
) => {
  const data = await loadBrain();
  if (!winner) return;

  const updated = trainBrain(data, gameHistory, winner, mode);
  await saveBrain(updated);
};

export const updateStats = async (didWin: boolean) => {
  const data = await loadBrain();
  if (didWin) data.wins += 1;
  else data.losses += 1;
  await saveBrain(data);
};