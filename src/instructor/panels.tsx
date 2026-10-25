import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Clue, GameState, LeaderboardEntry, Lobby, Market, Order, Player } from '../module_bindings/types';
import { formatCents, leaderboardKey, pnlOf } from '../components/RoundOverlays';
import { WHALE_MODEL_LABELS } from '../components/SettingsDialog';

/** Runs a reducer call and reports the outcome in the dashboard toast. */
export type Run = (label: string, call: () => Promise<unknown>) => Promise<boolean>;

// Floor grid shared with the game (backend x 0..19, y 0..10).
const COLS = 20;
const ROWS = 11;
const CENTRAL_ZONE = { minX: 7, maxX: 12, minY: 3, maxY: 8 };
const DESKS = new Set(['1,0', '2,0', '4,0', '5,0', '14,0', '15,0', '17,0', '18,0', '0,0', '19,0', '0,10', '19,10']);

const inputCls = 'panel-inset w-full px-3 py-2.5 text-[10px] outline-none focus:bg-white';

export function Section({ title, accent, right, children }: { title: string; accent: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b-4 border-ink px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={`inline-block h-3 w-3 ${accent} shadow-[0_0_0_3px_#1d1b2a]`} />
          <span className="text-[12px]">{title}</span>
        </div>
        {right}
      </div>
      <div className="min-w-0 p-4">{children}</div>
    </section>
  );
}

/** Two-click guard for destructive actions. */
function useConfirm(timeoutMs = 3500) {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), timeoutMs);
    return () => clearTimeout(t);
  }, [armed, timeoutMs]);
  return {
    armed,
    confirm: (key: string, action: () => void) => {
      if (armed === key) {
        setArmed(null);
        action();
      } else setArmed(key);
    },
  };
}

// --- Round control -------------------------------------------------------------

export function RoundControl({ lobby, run, studentCount }: { lobby: Lobby | null; run: Run; studentCount: number }) {
  const endRound = useReducer(reducers.endLobbyRound);
  const newRound = useReducer(reducers.startLobbyRound);
  const { armed, confirm } = useConfirm();
  const revealed = !!lobby?.roundOver;
  if (!lobby) return null;
  const lobbyId = lobby.lobbyId;

  if (revealed) {
    return (
      <div className="panel flex flex-wrap items-center justify-between gap-4 bg-amber-100 p-5">
        <div>
          <div className="text-[14px]">ROUND OVER · {lobby.code}</div>
          <div className="mt-2 text-[9px] leading-relaxed text-slate-600">
            Students are frozen on the final podium and trading is closed.
          </div>
        </div>
        <button
          className="sign sign-active !px-6 !py-4 text-[13px]"
          onClick={() => run('New round started', () => newRound({ lobbyId }))}
        >
          Start New Round
        </button>
      </div>
    );
  }

  const isArmed = armed === 'end';
  return (
    <button
      onClick={() => confirm('end', () => void run('Round ended — leaderboard revealed', () => endRound({ lobbyId })))}
      className={`group relative w-full border-4 border-ink px-6 py-7 text-white shadow-[inset_-6px_-6px_0_rgba(0,0,0,0.25),8px_8px_0_rgba(0,0,0,0.4)] transition-transform active:translate-y-1 ${
        isArmed ? 'animate-pulse bg-rose-700' : 'bg-rose-600 hover:bg-rose-500'
      }`}
    >
      <div className="text-[22px] tracking-wide sm:text-[28px]">{isArmed ? 'CLICK AGAIN TO CONFIRM' : `END ROUND · ${lobby.code}`}</div>
      <div className="mt-3 text-[9px] text-rose-100">
        Closes trading, freezes the floor and reveals the leaderboard to {studentCount} student{studentCount === 1 ? '' : 's'}
      </div>
    </button>
  );
}

// --- Leaderboard ---------------------------------------------------------------

