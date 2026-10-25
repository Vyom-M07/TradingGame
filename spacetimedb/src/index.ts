import {
  schema,
  table,
  t,
  SenderError,
  type InferSchema,
  type ReducerCtx,
  type ViewCtx,
} from 'spacetimedb/server';
import { Identity, ScheduleAt } from 'spacetimedb';

// -----------------------------------------------------------------------------
// TABLES
// -----------------------------------------------------------------------------

const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    username: t.string(),
    cashBalance: t.u64(), // cash in cents
    x: t.i32(), // tile grid x (0 to 19)
    y: t.i32(), // tile grid y (0 to 10)
    direction: t.string(), // "up" | "down" | "left" | "right"
    createdAt: t.timestamp(),
    role: t.string().default('STUDENT'), // "STUDENT" | "INSTRUCTOR"
    avatarType: t.string().default('trader'), // "trader" | "businesswoman"
    // False until join_game, and again after being disconnected for 2 minutes.
    onFloor: t.bool().default(false),
  }
);

const market = table(
  { name: 'market', public: true },
  {
    marketId: t.u64().primaryKey().autoInc(),
    question: t.string(),
    category: t.string(),
    description: t.string(),
    status: t.string(), // "OPEN" or "RESOLVED"
    winningSide: t.string(), // "" or "YES" or "NO"
    lastTradedPrice: t.u32(), // 1 - 99 cents (quoted in YES price)
    preResolvedPrice: t.u32(), // price before resolution to accurately restore on undo/reopen
    fairPrice: t.u32(), // 1 - 99 cents (underlying consensus fair value)
    volume: t.u64(), // total contracts matched
    createdAt: t.timestamp(),
    // Top-left tile of the market's 2x2 trading pit on the floor grid; -1 = not placed.
    locationX: t.i32().default(-1),
    locationY: t.i32().default(-1),
    // Bumped whenever the contract's terms change, so agents know to re-price.
    revision: t.u32().default(0),
  }
);

const order = table(
  { name: 'order', public: true },
  {
    orderId: t.u64().primaryKey().autoInc(),
    marketId: t.u64().index('btree'),
    owner: t.identity().index('btree'),
    side: t.string(), // "YES" or "NO"
    price: t.u32(), // 1 - 99 cents
    quantity: t.u32(),
    originalQuantity: t.u32(),
    isBot: t.bool(),
    botRole: t.string(), // "NONE" | "AMM" | "SNIPER" | "NOISE"
    timestamp: t.timestamp(),
    // bot_trader that owns this order (0 = a human, the whale or the house).
    botId: t.u64().default(0n),
  }
);

const position = table(
  {
    name: 'position',
    public: true,
    indexes: [
      { accessor: 'by_owner_market', algorithm: 'btree', columns: ['owner', 'marketId'] },
    ],
  },
  {
    positionId: t.u64().primaryKey().autoInc(),
    marketId: t.u64(),
    owner: t.identity(),
    yesShares: t.u32(),
    noShares: t.u32(),
  }
);

const trade = table(
  { name: 'trade', public: true },
  {
    tradeId: t.u64().primaryKey().autoInc(),
    marketId: t.u64().index('btree'),
    maker: t.identity(),
    taker: t.identity(),
    makerSide: t.string(), // "YES" or "NO"
    takerSide: t.string(), // "YES" or "NO"
    makerRole: t.string(), // "HUMAN" | "AMM" | "SNIPER"
    takerRole: t.string(), // "HUMAN" | "AMM" | "SNIPER"
    price: t.u32(), // execution price in cents (1-99 YES price)
    quantity: t.u32(),
    timestamp: t.timestamp(),
    makerBotId: t.u64().default(0n), // bot_trader on each side, 0 if none
    takerBotId: t.u64().default(0n),
  }
);

const clue = table(
  { name: 'clue', public: true },
  {
    clueId: t.u64().primaryKey().autoInc(),
    marketId: t.u64().index('btree'),
    title: t.string(),
    content: t.string(),
    suggestedFairPrice: t.u32(), // optional target fair price (0 if none)
    revealedAt: t.timestamp(),
  }
);

const lobby = table(
  { name: 'lobby', public: true },
  {
    lobbyId: t.u64().primaryKey().autoInc(),
    code: t.string().unique(), // e.g. "CAL13"
    title: t.string(),
    instructor: t.identity(), // Instructor / Room creator
    marketId: t.u64().index('btree'),
    initialBalance: t.u64(), // starting balance in cents for joining players (e.g. 10_000n = $100.00)
    createdAt: t.timestamp(),
  }
);

const lobbyParticipant = table(
  {
    name: 'lobby_participant',
    public: true,
    indexes: [
      { accessor: 'by_lobby_player', algorithm: 'btree', columns: ['lobbyId', 'player'] },
    ],
  },
  {
    participantId: t.u64().primaryKey().autoInc(),
    lobbyId: t.u64(),
    player: t.identity(),
    joinedAt: t.timestamp(),
  }
);

// Singleton (id = 0) of round-wide state every client reacts to.
const gameState = table(
  { name: 'game_state', public: true },
  {
    id: t.u32().primaryKey(),
    newsTickerMessage: t.string(),
    newsPostedAt: t.timestamp(), // bumps on every broadcast so repeats still flash
    isLeaderboardRevealed: t.bool(),
  }
);

// Private: live connections, so a player with another tab open stays on the floor.
const activeConnection = table(
  { name: 'active_connection' },
  {
    connectionId: t.connectionId().primaryKey(),
    identity: t.identity().index('btree'),
  }
);

// Private: fires 2 minutes after a player's last connection drops.
const disconnectTimer = table(
  { name: 'disconnect_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    identity: t.identity().index('btree'),
  }
);

// Private: holds the passcode used to claim the instructor role.
const instructorConfig = table(
  { name: 'instructor_config' },
  {
    id: t.u32().primaryKey(),
    passcode: t.string(),
  }
);

// -----------------------------------------------------------------------------
// SCHEMA
// -----------------------------------------------------------------------------


// Singleton (id = 0): who switched the house bots on, how fast they tick, and
// whether the external whale sidecar may trade.
const botConfig = table(
  { name: 'bot_config', public: true },
  {
    id: t.u32().primaryKey(),
    ammEnabled: t.bool(),
    whaleEnabled: t.bool(),
    tickMs: t.u32(),
    controlledBy: t.string(), // "" | "INSTRUCTOR" | "SOLO"
  }
);

