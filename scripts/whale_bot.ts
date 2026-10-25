// Whale AI — an autonomous institutional trader for the Serious Trading floor.
//
// Runs as a standalone Node process next to the game:
//
//   npm run whale                       # local SpacetimeDB (.env.development)
//   npm run whale -- --cloud            # Maincloud (.env.production)
//
// It trades only in rooms where an instructor (class rooms) or the owner
// (solo rooms) has switched it on, and stops when a room's round ends. Every
// 10 seconds it takes the next market across those rooms, reads its order book,
// clues and its own inventory, asks Claude Haiku for a trade (or falls back to a
// built-in expected-value sniper when ANTHROPIC_API_KEY is not set), places the
// order, and walks its avatar in that room over to the market's pit.
//
// Environment (read from the shell, then .env.local, then .env.development /
// .env.production):
//   ANTHROPIC_API_KEY        optional; enables the Claude decision engine (any env file)
//   WHALE_PASSCODE           instructor passcode (default CALHACKS13)
//   WHALE_NAME               display name (default "Whale AI")
//   VITE_SPACETIMEDB_URI     e.g. ws://localhost:3000
//   VITE_SPACETIMEDB_NAME    e.g. serious-trading-local

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import type { Identity } from 'spacetimedb';
import { DbConnection, tables } from '../src/module_bindings/index.ts';
import type { Clue, Lobby, Market, Order } from '../src/module_bindings/types.ts';

