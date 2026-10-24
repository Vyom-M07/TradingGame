import React, { useMemo } from 'react';
import { Identity } from 'spacetimedb';
import { Trade } from '../module_bindings/types';
import { History, TrendingUp, TrendingDown } from 'lucide-react';

interface RecentTradesProps {
  trades: readonly Trade[];
  activeMarketId: bigint | null;
  myIdentity: Identity | null;
}

export const RecentTrades: React.FC<RecentTradesProps> = ({
  trades,
  activeMarketId,
  myIdentity,
}) => {
  const myHex = myIdentity ? myIdentity.toHexString() : '';

  const filteredTrades = useMemo(() => {
    if (!activeMarketId) return [];
    return trades
      .filter(t => t.marketId === activeMarketId)
      .sort((a, b) => Number(b.timestamp.microsSinceUnixEpoch - a.timestamp.microsSinceUnixEpoch))
      .slice(0, 15);
  }, [trades, activeMarketId]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-bold text-white tracking-wide uppercase">
            Recent Trades
          </h2>
        </div>
        <span className="text-[11px] text-slate-400 font-mono">
          {filteredTrades.length} fills
        </span>
      </div>

      <div className="grid grid-cols-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 border-b border-slate-800/60">
        <div>Side / Actor</div>
        <div className="text-right">Price</div>
        <div className="text-right">Qty</div>
        <div className="text-right">Time</div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 py-1 max-h-[340px]">
        {filteredTrades.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400 italic">
            No trades executed yet
          </div>
        ) : (
          filteredTrades.map(trade => {
            const isYes = trade.takerSide === 'YES';
            const timeDate = new Date(Number(trade.timestamp.microsSinceUnixEpoch / 1000n));
            const timeStr = timeDate.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

            const isMine = myHex && (trade.taker.toHexString() === myHex || trade.maker.toHexString() === myHex);

            let roleBadge = 'Human';
            let roleClass = 'bg-slate-800 text-slate-300';
            if (trade.takerRole === 'SNIPER') {
              roleBadge = 'Sniper';
              roleClass = 'bg-amber-950/80 text-amber-300 border border-amber-600/30';
            } else if (trade.takerRole === 'AMM') {
              roleBadge = 'AMM';
              roleClass = 'bg-cyan-950/80 text-cyan-300 border border-cyan-600/30';
            }

            return (
              <div
                key={Number(trade.tradeId)}
                className={`grid grid-cols-4 text-xs font-mono px-2 py-1.5 rounded transition items-center ${
                  isMine ? 'bg-indigo-950/30 border border-indigo-500/20' : 'hover:bg-slate-800/50'
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1">
                    {isYes ? (
                      <TrendingUp className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-rose-400" />
                    )}
                    <span
                      className={`font-bold ${
                        isYes ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isYes ? 'BUY' : 'SELL'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] font-sans">
                    <span className={`px-1 rounded uppercase font-semibold ${roleClass}`}>
                      {roleBadge}
                    </span>
                    {isMine && (
                      <span className="px-1 rounded bg-indigo-600 text-white font-bold">
                        You
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right font-bold text-white text-sm">
                  {trade.price}¢
                </div>

                <div className="text-right text-slate-300">
                  {trade.quantity.toLocaleString()}
                </div>

                <div className="text-right text-slate-400 text-[11px]">
                  {timeStr}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