// Private: repeating schedule that drives the bots while they are on.
const botTimer = table(
  { name: 'bot_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

// Robot traders standing around the pits while the bots are on. They own the
// house liquidity (MAKER), pick off mispriced orders (SNIPER) and cross the
// spread now and then (NOISE). Bots trade on the house's account: no cash.
const botTrader = table(
  { name: 'bot_trader', public: true },
  {
    botId: t.u64().primaryKey().autoInc(),
    name: t.string(),
    role: t.string(), // "MAKER" | "SNIPER" | "NOISE"
    marketId: t.u64().index('btree'),
    x: t.i32(),
    y: t.i32(),
    direction: t.string(),
    tradeCount: t.u32(),
  }
);

const spacetimedb = schema({
  player,
  market,
  order,
  position,
  trade,
  clue,
  lobby,
  lobbyParticipant,
  gameState,
  botConfig,
  botTimer,
  botTrader,
  instructorConfig,
  activeConnection,
  disconnectTimer,
});

export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
// Read-only database handle shared by views and reducers.
type ReadDb = ViewCtx<InferSchema<typeof spacetimedb>>['db'];

const DEFAULT_INSTRUCTOR_PASSCODE = 'CALHACKS13';

// Players may pick these. 'whale' is reserved for the AI sidecar (registerWhale)
// and robots are only drawn for bot_trader rows.
const AVATAR_TYPES = ['trader', 'businesswoman'];
const WHALE_AVATAR = 'whale';
const BOT_TICK_OPTIONS = [600, 1000, 2000];
const SPAWN = { x: 3, y: 5 };
const DISCONNECT_GRACE_MICROS = 120_000_000n; // 2 minutes

// Floor grid (must match the client) and the central pit's walk-up zone.
const GRID_COLS = 20;
const GRID_ROWS = 11;
const CENTRAL_PIT_ZONE = { minX: 7, maxX: 12, minY: 3, maxY: 8 };

// -----------------------------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function getOrCreatePlayer(ctx: Ctx) {
  let p = ctx.db.player.identity.find(ctx.sender);
  if (!p) {
    p = ctx.db.player.insert({
      identity: ctx.sender,
      username: 'Trader_' + ctx.sender.toHexString().slice(0, 6),
      cashBalance: 10_000n, // $100.00 default initial starting bankroll in cents
      x: 3,
      y: 5,
      direction: 'right',
      createdAt: ctx.timestamp,
      role: 'STUDENT',
      avatarType: 'trader',
      onFloor: false,
    });
  }
  return p;
}

/** Validates a display name and rejects one already used by another player (case-insensitive). */
function assertUniqueName(ctx: Ctx, name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 24) {
    throw new SenderError('Name must be between 2 and 24 characters');
  }
  const lower = trimmed.toLowerCase();
  for (const other of ctx.db.player.iter()) {
    if (!other.identity.equals(ctx.sender) && other.username.toLowerCase() === lower) {
      throw new SenderError(`The name "${trimmed}" is already taken`);
    }
  }
  return trimmed;
}

function cancelDisconnectTimers(ctx: Ctx, identity: Identity) {
  for (const timer of [...ctx.db.disconnectTimer.identity.filter(identity)]) {
    ctx.db.disconnectTimer.scheduledId.delete(timer.scheduledId);
  }
}

function requireInstructor(ctx: Ctx) {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || p.role !== 'INSTRUCTOR') {
    throw new SenderError('Forbidden: instructor role required');
  }
  return p;
}

function getBotConfig(ctx: Ctx) {
  return (
    ctx.db.botConfig.id.find(0) ??
    ctx.db.botConfig.insert({ id: 0, ammEnabled: false, whaleEnabled: true, tickMs: 1000, controlledBy: '' })
  );
}

function getGameState(ctx: Ctx) {
  return (
    ctx.db.gameState.id.find(0) ??
    ctx.db.gameState.insert({
      id: 0,
      newsTickerMessage: '',
      newsPostedAt: ctx.timestamp,
      isLeaderboardRevealed: false,
    })
  );
}

/** Mid-price of a market's book in YES cents, falling back to the last trade. */
function midPrice(db: ReadDb, marketId: bigint): number {
  const m = db.market.marketId.find(marketId);
  if (!m) return 0;
  if (m.status === 'RESOLVED') return m.winningSide === 'YES' ? 100 : 0;
  let bestBid = 0;
  let bestAsk = 100;
  for (const o of db.order.marketId.filter(marketId)) {
    if (o.quantity === 0) continue;
    if (o.side === 'YES') bestBid = Math.max(bestBid, o.price);
    else bestAsk = Math.min(bestAsk, 100 - o.price);
  }
  if (bestBid > 0 && bestAsk < 100) return Math.round((bestBid + bestAsk) / 2);
  return m.lastTradedPrice;
}

/**
 * Total Net Worth = cash_balance + cash locked in resting orders
 *                 + open positions marked at the current mid-price.
 */
function valuePlayer(db: ReadDb, owner: Identity, cashBalance: bigint) {
  let escrow = 0n;
  for (const o of db.order.owner.filter(owner)) {
    if (!o.isBot) escrow += BigInt(o.price) * BigInt(o.quantity);
  }
  let holdings = 0n;
  const mids = new Map<bigint, number>();
  for (const pos of db.position.by_owner_market.filter(owner)) {
    if (pos.yesShares === 0 && pos.noShares === 0) continue;
    let mid = mids.get(pos.marketId);
    if (mid === undefined) {
      mid = midPrice(db, pos.marketId);
      mids.set(pos.marketId, mid);
    }
    holdings += BigInt(pos.yesShares) * BigInt(mid) + BigInt(pos.noShares) * BigInt(100 - mid);
  }
  const cash = cashBalance + escrow;
  return { cash, holdings, netWorth: cash + holdings };
}

/** Throws unless a 2x2 pit with top-left (x, y) fits on open floor. */
function assertPitLocation(ctx: Ctx, x: number, y: number) {
  // Row 0 holds the desks and the bottom row the corner plants.
  if (x < 0 || x > GRID_COLS - 2 || y < 1 || y > GRID_ROWS - 3) {
    throw new SenderError(`Pit location must be x 0-${GRID_COLS - 2}, y 1-${GRID_ROWS - 3}`);
  }
  const overlaps = (ax: number, ay: number, bx0: number, bx1: number, by0: number, by1: number) =>
    ax + 1 >= bx0 && ax <= bx1 && ay + 1 >= by0 && ay <= by1;
  const z = CENTRAL_PIT_ZONE;
  if (overlaps(x, y, z.minX, z.maxX, z.minY, z.maxY)) {
    throw new SenderError('That spot overlaps the central trading pit');
  }
  for (const m of ctx.db.market.iter()) {
    if (m.status !== 'OPEN' || m.locationX < 0) continue;
    if (overlaps(x, y, m.locationX - 1, m.locationX + 2, m.locationY - 1, m.locationY + 2)) {
      throw new SenderError(`That spot is too close to the pit for "${m.question}"`);
    }
  }
}

function getOrCreatePosition(ctx: Ctx, marketId: bigint, owner: any) {
  const matches = [...ctx.db.position.by_owner_market.filter([owner, marketId])];
  if (matches.length > 0) {
    return matches[0];
  }
  return ctx.db.position.insert({
    positionId: 0n,
    marketId,
    owner,
    yesShares: 0,
    noShares: 0,
  });
}


function makerBotFor(ctx: Ctx, marketId: bigint) {
  for (const b of ctx.db.botTrader.marketId.filter(marketId)) if (b.role === 'MAKER') return b.botId;
  return 0n;
}

function seedMarketLiquidity(ctx: Ctx, marketId: bigint, fairPrice: number) {
  const botId = makerBotFor(ctx, marketId);
  // Sizes wobble +-30% so the book visibly breathes as the maker requotes.
  const jitter = (qty: number) => Math.max(1, Math.round((qty * ctx.random.integerInRange(70, 130)) / 100));
  // Clear existing AMM bot orders for this market
  const existingOrders = [...ctx.db.order.marketId.filter(marketId)];
  // Bot orders carry no escrow, so they are simply replaced (including any
  // leftovers from before bots had their own identity).
  for (const o of existingOrders) {
    if (o.isBot) {
      ctx.db.order.orderId.delete(o.orderId);
    }
  }

  // Multi-tier ladder on YES bids (below fairPrice)
  const yesOffsets = [
    { delta: 1, qty: 30 },
    { delta: 2, qty: 60 },
    { delta: 4, qty: 120 },
    { delta: 7, qty: 250 },
    { delta: 12, qty: 600 },
  ];

  for (const item of yesOffsets) {
    const p = fairPrice - item.delta;
    if (p >= 1 && p <= 98) {
      ctx.db.order.insert({
        orderId: 0n,
        marketId,
        owner: ctx.identity, // the module itself is the market maker
        side: 'YES',
        price: p,
        quantity: jitter(item.qty),
        originalQuantity: item.qty,
        isBot: true,
        botRole: 'AMM',
        timestamp: ctx.timestamp,
        botId,
      });
    }
  }

  // Multi-tier ladder on NO bids (creating YES asks above fairPrice)
  const noOffsets = [
    { delta: 1, qty: 30 },
    { delta: 2, qty: 60 },
    { delta: 4, qty: 120 },
    { delta: 7, qty: 250 },
    { delta: 12, qty: 600 },
  ];

  for (const item of noOffsets) {
    const yesAsk = fairPrice + item.delta;
    const noBid = 100 - yesAsk;
    if (noBid >= 1 && noBid <= 98) {
      ctx.db.order.insert({
        orderId: 0n,
        marketId,
        owner: ctx.identity,
        side: 'NO',
        price: noBid,
        quantity: jitter(item.qty),
        originalQuantity: item.qty,
        isBot: true,
        botRole: 'AMM',
        timestamp: ctx.timestamp,
        botId,
      });
    }
  }
}

