import React, { useMemo } from 'react';
import { Identity } from 'spacetimedb';
import { Order } from '../module_bindings/types';
import { Layers, ShieldCheck } from 'lucide-react';

interface OrderBookProps {
  orders: readonly Order[];
  activeMarketId: bigint | null;
  lastTradedPrice: number; // Quoted in contract cents (1-99)
  myIdentity: Identity | null;
  onSelectPrice: (price: number, side: 'BID' | 'ASK') => void;
}

interface AggregatedLevel {
  price: number;
  quantity: number;
  total: number;
  orderCount: number;
  hasMyOrder: boolean;
  isAmmOnly: boolean;
}

export const OrderBook: React.FC<OrderBookProps> = ({
  orders,
  activeMarketId,
  lastTradedPrice,
  myIdentity,
  onSelectPrice,
}) => {
  const myHex = myIdentity ? myIdentity.toHexString() : '';

  // Filter open orders for current market
  const marketOrders = useMemo(() => {
    if (!activeMarketId) return [];
    return orders.filter(o => o.marketId === activeMarketId && o.quantity > 0);
  }, [orders, activeMarketId]);

  // Bids: orders to BUY contracts at price P (side === 'YES')
  const bids = useMemo(() => {
    const map = new Map<number, { qty: number; count: number; hasMyOrder: boolean; botCount: number }>();
    for (const o of marketOrders) {
      if (o.side === 'YES') {
        const cur = map.get(o.price) || { qty: 0, count: 0, hasMyOrder: false, botCount: 0 };
        const isMine = myHex && o.owner.toHexString() === myHex;
        map.set(o.price, {
          qty: cur.qty + o.quantity,
          count: cur.count + 1,
          hasMyOrder: cur.hasMyOrder || !!isMine,
          botCount: cur.botCount + (o.isBot ? 1 : 0),
        });
      }
    }

    const sortedPrices = Array.from(map.keys()).sort((a, b) => b - a); // Highest bid first
    let cumulative = 0;
    const levels: AggregatedLevel[] = [];
    for (const price of sortedPrices) {
      const data = map.get(price)!;
      cumulative += data.qty;
      levels.push({
        price,
        quantity: data.qty,
        total: cumulative,
        orderCount: data.count,
        hasMyOrder: data.hasMyOrder,
        isAmmOnly: data.botCount === data.count,
      });
    }
    return levels.slice(0, 8);
  }, [marketOrders, myHex]);

  // Asks: orders to SELL contracts at price (100 - o.price) (side === 'NO')
  const asks = useMemo(() => {
    const map = new Map<number, { qty: number; count: number; hasMyOrder: boolean; botCount: number }>();
    for (const o of marketOrders) {
      if (o.side === 'NO') {
        const askPrice = 100 - o.price;
        const cur = map.get(askPrice) || { qty: 0, count: 0, hasMyOrder: false, botCount: 0 };
        const isMine = myHex && o.owner.toHexString() === myHex;
        map.set(askPrice, {
          qty: cur.qty + o.quantity,
          count: cur.count + 1,
          hasMyOrder: cur.hasMyOrder || !!isMine,
          botCount: cur.botCount + (o.isBot ? 1 : 0),
        });
      }
    }

    const sortedPrices = Array.from(map.keys()).sort((a, b) => a - b); // Lowest ask closest to spread
    let cumulative = 0;
    const levels: AggregatedLevel[] = [];
    for (const price of sortedPrices) {
      const data = map.get(price)!;
      cumulative += data.qty;
      levels.push({
        price,
        quantity: data.qty,
        total: cumulative,
        orderCount: data.count,
        hasMyOrder: data.hasMyOrder,
        isAmmOnly: data.botCount === data.count,
      });
    }
    return levels.slice(0, 8).reverse(); // Reverse so lowest ask is at bottom (above spread)
  }, [marketOrders, myHex]);

  const maxCumulative = useMemo(() => {
    const maxBid = bids.length > 0 ? bids[bids.length - 1].total : 1;
    const maxAsk = asks.length > 0 ? asks[0].total : 1;
    return Math.max(maxBid, maxAsk, 100);
  }, [bids, asks]);

  const bestBid = bids.length > 0 ? bids[0].price : null;
  const bestAsk = asks.length > 0 ? asks[asks.length - 1].price : null;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-bold text-white tracking-wide uppercase">
            Order Book (CLOB)
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800 font-mono">
            {marketOrders.length} resting
          </span>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 border-b border-slate-800/60">
        <div>Price (¢)</div>
        <div className="text-right">Size</div>
        <div className="text-right">Total</div>
      </div>

      {/* Asks (Sell Orders) */}
      <div className="flex-1 flex flex-col justify-end space-y-0.5 py-1">
        {asks.length === 0 ? (
          <div className="text-center py-4 text-xs text-slate-400 italic">
            No resting asks
          </div>
        ) : (
          asks.map(level => {
            const depthPct = Math.min((level.total / maxCumulative) * 100, 100);
            return (
              <div
                key={`ask-${level.price}`}
                onClick={() => onSelectPrice(level.price, 'ASK')}
                title="Click to set Ask price in ticket"
                className="relative grid grid-cols-3 text-xs font-mono px-2 py-1 rounded hover:bg-slate-800/60 cursor-pointer transition select-none group"
              >
                {/* Red Depth Bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-rose-500/15 transition-all duration-200 rounded"
                  style={{ width: `${depthPct}%` }}
                />
                <div className="relative text-rose-400 font-bold group-hover:underline flex items-center gap-1">
                  <span>{level.price}¢</span>
                  {level.hasMyOrder && (
                    <span className="text-[9px] px-1 bg-indigo-500 text-white rounded font-sans uppercase">
                      You
                    </span>
                  )}
                </div>
                <div className="relative text-right text-slate-300">
                  {level.quantity.toLocaleString()}
                </div>
                <div className="relative text-right text-slate-500">
                  {level.total.toLocaleString()}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Center Spread & Last Price Bar */}
      <div className="my-1.5 py-2 px-3 bg-slate-950/80 rounded-lg border border-slate-800/80 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-bold text-slate-400">
            Last:
          </span>
          <span className="font-mono font-extrabold text-base text-white">
            {lastTradedPrice}¢
          </span>
        </div>
        <div className="font-mono flex items-center gap-2 text-[11px]">
          {spread !== null ? (
            <span className="flex items-center gap-1 text-emerald-400 font-bold">
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              <span>Spread: {spread}¢</span>
            </span>
          ) : (
            <span className="text-slate-500">Spread: —</span>
          )}
        </div>
      </div>

      {/* Bids (Buy Orders) */}
      <div className="flex-1 space-y-0.5 py-1">
        {bids.length === 0 ? (
          <div className="text-center py-4 text-xs text-slate-400 italic">
            No resting bids
          </div>
        ) : (
          bids.map(level => {
            const depthPct = Math.min((level.total / maxCumulative) * 100, 100);
            return (
              <div
                key={`bid-${level.price}`}
                onClick={() => onSelectPrice(level.price, 'BID')}
                title="Click to set Bid price in ticket"
                className="relative grid grid-cols-3 text-xs font-mono px-2 py-1 rounded hover:bg-slate-800/60 cursor-pointer transition select-none group"
              >
                {/* Green Depth Bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-emerald-500/15 transition-all duration-200 rounded"
                  style={{ width: `${depthPct}%` }}
                />
                <div className="relative text-emerald-400 font-bold group-hover:underline flex items-center gap-1">
                  <span>{level.price}¢</span>
                  {level.hasMyOrder && (
                    <span className="text-[9px] px-1 bg-indigo-500 text-white rounded font-sans uppercase">
                      You
                    </span>
                  )}
                </div>
                <div className="relative text-right text-slate-300">
                  {level.quantity.toLocaleString()}
                </div>
                <div className="relative text-right text-slate-500">
                  {level.total.toLocaleString()}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
