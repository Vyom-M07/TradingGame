import React from 'react';
import { Market } from '../module_bindings/types';
import { reducers } from '../module_bindings';
import { useReducer } from 'spacetimedb/react';
import { CheckCircle2, XCircle, RotateCcw, Plus, BarChart3, HelpCircle } from 'lucide-react';

interface MarketBannerProps {
  markets: readonly Market[];
  activeMarket: Market | null;
  isInstructor: boolean;
  onSelectMarket: (marketId: bigint) => void;
  onOpenCreateModal: () => void;
}

export const MarketBanner: React.FC<MarketBannerProps> = ({
  markets,
  activeMarket,
  isInstructor,
  onSelectMarket,
  onOpenCreateModal,
}) => {
  const resolveMarketReducer = useReducer(reducers.resolveMarket);
  const resetMarketReducer = useReducer(reducers.resetMarket);

  if (!activeMarket) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-400">
        No active market selected.
      </div>
    );
  }

  const yesPrice = activeMarket.lastTradedPrice;
  const noPrice = 100 - yesPrice;
  const isResolved = activeMarket.status === 'RESOLVED';

  const handleResolve = (side: 'YES' | 'NO') => {
    resolveMarketReducer({
      marketId: activeMarket.marketId,
      winningSide: side,
    });
  };

  const handleReset = () => {
    resetMarketReducer({
      marketId: activeMarket.marketId,
      defaultPrice: activeMarket.preResolvedPrice || 50,
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
      {/* Market Selector Tabs */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-3 overflow-x-auto">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1">
          {markets.map(m => {
            const isSelected = m.marketId === activeMarket.marketId;
            return (
              <button
                key={Number(m.marketId)}
                onClick={() => onSelectMarket(m.marketId)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer flex items-center gap-2 ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span>{m.question.length > 32 ? m.question.slice(0, 30) + '...' : m.question}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    isSelected ? 'bg-indigo-950/60 text-indigo-200' : 'bg-slate-900 text-emerald-400'
                  }`}
                >
                  {m.lastTradedPrice}¢
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={onOpenCreateModal}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 whitespace-nowrap transition cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Market</span>
        </button>
      </div>

      {/* Main Market Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
        {/* Left: Question & Meta */}
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              {activeMarket.category}
            </span>
            <span
              className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                isResolved
                  ? 'bg-amber-950/50 text-amber-400 border-amber-500/40'
                  : 'bg-emerald-950/50 text-emerald-400 border-emerald-500/40'
              }`}
            >
              {isResolved ? `Resolved: Winner ${activeMarket.winningSide}` : 'Market Open'}
            </span>
            <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
              <BarChart3 className="h-3.5 w-3.5 text-slate-500" />
              Volume: {Number(activeMarket.volume).toLocaleString()} contracts
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-snug">
            {activeMarket.question}
          </h1>

          <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
            {activeMarket.description}
          </p>

          {/* Probability Bar */}
          <div className="pt-2 space-y-1">
            <div className="flex justify-between text-xs font-mono font-bold">
              <span className="text-emerald-400 flex items-center gap-1">
                YES: {yesPrice}% ({yesPrice}¢)
              </span>
              <span className="text-rose-400 flex items-center gap-1">
                NO: {noPrice}% ({noPrice}¢)
              </span>
            </div>
            <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden flex border border-slate-700">
              <div
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
                style={{ width: `${yesPrice}%` }}
              />
              <div
                className="bg-gradient-to-r from-rose-500 to-pink-500 h-full transition-all duration-300"
                style={{ width: `${noPrice}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right: Quick Price Box & Resolution Demo Controls */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between gap-4">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-3">
              <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                Contract Price
              </div>
              <div className="text-2xl font-mono font-extrabold text-emerald-400">
                {yesPrice}¢
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                ${(yesPrice / 100).toFixed(2)} / contract
              </div>
            </div>

            <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-lg p-3">
              <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                Implied Probability
              </div>
              <div className="text-2xl font-mono font-extrabold text-indigo-400">
                {yesPrice}%
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                Consensus Fair Value
              </div>
            </div>
          </div>

          {/* Admin Demo Resolution Controls */}
          <div className="border-t border-slate-800 pt-3 space-y-2">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1">
                <HelpCircle className="h-3 w-3 text-indigo-400" />
                <span>Contract Settlement</span>
              </span>
              {!isInstructor && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 text-amber-400 border border-slate-800 font-mono">
                  Instructor Only
                </span>
              )}
            </div>
            {isInstructor ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleResolve('YES')}
                  disabled={isResolved}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
                    isResolved
                      ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30 cursor-pointer'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Resolve YES</span>
                </button>

                <button
                  onClick={() => handleResolve('NO')}
                  disabled={isResolved}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
                    isResolved
                      ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500'
                      : 'bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-900/30 cursor-pointer'
                  }`}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  <span>Resolve NO</span>
                </button>

                <button
                  onClick={handleReset}
                  title="Reset market to pre-resolved baseline"
                  className="flex items-center justify-center p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 text-center font-medium">
                Resolution and undo actions are reserved for the lobby instructor.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