// --- Config ------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLOUD = process.argv.includes('--cloud');
const ENV_FILES = ['.env.local', CLOUD ? '.env.production' : '.env.development', '.env.production', '.env.development', '.env'];
const readEnv = (file: string) => {
  const full = path.join(ROOT, file);
  return fs.existsSync(full) ? parseEnv(fs.readFileSync(full, 'utf8')) : {};
};
// Server settings come from .env.local plus the target's file; the shell always wins.
for (const file of ENV_FILES.slice(0, 2)) {
  for (const [key, value] of Object.entries(readEnv(file))) process.env[key] ??= value;
}
// The API key may live in any of the env files.
for (const file of ENV_FILES) {
  const key = readEnv(file).ANTHROPIC_API_KEY;
  if (key && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = key;
}

const HOST = process.env.VITE_SPACETIMEDB_URI || 'ws://localhost:3000';
const DB_NAME = process.env.VITE_SPACETIMEDB_NAME || 'serious-trading-local';
const NAME = process.env.WHALE_NAME || 'Whale AI';
const PASSCODE = process.env.WHALE_PASSCODE || 'CALHACKS13';
const MODEL = 'claude-haiku-5-5';
const TICK_MS = 10_000;
const STEP_MS = 260; // one floor tile per step while walking
const MAX_ORDER_QTY = 400;
const MAX_ORDER_CENTS = 150_000n; // never commit more than $1,500 on a single order
const STALE_ORDER_MICROS = 30_000_000n; // cancel our resting orders after 30s
const TOKEN_FILE = path.join(ROOT, 'scripts', `.whale_token.${DB_NAME}`);

// Floor geometry (matches spacetimedb/src/index.ts).
const GRID = { cols: 20, rows: 11 };
const CENTRAL_PIT = { minX: 8, maxX: 11, minY: 4, maxY: 7 };

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// --- Decision types ------------------------------------------------------------

const Decision = z.object({
  action: z.enum(['BUY', 'SELL', 'HOLD']),
  side: z.enum(['YES', 'NO']),
  price: z.number().int().describe('Limit price in cents of the chosen side, 1-99'),
  quantity: z.number().int().describe('Contracts, 0 when holding'),
  reasoning: z.string().describe('One or two sentences shown in the whale log'),
});
type Decision = z.infer<typeof Decision>;

interface Snapshot {
  room: Lobby;
  market: Market;
  clues: Clue[];
  bestBid: number; // best YES bid, 0 if none
  bestAsk: number; // best YES ask, 100 if none
  spread: number;
  bids: { price: number; qty: number }[]; // YES bids, best first
  asks: { price: number; qty: number }[]; // YES asks, best first
  cashCents: bigint;
  yesShares: number;
  noShares: number;
  myOrders: Order[];
}

// --- Connection ------------------------------------------------------------------

let me: Identity | null = null;
let registered = false;
let marketCursor = 0;
const walking = new Set<bigint>(); // rooms whose avatar is mid-walk

const savedToken = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : undefined;

const conn = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(savedToken || undefined)
  .withAutomaticReconnect()
  .onConnect((_conn, identity, token) => {
    me = identity;
    fs.writeFileSync(TOKEN_FILE, token);
    log(`connected to ${HOST}/${DB_NAME} as ${identity.toHexString().slice(0, 12)}…`);
  })
  .onDisconnect((_ctx, error, nextAttempt, delayMs) => {
    if (nextAttempt !== undefined) log(`disconnected, retry ${nextAttempt} in ${delayMs} ms`, error ?? '');
    else log('connection closed', error ?? '');
  })
  .onConnectError((_ctx, error) => {
    log('could not connect — is `spacetime start` running and the module published?', error);
  })
  .build();

conn
  .subscriptionBuilder()
  .onApplied(() => void register())
  .subscribe([
    tables.player,
    tables.market,
    tables.order,
    tables.position,
    tables.clue,
    tables.lobby,
    tables.whaleAvatar,
  ]);

async function register() {
  if (registered) return;
  try {
    await conn.reducers.registerWhale({ name: NAME, passcode: PASSCODE });
    registered = true;
    log(`${NAME} is on the floor. Engine: ${anthropic ? `Claude (${MODEL})` : 'EV sniper (no ANTHROPIC_API_KEY)'}`);
  } catch (err) {
    log('registerWhale failed:', errorText(err));
    log('check WHALE_PASSCODE matches the instructor passcode, and that the name is free.');
  }
}

// --- Main loop ---------------------------------------------------------------------

setInterval(() => void tick(), TICK_MS);

async function tick() {
  if (!registered || !me || !conn.isActive) return;

  const rooms = activeRooms();
  const work = rooms.flatMap(room => roomMarkets(room).map(market => ({ room, market })));
  if (work.length === 0) {
    for (const room of rooms) void wander(room);
    return;
  }
  const { room, market } = work[marketCursor++ % work.length];
  const snap = snapshot(room, market);

  cancelStaleOrders(snap);
  void walkTo(room, pitTileFor(market));

  let decision: Decision;
  let engine = 'EV';
  if (anthropic) {
    try {
      decision = await askClaude(snap);
      engine = 'Claude';
    } catch (err) {
      log('Claude call failed, using EV sniper this tick:', errorText(err));
      decision = evSniper(snap);
    }
  } else {
    decision = evSniper(snap);
  }

  await execute(snap, decision, engine);
}

/** Rooms the whale is switched on in (and standing in) whose round is still open. */
function activeRooms() {
  return [...conn.db.lobby.iter()]
    .filter(l => l.whaleEnabled && !l.roundOver && conn.db.whaleAvatar.lobbyId.find(l.lobbyId))
    .sort((a, b) => (a.lobbyId < b.lobbyId ? -1 : 1));
}

/** A room's open markets: its central one, plus the class floor pits in class rooms (matches the server). */
function roomMarkets(room: Lobby) {
  return [...conn.db.market.iter()]
    .filter(
      m =>
        m.status === 'OPEN' &&
        (m.marketId === room.marketId ||
          (room.isSolo ? m.lobbyId === room.lobbyId : m.lobbyId === 0n && m.locationX >= 0))
    )
    .sort((a, b) => (a.marketId < b.marketId ? -1 : 1));
}

function snapshot(room: Lobby, market: Market): Snapshot {
  const orders = [...conn.db.order.iter()].filter(o => o.marketId === market.marketId && o.quantity > 0);
  const level = (map: Map<number, number>, price: number, qty: number) => map.set(price, (map.get(price) ?? 0) + qty);
  const bidMap = new Map<number, number>();
  const askMap = new Map<number, number>();
  for (const o of orders) {
    if (o.side === 'YES') level(bidMap, o.price, o.quantity);
    else level(askMap, 100 - o.price, o.quantity);
  }
  const bids = [...bidMap].map(([price, qty]) => ({ price, qty })).sort((a, b) => b.price - a.price);
  const asks = [...askMap].map(([price, qty]) => ({ price, qty })).sort((a, b) => a.price - b.price);
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 100;

  const player = conn.db.player.identity.find(me!);
  const pos = [...conn.db.position.iter()].find(p => p.marketId === market.marketId && p.owner.isEqual(me!));
  const clues = [...conn.db.clue.iter()]
    .filter(c => c.marketId === market.marketId)
    .sort((a, b) => Number(a.revealedAt.microsSinceUnixEpoch - b.revealedAt.microsSinceUnixEpoch));

  return {
    room,
    market,
    clues,
    bestBid,
    bestAsk,
    spread: bestAsk - bestBid,
    bids: bids.slice(0, 5),
    asks: asks.slice(0, 5),
    cashCents: player?.cashBalance ?? 0n,
    yesShares: pos?.yesShares ?? 0,
    noShares: pos?.noShares ?? 0,
    myOrders: orders.filter(o => o.owner.isEqual(me!)),
  };
}

// --- Decision engines -------------------------------------------------------------

const SYSTEM_PROMPT = `You are "The Whale", an apex institutional trader on a classroom prediction-market floor.
Each contract pays 100 cents if its side wins, 0 otherwise. A YES price of 62 means the floor
implies a 62% chance; the matching NO price is 38.

Every 10 seconds you get one market's order book, the clues revealed so far and your inventory.
Estimate the true probability from the question and the clues, then trade aggressively when the
book is mispriced versus your estimate, and HOLD when the edge is under ~3 cents.

Order semantics:
- BUY YES at p: bid for YES at p cents (fills against YES asks at or below p).
- BUY NO at p: bid for NO at p cents (fills against YES bids at or above 100 - p).
- SELL YES at p is the same as BUY NO at 100 - p; SELL NO at p is the same as BUY YES at 100 - p.
- price is always in cents of the side you name, 1-99. quantity is 1-${MAX_ORDER_QTY}; use 0 for HOLD.
- A single order may commit at most $${Number(MAX_ORDER_CENTS) / 100} and never more cash than you have.

Size up when the clues make the outcome near-certain, keep inventory balanced when they don't, and
write reasoning as one or two short sentences a student could learn from.`;

async function askClaude(s: Snapshot): Promise<Decision> {
  const state = {
    question: s.market.question,
    description: s.market.description,
    category: s.market.category,
    lastTradedYes: s.market.lastTradedPrice,
    volume: Number(s.market.volume),
    book: {
      bestYesBid: s.bestBid || null,
      bestYesAsk: s.bestAsk < 100 ? s.bestAsk : null,
      spread: s.spread,
      yesBids: s.bids,
      yesAsks: s.asks,
    },
    clues: s.clues.map(c => ({
      title: c.title,
      content: c.content,
      ...(c.suggestedFairPrice > 0 ? { hintedFairYes: c.suggestedFairPrice } : {}),
    })),
    you: {
      cashCents: Number(s.cashCents),
      yesShares: s.yesShares,
      noShares: s.noShares,
      restingOrders: s.myOrders.map(o => ({ side: o.side, price: o.price, quantity: o.quantity })),
    },
  };

  const response = await anthropic!.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(Decision) },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(state) }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`no decision (stop_reason=${response.stop_reason})`);
  }
  return response.parsed_output;
}

