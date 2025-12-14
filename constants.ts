import { Disk } from './types';

export const BOARD_SIZE = 8;
export const STORAGE_KEY = 'neuro_reversi_brain_v3'; // Version up for advanced logic

export const DISK_COLORS: Record<string, string> = {
  Black: 'bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.6)]', // Cyberpunk Blue/Cyan
  White: 'bg-fuchsia-500 shadow-[0_0_15px_rgba(217,70,239,0.6)]', // Cyberpunk Pink/Purple
};

// Advanced Strategic Weights
// Corners (0,0 etc) are 500.
// X-squares (1,1 etc) are -500 (Death zone if corner is empty).
// C-squares (0,1 etc) are -100.
export const INITIAL_WEIGHTS = [
  [ 500, -100,  50,  10,  10,  50, -100,  500],
  [-100, -500, -10,  -5,  -5, -10, -500, -100],
  [  50,  -10,  20,   5,   5,  20,  -10,   50],
  [  10,   -5,   5,   1,   1,   5,   -5,   10],
  [  10,   -5,   5,   1,   1,   5,   -5,   10],
  [  50,  -10,  20,   5,   5,  20,  -10,   50],
  [-100, -500, -10,  -5,  -5, -10, -500, -100],
  [ 500, -100,  50,  10,  10,  50, -100,  500],
];