// -----------------------------------------------------------------------------
// LIFECYCLE HOOKS
// -----------------------------------------------------------------------------

export const init = spacetimedb.init(ctx => {
  getGameState(ctx);
  ctx.db.instructorConfig.insert({ id: 0, passcode: DEFAULT_INSTRUCTOR_PASSCODE });

  // 1. Classroom / Educational Market: 3-Card Sum Game
  const mEdu = ctx.db.market.insert({
    marketId: 0n,
    question: 'Expected Sum of 3 Mystery Cards > 20?',
    category: 'Classroom',
    description: 'Instructor will progressively reveal 3 cards. Resolves YES if total card value exceeds 20 (Face cards = 10, Ace = 11).',
    status: 'OPEN',
    winningSide: '',
    lastTradedPrice: 50,
    preResolvedPrice: 50,
    fairPrice: 50,
    volume: 500n,
    createdAt: ctx.timestamp,
    locationX: -1,
    locationY: -1,
    revision: 0,
  });
  seedMarketLiquidity(ctx, mEdu.marketId, 50);

  // Default Lobby for Cal Hacks Demo ($100 default bankroll)
  ctx.db.lobby.insert({
    lobbyId: 0n,
    code: 'CAL13',
    title: 'Cal Hacks 13.0 Main Arena',
    instructor: ctx.sender,
    marketId: mEdu.marketId,
    initialBalance: 10_000n, // $100.00
    createdAt: ctx.timestamp,
  });

  // 2. High-interest prediction markets
  const m1 = ctx.db.market.insert({
    marketId: 0n,
    question: 'Bitcoin > $68,500 by End of Week?',
    category: 'Crypto',
    description: 'Resolves YES if BTC/USD trades strictly above $68,500.00 on major index before expiration.',
    status: 'OPEN',
    winningSide: '',
    lastTradedPrice: 62,
    preResolvedPrice: 62,
    fairPrice: 62,
    volume: 1250n,
    createdAt: ctx.timestamp,
    locationX: -1,
    locationY: -1,
    revision: 0,
  });
  seedMarketLiquidity(ctx, m1.marketId, 62);

  const m2 = ctx.db.market.insert({
    marketId: 0n,
    question: 'Fed cuts interest rates by 25 bps at upcoming FOMC?',
    category: 'Macro',
    description: 'Resolves YES if Federal Reserve announces benchmark federal funds rate cut of 25 bps.',
    status: 'OPEN',
    winningSide: '',
    lastTradedPrice: 84,
    preResolvedPrice: 84,
    fairPrice: 84,
    volume: 3840n,
    createdAt: ctx.timestamp,
    locationX: -1,
    locationY: -1,
    revision: 0,
  });
  seedMarketLiquidity(ctx, m2.marketId, 84);

  const m3 = ctx.db.market.insert({
    marketId: 0n,
    question: 'SpaceX Starship Flight 6 catches booster on tower?',
    category: 'Tech',
    description: 'Resolves YES if Super Heavy booster successfully returns and is captured by Mechazilla arms.',
    status: 'OPEN',
    winningSide: '',
    lastTradedPrice: 75,
    preResolvedPrice: 75,
    fairPrice: 75,
    volume: 890n,
    createdAt: ctx.timestamp,
    locationX: -1,
    locationY: -1,
    revision: 0,
  });
  seedMarketLiquidity(ctx, m3.marketId, 75);

  const m4 = ctx.db.market.insert({
    marketId: 0n,
    question: 'OpenAI releases Orion model publicly in Q4?',
    category: 'AI',
    description: 'Resolves YES if OpenAI launches general public access to its next-generation frontier model.',
    status: 'OPEN',
    winningSide: '',
    lastTradedPrice: 41,
    preResolvedPrice: 41,
    fairPrice: 41,
    volume: 2150n,
    createdAt: ctx.timestamp,
    locationX: -1,
    locationY: -1,
    revision: 0,
  });
  seedMarketLiquidity(ctx, m4.marketId, 41);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  getOrCreatePlayer(ctx);
  if (ctx.connectionId) {
    ctx.db.activeConnection.insert({ connectionId: ctx.connectionId, identity: ctx.sender });
  }
  // Back within the grace period: keep the avatar where it was.
  cancelDisconnectTimers(ctx, ctx.sender);
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  if (ctx.connectionId) ctx.db.activeConnection.connectionId.delete(ctx.connectionId);
  // Another tab is still open for this identity.
  if ([...ctx.db.activeConnection.identity.filter(ctx.sender)].length > 0) return;

  // The whale sidecar has no grace period: off the floor and out of the book now.
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p?.avatarType === WHALE_AVATAR) {
    let refund = 0n;
    for (const o of [...ctx.db.order.owner.filter(ctx.sender)]) {
      if (o.isBot) continue;
      refund += BigInt(o.price) * BigInt(o.quantity);
      ctx.db.order.orderId.delete(o.orderId);
    }
    ctx.db.player.identity.update({ ...p, onFloor: false, cashBalance: p.cashBalance + refund });
    return;
  }

  cancelDisconnectTimers(ctx, ctx.sender);
  ctx.db.disconnectTimer.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + DISCONNECT_GRACE_MICROS),
    identity: ctx.sender,
  });
});

/**
 * Grace period expired: take the avatar off the map. Resting orders, cash and
 * positions are untouched so their liquidity stays in the market.
 */
export const removeIdleAvatar = spacetimedb.reducer(
  { onSchedule: disconnectTimer },
  { timer: disconnectTimer.rowType },
  (ctx, { timer }) => {
    if (!ctx.sender.equals(ctx.identity)) throw new SenderError('Scheduler only');
    if ([...ctx.db.activeConnection.identity.filter(timer.identity)].length > 0) return;
    const p = ctx.db.player.identity.find(timer.identity);
    if (p && p.onFloor) ctx.db.player.identity.update({ ...p, onFloor: false });
  }
);

// -----------------------------------------------------------------------------
// REDUCERS
// -----------------------------------------------------------------------------

/** Login: claim a unique name, pick an avatar and step onto the floor. */
export const joinGame = spacetimedb.reducer(
  { name: t.string(), avatarType: t.string() },
  (ctx, { name, avatarType }) => {
    const username = assertUniqueName(ctx, name);
    if (!AVATAR_TYPES.includes(avatarType)) throw new SenderError('Unknown avatar');
    if (ctx.db.player.identity.find(ctx.sender)?.avatarType === WHALE_AVATAR) {
      throw new SenderError('The whale joins with registerWhale');
    }
    const p = getOrCreatePlayer(ctx);
    cancelDisconnectTimers(ctx, ctx.sender);
    ctx.db.player.identity.update({
      ...p,
      username,
      avatarType,
      onFloor: true,
      // Players returning after being cleared from the map start at the door.
      x: p.onFloor ? p.x : SPAWN.x,
      y: p.onFloor ? p.y : SPAWN.y,
      direction: p.onFloor ? p.direction : 'down',
    });
  }
);