/** Ranked by P&L, so the whale's $5,000 bankroll doesn't put it on top by default. */
export function LeaderboardPanel({ rows, run }: { rows: readonly LeaderboardEntry[]; run: Run }) {
  const kickPlayer = useReducer(reducers.kickPlayer);
  const { armed, confirm } = useConfirm();
  const ranked = useMemo(
    () => [...rows].sort((a, b) => pnlOf(b) - pnlOf(a) || a.username.localeCompare(b.username)),
    [rows]
  );
  return (
    <Section
      title="Live Leaderboard"
      accent="bg-amber-300"
      right={<span className="text-[8px] text-slate-500">INSTRUCTOR EYES ONLY</span>}
    >
      {ranked.length === 0 ? (
        <div className="py-8 text-center text-[9px] leading-relaxed text-slate-500">
          No students yet. Share the lobby QR code to get the class on the floor.
        </div>
      ) : (
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full border-collapse text-[9px]">
            <thead className="sticky top-0 bg-white text-slate-500">
              <tr className="border-b-4 border-ink text-left">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">TRADER</th>
                <th className="py-2 pr-2 text-right">CASH</th>
                <th className="py-2 pr-2 text-right">POSITIONS</th>
                <th className="py-2 pr-2 text-right">NET WORTH</th>
                <th className="py-2 pr-2 text-right">P&L</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const pnl = pnlOf(r);
                const key = leaderboardKey(r);
                const kickArmed = armed === key;
                return (
                  <tr key={key} className={`border-b-2 border-slate-200 ${i < 3 ? 'bg-amber-50' : ''}`}>
                    <td className="py-2.5 pr-2">{['🥇', '🥈', '🥉'][i] ?? i + 1}</td>
                    <td className="max-w-[160px] truncate py-2.5 pr-2" title={r.username}>
                      {r.username}
                      {r.botId !== 0n ? (
                        <span className="ml-2 bg-sky-300 px-1 text-[7px]">BOT</span>
                      ) : (
                        r.isAi && <span className="ml-2 bg-amber-300 px-1 text-[7px]">AI</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-2 text-right">{formatCents(r.cashCents)}</td>
                    <td className="py-2.5 pr-2 text-right">{formatCents(r.holdingsCents)}</td>
                    <td className="py-2.5 pr-2 text-right text-[10px]">{formatCents(r.netWorthCents)}</td>
                    <td className={`py-2.5 pr-2 text-right ${pnl > 0 ? 'text-emerald-700' : pnl < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                      {pnl > 0 ? '+' : pnl < 0 ? '-' : ''}
                      {formatCents(Math.abs(pnl))}
                    </td>
                    <td className="py-2.5 text-right">
                      {!r.isAi && (
                        <button
                          className={`border-2 border-ink px-1.5 py-1 text-[7px] ${kickArmed ? 'animate-pulse bg-rose-600 text-white' : 'bg-white hover:bg-rose-100'}`}
                          title={`Send ${r.username} back to the menu`}
                          onClick={() =>
                            confirm(key, () =>
                              void run(`${r.username} was kicked`, () => kickPlayer({ target: r.identity, lobbyId: r.lobbyId }))
                            )
                          }
                        >
                          {kickArmed ? 'SURE?' : 'KICK'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 text-[7px] leading-relaxed text-slate-500">
        Net worth = cash + cash locked in open orders + positions valued at the order-book mid price. P&L is measured from
        each trader's starting cash ($5,000 for the whale). Bots trade on the house's account and are scored on a notional
        bankroll equal to the room's starting cash, counted from when the bots were last switched on. Kicking sends a
        student back to the menu; they keep their cash and positions and can rejoin with the room code.
      </div>
    </Section>
  );
}

// --- Breaking news ---------------------------------------------------------------

const ALERT_PRESETS = [
  'Trading halts in 60 seconds!',
  'Rumor: the next card is a face card.',
  'Liquidity warning: market makers are pulling quotes.',
];

export function AlertPanel({ gameState, run }: { gameState: GameState | null; run: Run }) {
  const broadcast = useReducer(reducers.broadcastAlert);
  const [message, setMessage] = useState('');
  const live = gameState?.newsTickerMessage ?? '';

  return (
    <Section title="Breaking News" accent="bg-rose-500">
      <div className="space-y-3 text-[9px]">
        <div className="border-4 border-ink bg-rose-600 px-3 py-3 leading-relaxed text-white">
          <span className="text-rose-200">ON AIR: </span>
          {live || <span className="text-rose-200">nothing</span>}
        </div>
        <textarea
          rows={2}
          maxLength={200}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Flash a red banner on every student's screen…"
          className={`${inputCls} resize-none leading-relaxed`}
        />
        <div className="flex flex-wrap gap-2">
          {ALERT_PRESETS.map(p => (
            <button key={p} className="sign !px-2 !py-1.5 text-[7px]" onClick={() => setMessage(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <button
            className="sign flex-1 !bg-rose-400 text-[10px] disabled:opacity-50"
            disabled={!message.trim()}
            onClick={async () => {
              if (await run('Alert broadcast', () => broadcast({ message }))) setMessage('');
            }}
          >
            Broadcast
          </button>
          <button className="sign text-[10px]" disabled={!live} onClick={() => run('Banner cleared', () => broadcast({ message: '' }))}>
            Clear
          </button>
        </div>
      </div>
    </Section>
  );
}

// --- Market deployment -------------------------------------------------------------

function pitError(x: number, y: number, markets: readonly Market[]) {
  if (x < 0 || x > COLS - 2 || y < 1 || y > ROWS - 3) return 'Off the usable floor';
  const overlaps = (bx0: number, bx1: number, by0: number, by1: number) => x + 1 >= bx0 && x <= bx1 && y + 1 >= by0 && y <= by1;
  const z = CENTRAL_ZONE;
  if (overlaps(z.minX, z.maxX, z.minY, z.maxY)) return 'Overlaps the central pit';
  const clash = markets.find(
    m => m.status === 'OPEN' && m.locationX >= 0 && overlaps(m.locationX - 1, m.locationX + 2, m.locationY - 1, m.locationY + 2)
  );
  return clash ? `Too close to "${clash.question}"` : null;
}

function FloorPicker({
  markets,
  selected,
  onSelect,
}: {
  markets: readonly Market[];
  selected: { x: number; y: number } | null;
  onSelect: (pos: { x: number; y: number }) => void;
}) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const placed = markets.filter(m => m.status === 'OPEN' && m.locationX >= 0);
  const probe = hover ?? selected;
  const probeOk = probe ? !pitError(probe.x, probe.y, markets) : false;

  const cellClass = (x: number, y: number) => {
    const inProbe = probe && x >= probe.x && x <= probe.x + 1 && y >= probe.y && y <= probe.y + 1;
    if (inProbe) return probeOk ? 'bg-emerald-400' : 'bg-rose-400';
    if (placed.some(m => x >= m.locationX && x <= m.locationX + 1 && y >= m.locationY && y <= m.locationY + 1)) return 'bg-emerald-700';
    if (x >= 8 && x <= 11 && y >= 4 && y <= 7) return 'bg-emerald-900';
    if (DESKS.has(`${x},${y}`)) return 'bg-amber-800';
    return 'bg-slate-500';
  };

  return (
    <div>
      <div
        className="grid gap-[2px] border-4 border-ink bg-ink p-[2px]"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: ROWS * COLS }, (_, i) => {
          const x = i % COLS;
          const y = Math.floor(i / COLS);
          return (
            <button
              key={i}
              type="button"
              className={`aspect-square ${cellClass(x, y)}`}
              onMouseEnter={() => setHover({ x, y })}
              onClick={() => onSelect({ x, y })}
              title={`(${x}, ${y})`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[7px] text-slate-600">
        <span><span className="mr-1 inline-block h-2 w-2 bg-emerald-900" />central pit</span>
        <span><span className="mr-1 inline-block h-2 w-2 bg-emerald-700" />deployed pits</span>
        <span><span className="mr-1 inline-block h-2 w-2 bg-amber-800" />desks</span>
        <span>{probe ? `(${probe.x}, ${probe.y}) ${pitError(probe.x, probe.y, markets) ?? 'OK'}` : 'Click the top-left tile of the new pit'}</span>
      </div>
    </div>
  );
}

export function DeployMarketPanel({ markets, run }: { markets: readonly Market[]; run: Run }) {
  const createMarket = useReducer(reducers.createMarket);
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('Classroom');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState(50);
  const [onFloor, setOnFloor] = useState(true);
  const [loc, setLoc] = useState<{ x: number; y: number } | null>(null);

  const locError = onFloor ? (loc ? pitError(loc.x, loc.y, markets) : 'Pick a spot on the floor') : null;
  const canDeploy = question.trim().length > 0 && !locError;

  const deploy = async () => {
    const ok = await run('Market deployed', () =>
      createMarket({
        question: question.trim(),
        category,
        description: description.trim(),
        initialPrice: price,
        locationX: onFloor && loc ? loc.x : -1,
        locationY: onFloor && loc ? loc.y : -1,
      })
    );
    if (ok) {
      setQuestion('');
      setDescription('');
      setLoc(null);
    }
  };

  return (
    <Section title="Deploy Market" accent="bg-emerald-400">
      <div className="space-y-4 text-[9px]">
        <input className={inputCls} placeholder="Question, e.g. Will the class average beat 70%?" value={question} onChange={e => setQuestion(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
            {['Classroom', 'Crypto', 'Macro', 'Tech', 'AI', 'Sports', 'General'].map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap">OPEN {price}¢</span>
            <input type="range" min={1} max={99} value={price} onChange={e => setPrice(Number(e.target.value))} className="pixel-range w-full" />
          </label>
        </div>
        <textarea rows={2} className={`${inputCls} resize-none`} placeholder="Resolution rules (optional)" value={description} onChange={e => setDescription(e.target.value)} />

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onFloor} onChange={e => setOnFloor(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
          Spawn a trading pit on the floor
        </label>
        {onFloor && <FloorPicker markets={markets} selected={loc} onSelect={setLoc} />}

        <button className="sign sign-active w-full text-[11px] disabled:opacity-50" disabled={!canDeploy} onClick={deploy}>
          {locError && question.trim() ? locError : 'Deploy'}
        </button>
      </div>
    </Section>
  );
}

// --- Market management ---------------------------------------------------------------

const CATEGORIES = ['Classroom', 'Crypto', 'Macro', 'Tech', 'AI', 'Sports', 'General'];

/** Red confirmation shown before an edit wipes the contract's order book. */
function WipeOrdersModal({
  market,
  question,
  category,
  orders,
  onCancel,
  onConfirm,
}: {
  market: Market;
  question: string;
  category: string;
  orders: readonly Order[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const human = orders.filter(o => !o.isBot);
  const owners = new Set(human.map(o => o.owner.toHexString())).size;
  const escrow = human.reduce((sum, o) => sum + o.price * o.quantity, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={e => e.target === e.currentTarget && !busy && onCancel()}>
      <div role="alertdialog" aria-modal="true" className="pop-in w-full max-w-lg border-[6px] border-red-500 bg-white shadow-[8px_8px_0_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-3 bg-red-500 px-4 py-3 text-white">
          <AlertTriangle className="h-6 w-6 shrink-0" strokeWidth={3} />
          <span className="text-[13px]">WARNING</span>
        </div>
        <div className="space-y-4 p-5 text-[9px] leading-[1.8]">
          <p className="text-[11px] leading-[1.7] text-red-700">
            WARNING: Modifying this market mid-game will immediately cancel and wipe all existing resting orders for this contract.
          </p>
          <div className="panel-inset space-y-1 p-3">
            <div className="text-slate-500">FROM</div>
            <div>{market.question} <span className="text-slate-500">({market.category})</span></div>
            <div className="mt-2 text-slate-500">TO</div>
            <div>{question} <span className="text-slate-500">({category})</span></div>
          </div>
          <ul className="list-inside list-disc space-y-1 text-slate-700">
            <li>
              {orders.length} resting order{orders.length === 1 ? '' : 's'} cancelled ({orders.length - human.length} market-maker)
            </li>
            <li>
              {formatCents(escrow)} escrow refunded to {owners} student{owners === 1 ? '' : 's'}
            </li>
            <li>Existing positions are kept</li>
          </ul>
          <div className="flex gap-3 pt-1">
            <button type="button" className="sign flex-1 text-[10px]" disabled={busy} onClick={onCancel}>
              Keep Editing
            </button>
            <button
              type="button"
              className="sign flex-1 !border-red-700 !bg-red-500 text-[10px] !text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onConfirm();
              }}
            >
              {busy ? 'Wiping…' : 'Confirm & Wipe Orders'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditMarketForm({
  market,
  orders,
  run,
  onDone,
}: {
  market: Market;
  orders: readonly Order[];
  run: Run;
  onDone: () => void;
}) {
  const modifyMarket = useReducer(reducers.modifyMarket);
  const [question, setQuestion] = useState(market.question);
  const [category, setCategory] = useState(market.category);
  const [confirming, setConfirming] = useState(false);
  const marketOrders = orders.filter(o => o.marketId === market.marketId);
  const changed = question.trim() !== market.question || category !== market.category;

  return (
    <form
      className="mt-3 space-y-3 border-t-2 border-dashed border-slate-300 pt-3"
      onSubmit={e => {
        // Saving never fires the reducer directly: it opens the warning first.
        e.preventDefault();
        if (changed && question.trim()) setConfirming(true);
      }}
    >
      <input className={inputCls} maxLength={200} value={question} onChange={e => setQuestion(e.target.value)} />
      <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
        {[...new Set([market.category, ...CATEGORIES])].map(c => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <div className="flex gap-2">
        <button type="submit" className="sign sign-active flex-1 text-[9px] disabled:opacity-50" disabled={!changed || !question.trim()}>
          Save
        </button>
        <button type="button" className="sign text-[9px]" onClick={onDone}>
          Cancel
        </button>
      </div>
      {marketOrders.length > 0 && (
        <div className="text-[7px] text-red-600">Saving will cancel {marketOrders.length} resting order{marketOrders.length === 1 ? '' : 's'}.</div>
      )}
      {confirming && (
        <WipeOrdersModal
          market={market}
          question={question.trim()}
          category={category}
          orders={marketOrders}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            const ok = await run('Market updated — orders wiped and refunded', () =>
              modifyMarket({ marketId: market.marketId, newQuestion: question.trim(), newCategory: category })
            );
            setConfirming(false);
            if (ok) onDone();
          }}
        />
      )}
    </form>
  );
}

const CARD_PRESETS = [
  { title: 'Card 1 Revealed', content: 'First card is a 7 of Spades (Value = 7). Current sum: 7.', fair: 54 },
  { title: 'Card 2 Revealed', content: 'Second card is a 9 of Diamonds (Value = 9). Current sum: 16.', fair: 78 },
  { title: 'Card 3 Revealed', content: 'Final card is an 8 of Hearts (Value = 8). Final sum = 24! (> 20)', fair: 99 },
];

function ClueForm({ market, clues, run }: { market: Market; clues: readonly Clue[]; run: Run }) {
  const revealClue = useReducer(reducers.revealClue);
  const clearClues = useReducer(reducers.clearClues);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [fair, setFair] = useState(market.fairPrice || 50);
  const marketClues = clues.filter(c => c.marketId === market.marketId);

  return (
    <div className="mt-3 space-y-3 border-t-2 border-dashed border-slate-300 pt-3">
      {market.category === 'Classroom' && (
        <div className="grid grid-cols-3 gap-2">
          {CARD_PRESETS.map(cp => (
            <button
              key={cp.title}
              className="sign !flex-col !items-start !gap-1 !px-2 text-left text-[7px]"
              onClick={() => {
                setTitle(cp.title);
                setContent(cp.content);
                setFair(cp.fair);
              }}
            >
              <span>{cp.title}</span>
              <span className="text-slate-500">→ {cp.fair}¢</span>
            </button>
          ))}
        </div>
      )}
      <input className={inputCls} placeholder="Clue title" value={title} onChange={e => setTitle(e.target.value)} />
      <textarea rows={2} className={`${inputCls} resize-none`} placeholder="What the class learns" value={content} onChange={e => setContent(e.target.value)} />
      <label className="flex items-center gap-2 text-[8px]">
        <span className="whitespace-nowrap">NEW FAIR {fair}¢</span>
        <input type="range" min={1} max={99} value={fair} onChange={e => setFair(Number(e.target.value))} className="pixel-range w-full" />
      </label>
      <div className="flex gap-2">
        <button
          className="sign sign-active flex-1 text-[9px] disabled:opacity-50"
          disabled={!title.trim() || !content.trim()}
          onClick={async () => {
            const ok = await run('Clue revealed', () => revealClue({ marketId: market.marketId, title, content, newFairPrice: fair }));
            if (ok) {
              setTitle('');
              setContent('');
            }
          }}
        >
          Reveal Clue
        </button>
        {marketClues.length > 0 && (
          <button className="sign text-[9px]" onClick={() => run('Clues cleared', () => clearClues({ marketId: market.marketId }))}>
            Clear ({marketClues.length})
          </button>
        )}
      </div>
    </div>
  );
}

export function MarketsPanel({
  markets,
  clues,
  orders,
  activeLobby,
  run,
}: {
  markets: readonly Market[];
  clues: readonly Clue[];
  orders: readonly Order[];
  activeLobby: Lobby | null;
  run: Run;
}) {
  const resolveMarket = useReducer(reducers.resolveMarket);
  const resetMarket = useReducer(reducers.resetMarket);
  const createLobby = useReducer(reducers.createLobby);
  const [openClues, setOpenClues] = useState<bigint | null>(null);
  const [editing, setEditing] = useState<bigint | null>(null);
  const { armed, confirm } = useConfirm();

  const sorted = [...markets].sort((a, b) => (a.status === b.status ? Number(b.marketId - a.marketId) : a.status === 'OPEN' ? -1 : 1));

  return (
    <Section title="Markets" accent="bg-sky-400" right={<span className="text-[8px] text-slate-500">{markets.length} TOTAL</span>}>
      <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
        {sorted.map(m => {
          const id = m.marketId.toString();
          const isCenter = activeLobby?.marketId === m.marketId;
          return (
            <div key={id} className="panel-inset p-3 text-[8px]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] leading-[1.6]">{m.question}</div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
                    <span>{m.category.toUpperCase()}</span>
                    <span>
                      LAST <span className="text-emerald-700">{m.lastTradedPrice}¢</span>
                    </span>
                    <span>
                      FAIR <span className="text-sky-700">{m.fairPrice}¢</span>
                    </span>
                    <span>VOL {Number(m.volume)}</span>
                    <span>{isCenter ? 'CENTRAL PIT' : m.locationX >= 0 ? `PIT (${m.locationX},${m.locationY})` : 'OFF FLOOR'}</span>
                  </div>
                </div>
                <span
                  className={`shrink-0 border-2 border-ink px-2 py-1 ${m.status === 'OPEN' ? 'bg-emerald-300' : 'bg-slate-300'}`}
                >
                  {m.status === 'OPEN' ? 'OPEN' : `${m.winningSide} WON`}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {m.status === 'OPEN' ? (
                  <>
                    <button
                      className="sign !bg-emerald-300 !px-2 !py-1.5 text-[8px]"
                      onClick={() => confirm(`yes-${id}`, () => void run('Resolved YES — winners paid', () => resolveMarket({ marketId: m.marketId, outcome: 'YES' })))}
                    >
                      {armed === `yes-${id}` ? 'Confirm YES?' : 'YES wins'}
                    </button>
                    <button
                      className="sign !bg-rose-300 !px-2 !py-1.5 text-[8px]"
                      onClick={() => confirm(`no-${id}`, () => void run('Resolved NO — winners paid', () => resolveMarket({ marketId: m.marketId, outcome: 'NO' })))}
                    >
                      {armed === `no-${id}` ? 'Confirm NO?' : 'NO wins'}
                    </button>
                    <button
                      className={`sign !px-2 !py-1.5 text-[8px] ${openClues === m.marketId ? 'sign-active' : ''}`}
                      onClick={() => {
                        setEditing(null);
                        setOpenClues(openClues === m.marketId ? null : m.marketId);
                      }}
                    >
                      Clues
                    </button>
                    <button
                      className={`sign !px-2 !py-1.5 text-[8px] ${editing === m.marketId ? 'sign-active' : ''}`}
                      onClick={() => {
                        setOpenClues(null);
                        setEditing(editing === m.marketId ? null : m.marketId);
                      }}
                    >
                      Edit
                    </button>
                    {activeLobby && !isCenter && (
                      <button
                        className="sign !px-2 !py-1.5 text-[8px]"
                        title="Show this market in the central pit"
                        onClick={() =>
                          run('Moved to the central pit', () =>
                            createLobby({ code: activeLobby.code, title: activeLobby.title, marketId: m.marketId, initialBalance: activeLobby.initialBalance })
                          )
                        }
                      >
                        To Center
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    className="sign !bg-amber-200 !px-2 !py-1.5 text-[8px]"
                    onClick={() => run('Market reopened', () => resetMarket({ marketId: m.marketId, defaultPrice: m.preResolvedPrice || 50 }))}
                  >
                    Undo / Reopen
                  </button>
                )}
              </div>

              {openClues === m.marketId && m.status === 'OPEN' && <ClueForm market={m} clues={clues} run={run} />}
              {editing === m.marketId && m.status === 'OPEN' && (
                <EditMarketForm key={id} market={m} orders={orders} run={run} onDone={() => setEditing(null)} />
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// --- Classroom: lobby, balances, bots, access ------------------------------------------

export function ClassroomPanel({
  lobbies,
  activeLobby,
  markets,
  studentCount,
  onSelectLobby,
  whale,
  run,
}: {
  lobbies: readonly Lobby[];
  activeLobby: Lobby | null;
  markets: readonly Market[];
  studentCount: number;
  onSelectLobby: (code: string) => void;
  /** The running whale sidecar, if any. */
  whale: Player | null;
  run: Run;
}) {
  const resetBalances = useReducer(reducers.resetLobbyBalances);
  const deleteLobby = useReducer(reducers.deleteLobby);
  const setLobbyBots = useReducer(reducers.setLobbyBots);
  const createLobby = useReducer(reducers.createLobby);
  const setPasscode = useReducer(reducers.setInstructorPasscode);
  const { armed, confirm } = useConfirm();
  const [newCode, setNewCode] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [bankroll, setBankroll] = useState(100);
  const [passcode, setPasscodeValue] = useState('');
  const [copied, setCopied] = useState(false);

  const joinUrl = activeLobby ? `${window.location.origin}/?lobby=${activeLobby.code}` : '';

  return (
    <Section title="Classroom" accent="bg-violet-400" right={<span className="text-[8px] text-slate-500">{studentCount} STUDENTS</span>}>
      <div className="space-y-5 text-[9px]">
        <div className="space-y-2">
          <div className="text-slate-500">ACTIVE LOBBY</div>
          <div className="flex gap-2">
            <select className={inputCls} value={activeLobby?.code ?? ''} onChange={e => onSelectLobby(e.target.value)}>
              {lobbies.map(l => (
                <option key={l.code} value={l.code}>
                  {l.code} — {l.title}
                </option>
              ))}
            </select>
            <button
              className="sign !px-3 text-[8px]"
              disabled={!joinUrl}
              onClick={() => {
                void navigator.clipboard?.writeText(joinUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <div className="truncate text-[7px] text-slate-500">{joinUrl}</div>
        </div>

        {activeLobby && <BotControls lobby={activeLobby} whale={whale} run={run} setLobbyBots={setLobbyBots} />}

        <div className="grid grid-cols-2 gap-3">
          <button
            className="sign text-[9px]"
            disabled={!activeLobby}
            onClick={() =>
              activeLobby &&
              confirm('reset', () => void run('Balances, positions and orders reset', () => resetBalances({ code: activeLobby.code })))
            }
          >
            {armed === 'reset' ? 'Confirm reset?' : 'Reset balances'}
          </button>
          <button
            className={`sign text-[9px] ${armed === 'delete' ? 'animate-pulse !bg-rose-600 text-white' : '!bg-rose-200'}`}
            disabled={!activeLobby}
            title="Close this room: everyone in it goes back to the menu"
            onClick={() =>
              activeLobby &&
              confirm('delete', () =>
                void run(`Lobby ${activeLobby.code} deleted`, () => deleteLobby({ lobbyId: activeLobby.lobbyId }))
              )
            }
          >
            {armed === 'delete' ? `Delete ${activeLobby?.code}?` : 'Delete lobby'}
          </button>
        </div>

        <details className="panel-inset p-3">
          <summary className="cursor-pointer">CREATE LOBBY</summary>
          <form
            className="mt-3 space-y-2"
            onSubmit={async e => {
              e.preventDefault();
              const code = newCode.trim().toUpperCase();
              const marketId = activeLobby?.marketId ?? markets[0]?.marketId;
              if (!code || marketId === undefined) return;
              const ok = await run(`Lobby ${code} created`, () =>
                createLobby({ code, title: newTitle.trim() || `${code} Trading Arena`, marketId, initialBalance: BigInt(Math.round(bankroll * 100)) })
              );
              if (ok) {
                onSelectLobby(code);
                setNewCode('');
                setNewTitle('');
              }
            }}
          >
            <input className={`${inputCls} uppercase`} maxLength={16} placeholder="CODE" value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} />
            <input className={inputCls} placeholder="Title" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
            <label className="flex items-center gap-2">
              <span className="whitespace-nowrap">START $</span>
              <input type="number" min={10} max={10000} step={10} className={inputCls} value={bankroll} onChange={e => setBankroll(Number(e.target.value))} />
            </label>
            <button type="submit" className="sign w-full text-[9px]">
              Create
            </button>
          </form>
        </details>

        <details className="panel-inset p-3">
          <summary className="cursor-pointer">INSTRUCTOR PASSCODE</summary>
          <div className="mt-3 flex gap-2">
            <input className={inputCls} placeholder="New passcode" value={passcode} onChange={e => setPasscodeValue(e.target.value)} />
            <button
              className="sign !px-3 text-[8px]"
              disabled={passcode.trim().length < 4}
              onClick={async () => {
                if (await run('Passcode updated', () => setPasscode({ passcode }))) setPasscodeValue('');
              }}
            >
              Save
            </button>
          </div>
        </details>
      </div>
    </Section>
  );
}

const BOT_SPEEDS = [600, 1000, 2000];

/** The robot traders and the AI whale in the selected room. */
function BotControls({
  lobby,
  whale,
  run,
  setLobbyBots,
}: {
  lobby: Lobby;
  whale: Player | null;
  run: Run;
  setLobbyBots: (args: { lobbyId: bigint; botsEnabled: boolean; whaleEnabled: boolean; tickMs: number }) => Promise<unknown>;
}) {
  const setWhaleModel = useReducer(reducers.setWhaleModel);
  const amm = lobby.botsEnabled;
  const whaleOn = lobby.whaleEnabled;
  const tickMs = lobby.botTickMs;
  // The server refuses to switch the whale on while its process is down.
  const whaleAvailable = !!whale || whaleOn;
  const allOn = amm && (whaleOn || !whaleAvailable);
  const save = (label: string, next: { botsEnabled: boolean; whaleEnabled: boolean; tickMs: number }) =>
    void run(label, () => setLobbyBots({ lobbyId: lobby.lobbyId, ...next }));

  return (
    <div className="panel-inset space-y-3 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div>AI WHALE &amp; MARKET MAKERS</div>
          <div className="text-[7px] text-slate-500">Runs on the server for {lobby.code}'s central pit and floor pits</div>
        </div>
        <button
          className={`sign text-[9px] ${allOn ? 'sign-active' : ''}`}
          onClick={() =>
            save(allOn ? 'Bots stopped' : 'Bots started', {
              botsEnabled: !allOn,
              whaleEnabled: !allOn && !!whale,
              tickMs,
            })
          }
        >
          {allOn ? 'ON' : amm || whaleOn ? 'PARTIAL' : 'OFF'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[8px]">
        <button
          className={`sign !px-2 !py-1 text-[8px] ${amm ? 'sign-active' : ''}`}
          onClick={() => save(amm ? 'Robot traders off' : 'Robot traders on', { botsEnabled: !amm, whaleEnabled: whaleOn, tickMs })}
        >
          BOTS {amm ? 'ON' : 'OFF'}
        </button>
        <button
          className={`sign !px-2 !py-1 text-[8px] disabled:opacity-40 ${whaleOn ? 'sign-active' : ''}`}
          disabled={!whaleAvailable}
          title={whaleAvailable ? undefined : 'Start the whale with npm run whale'}
          onClick={() => save(whaleOn ? 'Whale off' : 'Whale trading', { botsEnabled: amm, whaleEnabled: !whaleOn, tickMs })}
        >
          WHALE {whaleOn ? 'ON' : 'OFF'}
        </button>
        {whaleOn && (
          <select
            className="panel-inset px-1.5 py-1 text-[8px] outline-none"
            title="Model driving the whale in this room"
            value={lobby.whaleModel}
            onChange={e => {
              const model = e.target.value;
              void run(`Whale now runs on ${WHALE_MODEL_LABELS[model]}`, () => setWhaleModel({ lobbyId: lobby.lobbyId, model }));
            }}
          >
            {Object.entries(WHALE_MODEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto flex gap-1">
          {BOT_SPEEDS.map(ms => (
            <button
              key={ms}
              className={`sign !px-2 !py-1 text-[8px] ${tickMs === ms ? 'sign-active' : ''}`}
              onClick={() => save(`Bot speed ${ms}ms`, { botsEnabled: amm, whaleEnabled: whaleOn, tickMs: ms })}
            >
              {ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
            </button>
          ))}
        </span>
      </div>
      <div className="text-[7px] text-slate-500">
        Whale sidecar: {whale ? `online as ${whale.username}` : 'offline (npm run whale)'}
      </div>
    </div>
  );
}
