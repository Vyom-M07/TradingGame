import React, { useState } from 'react';
import { Identity } from 'spacetimedb';
import { Position, Order, Market, Player } from '../module_bindings/types';
import { reducers } from '../module_bindings';
import { useReducer } from 'spacetimedb/react';
import { Briefcase, Clock, Info, Trash2, ArrowUpRight, CheckCircle2 } from 'lucide-react';

interface PortfolioProps {
  myIdentity: Identity | null;
  player: Player | null;
  positions: readonly Position[];
  orders: readonly Order[];
  markets: readonly Market[];
  onSelectMarket: (marketId: bigint) => void;
}

export const Portfolio: React.FC<PortfolioProps> = ({
  myIdentity,
  player,
  positions,
  orders,
  markets,
  onSelectMarket,
}) => {
  const [activeTab, setActiveTab] = useState<'positions' | 'orders' | 'architecture'>('positions');

  const cancelOrderReducer = useReducer(reducers.cancelOrder);

  // Filter positions owned by current user
  const myPositions = positions.filter(
    p =>
      myIdentity &&
      p.owner.toHexString() === myIdentity.toHexString() &&
      (p.yesShares > 0 || p.noShares > 0)
  );

  // Filter open orders owned by current user
  const myOrders = orders.filter(
    o =>
      myIdentity &&
      o.owner.toHexString() === myIdentity.toHexString() &&
      o.quantity > 0
  );

  const getMarket = (marketId: bigint) => {
    return markets.find(m => m.marketId === marketId);
  };

  const handleCancelOrder = (orderId: bigint) => {
    cancelOrderReducer({ orderId });
  };

  // Compute total portfolio valuation
  let totalPositionValueCents = 0;
  for (const pos of myPositions) {
    const m = getMarket(pos.marketId);
    const yesVal = m ? pos.yesShares * m.lastTradedPrice : 0;
    const noVal = m ? pos.noShares * (100 - m.lastTradedPrice) : 0;
    totalPositionValueCents += yesVal + noVal;
  }
  const cashCents = player ? Number(player.cashBalance) : 0;
  const netWorthDollars = ((cashCents + totalPositionValueCents) / 100).toFixed(2);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
      {/* Header and Tabs */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('positions')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeTab === 'positions'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Briefcase className="h-3.5 w-3.5" />
            <span>Open Positions ({myPositions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeTab === 'orders'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Open Orders ({myOrders.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('architecture')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeTab === 'architecture'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Info className="h-3.5 w-3.5" />
            <span>CLOB Architecture</span>
          </button>
        </div>

        {/* Portfolio Summary Pill */}
        <div className="text-xs font-mono bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 flex items-center gap-3">
          <span className="text-slate-400">Net Worth:</span>
          <span className="font-extrabold text-emerald-400">${netWorthDollars}</span>
        </div>
      </div>

      {/* Tab 1: Positions */}
      {activeTab === 'positions' && (
        <div className="overflow-x-auto">
          {myPositions.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">
              <p>You have no active contract positions.</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Place an order using the Trade Ticket to take a YES or NO position!
              </p>
            </div>
          ) : (
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
                  <th className="py-2 px-3">Market</th>
                  <th className="py-2 px-3 text-center">YES Shares</th>
                  <th className="py-2 px-3 text-center">NO Shares</th>
                  <th className="py-2 px-3 text-right">Current Value</th>
                  <th className="py-2 px-3 text-right">Max Payout</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {myPositions.map(pos => {
                  const m = getMarket(pos.marketId);
                  const yesPrice = m ? m.lastTradedPrice : 50;
                  const noPrice = 100 - yesPrice;
                  const currentValCents = pos.yesShares * yesPrice + pos.noShares * noPrice;
                  const maxPayoutCents = Math.max(pos.yesShares, pos.noShares) * 100;

                  return (
                    <tr key={Number(pos.positionId)} className="hover:bg-slate-800/40">
                      <td className="py-3 px-3 font-sans font-semibold text-white max-w-xs truncate">
                        {m?.question || `Market #${Number(pos.marketId)}`}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {pos.yesShares > 0 ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/20 font-bold">
                            {pos.yesShares.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {pos.noShares > 0 ? (
                          <span className="px-2 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-500/20 font-bold">
                            {pos.noShares.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-200">
                        ${(currentValCents / 100).toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right text-emerald-400 font-bold">
                        ${(maxPayoutCents / 100).toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-sans">
                        <button
                          onClick={() => onSelectMarket(pos.marketId)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer inline-flex items-center gap-1"
                        >
                          <span>Trade</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 2: Orders */}
      {activeTab === 'orders' && (
        <div className="overflow-x-auto">
          {myOrders.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">
              <p>No open resting limit orders.</p>
              <p className="text-[11px] text-slate-400 mt-1">
                When you place a limit order that is not immediately filled, it rests here!
              </p>
            </div>
          ) : (
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
                  <th className="py-2 px-3">Order ID</th>
                  <th className="py-2 px-3">Market</th>
                  <th className="py-2 px-3 text-center">Side</th>
                  <th className="py-2 px-3 text-center">Limit Price</th>
                  <th className="py-2 px-3 text-right">Unfilled / Total</th>
                  <th className="py-2 px-3 text-right">Escrow</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {myOrders.map(order => {
                  const m = getMarket(order.marketId);
                  const isBid = order.side === 'YES';
                  const displayPrice = isBid ? order.price : 100 - order.price;
                  const escrowDollars = ((order.price * order.quantity) / 100).toFixed(2);

                  return (
                    <tr key={Number(order.orderId)} className="hover:bg-slate-800/40">
                      <td className="py-3 px-3 text-slate-400">
                        #{Number(order.orderId)}
                      </td>
                      <td className="py-3 px-3 font-sans font-semibold text-white max-w-xs truncate">
                        {m?.question || `Market #${Number(order.marketId)}`}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded font-bold ${
                            isBid
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-950/60 text-rose-400 border border-rose-500/20'
                          }`}
                        >
                          {isBid ? 'BID' : 'ASK'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center font-bold text-white">
                        {displayPrice}¢
                      </td>
                      <td className="py-3 px-3 text-right text-slate-300">
                        {order.quantity} / {order.originalQuantity}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-200">
                        ${escrowDollars}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => handleCancelOrder(order.orderId)}
                          className="flex items-center gap-1 text-rose-400 hover:text-rose-300 transition cursor-pointer ml-auto text-xs font-sans font-semibold bg-rose-950/40 hover:bg-rose-900/40 px-2 py-1 rounded border border-rose-500/20"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Cancel</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 3: CLOB Architecture details */}
      {activeTab === 'architecture' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
            <div className="font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Strict Integer Math</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              All prediction contract prices range strictly from 1¢ to 99¢.
              <code className="text-emerald-400 ml-1">1 YES + 1 NO = $1.00 (100¢)</code>.
              No floating-point rounding bugs or fractional slippage errors.
            </p>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
            <div className="font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-indigo-400" />
              <span>In-Memory Matching Engine</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              The entire Central Limit Order Book matching engine executes deterministic ACID transactions in-memory at up to 300,000 TPS.
            </p>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
            <div className="font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-teal-400" />
              <span>Zero-Latency WebSockets</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              The React frontend is connected via continuous streaming subscriptions. Every match or resting order instantly synchronizes into the UI without HTTP polling.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
