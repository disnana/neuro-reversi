import React from 'react';

interface Props {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
}

export const ConfirmationModal: React.FC<Props> = ({ isOpen, onConfirm, onCancel, title, message }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-red-500/50 rounded-xl max-w-md w-full p-6 shadow-[0_0_50px_rgba(239,68,68,0.2)] animate-in fade-in zoom-in duration-200">
        <h3 className="text-xl font-display font-bold text-red-500 mb-2 flex items-center gap-2">
          ⚠️ {title}
        </h3>
        <p className="text-slate-300 mb-6 text-sm leading-relaxed">
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button 
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold transition-colors border border-slate-700"
          >
            CANCEL
          </button>
          <button 
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-bold shadow-lg transition-all"
          >
            CONFIRM RESET
          </button>
        </div>
      </div>
    </div>
  );
};