/**
 * Zero-config quant fallback: take the latest clue's hinted fair price (or the
 * book mid) as the estimate and lift any quote that is at least 3¢ mispriced.
 */
function evSniper(s: Snapshot): Decision {
  const hinted = [...s.clues].reverse().find(c => c.suggestedFairPrice > 0)?.suggestedFairPrice;
  const mid = s.bestBid > 0 && s.bestAsk < 100 ? Math.round((s.bestBid + s.bestAsk) / 2) : s.market.lastTradedPrice;
  const fair = hinted ?? mid;
  const edgeBuy = fair - s.bestAsk;
  const edgeSell = s.bestBid - fair;
  const size = (edge: number, depth: number) => Math.max(10, Math.min(MAX_ORDER_QTY, depth, edge * 40));

  if (s.bestAsk < 100 && edgeBuy >= 3) {
    return {
      action: 'BUY',
      side: 'YES',
      price: s.bestAsk,
      quantity: size(edgeBuy, s.asks[0].qty),
      reasoning: `Fair ~${fair}¢${hinted ? ' (clue)' : ''} vs ask ${s.bestAsk}¢: +${edgeBuy}¢ edge per YES. Lifting the offer.`,
    };
  }
  if (s.bestBid > 0 && edgeSell >= 3) {
    return {
      action: 'SELL',
      side: 'YES',
      price: s.bestBid,
      quantity: size(edgeSell, s.bids[0].qty),
      reasoning: `Fair ~${fair}¢${hinted ? ' (clue)' : ''} vs bid ${s.bestBid}¢: YES is ${edgeSell}¢ rich. Hitting the bid via NO.`,
    };
  }
  return {
    action: 'HOLD',
    side: 'YES',
    price: fair,
    quantity: 0,
    reasoning: `Book ${s.bestBid || '-'}/${s.bestAsk < 100 ? s.bestAsk : '-'} sits within 3¢ of fair ~${fair}¢. No edge.`,
  };
}

