import { GameMode, Disk, Board, Move, WorkerStartMessage } from '../types';
import { createInitialBoard, getValidMoves, applyMove, countScore } from './gameLogic';
import { getBestMove } from './learningService';

/*
 * WEB WORKER ENTRY POINT
 * Runs on a separate CPU thread.
 * DO NOT access DOM or localStorage here.
 */

self.onmessage = async (event: MessageEvent<WorkerStartMessage>) => {
  const { type, mode, brain, reportUpdates } = event.data;

  if (type !== 'START_GAME') return;

  let board = createInitialBoard();
  let activeColor: Disk = 'Black';
  const history: { board: Board; move: Move; color: Disk }[] = [];
  let noMoveCount = 0;

  // Safety break
  let turnCount = 0;
  const MAX_TURNS = 200;

  while (turnCount < MAX_TURNS) {
    const validMoves = getValidMoves(board, activeColor);

    if (validMoves.length === 0) {
      noMoveCount++;
      if (noMoveCount >= 2) break; // Double pass = Game Over

      activeColor = activeColor === 'Black' ? 'White' : 'Black';
      continue;
    }

    noMoveCount = 0;
    let selectedMove: Move;

    // --- DECISION LOGIC ---
    if (activeColor === 'Black') {
      // Local Bot (Learning Agent)
      // CRITICAL: Pass 'brain' explicitly to avoid localStorage access in Worker
      selectedMove = await getBestMove(board, validMoves, brain);
    } else {
      // White Player (Opponent)
      if (mode === GameMode.TRAINING_RANDOM) {
        selectedMove = validMoves[Math.floor(Math.random() * validMoves.length)];
      } else if (mode === GameMode.TRAINING_SELF) {
        selectedMove = await getBestMove(board, validMoves, brain);
      } else {
        selectedMove = validMoves[0];
      }
    }

    // Record History
    history.push({
      board: JSON.parse(JSON.stringify(board)),
      move: selectedMove,
      color: activeColor
    });

    // Apply Move
    board = applyMove(board, activeColor, selectedMove.row, selectedMove.col);

    // --- REAL-TIME UPDATE ---
    // Post updates for visualization only if requested.
    // This optimization allows massive concurrency without freezing the UI thread.
    if (reportUpdates) {
      self.postMessage({
        type: 'GAME_UPDATE',
        board: board,
        scores: countScore(board)
      });
    }

    // Switch Turn
    activeColor = activeColor === 'Black' ? 'White' : 'Black';
    turnCount++;
  }

  // Game Over
  const scores = countScore(board);
  let winner: Disk = null;
  if (scores.Black > scores.White) winner = 'Black';
  else if (scores.White > scores.Black) winner = 'White';

  self.postMessage({
    type: 'GAME_OVER',
    history,
    winner,
    scores,
    finalBoard: board
  });
};