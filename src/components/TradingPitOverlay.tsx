import { useState, useMemo, useEffect } from 'react';
import { Identity } from 'spacetimedb';
import { Market, Order, Position, Trade, Player } from '../module_bindings/types';
import { X, TrendingUp, TrendingDown, ShieldCheck, AlertTriangle, Zap } from 'lucide-react';

interface TradingPitOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  market: Market | null;
  orders: readonly Order[];
  trades: readonly Trade[];
  player: Player | null;
  positions: readonly Position[];
  myIdentity: Identity | null;
  onPlaceOrder: (side: 'YES' | 'NO', price: number, quantity: number) => Promise<void> | void;
  onCancelOrder: (orderId: bigint) => void;
}

export function TradingPitOverlay({
  isOpen,
  onClose,
  market,
  orders,
  trades,
  player,
  positions,
  myIdentity,
  onPlaceOrder,
  onCancelOrder,
}: TradingPitOverlayProps) {
  // ESC and E key handlers to close overlay
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

  const [side, setSide] = useState<'YES' | 'NO'>('YES');
  const [price, setPrice] = useState<number>(50);
  const [quantity, setQuantity] = useState<number>(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Sync initial price with market last traded or fair price
  useEffect(() => {
    if (market && (!price || price === 50)) {
      setPrice(market.lastTradedPrice || market.fairPrice || 50);
    }
  }, [market]);

  const myIdentityHex = myIdentity ? myIdentity.toHexString() : '';

  // Filter orders for active market
  const marketOrders = useMemo(() => {
    if (!market) return [];
    return orders.filter(o => o.marketId === market.marketId);
  }, [orders, market]);

  // Player position for this market
  const currentPosition = useMemo(() => {
    if (!market || !myIdentity) return null;
    return positions.find(
      p => p.marketId === market.marketId && p.owner.toHexString() === myIdentityHex
    ) ?? null;
  }, [positions, market, myIdentityHex]);

  // Aggregate orders by price level for CLOB Ladder
  // Prices 1..99
  const { bidsByPrice, asksByPrice, maxVolume } = useMemo(() => {
    const bidsMap = new Map<number, { volume: number; myQuantity: number; orderIds: bigint[] }>();
    const asksMap = new Map<number, { volume: number; myQuantity: number; orderIds: bigint[] }>();

    let maxVol = 1;

    for (const o of marketOrders) {
      const isMine = o.owner.toHexString() === myIdentityHex;

      if (o.side === 'YES') {
        // YES Bids: Buyer willing to buy YES at price p (1..99)
        const entry = bidsMap.get(o.price) || { volume: 0, myQuantity: 0, orderIds: [] };
        entry.volume += o.quantity;
        if (isMine) {
          entry.myQuantity += o.quantity;
          entry.orderIds.push(o.orderId);
        }
        bidsMap.set(o.price, entry);
        if (entry.volume > maxVol) maxVol = entry.volume;
      } else if (o.side === 'NO') {
        // NO Bids: Equivalent to asking (selling) YES at (100 - noPrice)
        const yesAskPrice = 100 - o.price;
        const entry = asksMap.get(yesAskPrice) || { volume: 0, myQuantity: 0, orderIds: [] };
        entry.volume += o.quantity;
        if (isMine) {
          entry.myQuantity += o.quantity;
          entry.orderIds.push(o.orderId);
        }
        asksMap.set(yesAskPrice, entry);
        if (entry.volume > maxVol) maxVol = entry.volume;
      }
    }

    // Sort asks ascending (e.g. 52¢, 55¢, 60¢)
    const sortedAsks = Array.from(asksMap.entries())
      .map(([p, data]) => ({ price: p, ...data }))
      .sort((a, b) => a.price - b.price);

    // Sort bids descending (e.g. 48¢, 45¢, 40¢)
    const sortedBids = Array.from(bidsMap.entries())
      .map(([p, data]) => ({ price: p, ...data }))
      .sort((a, b) => b.price - a.price);

    return { bidsByPrice: sortedBids, asksByPrice: sortedAsks, maxVolume: maxVol };
  }, [marketOrders, myIdentityHex]);

  // Best Bid & Best Ask
  const bestBid = bidsByPrice.length > 0 ? bidsByPrice[0].price : null;
  const bestAsk = asksByPrice.length > 0 ? asksByPrice[0].price : null;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;

  // Order Ticket Calculations
  // Total cost in cents
  const effectiveCostPerContract = side === 'YES' ? price : 100 - price;
  const totalCostCents = effectiveCostPerContract * quantity;
  const totalCostDollars = (totalCostCents / 100).toFixed(2);
  const potentialPayoutDollars = ((quantity * 100) / 100).toFixed(2);
  const maxProfitDollars = ((quantity * (100 - effectiveCostPerContract)) / 100).toFixed(2);
  const roiPercent = effectiveCostPerContract > 0
    ? Math.round(((100 - effectiveCostPerContract) / effectiveCostPerContract) * 100)
    : 0;

  // Optimality against market fair value
  const fairPrice = market?.fairPrice || 50;
  const optimality = useMemo(() => {
    if (side === 'YES') {
      const diff = fairPrice - price; // if fairPrice is 55 and buying at 50, diff = +5 (underpaying)
      if (diff > 0) return { label: `+${diff}¢ EV (+${roiPercent}% ROI)`, status: 'optimal' };
      if (diff === 0) return { label: 'FAIR VALUE (0¢ EV)', status: 'fair' };
      return { label: `${diff}¢ EV (Overpaying)`, status: 'suboptimal' };
    } else {
      // Side is NO: buying NO at (100 - price), fair value of NO is (100 - fairPrice)
      const noPrice = 100 - price;
      const fairNo = 100 - fairPrice;
      const diff = fairNo - noPrice;
      if (diff > 0) return { label: `+${diff}¢ EV (+${roiPercent}% ROI)`, status: 'optimal' };
      if (diff === 0) return { label: 'FAIR VALUE (0¢ EV)', status: 'fair' };
      return { label: `${diff}¢ EV (Overpaying)`, status: 'suboptimal' };
    }
  }, [side, price, fairPrice, roiPercent]);

  // Submit order handler
  const handleExecute = async () => {
    if (!market || quantity <= 0) return;
    if (price < 1 || price > 99) return;

    const availableCash = Number(player?.cashBalance ?? 0n);
    if (totalCostCents > availableCash) {
      setFeedbackMsg({ text: `Insufficient cash! Needed: $${totalCostDollars}`, type: 'error' });
      return;
    }

    try {
      setIsSubmitting(true);
      setFeedbackMsg(null);
      // Backend expects: side is 'YES' or 'NO', and price in that side's denomination
      // If buying YES at P: side='YES', price=P
      // If asking / buying NO at (100 - P): side='NO', price=100-P
      const submitPrice = side === 'YES' ? price : 100 - price;
      await onPlaceOrder(side, submitPrice, quantity);
      setFeedbackMsg({ text: `ORDER PLACED: ${quantity}x ${side} @ ${price}¢`, type: 'success' });
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err: any) {
      setFeedbackMsg({ text: err?.message || 'Order failed', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm select-none"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-5xl max-h-[92vh] bg-slate-950 border-2 border-indigo-500/80 rounded-xl shadow-[0_0_60px_rgba(99,102,241,0.3)] flex flex-col overflow-hidden text-slate-100">
        {/* Terminal Header */}
        <div className="px-4 py-3 bg-slate-900 border-b border-indigo-500/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <span className="font-['Press_Start_2P'] text-[11px] text-emerald-400 tracking-wider">
              TRADING PIT TERMINAL
            </span>
            <span className="hidden sm:inline-block px-2 py-0.5 text-[9px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-700/50 rounded">
              CENTRAL LIMIT ORDER BOOK
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-400 font-mono hidden md:inline">
              [PRESS ESC TO CLOSE]
            </span>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Close Pit Terminal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Market Banner Info */}
        <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex-1 min-w-[240px]">
            <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
              Active Contract
            </div>
            <div className="font-semibold text-white truncate text-sm">
              {market?.question || 'Mystery Cards Expected Sum > 20'}
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono text-xs">
            <div>
              <span className="text-slate-400">LAST: </span>
              <span className="font-bold text-emerald-400">{market?.lastTradedPrice ?? 50}¢</span>
            </div>
            <div>
              <span className="text-slate-400">FAIR: </span>
              <span className="font-bold text-sky-400">{fairPrice}¢</span>
            </div>
            <div>
              <span className="text-slate-400">SPREAD: </span>
              <span className="font-bold text-yellow-400">
                {spread !== null ? `${spread}¢` : '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-400">CASH: </span>
              <span className="font-bold text-white">
                ${((Number(player?.cashBalance ?? 0n)) / 100).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Main Terminal Workspace (2 Columns) */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Aggregated CLOB Order Book Ladder (7 cols) */}
          <div className="lg:col-span-7 flex flex-col bg-slate-900/50 border border-slate-800 rounded-lg p-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
              <span className="font-['Press_Start_2P'] text-[9px] text-slate-300">
                AGGREGATED ORDER BOOK
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                Click price to fill ticket
              </span>
            </div>

            {/* Column Headers */}
            <div className="grid grid-cols-12 text-[10px] font-mono text-slate-400 px-2 py-1 bg-slate-950/60 rounded">
              <div className="col-span-3">PRICE (¢)</div>
              <div className="col-span-3 text-right">VOLUME</div>
              <div className="col-span-6 text-right">ORDERS / PARTICIPATION</div>
            </div>

            {/* Asks (Sellers / NO Bids) - Top Ladder */}
            <div className="space-y-1 my-1 max-h-[160px] overflow-y-auto pr-1">
              {asksByPrice.length === 0 ? (
                <div className="text-center py-2 text-xs font-mono text-slate-500">
                  No resting asks
                </div>
              ) : (
                asksByPrice.slice(0, 8).map(ask => (
                  <div
                    key={`ask-${ask.price}`}
                    onClick={() => {
                      setPrice(ask.price);
                      setSide('YES'); // Buyer takes ask
                    }}
                    className="relative grid grid-cols-12 items-center text-xs font-mono px-2 py-1 rounded cursor-pointer hover:bg-rose-950/40 transition group"
                  >
                    {/* Depth Bar Background */}
                    <div
                      className="absolute top-0 right-0 bottom-0 bg-rose-500/15 rounded pointer-events-none"
                      style={{ width: `${Math.min(100, (ask.volume / maxVolume) * 100)}%` }}
                    />

                    <div className="col-span-3 font-bold text-rose-400 z-10 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-rose-400" />
                      {ask.price}¢
                    </div>
                    <div className="col-span-3 text-right text-slate-300 z-10 font-bold">
                      {ask.volume}
                    </div>
                    <div className="col-span-6 text-right z-10 flex items-center justify-end gap-1.5">
                      {ask.myQuantity > 0 && (
                        <span className="font-['Press_Start_2P'] text-yellow-400 animate-pulse text-[8px] bg-yellow-950/60 px-1.5 py-0.5 rounded border border-yellow-500/50">
                          YOU: {ask.myQuantity}
                        </span>
                      )}
                      {ask.orderIds.length > 0 && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            ask.orderIds.forEach(id => onCancelOrder(id));
                          }}
                          className="text-[9px] bg-rose-950 text-rose-300 hover:bg-rose-900 px-1 rounded border border-rose-700/60"
                          title="Cancel your order"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Spread / Mid-Market Divider */}
            <div className="py-1 px-3 my-1 bg-slate-950 border-y border-indigo-500/30 flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-400">
                SPREAD: <span className="text-yellow-400 font-bold">{spread !== null ? `${spread}¢` : '—'}</span>
              </span>
              <span className="text-slate-400">
                MID: <span className="text-sky-400 font-bold">
                  {bestBid && bestAsk ? `${Math.round((bestBid + bestAsk) / 2)}¢` : `${fairPrice}¢`}
                </span>
              </span>
            </div>

            {/* Bids (Buyers / YES Bids) - Bottom Ladder */}
            <div className="space-y-1 my-1 max-h-[160px] overflow-y-auto pr-1">
              {bidsByPrice.length === 0 ? (
                <div className="text-center py-2 text-xs font-mono text-slate-500">
                  No resting bids
                </div>
              ) : (
                bidsByPrice.slice(0, 8).map(bid => (
                  <div
                    key={`bid-${bid.price}`}
                    onClick={() => {
                      setPrice(bid.price);
                      setSide('NO'); // Seller hits bid
                    }}
                    className="relative grid grid-cols-12 items-center text-xs font-mono px-2 py-1 rounded cursor-pointer hover:bg-emerald-950/40 transition group"
                  >
                    {/* Depth Bar Background */}
                    <div
                      className="absolute top-0 right-0 bottom-0 bg-emerald-500/15 rounded pointer-events-none"
                      style={{ width: `${Math.min(100, (bid.volume / maxVolume) * 100)}%` }}
                    />

                    <div className="col-span-3 font-bold text-emerald-400 z-10 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3 text-emerald-400" />
                      {bid.price}¢
                    </div>
                    <div className="col-span-3 text-right text-slate-300 z-10 font-bold">
                      {bid.volume}
                    </div>
                    <div className="col-span-6 text-right z-10 flex items-center justify-end gap-1.5">
                      {bid.myQuantity > 0 && (
                        <span className="font-['Press_Start_2P'] text-yellow-400 animate-pulse text-[8px] bg-yellow-950/60 px-1.5 py-0.5 rounded border border-yellow-500/50">
                          YOU: {bid.myQuantity}
                        </span>
                      )}
                      {bid.orderIds.length > 0 && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            bid.orderIds.forEach(id => onCancelOrder(id));
                          }}
                          className="text-[9px] bg-rose-950 text-rose-300 hover:bg-rose-900 px-1 rounded border border-rose-700/60"
                          title="Cancel your order"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Position Summary Pill */}
            <div className="mt-auto pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">YOUR HOLDINGS:</span>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400 font-bold">
                  {currentPosition?.yesShares ?? 0} YES
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-rose-400 font-bold">
                  {currentPosition?.noShares ?? 0} NO
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Instant Execution Ticket & Optimality Gauge (5 cols) */}
          <div className="lg:col-span-5 flex flex-col bg-slate-900/70 border border-indigo-500/40 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="font-['Press_Start_2P'] text-[9px] text-indigo-300">
                TRADE TICKET
              </span>
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                <Zap className="w-3 h-3 text-emerald-400" /> ZERO-LATENCY
              </span>
            </div>

            {/* Side Selector (YES vs NO / Bid vs Ask) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSide('YES')}
                className={`py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition ${
                  side === 'YES'
                    ? 'bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.5)]'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                BID (BUY YES)
              </button>
              <button
                type="button"
                onClick={() => setSide('NO')}
                className={`py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition ${
                  side === 'NO'
                    ? 'bg-rose-600 text-white shadow-[0_0_15px_rgba(244,63,94,0.5)]'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                ASK (BUY NO)
              </button>
            </div>

            {/* Price Input & Slider */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1 font-mono">
                <span className="text-slate-300">LIMIT PRICE:</span>
                <span className="font-bold text-base text-yellow-400">{price}¢</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={99}
                  value={price}
                  onChange={e => setPrice(Number(e.target.value))}
                  className="flex-1 accent-indigo-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setPrice(fairPrice)}
                  className="px-2 py-1 text-[9px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-700 rounded hover:bg-indigo-900 transition"
                  title="Match Market Fair Value"
                >
                  FAIR ({fairPrice}¢)
                </button>
              </div>
            </div>

            {/* Quantity Selector & Presets */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1 font-mono">
                <span className="text-slate-300">QUANTITY:</span>
                <span className="font-bold text-white">{quantity} contracts</span>
              </div>
              <div className="grid grid-cols-5 gap-1 text-xs font-mono">
                {[1, 5, 10, 25, 50].map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuantity(q)}
                    className={`py-1 rounded border transition ${
                      quantity === q
                        ? 'bg-indigo-600 border-indigo-400 text-white font-bold'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    +{q}
                  </button>
                ))}
              </div>
            </div>

            {/* Optimality Indicator Gauge */}
            <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400 text-[11px]">EXPECTED VALUE:</span>
              <span
                className={`font-bold flex items-center gap-1 ${
                  optimality.status === 'optimal'
                    ? 'text-emerald-400'
                    : optimality.status === 'fair'
                    ? 'text-sky-400'
                    : 'text-amber-400'
                }`}
              >
                {optimality.status === 'optimal' ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                )}
                {optimality.label}
              </span>
            </div>

            {/* Cost & Payout Matrix */}
            <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 text-xs font-mono space-y-1">
              <div className="flex justify-between text-slate-400">
                <span>Total Outlay:</span>
                <span className="text-white font-bold">${totalCostDollars}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Payout if Correct:</span>
                <span className="text-emerald-400 font-bold">${potentialPayoutDollars}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Max Net Profit:</span>
                <span className="text-emerald-300 font-bold">+${maxProfitDollars}</span>
              </div>
            </div>

            {/* Execution Feedback Message */}
            {feedbackMsg && (
              <div
                className={`text-xs font-mono p-2 rounded text-center ${
                  feedbackMsg.type === 'success'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-600'
                    : 'bg-rose-950 text-rose-300 border border-rose-600'
                }`}
              >
                {feedbackMsg.text}
              </div>
            )}

            {/* Execute Button */}
            <button
              type="button"
              disabled={isSubmitting || quantity <= 0}
              onClick={handleExecute}
              className={`w-full py-3 rounded-lg font-['Press_Start_2P'] text-[10px] tracking-wider transition ${
                side === 'YES'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]'
                  : 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.4)]'
              } disabled:opacity-50`}
            >
              {isSubmitting ? 'MATCHING...' : `TRANSACT ${quantity}x ${side}`}
            </button>
          </div>
        </div>

        {/* Footer / Recent Pit Tape */}
        <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400 overflow-x-auto">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider whitespace-nowrap">
            Recent Pit Matches:
          </span>
          <div className="flex items-center gap-3 overflow-x-auto pl-2">
            {trades.slice(0, 4).map(t => (
              <span key={t.tradeId.toString()} className="whitespace-nowrap text-[11px]">
                ⚡ <span className="text-white font-bold">{t.quantity}x</span> @{' '}
                <span className="text-emerald-400 font-bold">{t.price}¢</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
