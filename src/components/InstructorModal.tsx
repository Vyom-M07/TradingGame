import { useState } from 'react';
import { Market, Clue } from '../module_bindings/types';
import { PixelDialog } from './Dialogs';

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

const inputCls = 'panel-inset w-full px-3 py-2.5 text-[10px] outline-none focus:bg-white';

// Card revelation shortcuts for the 3-Card Sum game
const cardPresets = [
  { title: 'Card 1 Revealed', content: 'First card is a 7 of Spades (Value = 7). Current sum: 7.', fair: 54 },
  { title: 'Card 2 Revealed', content: 'Second card is a 9 of Diamonds (Value = 9). Current sum: 16.', fair: 78 },
  { title: 'Card 3 Revealed', content: 'Final card is an 8 of Hearts (Value = 8). Final sum = 24! (> 20)', fair: 99 },
];

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
  const [clueTitle, setClueTitle] = useState('');
  const [clueContent, setClueContent] = useState('');
  const [newFairPrice, setNewFairPrice] = useState<number>(50);
  const [statusMsg, setStatusMsg] = useState('');

  if (!market) return null;

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

  return (
    <PixelDialog isOpen={isOpen} onClose={onClose} title="Host Controls" accent="bg-violet-400" width="max-w-xl">
      <div className="space-y-5 text-[9px] leading-relaxed">
        {/* Active contract */}
        <div className="panel-inset p-3">
          <div className="text-slate-500">MANAGING</div>
          <div className="mt-2 text-[11px] leading-[1.6]">{market.question}</div>
          <div className="mt-3 flex flex-wrap gap-4">
            <span>
              STATUS <span className={market.status === 'OPEN' ? 'text-emerald-700' : 'text-rose-600'}>{market.status}</span>
            </span>
            <span>
              FAIR <span className="text-sky-700">{market.fairPrice}¢</span>
            </span>
            <span>
              LAST <span className="text-amber-600">{market.lastTradedPrice}¢</span>
            </span>
          </div>
        </div>

        {/* Clue reveal */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px]">REVEAL A CLUE</span>
            {marketClues.length > 0 && (
              <button type="button" onClick={() => onClearClues()} className="text-rose-600 underline">
                Clear clues
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {cardPresets.map(cp => (
              <button
                key={cp.title}
                type="button"
                onClick={() => {
                  setClueTitle(cp.title);
                  setClueContent(cp.content);
                  setNewFairPrice(cp.fair);
                }}
                className="sign !flex-col !items-start !gap-2 !px-2 text-left text-[8px]"
              >
                <span>{cp.title}</span>
                <span className="text-slate-500">→ {cp.fair}¢</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleReveal} className="space-y-3">
            <input
              type="text"
              placeholder="Clue title"
              value={clueTitle}
              onChange={e => setClueTitle(e.target.value)}
              className={inputCls}
            />
            <textarea
              rows={2}
              placeholder="e.g. Card is King of Hearts (10 pts). Current sum: 10."
              value={clueContent}
              onChange={e => setClueContent(e.target.value)}
              className={`${inputCls} resize-none leading-relaxed`}
            />
            <label className="block space-y-2">
              <span>NEW FAIR VALUE: {newFairPrice}¢</span>
              <input
                type="range"
                min={1}
                max={99}
                value={newFairPrice}
                onChange={e => setNewFairPrice(Number(e.target.value))}
                className="pixel-range w-full"
              />
            </label>
            <button type="submit" className="sign sign-active w-full">
              Broadcast to Floor
            </button>
          </form>

          {marketClues.length > 0 && (
            <div className="space-y-2">
              <div className="text-slate-500">REVEALED</div>
              {marketClues.map(c => (
                <div key={c.clueId.toString()} className="panel-inset p-2">
                  <div className="text-sky-700">{c.title}</div>
                  <div className="mt-1 text-[8px] text-slate-600">{c.content}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Resolution */}
        <section className="space-y-3 border-t-4 border-ink pt-4">
          <div className="text-[10px]">SETTLE MARKET</div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onResolveMarket('YES')}
              className="sign !bg-emerald-300 text-[10px]"
            >
              YES wins
            </button>
            <button type="button" onClick={() => onResolveMarket('NO')} className="sign !bg-rose-300 text-[10px]">
              NO wins
            </button>
          </div>
          {market.status === 'RESOLVED' && (
            <button type="button" onClick={() => onResetMarket()} className="sign !bg-amber-200 w-full text-[10px]">
              Undo / Reopen
            </button>
          )}
        </section>

        {/* Reset balances */}
        <section className="flex items-center justify-between gap-3 border-t-4 border-ink pt-4">
          <div>
            <div className="text-[10px]">RESET BALANCES</div>
            <div className="mt-1 text-[8px] text-slate-500">Everyone in {activeLobbyCode} back to starting cash.</div>
          </div>
          <button type="button" onClick={() => onResetBalances(activeLobbyCode)} className="sign text-[10px]">
            Reset
          </button>
        </section>

        {statusMsg && <div className="border-[3px] border-emerald-600 bg-emerald-50 p-2 text-center text-emerald-700">{statusMsg}</div>}
      </div>
    </PixelDialog>
  );
}
