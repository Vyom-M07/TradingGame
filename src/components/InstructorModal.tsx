import { useState, useEffect } from 'react';
import { Market, Clue } from '../module_bindings/types';
import { X, Shield, Eye, Undo2, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface InstructorModalProps {
  isOpen: boolean;
  onClose: () => void;
  market: Market | null;
  clues: readonly Clue[];
  activeLobbyCode?: string;
  onRevealClue: (title: string, content: string, newFairPrice: number) => Promise<void> | void;
  onClearClues: () => Promise<void> | void;
  onResolveMarket: (winningSide: 'YES' | 'NO') => Promise<void> | void;
  onResetMarket: () => Promise<void> | void;
  onResetBalances: (code: string) => Promise<void> | void;
}

export function InstructorModal({
  isOpen,
  onClose,
  market,
  clues,
  activeLobbyCode = 'CAL13',
  onRevealClue,
  onClearClues,
  onResolveMarket,
  onResetMarket,
  onResetBalances,
}: InstructorModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const [clueTitle, setClueTitle] = useState('');
  const [clueContent, setClueContent] = useState('');
  const [newFairPrice, setNewFairPrice] = useState<number>(50);
  const [statusMsg, setStatusMsg] = useState('');

  if (!isOpen || !market) return null;

  const marketClues = clues.filter(c => c.marketId === market.marketId);

  const handleReveal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clueTitle.trim() || !clueContent.trim()) return;

    try {
      await onRevealClue(clueTitle, clueContent, newFairPrice);
      setClueTitle('');
      setClueContent('');
      setStatusMsg('Clue revealed to all players!');
      setTimeout(() => setStatusMsg(''), 2500);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to reveal clue');
    }
  };

  // Card revelation shortcuts for the 3-Card Sum game
  const cardPresets = [
    { title: 'Card 1 Revealed', content: 'First card is a 7 of Spades (Value = 7). Current sum: 7.', fair: 54 },
    { title: 'Card 2 Revealed', content: 'Second card is a 9 of Diamonds (Value = 9). Current sum: 16.', fair: 78 },
    { title: 'Card 3 Revealed', content: 'Final card is an 8 of Hearts (Value = 8). Final sum = 24! (> 20)', fair: 99 },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm select-none"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-xl max-h-[90vh] bg-slate-950 border-2 border-purple-500/70 rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 border-b border-purple-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-400" />
            <span className="font-['Press_Start_2P'] text-[11px] text-purple-300">
              INSTRUCTOR PIT CONTROLS
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs font-mono">
          {/* Active Contract Info */}
          <div className="p-3 bg-purple-950/30 border border-purple-700/40 rounded-lg">
            <div className="text-[10px] text-purple-300 uppercase">Managing Market:</div>
            <div className="font-bold text-white text-sm mt-0.5">{market.question}</div>
            <div className="flex gap-4 mt-2 text-slate-300">
              <span>Status: <strong className={market.status === 'OPEN' ? 'text-emerald-400' : 'text-rose-400'}>{market.status}</strong></span>
              <span>Fair Value: <strong className="text-sky-400">{market.fairPrice}¢</strong></span>
              <span>Last: <strong className="text-yellow-400">{market.lastTradedPrice}¢</strong></span>
            </div>
          </div>

          {/* Section 1: Progressive Clue / Card Revelation */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-sky-400" />
                PROGRESSIVE CARD / INFORMATION REVEAL
              </span>
              {marketClues.length > 0 && (
                <button
                  type="button"
                  onClick={() => onClearClues()}
                  className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Clear Clues
                </button>
              )}
            </div>

            {/* Quick Card Presets */}
            <div className="grid grid-cols-3 gap-2">
              {cardPresets.map((cp, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setClueTitle(cp.title);
                    setClueContent(cp.content);
                    setNewFairPrice(cp.fair);
                  }}
                  className="p-2 bg-slate-900 border border-slate-700 hover:border-sky-400 rounded text-left transition"
                >
                  <div className="font-bold text-sky-300 text-[10px]">{cp.title}</div>
                  <div className="text-[9px] text-slate-400 mt-1">Target: {cp.fair}¢</div>
                </button>
              ))}
            </div>

            {/* Custom Reveal Form */}
            <form onSubmit={handleReveal} className="space-y-2 p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
              <div>
                <label className="text-slate-400 text-[10px] block mb-1">CLUE TITLE:</label>
                <input
                  type="text"
                  placeholder="e.g. Card 1 Revealed"
                  value={clueTitle}
                  onChange={e => setClueTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="text-slate-400 text-[10px] block mb-1">CLUE DESCRIPTION / CARD VALUE:</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Card is King of Hearts (10 pts). Current sum: 10."
                  value={clueContent}
                  onChange={e => setClueContent(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="text-slate-400 text-[10px] block mb-1">
                  NEW REVISED FAIR VALUE (1¢–99¢): {newFairPrice}¢
                </label>
                <input
                  type="range"
                  min={1}
                  max={99}
                  value={newFairPrice}
                  onChange={e => setNewFairPrice(Number(e.target.value))}
                  className="w-full accent-sky-500 cursor-pointer"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded transition"
              >
                BROADCAST CARD REVEAL TO ROOM
              </button>
            </form>

            {/* Previously Revealed Clues */}
            {marketClues.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-slate-400 uppercase">Revealed to Students:</span>
                {marketClues.map(c => (
                  <div key={c.clueId.toString()} className="p-2 bg-slate-900 rounded border border-slate-800 text-[11px]">
                    <div className="font-bold text-sky-300">{c.title}</div>
                    <div className="text-slate-300 text-[10px] mt-0.5">{c.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Market Resolution */}
          <div className="space-y-2 pt-3 border-t border-slate-800">
            <span className="font-bold text-slate-200">MARKET SETTLEMENT & RESOLUTION</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onResolveMarket('YES')}
                className="py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded flex items-center justify-center gap-1.5 transition"
              >
                <CheckCircle2 className="w-4 h-4" /> RESOLVE YES ($1.00)
              </button>
              <button
                type="button"
                onClick={() => onResolveMarket('NO')}
                className="py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded flex items-center justify-center gap-1.5 transition"
              >
                <AlertTriangle className="w-4 h-4" /> RESOLVE NO ($0.00)
              </button>
            </div>

            {market.status === 'RESOLVED' && (
              <button
                type="button"
                onClick={() => onResetMarket()}
                className="w-full py-2 bg-amber-600/80 hover:bg-amber-600 text-white font-bold rounded flex items-center justify-center gap-1.5 transition"
              >
                <Undo2 className="w-4 h-4" /> UNDO RESOLUTION (REOPEN MARKET)
              </button>
            )}
          </div>

          {/* Section 3: Reset Lobby Balances */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <div>
              <div className="font-bold text-slate-300">Reset All Player Balances</div>
              <div className="text-[10px] text-slate-400">Reverts all joined players in lobby back to starting bankroll.</div>
            </div>
            <button
              type="button"
              onClick={() => onResetBalances(activeLobbyCode)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-rose-950 hover:border-rose-600 border border-slate-700 text-slate-300 hover:text-rose-300 rounded transition"
            >
              Reset Balances
            </button>
          </div>

          {statusMsg && (
            <div className="p-2 rounded bg-emerald-950 border border-emerald-600 text-emerald-300 text-center">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
