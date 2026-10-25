import { useEffect, useMemo, useState } from 'react';
import type { Player } from '../module_bindings/types';
import { AVATARS, SELECTABLE_AVATARS, avatarTypeFor, type AvatarType } from '../game/assets';

interface LoginScreenProps {
  connected: boolean;
  ready: boolean;
  players: readonly Player[];
  me: Player | null;
  onJoin: (name: string, avatarType: AvatarType) => Promise<void>;
}

// Server-assigned placeholder names aren't worth pre-filling.
const isPlaceholderName = (name: string) => /^Trader_[0-9a-f]{6}$/.test(name);

/** Shown before Phaser boots: pick a unique name and an avatar. */
export function LoginScreen({ connected, ready, players, me, onJoin }: LoginScreenProps) {
  const [name, setName] = useState('');
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
  const taken = useMemo(() => {
    const lower = trimmed.toLowerCase();
    return players.some(p => p.identity.toHexString() !== myHex && p.username.toLowerCase() === lower);
  }, [players, trimmed, myHex]);

  const lengthOk = trimmed.length >= 2 && trimmed.length <= 24;
  const status = !trimmed ? '' : !lengthOk ? '2-24 characters' : taken ? 'Name already taken' : 'Available';
  const canJoin = connected && ready && lengthOk && !taken && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canJoin) return;
    setBusy(true);
    setError('');
    try {
      await onJoin(trimmed, avatar);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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

          <button type="submit" disabled={!canJoin} className="sign sign-active w-full !py-4 text-[13px] disabled:opacity-50">
            {!connected || !ready ? 'Connecting…' : busy ? 'Entering…' : 'Enter the Floor'}
          </button>
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
