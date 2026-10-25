import { useEffect, useMemo, useState } from 'react';
import type { Lobby, Player } from '../module_bindings/types';
import { AVATARS, SELECTABLE_AVATARS, avatarTypeFor, type AvatarType } from '../game/assets';

/** Where the player goes after login: a room by code, or their own solo room. */
export type RoomChoice = { kind: 'code'; code: string } | { kind: 'solo' };

interface LoginScreenProps {
  connected: boolean;
  ready: boolean;
  players: readonly Player[];
  lobbies: readonly Lobby[];
  me: Player | null;
  /** Pre-filled room code, e.g. from ?lobby= */
  initialCode: string;
  onJoin: (name: string, avatarType: AvatarType, room: RoomChoice) => Promise<void>;
}

// Server-assigned placeholder names aren't worth pre-filling.
const isPlaceholderName = (name: string) => /^Trader_[0-9a-f]{6}$/.test(name);

/** Shown before Phaser boots: pick a name and an avatar, then a room. */
export function LoginScreen({ connected, ready, players, lobbies, me, initialCode, onJoin }: LoginScreenProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode);
  const [avatar, setAvatar] = useState<AvatarType>('trader');
  const [prefilled, setPrefilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Returning players get their previous name and avatar.
  useEffect(() => {
    if (prefilled || !me) return;
    if (!isPlaceholderName(me.username)) setName(me.username);
    const previous = avatarTypeFor(me.avatarType);
    setAvatar(AVATARS[previous].selectable ? previous : 'trader');
    setPrefilled(true);
  }, [me, prefilled]);

  const trimmed = name.trim();
  const myHex = me?.identity.toHexString();
  const cleanCode = code.trim().toUpperCase();

  // Names only need to be unique among the players on a class room's floor
  // right now (matches the server); solo never checks.
  const classRoom = useMemo(() => lobbies.find(l => l.code === cleanCode && !l.isSolo) ?? null, [lobbies, cleanCode]);
  const takenInRoom = useMemo(() => {
    if (!classRoom) return false;
    const lower = trimmed.toLowerCase();
    return players.some(
      p =>
        p.identity.toHexString() !== myHex &&
        p.lobbyId === classRoom.lobbyId &&
        p.onFloor &&
        p.username.toLowerCase() === lower
    );
  }, [players, classRoom, trimmed, myHex]);

  const lengthOk = trimmed.length >= 2 && trimmed.length <= 24;
  const status = !trimmed
    ? ''
    : !lengthOk
      ? '2-24 characters'
      : takenInRoom
        ? `Name already taken in ${classRoom!.code}`
        : 'Available';
  const canJoin = connected && ready && lengthOk && !busy;

  const enter = async (room: RoomChoice) => {
    if (!canJoin) return;
    setBusy(true);
    setError('');
    try {
      await onJoin(trimmed, avatar, room);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cleanCode && !takenInRoom) void enter({ kind: 'code', code: cleanCode });
  };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#4f8a3c] bg-[radial-gradient(#5e9c47_2px,transparent_2px)] bg-[size:24px_24px]">
      <div className="flex min-h-full flex-col items-center justify-center gap-6 p-4">
        <div className="text-center">
          <div className="logo-text text-[34px] leading-[1.15] sm:text-[44px]">
            SERIOUS TRADING
          </div>
          <div className="logo-text mt-3 text-[10px]">— THE TRADING FLOOR —</div>
        </div>

        <form onSubmit={submit} className="panel pop-in w-full max-w-xl space-y-5 p-5 text-[10px]">
          <div>
            <div className="mb-3 text-slate-500">CHOOSE YOUR TRADER</div>
            <div className="grid grid-cols-2 gap-3" role="radiogroup">
              {SELECTABLE_AVATARS.map(type => (
                <AvatarCard key={type} type={type} selected={avatar === type} onSelect={() => setAvatar(type)} />
              ))}
            </div>
          </div>

          <label className="block space-y-2">
            <span className="text-slate-500">YOUR NAME ON THE FLOOR</span>
            <input
              autoFocus
              maxLength={24}
              value={name}
              onChange={e => {
                setName(e.target.value);
                setError('');
              }}
              placeholder="e.g. Gordon"
              className="panel-inset w-full px-3 py-3 text-[13px] outline-none focus:bg-white"
            />
            <span className={`block h-3 text-[8px] ${status === 'Available' ? 'text-emerald-700' : 'text-rose-600'}`}>{status}</span>
          </label>

          {error && <div className="border-[3px] border-rose-600 bg-rose-50 p-2 leading-relaxed text-rose-700">{error}</div>}

          {!connected || !ready ? (
            <div className="space-y-2">
              <div className="sign w-full !py-4 text-[13px] opacity-50">Connecting…</div>
              <button
                type="button"
                className="w-full text-center text-[8px] text-slate-500 hover:text-ink underline cursor-pointer"
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
              >
                Clear saved cache & reconnect
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-slate-500">JOIN YOUR CLASS</div>
              <div className="flex items-stretch gap-2">
                <input
                  maxLength={16}
                  value={code}
                  onChange={e => {
                    setCode(e.target.value.toUpperCase());
                    setError('');
                  }}
                  placeholder="ROOM CODE"
                  className="panel-inset w-full px-3 py-3 text-[13px] uppercase outline-none focus:bg-white"
                />
                <button
                  type="submit"
                  disabled={!canJoin || !cleanCode || takenInRoom}
                  className="sign sign-active !px-4 text-[11px] disabled:opacity-50"
                >
                  {busy ? '…' : 'Join with code'}
                </button>
              </div>
              <div className="text-center text-slate-500">— OR —</div>
              <button
                type="button"
                disabled={!canJoin}
                onClick={() => void enter({ kind: 'solo' })}
                className="sign w-full !py-4 text-[13px] disabled:opacity-50"
              >
                {busy ? 'Entering…' : 'Play solo'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

function AvatarCard({ type, selected, onSelect }: { type: AvatarType; selected: boolean; onSelect: () => void }) {
  const [frame, setFrame] = useState(0);
  // The selected trader walks in place.
  useEffect(() => {
    if (!selected) {
      setFrame(0);
      return;
    }
    const t = setInterval(() => setFrame(f => (f + 1) % 4), 140);
    return () => clearInterval(t);
  }, [selected]);

  const base = AVATARS[type].dir;
  const src = selected ? `${base}/walk/south_${frame}.png` : `${base}/idle/south.png`;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`sign !flex-col !gap-3 !px-3 !py-4 ${selected ? 'sign-active' : ''}`}
    >
      <span className="flex h-32 w-32 items-end justify-center">
        <img
          src={src}
          alt=""
          draggable={false}
          className="[image-rendering:pixelated]"
          style={{ height: AVATARS[type].canvas * 3, width: AVATARS[type].canvas * 3 }}
        />
      </span>
      <span className="whitespace-normal text-center text-[8px] leading-[1.6]">{AVATARS[type].label}</span>
    </button>
  );
}