// --- Execution -------------------------------------------------------------------

async function execute(s: Snapshot, d: Decision, engine: string) {
  const tag = `[${engine}] ${s.room.code} · ${s.market.question.slice(0, 40)}`;
  if (d.action === 'HOLD' || d.quantity <= 0) {
    log(`${tag} HOLD — ${d.reasoning}`);
    return;
  }

  // SELL X at p is a bid for the other side at 100 - p.
  const side = d.action === 'BUY' ? d.side : d.side === 'YES' ? 'NO' : 'YES';
  const price = clamp(Math.round(d.action === 'BUY' ? d.price : 100 - d.price), 1, 99);
  const affordable = Number((s.cashCents < MAX_ORDER_CENTS ? s.cashCents : MAX_ORDER_CENTS) / BigInt(price));
  const quantity = clamp(Math.round(d.quantity), 0, Math.min(MAX_ORDER_QTY, affordable));
  if (quantity < 1) {
    log(`${tag} wanted ${d.action} ${d.side} but cash is too low ($${(Number(s.cashCents) / 100).toFixed(2)})`);
    return;
  }

  try {
    await conn.reducers.placeOrder({ marketId: s.market.marketId, side, price, quantity });
    log(`${tag} ${d.action} ${d.side} → bid ${quantity} ${side} @ ${price}¢ — ${d.reasoning}`);
  } catch (err) {
    log(`${tag} order rejected: ${errorText(err)}`);
  }
}

function cancelStaleOrders(s: Snapshot) {
  const now = BigInt(Date.now()) * 1000n;
  for (const o of s.myOrders) {
    if (now - o.timestamp.microsSinceUnixEpoch > STALE_ORDER_MICROS) {
      conn.reducers.cancelOrder({ orderId: o.orderId }).catch(() => undefined);
    }
  }
}

// --- Walking the floor -------------------------------------------------------------

/** A tile inside the market's 2x2 pit, or inside the central pit for lobby markets. */
function pitTileFor(m: Market) {
  if (m.locationX >= 0) {
    return { x: m.locationX + randInt(0, 1), y: m.locationY + randInt(0, 1) };
  }
  return { x: randInt(CENTRAL_PIT.minX, CENTRAL_PIT.maxX), y: randInt(CENTRAL_PIT.minY, CENTRAL_PIT.maxY) };
}

async function wander(room: Lobby) {
  await walkTo(room, { x: randInt(2, GRID.cols - 3), y: randInt(2, GRID.rows - 3) });
}

/** Steps tile by tile within a room so its clients animate a walk instead of a teleport. */
async function walkTo(room: Lobby, target: { x: number; y: number }) {
  const lobbyId = room.lobbyId;
  if (walking.has(lobbyId) || !me) return;
  walking.add(lobbyId);
  try {
    for (let i = 0; i < 40; i++) {
      // Gone once the whale is switched off in this room.
      const p = conn.db.whaleAvatar.lobbyId.find(lobbyId);
      if (!p) break;
      const dx = Math.sign(target.x - p.x);
      const dy = Math.sign(target.y - p.y);
      if (dx === 0 && dy === 0) break;
      // Walk the longer axis first, like a person would.
      const horizontal = dx !== 0 && (dy === 0 || Math.abs(target.x - p.x) >= Math.abs(target.y - p.y));
      const next = horizontal ? { x: p.x + dx, y: p.y } : { x: p.x, y: p.y + dy };
      const direction = horizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      await conn.reducers.whaleMove({ lobbyId, ...next, direction });
      await sleep(STEP_MS);
    }
  } catch (err) {
    log(`whaleMove in ${room.code} failed:`, errorText(err));
  } finally {
    walking.delete(lobbyId);
  }
}

// --- Utils -----------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function randInt(lo: number, hi: number) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function log(...parts: unknown[]) {
  console.log(`[whale ${new Date().toLocaleTimeString()}]`, ...parts);
}

process.on('SIGINT', () => {
  log('shutting down');
  conn.disconnect();
  process.exit(0);
});
