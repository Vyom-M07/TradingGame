import React, { useState, useEffect } from 'react';
import { reducers } from '../module_bindings';
import { useReducer } from 'spacetimedb/react';
import { X, Sparkles } from 'lucide-react';

interface CreateMarketModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateMarketModal: React.FC<CreateMarketModalProps> = ({ isOpen, onClose }) => {
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('Tech');
  const [description, setDescription] = useState('');
  const [initialPrice, setInitialPrice] = useState(50);

  const createMarketReducer = useReducer(reducers.createMarket);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    createMarketReducer({
      question: question.trim(),
      category: category.trim(),
      description: description.trim() || 'Custom binary prediction market contract.',
      initialPrice,
    });

    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto my-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <h2 className="text-base font-bold text-white">Create Prediction Market</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition cursor-pointer p-1"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Market Question / Event
            </label>
            <input
              type="text"
              placeholder="e.g. Will ETH flip SOL in 24h DEX volume?"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="Crypto">Crypto</option>
                <option value="Macro">Macro</option>
                <option value="Tech">Tech</option>
                <option value="AI">AI</option>
                <option value="Sports">Sports</option>
                <option value="Politics">Politics</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Initial YES Price (¢)
              </label>
              <input
                type="number"
                min="1"
                max="99"
                value={initialPrice}
                onChange={e => setInitialPrice(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Resolution Criteria & Description
            </label>
            <textarea
              rows={3}
              placeholder="Explain how and when the market will be determined..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-slate-400 space-y-1 text-[11px]">
            <p className="font-semibold text-slate-300">Automated Market Liquidity</p>
            <p>
              When created, the automated market maker will automatically populate a dense multi-tier ladder of resting bids and asks around {initialPrice}¢ so players can trade immediately.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-lg shadow-emerald-900/30 cursor-pointer"
            >
              Launch Market
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