export const setUsername = spacetimedb.reducer(
  { username: t.string() },
  (ctx, { username }) => {
    const trimmed = assertUniqueName(ctx, username);
    const p = getOrCreatePlayer(ctx);
    ctx.db.player.identity.update({ ...p, username: trimmed });
  }
);

/**
 * Move Player Grid Coordinates in 2D Trading Floor
 */
export const movePlayer = spacetimedb.reducer(
  {
    x: t.i32(),
    y: t.i32(),
    direction: t.string(),
  },
  (ctx, { x, y, direction }) => {
    const clampedX = Math.max(0, Math.min(19, x));
    const clampedY = Math.max(0, Math.min(10, y));
    const p = getOrCreatePlayer(ctx);
    ctx.db.player.identity.update({
      ...p,
      x: clampedX,
      y: clampedY,
      direction: direction || p.direction,
    });
  }
);

/**
 * Deploy a new contract with its own trading pit on the floor (Instructor only).
 * Pass locationX = locationY = -1 to create a market without a floor pit.
 */
export const createMarket = spacetimedb.reducer(
  {
    question: t.string(),
    category: t.string(),
    description: t.string(),
    initialPrice: t.u32(),
    locationX: t.i32(),
    locationY: t.i32(),
  },
  (ctx, { question, category, description, initialPrice, locationX, locationY }) => {
    requireInstructor(ctx);
    if (!question.trim()) throw new SenderError('Question is required');
    if (initialPrice < 1 || initialPrice > 99) {
      throw new SenderError('Initial price must be between 1 and 99 cents');
    }
    const placed = locationX >= 0 || locationY >= 0;
    if (placed) assertPitLocation(ctx, locationX, locationY);
    const m = ctx.db.market.insert({
      marketId: 0n,
      question: question.trim(),
      category: category.trim() || 'General',
      description: description.trim(),
      status: 'OPEN',
      winningSide: '',
      lastTradedPrice: initialPrice,
      preResolvedPrice: initialPrice,
      fairPrice: initialPrice,
      volume: 0n,
      createdAt: ctx.timestamp,
      locationX: placed ? locationX : -1,
      locationY: placed ? locationY : -1,
      revision: 0,
    });
    seedMarketLiquidity(ctx, m.marketId, initialPrice);
  }
);

/**
 * Create or Update Lobby with custom initial bankroll for players
 */
export const createLobby = spacetimedb.reducer(
  {
    code: t.string(),
    title: t.string(),
    marketId: t.u64(),
    initialBalance: t.u64(), // starting balance in cents (e.g. 10_000n = $100.00)
  },
  (ctx, { code, title, marketId, initialBalance }) => {
    requireInstructor(ctx);
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length < 3 || cleanCode.length > 16) {
      throw new SenderError('Lobby code must be between 3 and 16 characters');
    }
    const m = ctx.db.market.marketId.find(marketId);
    if (!m) throw new SenderError('Market not found');

    const bankrollCents = initialBalance > 0n ? initialBalance : 10_000n; // default $100.00

    const existing = ctx.db.lobby.code.find(cleanCode);
    if (existing) {
      const isSystem = existing.instructor.toHexString().replace(/0/g, '') === '';
      if (!isSystem && !existing.instructor.equals(ctx.sender)) {
        throw new SenderError(`Lobby code '${cleanCode}' is already registered to another instructor`);
      }
      ctx.db.lobby.lobbyId.update({
        ...existing,
        title: title.trim() || existing.title,
        instructor: ctx.sender,
        marketId,
        initialBalance: bankrollCents,
      });

      let p = getOrCreatePlayer(ctx);
      ctx.db.player.identity.update({
        ...p,
        cashBalance: bankrollCents,
      });
      return;
    }

    const createdLobby = ctx.db.lobby.insert({
      lobbyId: 0n,
      code: cleanCode,
      title: title.trim() || `Lobby ${cleanCode}`,
      instructor: ctx.sender,
      marketId,
      initialBalance: bankrollCents,
      createdAt: ctx.timestamp,
    });

    let p = getOrCreatePlayer(ctx);
    ctx.db.player.identity.update({
      ...p,
      cashBalance: bankrollCents,
    });

    ctx.db.lobbyParticipant.insert({
      participantId: 0n,
      lobbyId: createdLobby.lobbyId,
      player: ctx.sender,
      joinedAt: ctx.timestamp,
    });
  }
);

/**
 * Join Lobby:
 * When a player joins a lobby, grant the lobby's configured initial starting balance
 * if this is the player's first time entering this room.
 */
export const joinLobby = spacetimedb.reducer(
  { code: t.string() },
  (ctx, { code }) => {
    const cleanCode = code.trim().toUpperCase();
    const l = ctx.db.lobby.code.find(cleanCode);
    if (!l) throw new SenderError(`Lobby '${cleanCode}' not found`);

    let p = getOrCreatePlayer(ctx);

    const existing = [...ctx.db.lobbyParticipant.by_lobby_player.filter([l.lobbyId, ctx.sender])];
    if (existing.length === 0) {
      // Starting cash is granted once per player, not per lobby, so hopping to
      // a new lobby can't refill a spent bankroll.
      const joinedBefore = [...ctx.db.lobbyParticipant.iter()].some(part => part.player.equals(ctx.sender));
      if (!joinedBefore) {
        const startingCents = l.initialBalance > 0n ? l.initialBalance : 10_000n;
        ctx.db.player.identity.update({
          ...p,
          cashBalance: startingCents,
        });
      }

      ctx.db.lobbyParticipant.insert({
        participantId: 0n,
        lobbyId: l.lobbyId,
        player: ctx.sender,
        joinedAt: ctx.timestamp,
      });
    }
  }
);

/**
 * Reset all player balances in the lobby back to the lobby initial balance (Instructor only)
 */
export const resetLobbyBalances = spacetimedb.reducer(
  { code: t.string() },
  (ctx, { code }) => {
    const cleanCode = code.trim().toUpperCase();
    const l = ctx.db.lobby.code.find(cleanCode);
    if (!l) throw new SenderError(`Lobby '${cleanCode}' not found`);
    requireInstructor(ctx);

    // Fresh start: starting cash, no positions, no resting orders.
    const startingCents = l.initialBalance > 0n ? l.initialBalance : 10_000n;
    for (const part of ctx.db.lobbyParticipant.iter()) {
      if (part.lobbyId !== l.lobbyId) continue;
      const playerRec = ctx.db.player.identity.find(part.player);
      if (!playerRec || playerRec.role === 'INSTRUCTOR') continue;
      ctx.db.player.identity.update({ ...playerRec, cashBalance: startingCents });
      for (const pos of [...ctx.db.position.by_owner_market.filter(part.player)]) {
        ctx.db.position.positionId.update({ ...pos, yesShares: 0, noShares: 0 });
      }
      for (const o of [...ctx.db.order.owner.filter(part.player)]) {
        if (!o.isBot) ctx.db.order.orderId.delete(o.orderId);
      }
    }
  }
);

/**
 * Reveal progressive information / clue to class (Instructor only)
 */
export const revealClue = spacetimedb.reducer(
  {
    marketId: t.u64(),
    title: t.string(),
    content: t.string(),
    newFairPrice: t.u32(),
  },
  (ctx, { marketId, title, content, newFairPrice }) => {
    requireInstructor(ctx);
    const m = ctx.db.market.marketId.find(marketId);
    if (!m) throw new SenderError('Market not found');

    ctx.db.clue.insert({
      clueId: 0n,
      marketId,
      title: title.trim(),
      content: content.trim(),
      suggestedFairPrice: newFairPrice,
      revealedAt: ctx.timestamp,
    });

    if (newFairPrice >= 1 && newFairPrice <= 99 && m.status === 'OPEN') {
      ctx.db.market.marketId.update({
        ...m,
        fairPrice: newFairPrice,
        lastTradedPrice: newFairPrice,
      });
      seedMarketLiquidity(ctx, marketId, newFairPrice);
    }
  }
);

