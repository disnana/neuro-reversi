import { LearningData, Board, Move, Disk, Coordinate, LearnedMove } from '../types';
import { STORAGE_KEY, INITIAL_WEIGHTS, BOARD_SIZE } from '../constants';
import { getValidMoves, applyMove, countScore } from './gameLogic';

const DEFAULT_MEMORY_LIMIT = 5000;

const INITIAL_DATA: LearningData = {
  memory: {},
  weights: JSON.parse(JSON.stringify(INITIAL_WEIGHTS)), // Deep copy
  totalGames: 0,
  wins: 0,
  losses: 0,
  experience: 0,
  maxMemoryLimit: DEFAULT_MEMORY_LIMIT,
};

// --- Utilities ---

export const loadBrain = (): LearningData => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return INITIAL_DATA;
  
  try {
    const data = JSON.parse(stored);
    
    // Validate and Migrate Data Structure if necessary
    if (!data.weights) data.weights = JSON.parse(JSON.stringify(INITIAL_WEIGHTS));
    if (!data.memory) data.memory = {};
    if (!data.maxMemoryLimit) data.maxMemoryLimit = DEFAULT_MEMORY_LIMIT;

    // Data Migration: Ensure all memory entries have score and timestamp
    // (For backward compatibility with old saves)
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    return data;
  } catch (e) {
      console.error("Failed to load brain", e);
      return INITIAL_DATA;
  }
};

export const saveBrain = (data: LearningData) => {
  const keys = Object.keys(data.memory);
  const maxLimit = data.maxMemoryLimit || DEFAULT_MEMORY_LIMIT;
  // If full, prune down to 90% to avoid pruning every single turn
  const keepCount = Math.floor(maxLimit * 0.9);

  // Natural Selection Memory Pruning
  if (keys.length > maxLimit) {
     // Convert to array for sorting
     // We map keys to their entry data to sort them
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
     const limit = Math.min(entries.length, keepCount);
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
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const setMemoryLimit = (limit: number) => {
    const data = loadBrain();
    data.maxMemoryLimit = limit;
    saveBrain(data);
};

export const importBrainData = (jsonStr: string): boolean => {
  try {
    const data = JSON.parse(jsonStr);
    // Basic structural validation
    if (
        typeof data.totalGames === 'number' &&
        Array.isArray(data.weights) &&
        typeof data.memory === 'object'
    ) {
        // Ensure maxMemoryLimit exists on import
        if (!data.maxMemoryLimit) data.maxMemoryLimit = DEFAULT_MEMORY_LIMIT;
        saveBrain(data);
        return true;
    }
    return false;
  } catch (e) {
    console.error("Import failed", e);
    return false;
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
        {r:0, c:0}, {r:0, c:7}, {r:7, c:0}, {r:7, c:7}
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

  for(let r=0; r<BOARD_SIZE; r++) {
      for(let c=0; c<BOARD_SIZE; c++) {
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
  const corners = [[0,0], [0,7], [7,0], [7,7]];
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
export const getBestMove = (board: Board, validMoves: Move[], injectedBrain?: LearningData): Move => {
  const data = injectedBrain || loadBrain();
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
  winner: Disk
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
  for(let r=0; r<BOARD_SIZE; r++) {
      for(let c=0; c<BOARD_SIZE; c++) {
          if (newData.weights[r][c] > 600) newData.weights[r][c] = 600;
          if (newData.weights[r][c] < -600) newData.weights[r][c] = -600;
      }
  }

  // Update Memory with Reinforcement
  if (gameHistory.length > 20) {
      const midGame = gameHistory.slice(15, -8); // Learn from midgame patterns
      midGame.forEach(turn => {
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
                  // New Pattern or overwriting weaker/different strategy
                  // Initialize with score 1
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
  if (winner) newData.wins += 1; // Note: In self play, this stat is ambiguous, usually tracks "Primary Bot"
  else newData.losses += 1;

  return newData;
};

// Main thread wrapper
export const learnGame = (
  gameHistory: { board: Board; move: Move; color: Disk }[],
  winner: Disk
) => {
  const data = loadBrain();
  if (!winner) return;
  
  const updated = trainBrain(data, gameHistory, winner);
  saveBrain(updated);
};

export const updateStats = (didWin: boolean) => {
    const data = loadBrain();
    if (didWin) data.wins += 1;
    else data.losses += 1;
    saveBrain(data);
};