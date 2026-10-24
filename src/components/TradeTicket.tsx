import React, { useState, useEffect } from 'react';
import { Player, Market } from '../module_bindings/types';
import { reducers } from '../module_bindings';
import { useReducer } from 'spacetimedb/react';
import { ArrowUpRight, DollarSign, AlertCircle, CheckCircle, Scale } from 'lucide-react';

interface TradeTicketProps {
  connected: boolean;
  market: Market | null;
  player: Player | null;
  selectedPrice: { price: number; side: 'BID' | 'ASK' } | null;
}

export const TradeTicket: React.FC<TradeTicketProps> = ({
  connected,
  market,
  player,
  selectedPrice,
}) => {
  const [side, setSide] = useState<'BID' | 'ASK'>('BID');
  const [price, setPrice] = useState<number>(55);
  const [quantity, setQuantity] = useState<number>(25);
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const placeOrderReducer = useReducer(reducers.placeOrder);

  // Sync when user clicks a row in the orderbook
  useEffect(() => {
    if (selectedPrice) {
      setSide(selectedPrice.side);
      setPrice(selectedPrice.price);
    }
  }, [selectedPrice]);

  // Adjust default price when switching market
  useEffect(() => {
    if (market) {
      setPrice(market.lastTradedPrice || 50);
    }
  }, [market?.marketId]);

  if (!market) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-center text-slate-400">
        Select a market to trade.
      </div>
    );
  }

  const isResolved = market.status === 'RESOLVED';
  const cashCents = player ? Number(player.cashBalance) : 0;

  // Financial Math for BID vs ASK:
  // BID (Buy contract): Buyer pays `price` cents per contract
  // ASK (Sell contract): Seller collateralizes `100 - price` cents per contract
  const costPerContractCents = side === 'BID' ? price : 100 - price;
  const totalCostCents = costPerContractCents * quantity;
  const totalCostDollars = (totalCostCents / 100).toFixed(2);
  const maxPayoutDollars = ((100 * quantity) / 100).toFixed(2);
  const maxProfitDollars =
    side === 'BID'
      ? (((100 - price) * quantity) / 100).toFixed(2)
      : ((price * quantity) / 100).toFixed(2);

  const returnPct =
    costPerContractCents > 0
      ? side === 'BID'
        ? (((100 - price) / price) * 100).toFixed(0)
        : (((price) / (100 - price)) * 100).toFixed(0)
      : '0';

  const hasEnoughCash = cashCents >= totalCostCents;

  // Decision Optimality Math (Neutral & Unbiased)
  // BID: buying below consensus fair value is +EV (optimal)
  // ASK: selling above consensus fair value is +EV (optimal)
  const evPerShareCents = side === 'BID' ? market.fairPrice - price : price - market.fairPrice;
  const totalEvDollars = ((evPerShareCents * quantity) / 100).toFixed(2);
  const isOptimal = evPerShareCents > 0;
  const isPar = evPerShareCents === 0;

  const handleMaxQuantity = () => {
    if (costPerContractCents <= 0) return;
    const maxQty = Math.floor(cashCents / costPerContractCents);
    setQuantity(Math.max(1, Math.min(maxQty, 5000)));
  };

  const handlePlaceOrder = () => {
    if (!connected) {
      setStatusMsg({ text: 'Connecting to live market...', isError: true });
      return;
    }
    if (isResolved) {
      setStatusMsg({ text: 'Cannot trade on resolved market', isError: true });
      return;
    }
    if (!hasEnoughCash) {
      setStatusMsg({ text: 'Insufficient cash balance for this order', isError: true });
      return;
    }

    try {
      if (side === 'BID') {
        placeOrderReducer({
          marketId: market.marketId,
          side: 'YES',
          price,
          quantity,
        });
        setStatusMsg({
          text: `Placed Limit Bid: Buy ${quantity} contracts @ ${price}¢`,
          isError: false,
        });
      } else {
        // ASK: offering to sell at `price` cents corresponds to backend NO at `100 - price`
        placeOrderReducer({
          marketId: market.marketId,
          side: 'NO',
          price: 100 - price,
          quantity,
        });
        setStatusMsg({
          text: `Placed Limit Ask: Offer ${quantity} contracts @ ${price}¢`,
          isError: false,
        });
      }

      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ text: err?.message || 'Failed to place order', isError: true });
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col justify-between space-y-4">
      {/* Header & Tabs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-400" />
            <span>Trade Ticket</span>
          </h2>
          <span className="text-[11px] font-mono text-slate-400">
            Available: ${(cashCents / 100).toFixed(2)}
          </span>
        </div>

        {/* Standard BID / ASK Selection Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
          <button
            onClick={() => setSide('BID')}
            className={`py-2 px-3 rounded-lg text-xs font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5 ${
              side === 'BID'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-900/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>BID (Buy)</span>
            <span className="text-[10px] font-mono opacity-80">
              @{market.lastTradedPrice}¢
            </span>
          </button>

          <button
            onClick={() => setSide('ASK')}
            className={`py-2 px-3 rounded-lg text-xs font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5 ${
              side === 'ASK'
                ? 'bg-gradient-to-r from-rose-600 to-pink-600 text-white shadow-lg shadow-rose-900/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>ASK (Sell)</span>
            <span className="text-[10px] font-mono opacity-80">
              @{market.lastTradedPrice}¢
            </span>
          </button>
        </div>
      </div>

      {/* Price Selector */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs">
          <label className="text-slate-300 font-semibold">
            {side === 'BID' ? 'Limit Bid Price' : 'Limit Ask Price'}
          </label>
          <span className="font-mono text-white font-extrabold text-sm">
            {price}¢ <span className="text-slate-400 font-normal text-[11px]">(${(price / 100).toFixed(2)})</span>
          </span>
        </div>

        <input
          type="range"
          min="1"
          max="99"
          value={price}
          onChange={e => setPrice(Number(e.target.value))}
          className={`w-full h-1.5 bg-slate-800 rounded-lg cursor-pointer ${
            side === 'BID' ? 'accent-emerald-500' : 'accent-rose-500'
          }`}
        />

        <div className="flex items-center gap-1 pt-1">
          {[-5, -1, 1, 5].map(delta => (
            <button
              key={delta}
              onClick={() => setPrice(p => Math.max(1, Math.min(99, p + delta)))}
              className="flex-1 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 transition cursor-pointer"
            >
              {delta > 0 ? `+${delta}¢` : `${delta}¢`}
            </button>
          ))}
          <button
            onClick={() => setPrice(market.fairPrice)}
            className="flex-1 py-1 text-[11px] font-mono bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 rounded border border-indigo-700/50 transition cursor-pointer font-bold"
          >
            Fair ({market.fairPrice}¢)
          </button>
        </div>
      </div>

      {/* Quantity Selector */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs">
          <label className="text-slate-300 font-semibold">Quantity (Contracts)</label>
          <span className="font-mono text-white font-extrabold text-sm">
            {quantity.toLocaleString()}
          </span>
        </div>

        <input
          type="range"
          min="1"
          max="500"
          value={quantity}
          onChange={e => setQuantity(Number(e.target.value))}
          className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
        />

        <div className="flex items-center gap-1 pt-1">
          {[10, 25, 50, 100].map(qty => (
            <button
              key={qty}
              onClick={() => setQuantity(qty)}
              className="flex-1 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 transition cursor-pointer"
            >
              {qty}
            </button>
          ))}
          <button
            onClick={handleMaxQuantity}
            className="flex-1 py-1 text-[11px] font-mono bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 rounded border border-emerald-700/50 transition cursor-pointer font-bold"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Decision Optimality Indicator (Neutral & Objective) */}
      <div
        className={`p-3 rounded-xl border text-xs space-y-1.5 transition ${
          isOptimal
            ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
            : isPar
            ? 'bg-blue-950/40 border-blue-500/40 text-blue-200'
            : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px]">
            <Scale className="h-3.5 w-3.5" />
            <span>
              {isOptimal
                ? 'Optimal Decision (+EV)'
                : isPar
                ? 'Fair Value (Neutral EV)'
                : 'Sub-Optimal Decision (-EV)'}
            </span>
          </div>
          <span className="font-mono font-bold text-xs">
            {evPerShareCents > 0 ? `+${evPerShareCents}¢ / share` : `${evPerShareCents}¢ / share`}
          </span>
        </div>

        <p className="text-[11px] leading-relaxed opacity-90">
          {side === 'BID' ? (
            isOptimal ? (
              <>
                Bidding at <strong>{price}¢</strong> is <strong>{market.fairPrice - price}¢ below</strong> consensus fair value ({market.fairPrice}¢). Expected profit: <strong>+${totalEvDollars}</strong>.
              </>
            ) : isPar ? (
              <>
                Bidding at fair consensus value (<strong>{market.fairPrice}¢</strong>). Zero statistical edge.
              </>
            ) : (
              <>
                Bidding at <strong>{price}¢</strong> pays a <strong>{price - market.fairPrice}¢ premium</strong> above fair value ({market.fairPrice}¢). Expected loss: <strong>-${Math.abs(Number(totalEvDollars)).toFixed(2)}</strong>.
              </>
            )
          ) : (
            isOptimal ? (
              <>
                Asking at <strong>{price}¢</strong> is <strong>{price - market.fairPrice}¢ above</strong> consensus fair value ({market.fairPrice}¢). Expected profit: <strong>+${totalEvDollars}</strong>.
              </>
            ) : isPar ? (
              <>
                Asking at fair consensus value (<strong>{market.fairPrice}¢</strong>). Zero statistical edge.
              </>
            ) : (
              <>
                Asking at <strong>{price}¢</strong> offers a <strong>{market.fairPrice - price}¢ discount</strong> below fair value ({market.fairPrice}¢). Expected loss: <strong>-${Math.abs(Number(totalEvDollars)).toFixed(2)}</strong>.
              </>
            )
          )}
        </p>
      </div>

      {/* Cost & Payout Summary Card */}
      <div className="bg-slate-950 rounded-xl p-3 border border-slate-800/80 space-y-1.5 text-xs font-mono">
        <div className="flex justify-between text-slate-400">
          <span>Cost Required:</span>
          <span className="text-white font-bold">${totalCostDollars}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>Max Settlement Payout:</span>
          <span className="text-white font-bold">${maxPayoutDollars}</span>
        </div>
        <div className="flex justify-between border-t border-slate-800/80 pt-1.5 font-bold">
          <span className="text-slate-300">Net Profit if Successful:</span>
          <span className={side === 'BID' ? 'text-emerald-400' : 'text-rose-400'}>
            +${maxProfitDollars} (+{returnPct}%)
          </span>
        </div>
      </div>

      {/* Status Feedback Message */}
      {statusMsg && (
        <div
          className={`p-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
            statusMsg.isError
              ? 'bg-rose-950/80 border border-rose-500/50 text-rose-300'
              : 'bg-emerald-950/80 border border-emerald-500/50 text-emerald-300'
          }`}
        >
          {statusMsg.isError ? (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          ) : (
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Place Order CTA Button */}
      <button
        onClick={handlePlaceOrder}
        disabled={isResolved || !hasEnoughCash}
        className={`w-full py-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition shadow-lg cursor-pointer ${
          isResolved
            ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
            : !hasEnoughCash
            ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            : side === 'BID'
            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-900/30'
            : 'bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white shadow-rose-900/30'
        }`}
      >
        <span>
          {isResolved
            ? 'Market Resolved'
            : !hasEnoughCash
            ? 'Insufficient Balance'
            : side === 'BID'
            ? `Submit Limit Bid (${price}¢)`
            : `Submit Limit Ask (${price}¢)`}
        </span>
        <ArrowUpRight className="h-4 w-4" />
      </button>
    </div>
  );
};
