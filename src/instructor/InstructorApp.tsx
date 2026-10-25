import { useCallback, useEffect, useMemo, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import {
  AlertPanel,
  ClassroomPanel,
  DeployMarketPanel,
  LeaderboardPanel,
  MarketsPanel,
  RoundControl,
  type Run,
} from './panels';

/** /instructor — the teacher's control room. Deliberately loads no Phaser. */
export default function InstructorApp() {
  const { isActive: connected, identity } = useSpacetimeDB();
  const [players, playersReady] = useTable(tables.player);
  const [markets] = useTable(tables.market);
  const [clues] = useTable(tables.clue);
  const [orders] = useTable(tables.order);
  const [lobbies] = useTable(tables.lobby);
  const [gameStates] = useTable(tables.gameState);
  const [leaderboard] = useTable(tables.leaderboard);
  const claimInstructor = useReducer(reducers.claimInstructor);

  const myHex = identity?.toHexString() ?? '';
  const me = useMemo(() => players.find(p => p.identity.toHexString() === myHex) ?? null, [players, myHex]);
  const isInstructor = me?.role === 'INSTRUCTOR';
  const gameState = gameStates[0] ?? null;

  // The dashboard runs class rooms; solo rooms belong to their students.
  const classLobbies = useMemo(() => lobbies.filter(l => !l.isSolo), [lobbies]);
  const classMarkets = useMemo(() => markets.filter(m => m.lobbyId === 0n), [markets]);
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const activeLobby = useMemo(
    () =>
      classLobbies.find(l => l.code === lobbyCode) ?? classLobbies.find(l => l.code === 'CAL13') ?? classLobbies[0] ?? null,
    [classLobbies, lobbyCode]
  );
  const roomRows = useMemo(
    () => leaderboard.filter(r => r.lobbyId === activeLobby?.lobbyId),
    [leaderboard, activeLobby?.lobbyId]
  );
  // The whale sidecar's player row; onFloor means the process is running.
  const whale = players.find(p => p.avatarType === 'whale' && p.onFloor) ?? null;

  // Toast for reducer outcomes.
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const run: Run = useCallback(async (label, call) => {
    try {
      await call();
      setToast({ text: label, ok: true });
      return true;
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : String(err), ok: false });
      return false;
    }
  }, []);

  const studentCount = players.filter(
    p => p.role !== 'INSTRUCTOR' && p.avatarType !== 'whale' && p.lobbyId === activeLobby?.lobbyId
  ).length;

  if (!connected || !playersReady) {
    return (
      <Screen>
        <div className="panel p-6 text-[11px] text-center space-y-3">
          <div>Connecting to the exchange…</div>
          <button
            type="button"
            className="sign text-[8px] text-slate-500 hover:text-ink cursor-pointer"
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
          >
            Clear saved cache & reconnect
          </button>
        </div>
      </Screen>
    );
  }

  if (!isInstructor) {
    return (
      <Screen>
        <PasscodeGate onSubmit={passcode => run('Welcome, instructor', () => claimInstructor({ passcode }))} />
        <Toast toast={toast} />
      </Screen>
    );
  }

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#26303f] bg-[linear-gradient(#2c3749_2px,transparent_2px),linear-gradient(90deg,#2c3749_2px,transparent_2px)] bg-[size:32px_32px] text-ink">
      <header className="sticky top-0 z-20 border-b-4 border-ink bg-white px-5 py-3 shadow-[0_4px_0_rgba(0,0,0,0.3)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="text-[16px] leading-tight">
              SERIOUS TRADING
              <div className="mt-1 text-[8px] text-rose-600">INSTRUCTOR MODE</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[9px]">
            <span className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_0_2px_#1d1b2a]" /> LIVE
            </span>
            <span className="text-slate-500">{me?.username}</span>
            <a className="sign !px-3 !py-2 text-[9px]" href={activeLobby ? `/?lobby=${activeLobby.code}` : '/'} target="_blank" rel="noreferrer">
              Open Floor ↗
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 p-5">
        <RoundControl lobby={activeLobby} run={run} studentCount={studentCount} />

        <div className="grid gap-5 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <LeaderboardPanel rows={roomRows} />
          </div>
          <div className="space-y-5 lg:col-span-5">
            <AlertPanel gameState={gameState} run={run} />
            <ClassroomPanel
              lobbies={classLobbies}
              activeLobby={activeLobby}
              markets={classMarkets}
              studentCount={studentCount}
              onSelectLobby={setLobbyCode}
              whale={whale}
              run={run}
            />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <DeployMarketPanel markets={classMarkets} run={run} />
          </div>
          <div className="lg:col-span-7">
            <MarketsPanel markets={classMarkets} clues={clues} orders={orders} activeLobby={activeLobby} run={run} />
          </div>
        </div>
      </main>

      <Toast toast={toast} />
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-[#26303f] p-4 text-ink">{children}</div>
  );
}

function PasscodeGate({ onSubmit }: { onSubmit: (passcode: string) => Promise<boolean> }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="panel pop-in w-full max-w-sm space-y-4 p-6 text-[10px]"
      onSubmit={async e => {
        e.preventDefault();
        if (!passcode.trim()) return;
        setBusy(true);
        await onSubmit(passcode);
        setBusy(false);
      }}
    >
      <div className="text-[14px]">INSTRUCTOR LOGIN</div>
      <p className="leading-[1.8] text-slate-600">Enter the classroom passcode to unlock market controls and the live leaderboard.</p>
      <input
        autoFocus
        type="password"
        value={passcode}
        onChange={e => setPasscode(e.target.value)}
        className="panel-inset w-full px-3 py-3 text-[12px] outline-none focus:bg-white"
        placeholder="Passcode"
      />
      <button type="submit" disabled={busy} className="sign sign-active w-full disabled:opacity-50">
        {busy ? 'Checking…' : 'Unlock'}
      </button>
      <a href="/" className="block text-center text-[8px] text-slate-500 underline">
        Back to the trading floor
      </a>
    </form>
  );
}

function Toast({ toast }: { toast: { text: string; ok: boolean } | null }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className={`pop-in border-4 border-ink px-4 py-3 text-[10px] shadow-[6px_6px_0_rgba(0,0,0,0.4)] ${toast.ok ? 'bg-emerald-300' : 'bg-rose-300'}`}>
        {toast.text}
      </div>
    </div>
  );
}