/**
 * Clear clues for a market to replay a game (Instructor only)
 */
export const clearClues = spacetimedb.reducer(
  { marketId: t.u64() },
  (ctx, { marketId }) => {
    requireInstructor(ctx);
    for (const c of ctx.db.clue.marketId.filter(marketId)) {
      ctx.db.clue.clueId.delete(c.clueId);
    }
  }
);

/**
 * Core matching execution helper
 */
function executeOrderMatch(
  ctx: Ctx,
  marketId: bigint,
  sender: any,
  side: string,
  price: number,
  quantity: number,
  isBot: boolean,
  botRole: string,
  botId: bigint = 0n
) {
  const normSide = side.toUpperCase();
  const m = ctx.db.market.marketId.find(marketId);
  if (!m || m.status !== 'OPEN') return;

  // 1. SELF-TRADE PREVENTION (Cancel-Oldest STP)
  // Ensure the trader never locks the order book against themselves (e.g. 58¢ YES bid vs 42¢ NO bid which is 58¢ YES ask).
  // If the human trader already has opposing resting orders that would cross or lock (price + ownOrder.price >= 100),
  // cancel the older resting orders and refund their locked cash so the book never locks at 0¢ spread!
  if (!isBot) {
    const existingOwnOrders = [...ctx.db.order.marketId.filter(marketId)].filter(o =>
      o.owner.equals(sender)
    );

    let stpRefund = 0n;
    for (const ownOrder of existingOwnOrders) {
      const wouldCross =
        (normSide === 'YES' && ownOrder.side === 'NO' && ownOrder.price + price >= 100) ||
        (normSide === 'NO' && ownOrder.side === 'YES' && ownOrder.price + price >= 100);

      if (wouldCross) {
        stpRefund += BigInt(ownOrder.price) * BigInt(ownOrder.quantity);
        ctx.db.order.orderId.delete(ownOrder.orderId);
      }
    }

    if (stpRefund > 0n) {
      const p = ctx.db.player.identity.find(sender);
      if (p) {
        ctx.db.player.identity.update({
          ...p,
          cashBalance: p.cashBalance + stpRefund,
        });
      }
    }
  }

  let remainingQty = quantity;
  let priceRefund = 0n;
  let newLastTradedPrice = m.lastTradedPrice;
  let contractsMatched = 0n;

  const marketOrders = [...ctx.db.order.marketId.filter(marketId)];

  if (normSide === 'YES') {
    const oppositeOrders = marketOrders
      .filter(o => o.side === 'NO' && o.price + price >= 100 && (o.isBot || !o.owner.equals(sender)))
      .sort((a, b) => {
        if (b.price !== a.price) return b.price - a.price; // highest NO price first
        return Number(a.timestamp.microsSinceUnixEpoch - b.timestamp.microsSinceUnixEpoch);
      });

    for (const resting of oppositeOrders) {
      if (remainingQty <= 0) break;

      const matchQty = Math.min(remainingQty, resting.quantity);
      const yesExecPrice = 100 - resting.price; // cents

      const perShareRefund = price - yesExecPrice;
      priceRefund += BigInt(perShareRefund) * BigInt(matchQty);

      if (!isBot) {
        const takerPos = getOrCreatePosition(ctx, marketId, sender);
        ctx.db.position.positionId.update({
          ...takerPos,
          yesShares: takerPos.yesShares + matchQty,
        });
      }

      if (!resting.isBot) {
        const makerPos = getOrCreatePosition(ctx, marketId, resting.owner);
        ctx.db.position.positionId.update({
          ...makerPos,
          noShares: makerPos.noShares + matchQty,
        });
      }

      ctx.db.trade.insert({
        tradeId: 0n,
        marketId,
        maker: resting.owner,
        taker: sender,
        makerSide: 'NO',
        takerSide: 'YES',
        makerRole: resting.isBot ? resting.botRole : 'HUMAN',
        takerRole: isBot ? botRole : 'HUMAN',
        price: yesExecPrice,
        quantity: matchQty,
        timestamp: ctx.timestamp,
        makerBotId: resting.botId,
        takerBotId: botId,
      });

      if (resting.quantity === matchQty) {
        ctx.db.order.orderId.delete(resting.orderId);
      } else {
        ctx.db.order.orderId.update({
          ...resting,
          quantity: resting.quantity - matchQty,
        });
      }

      remainingQty -= matchQty;
      contractsMatched += BigInt(matchQty);
      newLastTradedPrice = yesExecPrice;
    }
  } else {
    const oppositeOrders = marketOrders
      .filter(o => o.side === 'YES' && o.price + price >= 100 && (o.isBot || !o.owner.equals(sender)))
      .sort((a, b) => {
        if (b.price !== a.price) return b.price - a.price; // highest YES price first
        return Number(a.timestamp.microsSinceUnixEpoch - b.timestamp.microsSinceUnixEpoch);
      });

    for (const resting of oppositeOrders) {
      if (remainingQty <= 0) break;

      const matchQty = Math.min(remainingQty, resting.quantity);
      const yesExecPrice = resting.price; // cents
      const noExecPrice = 100 - resting.price; // cents

      const perShareRefund = price - noExecPrice;
      priceRefund += BigInt(perShareRefund) * BigInt(matchQty);

      if (!isBot) {
        const takerPos = getOrCreatePosition(ctx, marketId, sender);
        ctx.db.position.positionId.update({
          ...takerPos,
          noShares: takerPos.noShares + matchQty,
        });
      }

      if (!resting.isBot) {
        const makerPos = getOrCreatePosition(ctx, marketId, resting.owner);
        ctx.db.position.positionId.update({
          ...makerPos,
          yesShares: makerPos.yesShares + matchQty,
        });
      }

      ctx.db.trade.insert({
        tradeId: 0n,
        marketId,
        maker: resting.owner,
        taker: sender,
        makerSide: 'YES',
        takerSide: 'NO',
        makerRole: resting.isBot ? resting.botRole : 'HUMAN',
        takerRole: isBot ? botRole : 'HUMAN',
        price: yesExecPrice,
        quantity: matchQty,
        timestamp: ctx.timestamp,
        makerBotId: resting.botId,
        takerBotId: botId,
      });

      if (resting.quantity === matchQty) {
        ctx.db.order.orderId.delete(resting.orderId);
      } else {
        ctx.db.order.orderId.update({
          ...resting,
          quantity: resting.quantity - matchQty,
        });
      }

      remainingQty -= matchQty;
      contractsMatched += BigInt(matchQty);
      newLastTradedPrice = yesExecPrice;
    }
  }

  if (!isBot && priceRefund > 0n) {
    const refreshedPlayer = ctx.db.player.identity.find(sender)!;
    ctx.db.player.identity.update({
      ...refreshedPlayer,
      cashBalance: refreshedPlayer.cashBalance + priceRefund,
    });
  }

  if (remainingQty > 0) {
    ctx.db.order.insert({
      orderId: 0n,
      marketId,
      owner: sender,
      side: normSide,
      price,
      quantity: remainingQty,
      originalQuantity: remainingQty,
      isBot,
      botRole,
      timestamp: ctx.timestamp,
      botId,
    });
  }

  if (contractsMatched > 0n) {
    ctx.db.market.marketId.update({
      ...m,
      lastTradedPrice: newLastTradedPrice,
      volume: m.volume + contractsMatched,
    });
  }
}

/**
 * Human Trader Order Placement
 */
