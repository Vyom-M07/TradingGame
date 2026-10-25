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
    // Room the player is in; 0 = back at the menu.
    lobbyId: t.u64().default(0n),
    // Room whose wallet the player is carrying (kept while at the menu). Entering
    // any other room starts a fresh wallet; coming back to this one keeps it.
    lastLobbyId: t.u64().default(0n),
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
    // 0 = the class floor; otherwise the solo room that owns this market.
    lobbyId: t.u64().default(0n),
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
    // Solo practice room owned by `instructor`; class rooms are run by instructors.
    isSolo: t.bool().default(false),
    botsEnabled: t.bool().default(false),
    whaleEnabled: t.bool().default(false),
    botTickMs: t.u32().default(1000),
    roundOver: t.bool().default(false),
    // Which model drives the whale in this room: "claude" | "gemini".
    whaleModel: t.string().default('claude'),
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
    isLeaderboardRevealed: t.bool(), // retired: rounds are per room (lobby.roundOver)
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


// Retired: bot settings now live on each lobby. Kept so existing data migrates.
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

// Private: repeating schedule that drives one room's bots while they are on.
const botTimer = table(
  { name: 'bot_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    lobbyId: t.u64().default(0n),
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
    lobbyId: t.u64().default(0n), // room whose crew this bot belongs to
    // Running book for the leaderboard: cents spent on fills (negative = net
    // received) and the contracts bought, marked to market like a player's.
    spentCents: t.i64().default(0n),
    yesShares: t.u32().default(0),
    noShares: t.u32().default(0),
  }
);

// Where the AI whale stands in each room it is switched on in. Moved only by the
// whale sidecar (whaleMove); the row is removed when the whale leaves the room.
const whaleAvatar = table(
  { name: 'whale_avatar', public: true },
  {
    lobbyId: t.u64().primaryKey(),
    x: t.i32(),
    y: t.i32(),
    direction: t.string(),
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
  whaleAvatar,
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
const WHALE_SPAWN = { x: 14, y: 6 };
const WHALE_BANKROLL = 500_000n; // $5,000
const DEFAULT_BALANCE = 10_000n; // $100
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
      lobbyId: 0n,
      lastLobbyId: 0n,
    });
  }
  return p;
}

function startingCentsFor(l: LobbyRow) {
  return l.initialBalance > 0n ? l.initialBalance : DEFAULT_BALANCE;
}

/** Fresh start for one player: the given cash, no positions, no resting orders. */
function resetWallet(ctx: Ctx, identity: Identity, cashCents: bigint) {
  for (const pos of [...ctx.db.position.by_owner_market.filter(identity)]) {
    if (pos.yesShares !== 0 || pos.noShares !== 0) ctx.db.position.positionId.update({ ...pos, yesShares: 0, noShares: 0 });
  }
  // Escrow isn't refunded: the cash is being replaced outright.
  for (const o of [...ctx.db.order.owner.filter(identity)]) {
    if (!o.isBot) ctx.db.order.orderId.delete(o.orderId);
  }
  const p = ctx.db.player.identity.find(identity);
  if (p) ctx.db.player.identity.update({ ...p, cashBalance: cashCents });
}

/** Validates a display name's length. Uniqueness is per class room (assertNameFreeInRoom). */
function cleanName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 24) {
    throw new SenderError('Name must be between 2 and 24 characters');
  }
  return trimmed;
}

/**
 * Class rooms need distinct names among the players on their floor right now
 * (case-insensitive). Solo rooms, and players who've left, been kicked or gone
 * idle, don't count.
 */
