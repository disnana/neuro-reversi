import { Board, Disk, Coordinate } from '../types';
import { BOARD_SIZE } from '../constants';

// Directions to check: [row, col]
const DIRECTIONS = [
  [-1, 0], [1, 0], [0, -1], [0, 1], // Cardinal
  [-1, -1], [-1, 1], [1, -1], [1, 1] // Diagonal
];

export const createInitialBoard = (): Board => {
  const board: Board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
  const center = BOARD_SIZE / 2;
  board[center - 1][center - 1] = 'White';
  board[center][center] = 'White';
  board[center - 1][center] = 'Black';
  board[center][center - 1] = 'Black';
  return board;
};

export const isValidMove = (board: Board, color: Disk, row: number, col: number): boolean => {
  if (board[row][col] !== null) return false;

  for (const [dRow, dCol] of DIRECTIONS) {
    let r = row + dRow;
    let c = col + dCol;
    let hasOpponent = false;

    while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
      const cell = board[r][c];
      if (cell === null) break;
      if (cell !== color) {
        hasOpponent = true;
      } else {
        if (hasOpponent) return true; // Found a valid line
        break;
      }
      r += dRow;
      c += dCol;
    }
  }
  return false;
};

export const getValidMoves = (board: Board, color: Disk): Coordinate[] => {
  const moves: Coordinate[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (isValidMove(board, color, r, c)) {
        moves.push({ row: r, col: c });
      }
    }
  }
  return moves;
};

export const applyMove = (board: Board, color: Disk, row: number, col: number): Board => {
  const newBoard = board.map(r => [...r]);
  newBoard[row][col] = color;

  for (const [dRow, dCol] of DIRECTIONS) {
    let r = row + dRow;
    let c = col + dCol;
    const disksToFlip: Coordinate[] = [];

    while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
      const cell = newBoard[r][c];
      if (cell === null) break;
      if (cell !== color) {
        disksToFlip.push({ row: r, col: c });
      } else {
        // Found our own color, flip the sandwiched ones
        if (disksToFlip.length > 0) {
          disksToFlip.forEach(pos => {
            newBoard[pos.row][pos.col] = color;
          });
        }
        break;
      }
      r += dRow;
      c += dCol;
    }
  }
  return newBoard;
};

export const countScore = (board: Board): { Black: number; White: number } => {
  let black = 0;
  let white = 0;
  board.flat().forEach(cell => {
    if (cell === 'Black') black++;
    if (cell === 'White') white++;
  });
  return { Black: black, White: white };
};

export const checkGameOver = (board: Board): boolean => {
  const blackMoves = getValidMoves(board, 'Black');
  const whiteMoves = getValidMoves(board, 'White');
  return blackMoves.length === 0 && whiteMoves.length === 0;
};