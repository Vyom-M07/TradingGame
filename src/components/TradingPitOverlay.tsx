import { useState, useMemo, useEffect } from 'react';
import { Identity } from 'spacetimedb';
import { Market, Order, Position, Trade, Player } from '../module_bindings/types';

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

interface Level {
  price: number;
  volume: number;
  myQuantity: number;
  orderIds: bigint[];
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

  const marketOrders = useMemo(() => {
    if (!market) return [];
    return orders.filter(o => o.marketId === market.marketId);
  }, [orders, market]);

  const currentPosition = useMemo(() => {
    if (!market || !myIdentity) return null;
    return positions.find(
      p => p.marketId === market.marketId && p.owner.toHexString() === myIdentityHex
    ) ?? null;
  }, [positions, market, myIdentityHex]);

  // Aggregate orders by price level for the CLOB ladder (prices 1..99).
  // YES orders are bids; a NO order at p is an ask for YES at 100 - p.
  const { bidsByPrice, asksByPrice, maxVolume } = useMemo(() => {
    const bidsMap = new Map<number, Level>();
    const asksMap = new Map<number, Level>();
    let maxVol = 1;

    for (const o of marketOrders) {
      const isMine = o.owner.toHexString() === myIdentityHex;
      const isYes = o.side === 'YES';
      if (!isYes && o.side !== 'NO') continue;
      const map = isYes ? bidsMap : asksMap;
      const levelPrice = isYes ? o.price : 100 - o.price;
      const entry = map.get(levelPrice) || { price: levelPrice, volume: 0, myQuantity: 0, orderIds: [] };
      entry.volume += o.quantity;
      if (isMine) {
        entry.myQuantity += o.quantity;
        entry.orderIds.push(o.orderId);
      }
      map.set(levelPrice, entry);
      if (entry.volume > maxVol) maxVol = entry.volume;
    }

    const sortedAsks = Array.from(asksMap.values()).sort((a, b) => a.price - b.price);
    const sortedBids = Array.from(bidsMap.values()).sort((a, b) => b.price - a.price);
    return { bidsByPrice: sortedBids, asksByPrice: sortedAsks, maxVolume: maxVol };
  }, [marketOrders, myIdentityHex]);

  const bestBid = bidsByPrice.length > 0 ? bidsByPrice[0].price : null;
  const bestAsk = asksByPrice.length > 0 ? asksByPrice[0].price : null;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;

  // Order ticket calculations (cents)
  const effectiveCostPerContract = side === 'YES' ? price : 100 - price;
  const totalCostCents = effectiveCostPerContract * quantity;
  const totalCostDollars = (totalCostCents / 100).toFixed(2);
  const potentialPayoutDollars = ((quantity * 100) / 100).toFixed(2);
  const maxProfitDollars = ((quantity * (100 - effectiveCostPerContract)) / 100).toFixed(2);
  const roiPercent = effectiveCostPerContract > 0
    ? Math.round(((100 - effectiveCostPerContract) / effectiveCostPerContract) * 100)
    : 0;

  // Expected value against the market's fair price
  const fairPrice = market?.fairPrice || 50;
  const optimality = useMemo(() => {
    const myCost = side === 'YES' ? price : 100 - price;
    const fair = side === 'YES' ? fairPrice : 100 - fairPrice;
    const diff = fair - myCost;
    if (diff > 0) return { label: `+${diff}¢ EV (+${roiPercent}% ROI)`, status: 'optimal' };
    if (diff === 0) return { label: 'FAIR (0¢ EV)', status: 'fair' };
    return { label: `${diff}¢ EV (overpaying)`, status: 'suboptimal' };
  }, [side, price, fairPrice, roiPercent]);