export const placeOrder = spacetimedb.reducer(
  {
    marketId: t.u64(),
    side: t.string(), // "YES" or "NO"
    price: t.u32(), // 1 - 99 cents
    quantity: t.u32(),
  },
  (ctx, { marketId, side, price, quantity }) => {
    const normSide = side.toUpperCase();
    if (normSide !== 'YES' && normSide !== 'NO') {
      throw new SenderError("Order side must be 'YES' or 'NO'");
    }
    if (price < 1 || price > 99) {
      throw new SenderError('Limit price must be between 1 and 99 cents');
    }
    if (quantity < 1 || quantity > 100_000) {
      throw new SenderError('Order quantity must be between 1 and 100,000');
    }

    const m = ctx.db.market.marketId.find(marketId);
    if (!m) throw new SenderError('Market not found');
    if (m.status !== 'OPEN') throw new SenderError('Market is resolved; orders cannot be placed');
    if (getGameState(ctx).isLeaderboardRevealed) {
      throw new SenderError('The round has ended; trading is closed');
    }

    let p = getOrCreatePlayer(ctx);

    const totalMaxCost = BigInt(price) * BigInt(quantity);
    if (p.cashBalance < totalMaxCost) {
      throw new SenderError(
        `Insufficient balance. Need $${(Number(totalMaxCost) / 100).toFixed(2)}, have $${(Number(p.cashBalance) / 100).toFixed(2)}`
      );
    }

    p = { ...p, cashBalance: p.cashBalance - totalMaxCost };
    ctx.db.player.identity.update(p);

    executeOrderMatch(ctx, marketId, ctx.sender, normSide, price, quantity, false, 'HUMAN');
  }
);

export const cancelOrder = spacetimedb.reducer(
  { orderId: t.u64() },
  (ctx, { orderId }) => {
    const o = ctx.db.order.orderId.find(orderId);
    if (!o) throw new SenderError('Order not found');
    if (o.isBot) throw new SenderError('Market-maker orders cannot be cancelled');
    if (!o.owner.equals(ctx.sender)) {
      throw new SenderError('Unauthorized: you do not own this order');
    }

    const refund = BigInt(o.price) * BigInt(o.quantity);
    const p = getOrCreatePlayer(ctx);
    ctx.db.player.identity.update({
      ...p,
      cashBalance: p.cashBalance + refund,
    });

    ctx.db.order.orderId.delete(orderId);
  }
);

/**
 * Resolve Market:
 * Remembers preResolvedPrice so undo/reopen restores the exact percentage and price.
 */
export const resolveMarket = spacetimedb.reducer(
  {
    marketId: t.u64(),
    outcome: t.string(), // "YES" or "NO"
  },
  (ctx, { marketId, outcome }) => {
    requireInstructor(ctx);
    const norm = outcome.toUpperCase();
    if (norm !== 'YES' && norm !== 'NO') {
      throw new SenderError("Winning side must be 'YES' or 'NO'");
    }

    const m = ctx.db.market.marketId.find(marketId);
    if (!m) throw new SenderError('Market not found');
    if (m.status === 'RESOLVED') throw new SenderError('Market is already resolved');

    // Store pre-resolution price for accurate undo
    const prePrice = (m.lastTradedPrice > 0 && m.lastTradedPrice < 100)
      ? m.lastTradedPrice
      : (m.fairPrice || 50);

    ctx.db.market.marketId.update({
      ...m,
      status: 'RESOLVED',
      winningSide: norm,
      preResolvedPrice: prePrice,
      lastTradedPrice: norm === 'YES' ? 100 : 0,
      fairPrice: norm === 'YES' ? 100 : 0,
    });

    // Payout winning positions
    for (const pos of ctx.db.position.iter()) {
      if (pos.marketId === marketId) {
        const winningShares = norm === 'YES' ? pos.yesShares : pos.noShares;
        if (winningShares > 0) {
          const payout = BigInt(winningShares) * 100n;
          const playerRecord = ctx.db.player.identity.find(pos.owner);
          if (playerRecord) {
            ctx.db.player.identity.update({
              ...playerRecord,
              cashBalance: playerRecord.cashBalance + payout,
            });
          }
        }

        ctx.db.position.positionId.update({
          ...pos,
          yesShares: 0,
          noShares: 0,
        });
      }
    }

    // Refund human resting orders
    for (const o of ctx.db.order.marketId.filter(marketId)) {
      if (!o.isBot) {
        const refund = BigInt(o.price) * BigInt(o.quantity);
        const ownerRecord = ctx.db.player.identity.find(o.owner);
        if (ownerRecord) {
          ctx.db.player.identity.update({
            ...ownerRecord,
            cashBalance: ownerRecord.cashBalance + refund,
          });
        }
      }
      ctx.db.order.orderId.delete(o.orderId);
    }
  }
);

/**
 * Change a live contract's wording (Instructor only). Because the terms
 * change, every resting order on it is cancelled first: human orders are
 * refunded their escrow; market-maker orders hold no cash and are dropped.
 */
export const modifyMarket = spacetimedb.reducer(
  {
    marketId: t.u64(),
    newQuestion: t.string(),
    newCategory: t.string(),
  },
  (ctx, { marketId, newQuestion, newCategory }) => {
    requireInstructor(ctx);
    const m = ctx.db.market.marketId.find(marketId);
    if (!m) throw new SenderError('Market not found');
    if (m.status !== 'OPEN') throw new SenderError('Resolved markets cannot be edited');
    const question = newQuestion.trim();
    if (!question) throw new SenderError('Question is required');
    if (question.length > 200) throw new SenderError('Question is limited to 200 characters');

    // 1. Wipe the book, refunding escrow to each human owner.
    const refunds = new Map<string, { owner: Identity; cents: bigint }>();
    for (const o of [...ctx.db.order.marketId.filter(marketId)]) {
      if (!o.isBot) {
        const key = o.owner.toHexString();
        const entry = refunds.get(key) ?? { owner: o.owner, cents: 0n };
        entry.cents += BigInt(o.price) * BigInt(o.quantity);
        refunds.set(key, entry);
      }
      ctx.db.order.orderId.delete(o.orderId);
    }
    for (const { owner, cents } of refunds.values()) {
      const p = ctx.db.player.identity.find(owner);
      if (p) ctx.db.player.identity.update({ ...p, cashBalance: p.cashBalance + cents });
    }

    // 2. New terms; subscribers (UI, agents) receive the row update.
    ctx.db.market.marketId.update({
      ...m,
      question,
      category: newCategory.trim() || m.category,
      revision: m.revision + 1,
    });
  }
);

/**
 * Reset / Undo Market Resolution:
 * Restores the pre-resolved percentage and price!
 */
export const resetMarket = spacetimedb.reducer(
  {
    marketId: t.u64(),
    defaultPrice: t.u32(),
  },
  (ctx, { marketId, defaultPrice }) => {
    requireInstructor(ctx);
    const m = ctx.db.market.marketId.find(marketId);
    if (!m) throw new SenderError('Market not found');

    // Restore preResolvedPrice if valid, otherwise fallback to defaultPrice or 50
    const restoredPrice = (m.preResolvedPrice >= 1 && m.preResolvedPrice <= 99)
      ? m.preResolvedPrice
      : (defaultPrice >= 1 && defaultPrice <= 99 ? defaultPrice : 50);

    ctx.db.market.marketId.update({
      ...m,
      status: 'OPEN',
      winningSide: '',
      lastTradedPrice: restoredPrice,
      fairPrice: restoredPrice,
    });

    seedMarketLiquidity(ctx, marketId, restoredPrice);
  }
);

export const botReplenish = spacetimedb.reducer(
  { marketId: t.u64() },
  (ctx, { marketId }) => {
    const m = ctx.db.market.marketId.find(marketId);
    if (!m || m.status !== 'OPEN') return;
    seedMarketLiquidity(ctx, marketId, m.fairPrice);
  }
);

/**
 * One bot tick for a single market. The scheduled bot_timer runs this for every
 * open pit; kept as a reducer for manual testing.
 */
