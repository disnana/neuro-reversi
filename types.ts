export type Disk = 'Black' | 'White' | null;
export type Board = Disk[][];

export interface Coordinate {
  row: number;
  col: number;
}

export interface Move {
  row: number;
  col: number;
}

export interface PlayerState {
  color: Disk;
  score: number; // Number of disks
  isAi: boolean;
}

export interface BattleLog {
  turn: number;
  playerColor: Disk;
  move: Coordinate | 'PASS';
  message: string;
}

// Extended Move type for Memory with metadata
export interface LearnedMove extends Move {
  score: number;      // Confidence/Win count for this pattern
  timestamp: number;  // Last updated time
}

export interface LearningData {
  // Exact Match Memory: "BoardString" -> LearnedMove
  // Stores the best move for a specific board state, with metadata for pruning.
  memory: Record<string, LearnedMove>;
  
  // Positional Weights: 8x8 grid of values indicating strategic value
  // Updated when Gemini wins.
  weights: number[][]; 
  
  totalGames: number;
  wins: number;
  losses: number;
  experience: number;
  maxMemoryLimit: number; // Configurable memory cap
}

export enum GameMode {
  IDLE = 'IDLE',
  TRAINING = 'TRAINING', // Local Bot (Black) vs Gemini (White)
  TRAINING_RANDOM = 'TRAINING_RANDOM', // Local Bot (Black) vs Random (White)
  TRAINING_SELF = 'TRAINING_SELF', // Local Bot (Black) vs Local Bot (White)
  PVP = 'PVP', // Human (Black) vs Local Bot (White)
}

export interface StatPoint {
  game: number;
  winRate: number;
  experience: number;
}

// --- Worker Types ---
export interface WorkerStartMessage {
  type: 'START_GAME';
  mode: GameMode; // Only TRAINING_SELF or TRAINING_RANDOM
  brain: LearningData;
  reportUpdates?: boolean; // If true, worker sends GAME_UPDATE messages. If false, only GAME_OVER.
}

export interface WorkerUpdateMessage {
  type: 'GAME_UPDATE';
  board: Board;
  scores: { Black: number; White: number };
}

export interface WorkerGameOverMessage {
  type: 'GAME_OVER';
  history: { board: Board; move: Move; color: Disk }[];
  winner: Disk;
  scores: { Black: number; White: number }; 
  finalBoard: Board; // Visual snapshot of the completed game
}

export type WorkerOutputMessage = WorkerUpdateMessage | WorkerGameOverMessage;

// UI Type for Grid View
export interface WorkerStatus {
  id: number;
  winner: Disk;
  scores: { Black: number; White: number };
  board: Board;
  gamesPlayed: number;
}