  const handleExecute = async () => {
    if (!market || quantity <= 0) return;
    if (price < 1 || price > 99) return;

    const availableCash = Number(player?.cashBalance ?? 0n);
    if (totalCostCents > availableCash) {
      setFeedbackMsg({ text: `Not enough cash! Need $${totalCostDollars}`, type: 'error' });
      return;
    }

    try {
      setIsSubmitting(true);
      setFeedbackMsg(null);
      // Backend expects the price in the chosen side's denomination.
      const submitPrice = side === 'YES' ? price : 100 - price;
      await onPlaceOrder(side, submitPrice, quantity);
      setFeedbackMsg({ text: `ORDER IN: ${quantity}x ${side} @ ${price}¢`, type: 'success' });
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err: any) {
      setFeedbackMsg({ text: err?.message || 'Order failed', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const ladderRow = (level: Level, kind: 'ask' | 'bid') => {
    const isAsk = kind === 'ask';
    return (
      <div
        key={`${kind}-${level.price}`}
        onClick={() => {
          setPrice(level.price);
          setSide(isAsk ? 'YES' : 'NO'); // take the other side of the level
        }}
        className={`group relative grid cursor-pointer grid-cols-12 items-center px-2 py-1.5 text-[10px] ${
          isAsk ? 'hover:bg-rose-500/15' : 'hover:bg-emerald-500/15'
        }`}
      >
        <div
          className={`pointer-events-none absolute inset-y-0.5 right-0 ${isAsk ? 'bg-rose-500/20' : 'bg-emerald-500/20'}`}
          style={{ width: `${Math.min(100, (level.volume / maxVolume) * 100)}%` }}
        />
        <div className={`z-10 col-span-3 ${isAsk ? 'text-rose-400' : 'text-emerald-400'}`}>{level.price}¢</div>
        <div className="z-10 col-span-3 text-right text-slate-200">{level.volume}</div>
        <div className="z-10 col-span-6 flex items-center justify-end gap-2">
          {level.myQuantity > 0 && (
            <span className="font-['Press_Start_2P'] text-[8px] text-yellow-400 animate-pulse">
              YOU: {level.myQuantity}
            </span>
          )}
          {level.orderIds.length > 0 && (
            <button
              onClick={e => {
                e.stopPropagation();
                level.orderIds.forEach(id => onCancelOrder(id));
              }}
              className="border-2 border-rose-400 px-1 py-0.5 text-[7px] text-rose-300 hover:bg-rose-500 hover:text-white"
              title="Cancel your orders at this price"
            >
              X
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bezel pop-in flex max-h-[94vh] w-full max-w-5xl flex-col p-3 sm:p-4">
        {/* Bezel header plate */}
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-3">
            <span className="inline-block h-3 w-3 animate-pulse bg-emerald-500 shadow-[0_0_0_3px_#2f3346]" />
            <span className="text-[12px] text-ink">PIT TERMINAL</span>
            <span className="hidden text-[8px] text-slate-600 md:inline">CENTRAL LIMIT ORDER BOOK</span>
          </div>
          <button onClick={onClose} className="sign !px-2 !py-1 text-[10px]" title="Close (Esc)">
            X
          </button>
        </div>

        {/* Screen */}
        <div className="bezel-screen flex min-h-0 flex-1 flex-col overflow-hidden text-slate-100 z-50 bg-slate-900/90">
          {/* Market banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-700 px-4 py-3">
            <div className="min-w-[220px] flex-1">
              <div className="text-[8px] text-slate-400">CONTRACT</div>
              <div className="mt-2 text-[11px] leading-[1.6] text-white">{market?.question || 'Mystery Cards Expected Sum > 20'}</div>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-[9px] sm:grid-cols-4">
              <span>
                <span className="text-slate-400">LAST </span>
                <span className="text-emerald-400">{market?.lastTradedPrice ?? 50}¢</span>
              </span>
              <span>
                <span className="text-slate-400">FAIR </span>
                <span className="text-sky-400">{fairPrice}¢</span>
              </span>
              <span>
                <span className="text-slate-400">SPRD </span>
                <span className="text-yellow-400">{spread !== null ? `${spread}¢` : '—'}</span>
              </span>
              <span>
                <span className="text-slate-400">CASH </span>
                <span className="text-white">${(Number(player?.cashBalance ?? 0n) / 100).toFixed(2)}</span>
              </span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-12">
            {/* Order book ladder */}
            <div className="flex flex-col border-2 border-slate-700 p-3 lg:col-span-7">
              <div className="mb-2 flex items-center justify-between border-b-2 border-slate-700 pb-2">
                <span className="text-[9px] text-slate-200">ORDER BOOK</span>
                <span className="text-[7px] text-slate-500">click a level to fill ticket</span>
              </div>

              <div className="grid grid-cols-12 px-2 py-1 text-[7px] text-slate-500">
                <div className="col-span-3">PRICE</div>
                <div className="col-span-3 text-right">VOLUME</div>
                <div className="col-span-6 text-right">YOURS</div>
              </div>

              <div className="flex max-h-[180px] flex-col-reverse overflow-y-auto">
                {asksByPrice.length === 0 ? (
                  <div className="py-2 text-center text-[8px] text-slate-500">No asks</div>
                ) : (
                  asksByPrice.slice(0, 8).map(ask => ladderRow(ask, 'ask'))
                )}
              </div>

              <div className="my-1 flex items-center justify-between border-y-2 border-dashed border-slate-600 px-2 py-2 text-[8px]">
                <span className="text-slate-400">
                  SPREAD <span className="text-yellow-400">{spread !== null ? `${spread}¢` : '—'}</span>
                </span>
                <span className="text-slate-400">
                  MID{' '}
                  <span className="text-sky-400">
                    {bestBid && bestAsk ? `${Math.round((bestBid + bestAsk) / 2)}¢` : `${fairPrice}¢`}
                  </span>
                </span>
              </div>

              <div className="max-h-[180px] overflow-y-auto">
                {bidsByPrice.length === 0 ? (
                  <div className="py-2 text-center text-[8px] text-slate-500">No bids</div>
                ) : (
                  bidsByPrice.slice(0, 8).map(bid => ladderRow(bid, 'bid'))
                )}
              </div>

              <div className="mt-auto flex items-center justify-between border-t-2 border-slate-700 pt-3 text-[9px]">
                <span className="text-slate-400">HOLDINGS</span>
                <span>
                  <span className="text-emerald-400">{currentPosition?.yesShares ?? 0} YES</span>
                  <span className="text-slate-600"> | </span>
                  <span className="text-rose-400">{currentPosition?.noShares ?? 0} NO</span>
                </span>
              </div>
            </div>

            {/* Trade ticket */}
            <div className="flex flex-col gap-4 border-2 border-slate-700 p-3 lg:col-span-5">
              <div className="flex items-center justify-between border-b-2 border-slate-700 pb-2">
                <span className="text-[9px] text-slate-200">TICKET</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSide('YES')}
                  className={`border-[3px] py-2.5 text-[9px] ${
                    side === 'YES' ? 'border-emerald-300 bg-emerald-500 text-ink' : 'border-slate-600 text-slate-400 hover:text-white'
                  }`}
                >
                  BUY YES
                </button>
                <button
                  type="button"
                  onClick={() => setSide('NO')}
                  className={`border-[3px] py-2.5 text-[9px] ${
                    side === 'NO' ? 'border-rose-300 bg-rose-500 text-ink' : 'border-slate-600 text-slate-400 hover:text-white'
                  }`}
                >
                  BUY NO
                </button>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between text-[8px]">
                  <span className="text-slate-400">LIMIT (YES ¢)</span>
                  <span className="text-[14px] text-yellow-400">{price}¢</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={99}
                    value={price}
                    onChange={e => setPrice(Number(e.target.value))}
                    className="pixel-range flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setPrice(fairPrice)}
                    className="border-2 border-sky-400 px-2 py-1 text-[7px] text-sky-300 hover:bg-sky-500 hover:text-ink"
                    title="Snap to fair value"
                  >
                    FAIR
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between text-[8px]">
                  <span className="text-slate-400">QUANTITY</span>
                  <span className="text-white">{quantity}</span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {[1, 5, 10, 25, 50].map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQuantity(q)}
                      className={`border-2 py-1.5 text-[8px] ${
                        quantity === q ? 'border-yellow-300 bg-yellow-400 text-ink' : 'border-slate-600 text-slate-300 hover:text-white'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-2 border-slate-700 p-2.5 text-[8px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">EV</span>
                  <span
                    className={
                      optimality.status === 'optimal'
                        ? 'text-emerald-400'
                        : optimality.status === 'fair'
                          ? 'text-sky-400'
                          : 'text-amber-400'
                    }
                  >
                    {optimality.label}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">COST</span>
                  <span className="text-white">${totalCostDollars}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">PAYS IF RIGHT</span>
                  <span className="text-emerald-400">${potentialPayoutDollars}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">MAX PROFIT</span>
                  <span className="text-emerald-300">+${maxProfitDollars}</span>
                </div>
              </div>

              {feedbackMsg && (
                <div
                  className={`border-2 p-2 text-center text-[8px] leading-relaxed ${
                    feedbackMsg.type === 'success' ? 'border-emerald-400 text-emerald-300' : 'border-rose-400 text-rose-300'
                  }`}
                >
                  {feedbackMsg.text}
                </div>
              )}

              <button
                type="button"
                disabled={isSubmitting || quantity <= 0}
                onClick={handleExecute}
                className={`sign w-full !py-3.5 text-[11px] disabled:opacity-50 ${
                  side === 'YES' ? '!bg-emerald-400' : '!bg-rose-400'
                }`}
              >
                {isSubmitting ? 'MATCHING...' : `BUY ${quantity} ${side}`}
              </button>
            </div>
          </div>

          {/* Tape */}
          <div className="flex items-center gap-4 overflow-x-auto border-t-2 border-slate-700 px-4 py-2.5 text-[8px] text-slate-400">
            <span className="whitespace-nowrap text-slate-500">TAPE</span>
            {trades.length === 0 && <span className="text-slate-600">no trades yet</span>}
            {[...trades]
              .sort((a, b) => Number(b.timestamp.microsSinceUnixEpoch - a.timestamp.microsSinceUnixEpoch))
              .slice(0, 6)
              .map(t => (
                <span key={t.tradeId.toString()} className="whitespace-nowrap">
                  <span className="text-white">{t.quantity}x</span> @ <span className="text-emerald-400">{t.price}¢</span>
                </span>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