export const optimalBotTick = spacetimedb.reducer(
  { marketId: t.u64() },
  (ctx, { marketId }) => botTickMarket(ctx, marketId)
);

function botTickMarket(ctx: Ctx, marketId: bigint) {
  const m = ctx.db.market.marketId.find(marketId);
  if (!m || m.status !== 'OPEN') return;
  const bots = [...ctx.db.botTrader.marketId.filter(marketId)];
  const sniper = bots.find(b => b.role === 'SNIPER');
  const noise = bots.filter(b => b.role === 'NOISE');

  let currentFair = m.fairPrice;

  // Small drift chance for dynamic news simulation
  if (ctx.random.integerInRange(1, 10) <= 3) {
    currentFair = Math.max(5, Math.min(95, currentFair + ctx.random.integerInRange(-2, 2)));
    ctx.db.market.marketId.update({ ...m, fairPrice: currentFair });
  }

  const book = () => {
    const orders = [...ctx.db.order.marketId.filter(marketId)].filter(o => o.quantity > 0);
    const bids = orders.filter(o => o.side === 'YES').map(o => o.price);
    const asks = orders.filter(o => o.side === 'NO').map(o => 100 - o.price);
    return {
      orders,
      bestBid: bids.length > 0 ? Math.max(...bids) : 0,
      bestAsk: asks.length > 0 ? Math.min(...asks) : 100,
    };
  };

  // SNIPER: lift any ask below fair / hit any bid above fair.
  let { orders, bestBid, bestAsk } = book();
  let sniperExecuted = false;
  if (bestAsk < currentFair) {
    const resting = orders.find(o => o.side === 'NO' && 100 - o.price === bestAsk);
    if (resting) {
      const qty = Math.min(resting.quantity, 25);
      executeOrderMatch(ctx, marketId, ctx.identity, 'YES', bestAsk, qty, true, 'SNIPER', sniper?.botId ?? 0n);
      if (sniper) noteBotTrade(ctx, sniper.botId);
      sniperExecuted = true;
    }
  } else if (bestBid > currentFair) {
    const resting = orders.find(o => o.side === 'YES' && o.price === bestBid);
    if (resting) {
      const qty = Math.min(resting.quantity, 25);
      executeOrderMatch(ctx, marketId, ctx.identity, 'NO', 100 - bestBid, qty, true, 'SNIPER', sniper?.botId ?? 0n);
      if (sniper) noteBotTrade(ctx, sniper.botId);
      sniperExecuted = true;
    }
  }

  // NOISE: every so often cross the spread with a small order, leaning
  // toward fair value, so the tape keeps moving.
  for (const bot of noise) {
    if (ctx.random.integerInRange(1, 100) > NOISE_TRADE_PERCENT) continue;
    ({ bestBid, bestAsk } = book());
    const last = ctx.db.market.marketId.find(marketId)?.lastTradedPrice ?? currentFair;
    const yesOdds = Math.max(20, Math.min(80, 50 + (currentFair - last) * 6));
    const buyYes = ctx.random.integerInRange(1, 100) <= yesOdds;
    const qty = ctx.random.integerInRange(5, 25);
    if (buyYes && bestAsk < 100) {
      executeOrderMatch(ctx, marketId, ctx.identity, 'YES', bestAsk, qty, true, 'NOISE', bot.botId);
      noteBotTrade(ctx, bot.botId);
    } else if (!buyYes && bestBid > 0) {
      executeOrderMatch(ctx, marketId, ctx.identity, 'NO', 100 - bestBid, qty, true, 'NOISE', bot.botId);
      noteBotTrade(ctx, bot.botId);
    }
  }

  // MAKER: keep tight two-sided depth around fair value.
  ({ orders, bestBid, bestAsk } = book());
  const spread = bestAsk - bestBid;
  if (spread < 2 || spread > 4 || orders.length < 6 || !sniperExecuted) {
    seedMarketLiquidity(ctx, marketId, currentFair);
  }
}

const NOISE_TRADE_PERCENT = 30;

function noteBotTrade(ctx: Ctx, botId: bigint) {
  const b = ctx.db.botTrader.botId.find(botId);
  if (b) ctx.db.botTrader.botId.update({ ...b, tradeCount: b.tradeCount + 1 });
}

/** Open markets with a floor pit or a lobby: the ones bots work. */
function tradableMarkets(ctx: Ctx) {
  const lobbyMarkets = new Set([...ctx.db.lobby.iter()].map(l => l.marketId));
  return [...ctx.db.market.iter()].filter(
    m => m.status === 'OPEN' && (m.locationX >= 0 || lobbyMarkets.has(m.marketId))
  );
}

// Where bots stand: around the central trading post, or beside a market's booth.
const CENTRAL_BOT_SPOTS = [
  { x: 8, y: 4, direction: 'right' },
  { x: 11, y: 7, direction: 'left' },
  { x: 11, y: 4, direction: 'left' },
  { x: 8, y: 7, direction: 'right' },
  { x: 7, y: 5, direction: 'right' },
  { x: 12, y: 6, direction: 'left' },
  { x: 9, y: 3, direction: 'down' },
  { x: 10, y: 8, direction: 'up' },
];
const CENTRAL_ROSTER = ['MAKER', 'SNIPER', 'NOISE', 'NOISE'];
const PIT_ROSTER = ['MAKER', 'NOISE'];
const BOT_NAMES: Record<string, string> = { MAKER: 'Maker-Bot', SNIPER: 'Sniper-Bot', NOISE: 'Noise-Bot' };

/** Spawn a crew for every tradable market while bots are on; clear them when off. */
function syncBots(ctx: Ctx) {
  const enabled = ctx.db.botConfig.id.find(0)?.ammEnabled ?? false;
  const markets = enabled ? tradableMarkets(ctx) : [];
  const keep = new Set(markets.map(m => m.marketId));

  for (const b of [...ctx.db.botTrader.iter()]) {
    if (!keep.has(b.marketId)) ctx.db.botTrader.botId.delete(b.botId);
  }

  const counts: Record<string, number> = {};
  let centralSlot = 0;
  for (const b of ctx.db.botTrader.iter()) {
    counts[b.role] = (counts[b.role] ?? 0) + 1;
    if ((ctx.db.market.marketId.find(b.marketId)?.locationX ?? -1) < 0) centralSlot++;
  }

  for (const m of markets) {
    if ([...ctx.db.botTrader.marketId.filter(m.marketId)].length > 0) continue;
    const roster = m.locationX >= 0 ? PIT_ROSTER : CENTRAL_ROSTER;
    roster.forEach((role, i) => {
      const spot =
        m.locationX >= 0
          ? i === 0
            ? { x: m.locationX - 1, y: m.locationY + 1, direction: 'right' }
            : { x: m.locationX + 2, y: m.locationY, direction: 'left' }
          : CENTRAL_BOT_SPOTS[centralSlot++ % CENTRAL_BOT_SPOTS.length];
      counts[role] = (counts[role] ?? 0) + 1;
      ctx.db.botTrader.insert({
        botId: 0n,
        name: `${BOT_NAMES[role]} ${counts[role]}`,
        role,
        marketId: m.marketId,
        x: Math.max(0, Math.min(GRID_COLS - 1, spot.x)),
        y: Math.max(1, Math.min(GRID_ROWS - 2, spot.y)),
        direction: spot.direction,
        tradeCount: 0,
      });
    });
    // The new maker takes over the house quotes straight away.
    seedMarketLiquidity(ctx, m.marketId, m.fairPrice);
  }
}

