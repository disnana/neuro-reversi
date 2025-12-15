import React from 'react';
import { Board, Disk, Coordinate, GameMode, Move } from '../types';
import { DISK_COLORS } from '../constants';

interface Props {
  board: Board;
  validMoves: Coordinate[];
  onMove: (row: number, col: number) => void;
  gameMode: GameMode;
  isProcessing: boolean;
  scores: { Black: number; White: number };
  activeColor: Disk;
  lastMove: Move | null;
}

const getOpponentName = (mode: GameMode): string => {
  switch (mode) {
    case GameMode.TRAINING: return 'Gemini AI (Teacher)';
    case GameMode.TRAINING_RANDOM: return 'Random Walker (Dummy)';
    case GameMode.TRAINING_SELF: return 'NeuroBot Clone (Self)';
    case GameMode.PVP: return 'NeuroBot v3 (White)';
    default: return 'Waiting...';
  }
};

export const BattleArena: React.FC<Props> = ({
  board,
  validMoves,
  onMove,
  gameMode,
  isProcessing,
  scores,
  activeColor,
  lastMove
}) => {

  const isHumanTurn = gameMode === GameMode.PVP && activeColor === 'Black';
  const opponentName = getOpponentName(gameMode);

  return (
    <div className="flex flex-col items-center justify-center h-full w-full max-w-4xl mx-auto p-2 md:p-4 gap-4 md:gap-6">

      {/* Scoreboard */}
      <div className="flex justify-between items-center w-full max-w-2xl bg-slate-900/90 p-3 md:p-6 rounded-2xl border border-slate-700 shadow-2xl backdrop-blur-sm relative overflow-hidden">
        {/* Active Turn Indicator Line */}
        <div className={`absolute bottom-0 h-1 bg-cyan-500 transition-all duration-500 ${activeColor === 'Black' ? 'left-0 w-1/2' : 'left-1/2 w-1/2'}`}></div>

        <div className={`flex flex-col items-center w-1/2 transition-opacity ${activeColor === 'Black' ? 'opacity-100 scale-105' : 'opacity-60'}`}>
          <div className="text-[10px] md:text-xs font-display text-slate-400 uppercase tracking-widest mb-1 text-center">
            {gameMode === GameMode.TRAINING || gameMode === GameMode.TRAINING_RANDOM || gameMode === GameMode.TRAINING_SELF
              ? 'Local Bot'
              : 'YOU (Black)'}
          </div>
          <div className="text-3xl md:text-5xl font-bold font-display text-cyan-400">{scores.Black}</div>
          <div className={`w-2 h-2 md:w-3 md:h-3 rounded-full mt-1 md:mt-2 ${DISK_COLORS.Black}`}></div>
        </div>

        <div className="h-8 md:h-12 w-px bg-slate-700 mx-2 md:mx-4"></div>

        <div className={`flex flex-col items-center w-1/2 transition-opacity ${activeColor === 'White' ? 'opacity-100 scale-105' : 'opacity-60'}`}>
          <div className="text-[10px] md:text-xs font-display text-slate-400 uppercase tracking-widest mb-1 text-center whitespace-nowrap overflow-hidden text-ellipsis w-full">
            {opponentName}
          </div>
          <div className="text-3xl md:text-5xl font-bold font-display text-fuchsia-400">{scores.White}</div>
          <div className={`w-2 h-2 md:w-3 md:h-3 rounded-full mt-1 md:mt-2 ${DISK_COLORS.White}`}></div>
        </div>
      </div>

      {/* The Board */}
      <div className="relative p-1 md:p-2 bg-slate-800 rounded-lg shadow-2xl border-2 md:border-4 border-slate-700">
        <div
          className="grid grid-cols-8 gap-[1px] md:gap-1 bg-slate-900 border border-slate-900 mx-auto"
          style={{ width: 'min(90vw, 500px)', aspectRatio: '1 / 1', height: 'auto' }}
        >
          {board.map((row, rIndex) => (
            row.map((cell, cIndex) => {
              // Check if valid move
              const isValid = isHumanTurn && validMoves.some(m => m.row === rIndex && m.col === cIndex);
              const isLastMove = lastMove?.row === rIndex && lastMove?.col === cIndex;

              return (
                <div
                  key={`${rIndex}-${cIndex}`}
                  onClick={() => isValid && onMove(rIndex, cIndex)}
                  className={`
                    relative w-full h-full flex items-center justify-center
                    ${(rIndex + cIndex) % 2 === 0 ? 'bg-slate-800/50' : 'bg-slate-800/30'}
                    ${isValid ? 'cursor-pointer hover:bg-cyan-900/30' : ''}
                  `}
                  style={{ aspectRatio: '1/1' }}
                >
                  {/* Grid Marker */}
                  <div className="absolute inset-0 border border-slate-700/20 pointer-events-none"></div>

                  {/* Valid Move Hint */}
                  {isValid && (
                    <div className="w-2 h-2 md:w-3 md:h-3 rounded-full bg-cyan-500/30 animate-pulse pointer-events-none"></div>
                  )}

                  {/* Disk */}
                  {cell && (
                    <div
                      className={`
                          w-[85%] h-[85%] rounded-full transition-all duration-300 transform shadow-lg
                          ${DISK_COLORS[cell]}
                          ${isLastMove ? 'ring-1 md:ring-2 ring-white scale-105 md:scale-110' : ''}
                        `}
                      style={{ aspectRatio: '1/1' }}
                    >
                      <div className="w-full h-full rounded-full bg-gradient-to-br from-white/20 to-transparent"></div>
                    </div>
                  )}
                </div>
              );
            })
          ))}
        </div>

        {/* Processing Overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-slate-900/60 z-20 flex items-center justify-center backdrop-blur-[2px] rounded-lg">
            <div className="flex flex-col items-center animate-pulse">
              <div className="text-cyan-400 font-display tracking-widest text-sm md:text-lg font-bold shadow-black drop-shadow-lg">
                {gameMode === GameMode.TRAINING ? 'NEURAL PROCESSING' : 'CALCULATING'}
              </div>
              <div className="text-[10px] md:text-xs text-cyan-200 mt-1">Analyzing Strategy...</div>
            </div>
          </div>
        )}
      </div>

      {/* Status Text */}
      <div className="h-6 md:h-8 text-center">
        {activeColor === null ? (
          scores.Black > scores.White ? (
            <div className="text-cyan-400 font-bold tracking-widest animate-bounce text-sm md:text-base">BLACK WINS!</div>
          ) : scores.White > scores.Black ? (
            <div className="text-fuchsia-400 font-bold tracking-widest animate-bounce text-sm md:text-base">WHITE WINS!</div>
          ) : (
            <div className="text-yellow-400 font-bold tracking-widest animate-bounce text-sm md:text-base">DRAW!</div>
          )
        ) : (
          <div className="text-slate-500 text-xs md:text-sm">
            Current Turn: <span className={activeColor === 'Black' ? 'text-cyan-400' : 'text-fuchsia-400'}>{activeColor}</span>
          </div>
        )}
      </div>

    </div>
  );
};