function assertNameFreeInRoom(ctx: Ctx, l: LobbyRow, name: string) {
  if (l.isSolo) return;
  const lower = name.toLowerCase();
  for (const other of ctx.db.player.iter()) {
    if (other.identity.equals(ctx.sender) || other.lobbyId !== l.lobbyId || !other.onFloor) continue;
    if (other.username.toLowerCase() === lower) {
      throw new SenderError(`The name "${name}" is already taken in ${l.code}`);
    }
  }
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

type LobbyRow = NonNullable<ReturnType<Ctx['db']['lobby']['lobbyId']['find']>>;
type MarketRow = NonNullable<ReturnType<Ctx['db']['market']['marketId']['find']>>;

function requireLobby(ctx: Ctx, lobbyId: bigint) {
  const l = ctx.db.lobby.lobbyId.find(lobbyId);
  if (!l) throw new SenderError('Room not found');
  return l;
}

/** Solo rooms are run by their owner, class rooms by any instructor. */
function requireRoomController(ctx: Ctx, l: LobbyRow) {
  if (l.isSolo) {
    if (!l.instructor.equals(ctx.sender)) throw new SenderError('Only the owner can change a solo room');
  } else {
    requireInstructor(ctx);
  }
}

/** A solo room's own market is settled by the room's owner; class floor markets by an instructor. */
function requireMarketController(ctx: Ctx, m: MarketRow) {
  const solo = m.lobbyId === 0n ? null : ctx.db.lobby.lobbyId.find(m.lobbyId);
  if (solo?.isSolo && solo.instructor.equals(ctx.sender)) return;
  requireInstructor(ctx);
}

/** A room trades its central market, plus the class floor pits in class rooms. */
function roomHasMarket(l: LobbyRow, m: MarketRow) {
  if (m.marketId === l.marketId) return true;
  if (l.isSolo) return m.lobbyId === l.lobbyId;
  return m.lobbyId === 0n && m.locationX >= 0;
}

/** Open markets traded in a room. */
function roomMarkets(db: ReadDb, l: LobbyRow) {
  return [...db.market.iter()].filter(m => m.status === 'OPEN' && roomHasMarket(l, m));
}

function isWhale(p: { avatarType: string } | null | undefined) {
  return p?.avatarType === WHALE_AVATAR;
}

/** The whale sidecar is running: a registered whale with a live connection. */
function whaleRunning(ctx: Ctx) {
  for (const p of ctx.db.player.iter()) {
    if (isWhale(p) && p.onFloor && [...ctx.db.activeConnection.identity.filter(p.identity)].length > 0) return true;
  }
  return false;
}

/** Cancel the whale's resting orders on a room's markets, refunding escrow. */
function cancelWhaleOrders(ctx: Ctx, l: LobbyRow) {
  for (const w of ctx.db.player.iter()) {
    if (!isWhale(w)) continue;
    let refund = 0n;
    for (const o of [...ctx.db.order.owner.filter(w.identity)]) {
      const m = ctx.db.market.marketId.find(o.marketId);
      if (o.isBot || !m || !roomHasMarket(l, m)) continue;
      refund += BigInt(o.price) * BigInt(o.quantity);
      ctx.db.order.orderId.delete(o.orderId);
    }
    if (refund > 0n) {
      const fresh = ctx.db.player.identity.find(w.identity)!;
      ctx.db.player.identity.update({ ...fresh, cashBalance: fresh.cashBalance + refund });
    }
  }
}

/** Take the whale off a room's floor and out of its book. */
function removeWhaleFromRoom(ctx: Ctx, l: LobbyRow) {
  cancelWhaleOrders(ctx, l);
  ctx.db.whaleAvatar.lobbyId.delete(l.lobbyId);
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
    if (m.status !== 'OPEN' || m.locationX < 0 || m.lobbyId !== 0n) continue;
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


/** The maker bot quoting a market: the given room's, else any room's. */
function makerBotFor(ctx: Ctx, marketId: bigint, lobbyId?: bigint) {
  const makers = [...ctx.db.botTrader.marketId.filter(marketId)].filter(b => b.role === 'MAKER');
  return (makers.find(b => b.lobbyId === lobbyId) ?? makers[0])?.botId ?? 0n;
}

function seedMarketLiquidity(ctx: Ctx, marketId: bigint, fairPrice: number, lobbyId?: bigint) {
  const botId = makerBotFor(ctx, marketId, lobbyId);
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

/** The 3-card classroom game: the class floor's first market and every solo room's. */
function insertDefaultMarket(ctx: Ctx, lobbyId: bigint) {
  const m = ctx.db.market.insert({
    marketId: 0n,
    question: 'Expected Sum of 3 Mystery Cards > 20?',
    category: 'Classroom',
    description: 'Instructor will progressively reveal 3 cards. Resolves YES if total card value exceeds 20 (Face cards = 10, Ace = 11).',
    status: 'OPEN',
    winningSide: '',
    lastTradedPrice: 50,
    preResolvedPrice: 50,
    fairPrice: 50,
    volume: lobbyId === 0n ? 500n : 0n,
    createdAt: ctx.timestamp,
    locationX: -1,
    locationY: -1,
    revision: 0,
    lobbyId,
  });
  seedMarketLiquidity(ctx, m.marketId, 50);
  return m;
}

// -----------------------------------------------------------------------------
// LIFECYCLE HOOKS
// -----------------------------------------------------------------------------

export const init = spacetimedb.init(ctx => {
  getGameState(ctx);
  ctx.db.instructorConfig.insert({ id: 0, passcode: DEFAULT_INSTRUCTOR_PASSCODE });

  // 1. Classroom / Educational Market: 3-Card Sum Game
  const mEdu = insertDefaultMarket(ctx, 0n);

  // Default Lobby for Cal Hacks Demo ($100 default bankroll)
  ctx.db.lobby.insert({
    lobbyId: 0n,
    code: 'CAL13',
    title: 'Cal Hacks 13.0 Main Arena',
    instructor: ctx.sender,
    marketId: mEdu.marketId,
    initialBalance: 10_000n, // $100.00
    createdAt: ctx.timestamp,
    isSolo: false,
    botsEnabled: false,
    whaleEnabled: false,
    botTickMs: 1000,
    roundOver: false,
    whaleModel: 'claude',
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
    lobbyId: 0n,
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
    lobbyId: 0n,
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
    lobbyId: 0n,
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
    lobbyId: 0n,
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

  // A room's bots are on but its tick isn't scheduled (e.g. after a republish): restart them.
  const ticking = new Set([...ctx.db.botTimer.iter()].map(timer => timer.lobbyId));
  for (const l of [...ctx.db.lobby.iter()]) {
    if (l.botsEnabled && !ticking.has(l.lobbyId)) applyLobbyBots(ctx, l);
  }
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  if (ctx.connectionId) ctx.db.activeConnection.connectionId.delete(ctx.connectionId);
  // Another tab is still open for this identity.
  if ([...ctx.db.activeConnection.identity.filter(ctx.sender)].length > 0) return;

  // The whale sidecar has no grace period: off every room's floor and out of the book now.
  const p = ctx.db.player.identity.find(ctx.sender);
  if (isWhale(p)) {
    let refund = 0n;
    for (const o of [...ctx.db.order.owner.filter(ctx.sender)]) {
      if (o.isBot) continue;
      refund += BigInt(o.price) * BigInt(o.quantity);
      ctx.db.order.orderId.delete(o.orderId);
    }
    ctx.db.player.identity.update({ ...p!, onFloor: false, cashBalance: p!.cashBalance + refund });
    if (!whaleRunning(ctx)) {
      for (const l of [...ctx.db.lobby.iter()]) {
        if (l.whaleEnabled) ctx.db.lobby.lobbyId.update({ ...l, whaleEnabled: false });
        removeWhaleFromRoom(ctx, l);
      }
    }
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

/** Login: pick a name and an avatar and step onto the floor. Names are checked per class room. */
export const joinGame = spacetimedb.reducer(
  { name: t.string(), avatarType: t.string() },
  (ctx, { name, avatarType }) => {
    const username = cleanName(name);
    if (!AVATAR_TYPES.includes(avatarType)) throw new SenderError('Unknown avatar');
    if (ctx.db.player.identity.find(ctx.sender)?.avatarType === WHALE_AVATAR) {
      throw new SenderError('The whale joins with registerWhale');
    }
    const p = getOrCreatePlayer(ctx);
    // Still in a class room from before (e.g. a refresh): the new name must be free there.
    const current = ctx.db.lobby.lobbyId.find(p.lobbyId);
    if (current) assertNameFreeInRoom(ctx, current, username);
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
    const trimmed = cleanName(username);
    const p = getOrCreatePlayer(ctx);
    const current = ctx.db.lobby.lobbyId.find(p.lobbyId);
    if (current) assertNameFreeInRoom(ctx, current, trimmed);
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
      lobbyId: 0n, // instructor markets live on the class floor
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
    if (m.lobbyId !== 0n) throw new SenderError("That market belongs to a student's solo room");

    const bankrollCents = initialBalance > 0n ? initialBalance : 10_000n; // default $100.00

    const existing = ctx.db.lobby.code.find(cleanCode);
    if (existing?.isSolo) throw new SenderError(`Lobby code '${cleanCode}' is a solo room`);
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
      isSolo: false,
      botsEnabled: false,
      whaleEnabled: false,
      botTickMs: 1000,
      roundOver: false,
      whaleModel: 'claude',
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
 * Put the player in a room: they spawn at the door of its floor. Starting cash
 * is granted once per player, the first time they enter any room.
 */
function enterRoom(ctx: Ctx, l: LobbyRow) {
  let p = getOrCreatePlayer(ctx);
  if (isWhale(p)) throw new SenderError('The whale is switched on per room, not joined');
  assertNameFreeInRoom(ctx, l, p.username);

  // A different room than the one whose wallet we carry: start over with this
  // room's bankroll. Returning to the same room (refresh, menu, kick) keeps it.
  const carrying = p.lobbyId !== 0n ? p.lobbyId : p.lastLobbyId;
  if (carrying !== l.lobbyId) resetWallet(ctx, ctx.sender, startingCentsFor(l));

  if ([...ctx.db.lobbyParticipant.by_lobby_player.filter([l.lobbyId, ctx.sender])].length === 0) {
    ctx.db.lobbyParticipant.insert({
      participantId: 0n,
      lobbyId: l.lobbyId,
      player: ctx.sender,
      joinedAt: ctx.timestamp,
    });
  }

  p = ctx.db.player.identity.find(ctx.sender)!;
  if (p.lobbyId !== l.lobbyId || p.lastLobbyId !== l.lobbyId) {
    const moved = p.lobbyId !== l.lobbyId;
    ctx.db.player.identity.update({
      ...p,
      lobbyId: l.lobbyId,
      lastLobbyId: l.lobbyId,
      x: moved ? SPAWN.x : p.x,
      y: moved ? SPAWN.y : p.y,
      direction: moved ? 'down' : p.direction,
    });
  }
}

/** Join a class room by its code. Other players' solo rooms are off limits. */
export const joinLobby = spacetimedb.reducer(
  { code: t.string() },
  (ctx, { code }) => {
    const cleanCode = code.trim().toUpperCase();
    const l = ctx.db.lobby.code.find(cleanCode);
    if (!l) throw new SenderError(`Room '${cleanCode}' not found`);
    if (l.isSolo && !l.instructor.equals(ctx.sender)) {
      throw new SenderError(`Room '${cleanCode}' is someone else's solo room`);
    }
    enterRoom(ctx, l);
  }
);

/**
 * Practise alone: create (or come back to) the player's own room, with a
 * private copy of the default market seeded with house liquidity.
 */
export const startSolo = spacetimedb.reducer(ctx => {
  let l = [...ctx.db.lobby.iter()].find(r => r.isSolo && r.instructor.equals(ctx.sender));
  if (!l) {
    const hex = ctx.sender.toHexString().toUpperCase();
    let len = 4;
    while (ctx.db.lobby.code.find(`SOLO-${hex.slice(0, len)}`)) len++;
    l = ctx.db.lobby.insert({
      lobbyId: 0n,
      code: `SOLO-${hex.slice(0, len)}`,
      title: 'Solo Practice',
      instructor: ctx.sender,
      marketId: 0n,
      initialBalance: DEFAULT_BALANCE,
      createdAt: ctx.timestamp,
      isSolo: true,
      botsEnabled: false,
      whaleEnabled: false,
      botTickMs: 1000,
      roundOver: false,
      whaleModel: 'claude',
    });
  }
  if (!ctx.db.market.marketId.find(l.marketId)) {
    const m = insertDefaultMarket(ctx, l.lobbyId);
    l = { ...l, marketId: m.marketId };
    ctx.db.lobby.lobbyId.update(l);
  }
  enterRoom(ctx, l);
});

/** Back to the menu. Cash, positions and resting orders are kept. */
export const leaveLobby = spacetimedb.reducer(ctx => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p && p.lobbyId !== 0n) ctx.db.player.identity.update({ ...p, lobbyId: 0n });
});

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

    // Fresh start for everyone carrying this room's wallet (in it, or out at the menu).
    for (const p of [...ctx.db.player.iter()]) {
      if (p.role === 'INSTRUCTOR' || isWhale(p)) continue;
      const carrying = p.lobbyId !== 0n ? p.lobbyId : p.lastLobbyId;
      if (carrying === l.lobbyId) resetWallet(ctx, p.identity, startingCentsFor(l));
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
      if (resting.isBot) noteBotFill(ctx, resting.botId, 'NO', resting.price, matchQty);
      if (isBot) noteBotFill(ctx, botId, 'YES', yesExecPrice, matchQty);

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
      if (resting.isBot) noteBotFill(ctx, resting.botId, 'YES', resting.price, matchQty);
      if (isBot) noteBotFill(ctx, botId, 'NO', noExecPrice, matchQty);

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

    let p = getOrCreatePlayer(ctx);
    if (isWhale(p)) {
      // The whale trades every room it is switched on in.
      const rooms = [...ctx.db.lobby.iter()].filter(l => l.whaleEnabled && roomHasMarket(l, m));
      if (rooms.length === 0) throw new SenderError('The whale is not switched on in a room with this market');
      if (rooms.every(l => l.roundOver)) throw new SenderError('The round has ended; trading is closed');
    } else {
      const room = ctx.db.lobby.lobbyId.find(p.lobbyId);
      if (!room) throw new SenderError('Join a room before trading');
      if (!roomHasMarket(room, m)) throw new SenderError('That market is not traded in your room');
      if (room.roundOver) throw new SenderError('The round has ended; trading is closed');
    }

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
    const norm = outcome.toUpperCase();
    if (norm !== 'YES' && norm !== 'NO') {
      throw new SenderError("Winning side must be 'YES' or 'NO'");
    }

    const m = ctx.db.market.marketId.find(marketId);
    if (!m) throw new SenderError('Market not found');
    requireMarketController(ctx, m);
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
    const m = ctx.db.market.marketId.find(marketId);
    if (!m) throw new SenderError('Market not found');
    requireMarketController(ctx, m);

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
  (ctx, { marketId }) => botTickMarket(ctx, marketId, null)
);

/** One tick of a room's crew on a market (lobbyId null = whichever bots are there). */
function botTickMarket(ctx: Ctx, marketId: bigint, lobbyId: bigint | null) {
  const m = ctx.db.market.marketId.find(marketId);
  if (!m || m.status !== 'OPEN') return;
  const bots = [...ctx.db.botTrader.marketId.filter(marketId)].filter(b => lobbyId === null || b.lobbyId === lobbyId);
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
    seedMarketLiquidity(ctx, marketId, currentFair, lobbyId ?? undefined);
  }
}

const NOISE_TRADE_PERCENT = 30;

function noteBotTrade(ctx: Ctx, botId: bigint) {
  const b = ctx.db.botTrader.botId.find(botId);
  if (b) ctx.db.botTrader.botId.update({ ...b, tradeCount: b.tradeCount + 1 });
}

/** Book a fill to a bot: it bought `qty` contracts of `side` at `price` cents each. */
function noteBotFill(ctx: Ctx, botId: bigint, side: string, price: number, qty: number) {
  if (botId === 0n) return;
  const b = ctx.db.botTrader.botId.find(botId);
  if (!b) return;
  ctx.db.botTrader.botId.update({
    ...b,
    spentCents: b.spentCents + BigInt(price) * BigInt(qty),
    yesShares: b.yesShares + (side === 'YES' ? qty : 0),
    noShares: b.noShares + (side === 'NO' ? qty : 0),
  });
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

/** Spawn a crew for each of a room's markets while its bots are on; clear them when off. */
function syncBots(ctx: Ctx, l: LobbyRow) {
  const markets = l.botsEnabled ? roomMarkets(ctx.db, l) : [];
  const keep = new Set(markets.map(m => m.marketId));
  const crew = () => [...ctx.db.botTrader.iter()].filter(b => b.lobbyId === l.lobbyId);

  for (const b of crew()) {
    if (!keep.has(b.marketId)) ctx.db.botTrader.botId.delete(b.botId);
  }

  const counts: Record<string, number> = {};
  let centralSlot = 0;
  const staffed = new Set<bigint>();
  for (const b of crew()) {
    counts[b.role] = (counts[b.role] ?? 0) + 1;
    staffed.add(b.marketId);
    if ((ctx.db.market.marketId.find(b.marketId)?.locationX ?? -1) < 0) centralSlot++;
  }

  for (const m of markets) {
    if (staffed.has(m.marketId)) continue;
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
        lobbyId: l.lobbyId,
        spentCents: 0n,
        yesShares: 0,
        noShares: 0,
      });
    });
    // The new maker takes over the house quotes straight away.
    seedMarketLiquidity(ctx, m.marketId, m.fairPrice, l.lobbyId);
  }
}

/** Match a room's crew and repeating tick to its bot switch. */
function applyLobbyBots(ctx: Ctx, l: LobbyRow) {
  for (const timer of [...ctx.db.botTimer.iter()]) {
    if (timer.lobbyId === l.lobbyId) ctx.db.botTimer.scheduledId.delete(timer.scheduledId);
  }
  if (l.botsEnabled) {
    const tickMs = BOT_TICK_OPTIONS.includes(l.botTickMs) ? l.botTickMs : 1000;
    ctx.db.botTimer.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.interval(BigInt(tickMs) * 1000n),
      lobbyId: l.lobbyId,
    });
  }
  syncBots(ctx, l);
}

/** Server-side bots: one tick of a room's crew on each of its markets. */
export const runBotTimer = spacetimedb.reducer(
  { onSchedule: botTimer },
  { timer: botTimer.rowType },
  (ctx, { timer }) => {
    if (!ctx.sender.equals(ctx.identity)) throw new SenderError('Scheduler only');
    const l = ctx.db.lobby.lobbyId.find(timer.lobbyId);
    if (!l || !l.botsEnabled) {
      // A room that was switched off or deleted (or a timer from before bots
      // were per room): stop ticking and clear any crew left behind.
      ctx.db.botTimer.scheduledId.delete(timer.scheduledId);
      for (const b of [...ctx.db.botTrader.iter()]) {
        if (b.lobbyId === timer.lobbyId) ctx.db.botTrader.botId.delete(b.botId);
      }
      return;
    }
    syncBots(ctx, l); // markets may have been deployed or resolved since the last tick
    if (l.roundOver) return;
    for (const m of roomMarkets(ctx.db, l)) botTickMarket(ctx, m.marketId, l.lobbyId);
  }
);

/**
 * Switch a room's robot traders and the AI whale on or off and set the bot
 * speed. Solo rooms are run by their owner, class rooms by an instructor.
 */
export const setLobbyBots = spacetimedb.reducer(
  { lobbyId: t.u64(), botsEnabled: t.bool(), whaleEnabled: t.bool(), tickMs: t.u32() },
  (ctx, { lobbyId, botsEnabled, whaleEnabled, tickMs }) => {
    const l = requireLobby(ctx, lobbyId);
    requireRoomController(ctx, l);
    if (!BOT_TICK_OPTIONS.includes(tickMs)) throw new SenderError('Bot speed must be 600, 1000 or 2000 ms');
    if (whaleEnabled && !l.whaleEnabled && !whaleRunning(ctx)) {
      throw new SenderError('The whale is not running. Start it with npm run whale');
    }

    const next = { ...l, botsEnabled, whaleEnabled, botTickMs: tickMs };
    ctx.db.lobby.lobbyId.update(next);

    if (whaleEnabled && !ctx.db.whaleAvatar.lobbyId.find(lobbyId)) {
      ctx.db.whaleAvatar.insert({ lobbyId, x: WHALE_SPAWN.x, y: WHALE_SPAWN.y, direction: 'left' });
    } else if (!whaleEnabled) {
      removeWhaleFromRoom(ctx, next);
    }

    if (botsEnabled !== l.botsEnabled || tickMs !== l.botTickMs) applyLobbyBots(ctx, next);
  }
);

const WHALE_MODELS = ['claude', 'gemini'];

/** Pick the model that drives the whale in a room; the sidecar reads it each tick. */
export const setWhaleModel = spacetimedb.reducer(
  { lobbyId: t.u64(), model: t.string() },
  (ctx, { lobbyId, model }) => {
    const l = requireLobby(ctx, lobbyId);
    requireRoomController(ctx, l);
    if (!WHALE_MODELS.includes(model)) throw new SenderError("Whale model must be 'claude' or 'gemini'");
    ctx.db.lobby.lobbyId.update({ ...l, whaleModel: model });
  }
);

/** The whale sidecar walks its avatar around a room it is switched on in. */
export const whaleMove = spacetimedb.reducer(
  { lobbyId: t.u64(), x: t.i32(), y: t.i32(), direction: t.string() },
  (ctx, { lobbyId, x, y, direction }) => {
    if (!isWhale(ctx.db.player.identity.find(ctx.sender))) throw new SenderError('Only the whale can move the whale');
    const avatar = ctx.db.whaleAvatar.lobbyId.find(lobbyId);
    if (!avatar) throw new SenderError('The whale is not switched on in that room');
    ctx.db.whaleAvatar.lobbyId.update({
      ...avatar,
      x: Math.max(0, Math.min(GRID_COLS - 1, x)),
      y: Math.max(0, Math.min(GRID_ROWS - 1, y)),
      direction: direction || avatar.direction,
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

/**
 * Send a student out of a class room and back to the menu (Instructor only).
 * Like leaving: cash, positions and resting orders are kept, and the room
 * stays in their history so rejoining can't refill their starting cash.
 */
export const kickPlayer = spacetimedb.reducer(
  { target: t.identity(), lobbyId: t.u64() },
  (ctx, { target, lobbyId }) => {
    requireInstructor(ctx);
    const l = requireLobby(ctx, lobbyId);
    if (l.isSolo) throw new SenderError("Solo rooms belong to their student");
    const p = ctx.db.player.identity.find(target);
    if (!p || p.lobbyId !== lobbyId) throw new SenderError('That player is not in this room');
    if (p.role === 'INSTRUCTOR') throw new SenderError('Instructors cannot be kicked');
    ctx.db.player.identity.update({ ...p, lobbyId: 0n });
  }
);

/**
 * Close a class room for good (Instructor only): everyone in it goes back to
 * the menu, its bots and whale leave, and the room's code becomes free again.
 * Markets live on the class floor and are left alone.
 */
export const deleteLobby = spacetimedb.reducer(
  { lobbyId: t.u64() },
  (ctx, { lobbyId }) => {
    requireInstructor(ctx);
    const l = requireLobby(ctx, lobbyId);
    if (l.isSolo) throw new SenderError("Solo rooms belong to their student");

    for (const p of [...ctx.db.player.iter()]) {
      if (p.lobbyId === lobbyId) ctx.db.player.identity.update({ ...p, lobbyId: 0n });
    }
    removeWhaleFromRoom(ctx, l);
    for (const timer of [...ctx.db.botTimer.iter()]) {
      if (timer.lobbyId === lobbyId) ctx.db.botTimer.scheduledId.delete(timer.scheduledId);
    }
    for (const b of [...ctx.db.botTrader.iter()]) {
      if (b.lobbyId === lobbyId) ctx.db.botTrader.botId.delete(b.botId);
    }
    for (const part of [...ctx.db.lobbyParticipant.iter()]) {
      if (part.lobbyId === lobbyId) ctx.db.lobbyParticipant.participantId.delete(part.participantId);
    }
    ctx.db.lobby.lobbyId.delete(lobbyId);
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

/** End a room's round: closes its trading and reveals its leaderboard. */
export const endLobbyRound = spacetimedb.reducer(
  { lobbyId: t.u64() },
  (ctx, { lobbyId }) => {
    const l = requireLobby(ctx, lobbyId);
    requireRoomController(ctx, l);
    ctx.db.lobby.lobbyId.update({ ...l, roundOver: true });
  }
);

/** Hide a room's leaderboard again and reopen its trading. */
export const startLobbyRound = spacetimedb.reducer(
  { lobbyId: t.u64() },
  (ctx, { lobbyId }) => {
    const l = requireLobby(ctx, lobbyId);
    requireRoomController(ctx, l);
    ctx.db.lobby.lobbyId.update({ ...l, roundOver: false });
  }
);


/** Register the external Whale bot using the instructor passcode. */
export const registerWhale = spacetimedb.reducer(
  { name: t.string(), passcode: t.string() },
  (ctx, { name, passcode }) => {
    const cfg = ctx.db.instructorConfig.id.find(0);
    const expected = cfg?.passcode ?? DEFAULT_INSTRUCTOR_PASSCODE;
    if (passcode.trim() !== expected) throw new SenderError('Incorrect passcode');
    const trimmed = name.trim() || 'Whale AI';
    if (trimmed.length < 2 || trimmed.length > 24) {
      throw new SenderError('Name must be between 2 and 24 characters');
    }
    const lower = trimmed.toLowerCase();

    // Reclaim name from any prior whale instance if the identity changed across runs
    for (const other of ctx.db.player.iter()) {
      if (!other.identity.equals(ctx.sender) && other.username.toLowerCase() === lower) {
        if (isWhale(other)) {
          ctx.db.player.identity.update({
            ...other,
            username: `Whale_Old_${other.identity.toHexString().slice(0, 6)}`,
            onFloor: false,
          });
        } else {
          throw new SenderError(`The name "${trimmed}" is already taken`);
        }
      }
    }

    const p = getOrCreatePlayer(ctx);
    cancelDisconnectTimers(ctx, ctx.sender);
    ctx.db.player.identity.update({
      ...p,
      username: trimmed,
      avatarType: WHALE_AVATAR,
      role: 'STUDENT',
      // Running. It appears on a room's floor (whale_avatar) once switched on there.
      onFloor: true,
      lobbyId: 0n,
      cashBalance: p.cashBalance < WHALE_BANKROLL ? WHALE_BANKROLL : p.cashBalance,
    });
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
  lobbyId: t.u64(),
  isAi: t.bool(),
  startingCents: t.u64(), // bankroll P&L is measured from
  botId: t.u64(), // robot trader's bot_trader row; 0 for players and the whale
});

// Server-assigned name of a player who never picked one at login.
const PLACEHOLDER_NAME = /^Trader_[0-9a-f]{6}$/;

/**
 * A robot trader valued like a player. Bots trade on the house's account, so
 * each is given a notional bankroll equal to its room's starting cash.
 */
function valueBot(
  db: ReadDb,
  b: { marketId: bigint; spentCents: bigint; yesShares: number; noShares: number },
  startingCents: bigint
) {
  const mid = midPrice(db, b.marketId);
  const holdings = BigInt(b.yesShares) * BigInt(mid) + BigInt(b.noShares) * BigInt(100 - mid);
  let netWorth = startingCents - b.spentCents + holdings;
  if (netWorth < 0n) netWorth = 0n;
  const shownHoldings = holdings < netWorth ? holdings : netWorth;
  return { cash: netWorth - shownHoldings, holdings: shownHoldings, netWorth };
}

/**
 * Everyone trading a room, ranked by P&L: students, the whale (one row per room
 * it is on in) and the robot traders. Instructors see every room; students see
 * only their own room, and only once its round has ended.
 */
export const leaderboard = spacetimedb.view(
  { name: 'leaderboard', public: true },
  t.array(LeaderboardEntry),
  ctx => {
    const viewer = ctx.db.player.identity.find(ctx.sender);
    if (!viewer) return [];
    const isInstructor = viewer.role === 'INSTRUCTOR';
    if (!isInstructor) {
      const room = ctx.db.lobby.lobbyId.find(viewer.lobbyId);
      if (!room?.roundOver) return [];
    }

    const startingFor = new Map<bigint, bigint>();
    for (const l of ctx.db.lobby.iter()) startingFor.set(l.lobbyId, l.initialBalance > 0n ? l.initialBalance : DEFAULT_BALANCE);
    const everJoined = new Set([...ctx.db.lobbyParticipant.iter()].map(part => part.player.toHexString()));

    const rows = [];
    for (const p of ctx.db.player.iter()) {
      if (p.role === 'INSTRUCTOR') continue;
      const v = valuePlayer(ctx.db, p.identity, p.cashBalance);
      const base = {
        identity: p.identity,
        username: p.username,
        cashCents: v.cash,
        holdingsCents: v.holdings,
        netWorthCents: v.netWorth,
      };
      if (isWhale(p)) {
        if (!p.onFloor) continue;
        for (const w of ctx.db.whaleAvatar.iter()) {
          if (!isInstructor && w.lobbyId !== viewer.lobbyId) continue;
          const model = ctx.db.lobby.lobbyId.find(w.lobbyId)?.whaleModel === 'gemini' ? 'Gemini' : 'Claude';
          rows.push({
            ...base,
            username: `${p.username} (${model})`,
            lobbyId: w.lobbyId,
            isAi: true,
            startingCents: WHALE_BANKROLL,
            botId: 0n,
          });
        }
        continue;
      }
      if (isInstructor) {
        if (PLACEHOLDER_NAME.test(p.username) && !everJoined.has(p.identity.toHexString())) continue;
      } else if (p.lobbyId !== viewer.lobbyId) {
        continue;
      }
      rows.push({
        ...base,
        lobbyId: p.lobbyId,
        isAi: false,
        startingCents: startingFor.get(p.lobbyId) ?? DEFAULT_BALANCE,
        botId: 0n,
      });
    }

    for (const b of ctx.db.botTrader.iter()) {
      if (!isInstructor && b.lobbyId !== viewer.lobbyId) continue;
      const startingCents = startingFor.get(b.lobbyId) ?? DEFAULT_BALANCE;
      const v = valueBot(ctx.db, b, startingCents);
      rows.push({
        identity: Identity.zero(), // bots have no identity; botId tells them apart
        username: b.name,
        cashCents: v.cash,
        holdingsCents: v.holdings,
        netWorthCents: v.netWorth,
        lobbyId: b.lobbyId,
        isAi: true,
        startingCents,
        botId: b.botId,
      });
    }

    const pnl = (r: { netWorthCents: bigint; startingCents: bigint }) => r.netWorthCents - r.startingCents;
    rows.sort((a, b) => (pnl(a) === pnl(b) ? 0 : pnl(a) > pnl(b) ? -1 : 1));
    return rows;
  }
);
