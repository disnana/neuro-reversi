import { GameMode, Disk, Board, Move, WorkerStartMessage, Coordinate } from '../types';
// We still need createInitialBoard for the initial state sent to UI, 
// OR we can just create it from Rust. But keeping it simple for now.
import { createInitialBoard } from './gameLogic';
import init, { Bitboard } from 'neuroreversi-engine';

/*
 * WEB WORKER ENTRY POINT (v3.0 - Rust Powered)
 */

let isWasmInitialized = false;

// Helper to convert JS Board to Rust Bitboard U64s
const boardToBitboard = (board: Board): Bitboard => {
  let black = 0n;
  let white = 0n;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      if (cell === 'Black') {
        black |= (1n << BigInt(r * 8 + c));
      } else if (cell === 'White') {
        white |= (1n << BigInt(r * 8 + c));
      }
    }
  }
  return Bitboard.create(black, white);
};

// Helper: Convert JS Board to Rust Bitboard directly
// Actually, it's faster to maintain state as Bitboard in the loop if possible.
// But we need to report 'Board' structure to UI.
// Strategy: Keep 'Board' (Array) as master for history/reporting, 
// Convert to Bitboard for Thinking/ValidMove check.
// Optimization: We could keep Bitboard as master and only unpack to 2D array when reporting.
// Let's try Hybrid: Maintain JS 'board' for compatibility, use Rust for logic steps.

self.onmessage = async (event: MessageEvent<WorkerStartMessage>) => {
  const { type, mode, brain, reportUpdates } = event.data;

  if (type !== 'START_GAME') return;

  if (!isWasmInitialized) {
    // In Worker, import.meta.url is the worker script location.
    // We need to point to the Public folder where .wasm is served.
    // Assuming worker is at /assets/worker.js, and wasm is at /neuroreversi_engine_bg.wasm
    // In Vite dev, worker handles imports differently.
    // Let's try the direct import provided by the plugin first.
    try {
      await init();
      isWasmInitialized = true;
    } catch (e) {
      console.warn("Standard init failed, trying explicit path", e);
      try {
        await init('/neuroreversi_engine_bg.wasm');
        isWasmInitialized = true;
      } catch (e2) {
        console.error("CRITICAL: Failed to load WASM in Worker", e2);
        return;
      }
    }
  }

  let board = createInitialBoard();
  let activeColor: Disk = 'Black';
  const history: { board: Board; move: Move; color: Disk }[] = [];
  let noMoveCount  // Safety break
  let turnCount = 0;
  const MAX_TURNS = 200;

  // Throttle state
  let lastUpdateTimestamp = 0;

  // Create persisted Bitboard instance if possible? 
  // Rust Bitboard is immutable in our current design (apply_move returns new one).
  // So we recreate or update every turn.
  // Converting 64 squares is fast enough (nanoseconds).

  while (turnCount < MAX_TURNS) {
    const bb = boardToBitboard(board);
    const isBlack = activeColor === 'Black';

    // Check moves using WASM
    // Returns Vec<u8> (Uint8Array in JS)
    const validIndices = bb.get_valid_moves_indices(isBlack);

    if (validIndices.length === 0) {
      noMoveCount++;
      if (noMoveCount >= 2) break; // Double pass

      activeColor = activeColor === 'Black' ? 'White' : 'Black';
      continue;
    }

    noMoveCount = 0;
    let selectedIndex: number;

    // --- DECISION LOGIC (RUST POWERED) ---
    if (activeColor === 'Black') {
      // AI TURN (Rust Minimax)

      // Prepare weights
      let weights = new Int32Array(64);
      if (brain && brain.weights) {
        // Convert JS weights to Int32 for Rust
        for (let i = 0; i < 64; i++) {
          weights[i] = Math.floor(brain.weights[i]);
        }
      } else {
        // Default fallbacks if no brain loaded
        // Corner: 100, X-squares: -20, C-squares: -10, etc.
        // Just zero for now, logic has hardcoded fallback? No, logic depends on weights now.
        // Important: If we pass all zeros, the AI will only play based on Mobility and Disc Count.
        // Let's rely on that for "Baby" state.
      }

      const depth = 6;
      selectedIndex = bb.get_best_move(depth, isBlack, weights);
    } else {
      // OPPONENT TURN
      if (mode === GameMode.TRAINING_RANDOM) {
        // Random
        const rand = Math.floor(Math.random() * validIndices.length);
        selectedIndex = validIndices[rand];
      } else if (mode === GameMode.TRAINING_SELF) {
        // Self Play: Also use Rust AI
        const depth = 4; // Slightly faster for self-play bulk
        // For opponent self-play, use same brain weights or inverted?
        // Usually same brain playing itself.
        let weights = new Int32Array(64);
        if (brain && brain.weights) {
          for (let i = 0; i < 64; i++) weights[i] = Math.floor(brain.weights[i]);
        }
        selectedIndex = bb.get_best_move(depth, isBlack, weights);
      } else {
        // Simple greedy/first
        selectedIndex = validIndices[0];
      }
    }

    // Convert Index to Row/Col
    const selectedMove: Move = {
      row: Math.floor(selectedIndex / 8),
      col: selectedIndex % 8
    };

    // Record History
    history.push({
      board: JSON.parse(JSON.stringify(board)), // Deep copy 
      move: selectedMove,
      color: activeColor
    });

    // Apply Move (Use WASM to calculate result? No, we need to update the JS Board for history)
    // We *could* use bb.apply_move().to_js_array() if we wrote that method.
    // For now, let's trust our JS applyMove or reimplement it?
    // Actually, calling JS logic here is fine for state update, provided it matches Rust logic.
    // BUT! To be "v3", we should probably use the Rust result to ensure consistency.
    // Let's stick to JS applyMove for state tracking to minimize rewrite risk, 
    // since Rust only gave us the DECISION.
    // WAIT. If Rust 'get_best_move' uses Minimax, it simulates valid moves.
    // If JS 'applyLogic' is different, they desync.
    // v2.2 JS Logic is robust. We'll use it for the "Official State Record".

    // Use JS applyMove logic to update the master board
    // Ideally we import applyMove from gameLogic
    // But wait, I need to make sure I imported it. 
    // I did not import applyMove in the replace block above? checking...
    // I imported createInitialBoard. I need applyMove.

    // Let's reimplement simple apply loop here or import it.
    // I'll assume I can import it.

    const { applyMove: applyMoveJS, countScore: countScoreJS } = await import('./gameLogic');
    board = applyMoveJS(board, activeColor, selectedMove.row, selectedMove.col);

    if (reportUpdates) {
      // Throttling: Only send update every 50ms to prevent UI congestion
      const now = Date.now();
      if (now - lastUpdateTimestamp > 50) { // 20 FPS cap
        lastUpdateTimestamp = now;
        self.postMessage({
          type: 'GAME_UPDATE',
          board: board,
          scores: countScoreJS(board)
        });
      }
    }

    activeColor = activeColor === 'Black' ? 'White' : 'Black';
    turnCount++;
  }

  // Game Over
  const { countScore: finalCount } = await import('./gameLogic');
  const scores = finalCount(board);
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