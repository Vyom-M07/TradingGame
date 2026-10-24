import React, { useState } from 'react';
import { Market, Clue } from '../module_bindings/types';
import { reducers } from '../module_bindings';
import { useReducer } from 'spacetimedb/react';
import {
  GraduationCap,
  Sparkles,
  Eye,
  Lock,
  Send,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Crown,
  Radio,
} from 'lucide-react';

interface ClassroomCluesProps {
  activeMarket: Market | null;
  clues: readonly Clue[];
  isInstructor: boolean;
}

export const ClassroomClues: React.FC<ClassroomCluesProps> = ({
  activeMarket,
  clues,
  isInstructor,
}) => {
  const [isInstructorOpen, setIsInstructorOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [newFairPrice, setNewFairPrice] = useState<number>(65);

  const revealClueReducer = useReducer(reducers.revealClue);
  const clearCluesReducer = useReducer(reducers.clearClues);

  if (!activeMarket) return null;

  // Filter clues for active market, ordered chronologically
  const marketClues = clues
    .filter(c => c.marketId === activeMarket.marketId)
    .sort((a, b) => Number(a.revealedAt.microsSinceUnixEpoch - b.revealedAt.microsSinceUnixEpoch));

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    revealClueReducer({
      marketId: activeMarket.marketId,
      title: title.trim(),
      content: content.trim(),
      newFairPrice: Math.max(1, Math.min(99, newFairPrice)),
    });

    setTitle('');
    setContent('');
  };

  const handlePresetReveal = (presetTitle: string, presetContent: string, targetPrice: number) => {
    revealClueReducer({
      marketId: activeMarket.marketId,
      title: presetTitle,
      content: presetContent,
      newFairPrice: targetPrice,
    });
  };

  const handleResetClues = () => {
    clearCluesReducer({ marketId: activeMarket.marketId });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white uppercase tracking-wide">
                Classroom Market: Progressive Information Stream
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-700/50 font-semibold">
                {marketClues.length} Revealed
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Instructor progressively reveals hidden signals (e.g. card values) to simulate price discovery
            </p>
          </div>
        </div>

        {/* Instructor Controls or Student Indicator */}
        {isInstructor ? (
          <button
            onClick={() => setIsInstructorOpen(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer border ${
              isInstructorOpen
                ? 'bg-amber-600 text-white border-amber-500 shadow-md shadow-amber-600/30'
                : 'bg-slate-800 text-amber-300 hover:text-white border-amber-500/40'
            }`}
          >
            <Crown className="h-3.5 w-3.5" />
            <span>Instructor Controls</span>
            {isInstructorOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-950 border border-slate-800 text-slate-400">
            <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
            <span>Student Stream (Live)</span>
          </div>
        )}
      </div>

      {/* Clues Timeline / Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {marketClues.length === 0 ? (
          <div className="md:col-span-3 text-center py-6 border border-dashed border-slate-800 rounded-xl bg-slate-950/40 text-xs text-slate-400 space-y-1">
            <Lock className="h-5 w-5 mx-auto text-slate-500 mb-1" />
            <p className="font-semibold text-slate-300">All information is currently hidden</p>
            <p className="text-[11px] text-slate-500">
              Instructor has not announced any card values or signals yet. Trade based on prior probability!
            </p>
          </div>
        ) : (
          marketClues.map((clue, index) => {
            const timeDate = new Date(Number(clue.revealedAt.microsSinceUnixEpoch / 1000n));
            const timeStr = timeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            return (
              <div
                key={Number(clue.clueId)}
                className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3.5 space-y-2 relative overflow-hidden group hover:border-indigo-500/40 transition"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5 text-emerald-400" />
                    <span>#{index + 1}: {clue.title}</span>
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">{timeStr}</span>
                </div>

                <p className="text-xs text-slate-200 font-mono bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/70 leading-relaxed font-semibold">
                  {clue.content}
                </p>

                {clue.suggestedFairPrice > 0 && (
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1">
                    <span>New Fair Value:</span>
                    <span className="font-bold text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/20">
                      {clue.suggestedFairPrice}¢
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Instructor Control Deck (Expandable) */}
      {isInstructorOpen && (
        <div className="bg-slate-950 border border-indigo-500/30 rounded-xl p-4 space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Instructor Control Panel: Card & Clue Dispatcher
              </h3>
            </div>
            <button
              onClick={handleResetClues}
              className="flex items-center gap-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300 transition cursor-pointer bg-rose-950/40 px-2 py-1 rounded border border-rose-500/20"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Clear Clues</span>
            </button>
          </div>

          {/* Quick Presets for 3-Card Sum Game */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-slate-300">
              Quick 1-Click Game Presets (Mystery Card Reveals):
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  handlePresetReveal(
                    'Card 1 Revealed',
                    '♠️ 9 of Spades (Value = 9). Current Sum = 9. 2 cards remaining.',
                    58
                  )
                }
                className="p-2 text-left bg-slate-900 hover:bg-slate-800 rounded-lg border border-slate-800 hover:border-indigo-500/40 text-xs transition cursor-pointer"
              >
                <div className="font-bold text-slate-200">Reveal Card 1</div>
                <div className="text-[10px] text-slate-400">♠️ 9 of Spades (Sum: 9) → Fair: 58¢</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  handlePresetReveal(
                    'Card 2 Revealed',
                    '♥️ 4 of Hearts (Value = 4). Current Sum = 13. Needs 8+ to win.',
                    42
                  )
                }
                className="p-2 text-left bg-slate-900 hover:bg-slate-800 rounded-lg border border-slate-800 hover:border-indigo-500/40 text-xs transition cursor-pointer"
              >
                <div className="font-bold text-slate-200">Reveal Card 2</div>
                <div className="text-[10px] text-slate-400">♥️ 4 of Hearts (Sum: 13) → Fair: 42¢</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  handlePresetReveal(
                    'Final Card 3 Revealed',
                    '♦️ 8 of Diamonds (Value = 8). Final Sum = 21 > 20! YES WINS!',
                    99
                  )
                }
                className="p-2 text-left bg-slate-900 hover:bg-slate-800 rounded-lg border border-slate-800 hover:border-indigo-500/40 text-xs transition cursor-pointer"
              >
                <div className="font-bold text-emerald-300">Reveal Card 3 (Final)</div>
                <div className="text-[10px] text-slate-400">♦️ 8 of Diamonds (Sum: 21) → Fair: 99¢</div>
              </button>
            </div>
          </div>

          {/* Custom Reveal Form */}
          <form onSubmit={handleBroadcast} className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 text-xs border-t border-slate-800">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Clue Title</label>
              <input
                type="text"
                placeholder="e.g. Card #1 or CPI Print"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-400 font-semibold mb-1">Clue Content / Details</label>
              <input
                type="text"
                placeholder="e.g. Queen of Spades drawn (Value: 10 points)"
                value={content}
                onChange={e => setContent(e.target.value)}
                required
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-slate-400 font-semibold mb-1">New Fair (¢)</label>
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={newFairPrice}
                  onChange={e => setNewFairPrice(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5"
                title="Broadcast to all students in real-time"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Broadcast</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