/** Apply a bot on/off switch: crew on the floor plus the repeating tick. */
function applyBotConfig(
  ctx: Ctx,
  next: { ammEnabled: boolean; whaleEnabled: boolean; tickMs: number; controlledBy: string }
) {
  if (!BOT_TICK_OPTIONS.includes(next.tickMs)) throw new SenderError('Bot speed must be 600, 1000 or 2000 ms');
  const cfg = getBotConfig(ctx);
  ctx.db.botConfig.id.update({ ...cfg, ...next });

  for (const timer of [...ctx.db.botTimer.iter()]) ctx.db.botTimer.scheduledId.delete(timer.scheduledId);
  if (next.ammEnabled) {
    ctx.db.botTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(next.tickMs) * 1000n) });
  }
  syncBots(ctx);
}

/** Server-side bots: one tick for every open pit and lobby market. */
export const runBotTimer = spacetimedb.reducer(
  { onSchedule: botTimer },
  { timer: botTimer.rowType },
  (ctx, { timer: _timer }) => {
    if (!ctx.sender.equals(ctx.identity)) throw new SenderError('Scheduler only');
    syncBots(ctx); // markets may have been deployed or resolved since the last tick
    if (getGameState(ctx).isLeaderboardRevealed) return;
    for (const m of tradableMarkets(ctx)) botTickMarket(ctx, m.marketId);
  }
);

/**
 * Solo play: any trader can switch the bots on or off, unless the instructor
 * has taken control of them for the class.
 */
export const setSoloBots = spacetimedb.reducer(
  { enabled: t.bool(), tickMs: t.u32() },
  (ctx, { enabled, tickMs }) => {
    const cfg = getBotConfig(ctx);
    if (cfg.controlledBy === 'INSTRUCTOR' && cfg.ammEnabled) {
      throw new SenderError('Your instructor is running the bots for the class');
    }
    applyBotConfig(ctx, {
      ammEnabled: enabled,
      whaleEnabled: cfg.whaleEnabled,
      tickMs,
      controlledBy: enabled ? 'SOLO' : '',
    });
  }
);

// -----------------------------------------------------------------------------
// INSTRUCTOR "GOD MODE"
// -----------------------------------------------------------------------------

/** Become an instructor by presenting the classroom passcode. */
export const claimInstructor = spacetimedb.reducer(
  { passcode: t.string() },
  (ctx, { passcode }) => {
    const cfg = ctx.db.instructorConfig.id.find(0);
    const expected = cfg?.passcode ?? DEFAULT_INSTRUCTOR_PASSCODE;
    if (passcode.trim() !== expected) throw new SenderError('Incorrect instructor passcode');
    const p = getOrCreatePlayer(ctx);
    ctx.db.player.identity.update({ ...p, role: 'INSTRUCTOR' });
  }
);

export const setInstructorPasscode = spacetimedb.reducer(
  { passcode: t.string() },
  (ctx, { passcode }) => {
    requireInstructor(ctx);
    const clean = passcode.trim();
    if (clean.length < 4) throw new SenderError('Passcode must be at least 4 characters');
    const cfg = ctx.db.instructorConfig.id.find(0);
    if (cfg) ctx.db.instructorConfig.id.update({ ...cfg, passcode: clean });
    else ctx.db.instructorConfig.insert({ id: 0, passcode: clean });
  }
);

/** Promote or demote another player (Instructor only). */
export const setPlayerRole = spacetimedb.reducer(
  { target: t.identity(), role: t.string() },
  (ctx, { target, role }) => {
    requireInstructor(ctx);
    const norm = role.toUpperCase();
    if (norm !== 'STUDENT' && norm !== 'INSTRUCTOR') {
      throw new SenderError("Role must be 'STUDENT' or 'INSTRUCTOR'");
    }
    const p = ctx.db.player.identity.find(target);
    if (!p) throw new SenderError('Player not found');
    ctx.db.player.identity.update({ ...p, role: norm });
  }
);

/** Push a breaking-news banner to every client. An empty message clears it. */
export const broadcastAlert = spacetimedb.reducer(
  { message: t.string() },
  (ctx, { message }) => {
    requireInstructor(ctx);
    const clean = message.trim();
    if (clean.length > 200) throw new SenderError('Alerts are limited to 200 characters');
    const state = getGameState(ctx);
    ctx.db.gameState.id.update({ ...state, newsTickerMessage: clean, newsPostedAt: ctx.timestamp });
  }
);

/** End the round: closes trading and reveals the leaderboard to students. */
export const triggerEndRound = spacetimedb.reducer(ctx => {
  requireInstructor(ctx);
  const state = getGameState(ctx);
  ctx.db.gameState.id.update({ ...state, isLeaderboardRevealed: true });
});

/** Hide the leaderboard again and reopen trading for a new round. */
export const startNewRound = spacetimedb.reducer(ctx => {
  requireInstructor(ctx);
  const state = getGameState(ctx);
  ctx.db.gameState.id.update({
    ...state,
    isLeaderboardRevealed: false,
    newsTickerMessage: '',
    newsPostedAt: ctx.timestamp,
  });
});


/** Register the external Whale bot using the instructor passcode. */
export const registerWhale = spacetimedb.reducer(
  { name: t.string(), passcode: t.string() },
  (ctx, { name, passcode }) => {
    const cfg = ctx.db.instructorConfig.id.find(0);
    const expected = cfg?.passcode ?? DEFAULT_INSTRUCTOR_PASSCODE;
    if (passcode.trim() !== expected) throw new SenderError('Incorrect passcode');
    const trimmed = assertUniqueName(ctx, name);
    const p = getOrCreatePlayer(ctx);
    cancelDisconnectTimers(ctx, ctx.sender);
    ctx.db.player.identity.update({
      ...p,
      username: trimmed,
      avatarType: 'whale',
      role: 'STUDENT',
      onFloor: true,
      cashBalance: p.cashBalance < 500_000n ? 500_000n : p.cashBalance,
      x: p.onFloor ? p.x : 9,
      y: p.onFloor ? p.y : 6,
      direction: 'south',
    });
  }
);

/** Switch the bots and the AI whale on or off for every pit (Instructor only). */
export const setBotConfig = spacetimedb.reducer(
  { ammEnabled: t.bool(), whaleEnabled: t.bool(), tickMs: t.u32() },
  (ctx, { ammEnabled, whaleEnabled, tickMs }) => {
    requireInstructor(ctx);
    applyBotConfig(ctx, { ammEnabled, whaleEnabled, tickMs, controlledBy: ammEnabled ? 'INSTRUCTOR' : '' });
  }
);

// -----------------------------------------------------------------------------
// LEADERBOARD VIEW
// -----------------------------------------------------------------------------

const LeaderboardEntry = t.object('LeaderboardEntry', {
  identity: t.identity(),
  username: t.string(),
  cashCents: t.u64(),
  holdingsCents: t.u64(),
  netWorthCents: t.u64(),
});

/**
 * Students ranked by Total Net Worth. Instructors always see it; students get
 * an empty list until the instructor ends the round.
 */
export const leaderboard = spacetimedb.view(
  { name: 'leaderboard', public: true },
  t.array(LeaderboardEntry),
  ctx => {
    const viewer = ctx.db.player.identity.find(ctx.sender);
    const state = ctx.db.gameState.id.find(0);
    if (viewer?.role !== 'INSTRUCTOR' && !state?.isLeaderboardRevealed) return [];

    const rows = [];
    for (const p of ctx.db.player.iter()) {
      if (p.role === 'INSTRUCTOR' || p.avatarType === WHALE_AVATAR) continue;
      const v = valuePlayer(ctx.db, p.identity, p.cashBalance);
      rows.push({
        identity: p.identity,
        username: p.username,
        cashCents: v.cash,
        holdingsCents: v.holdings,
        netWorthCents: v.netWorth,
      });
    }
    rows.sort((a, b) => (a.netWorthCents === b.netWorthCents ? 0 : a.netWorthCents > b.netWorthCents ? -1 : 1));
    return rows;
  }
);
