import { useEffect, useMemo } from 'react';
import type { LeaderboardEntry } from '../module_bindings/types';
import { AVATARS, type AvatarType } from '../game/assets';

export const formatCents = (cents: bigint | number) =>
  `$${(Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function rankLeaderboard(rows: readonly LeaderboardEntry[]) {
  return [...rows].sort((a, b) =>
    a.netWorthCents === b.netWorthCents ? a.username.localeCompare(b.username) : a.netWorthCents > b.netWorthCents ? -1 : 1
  );
}

/** Red breaking-news strip pushed by the instructor's broadcast_alert. */
export function BreakingBanner({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 9000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="pointer-events-auto fixed inset-x-0 top-[22%] z-40 flex justify-center px-4" onClick={onDone}>
      <div className="pop-in flex w-[min(820px,96vw)] items-stretch border-4 border-ink bg-rose-600 text-white shadow-[8px_8px_0_rgba(0,0,0,0.4)]">
        <div className="flex items-center bg-ink px-3 text-[10px] text-rose-300">
          <span className="animate-pulse">BREAKING</span>
        </div>
        <div className="flex-1 px-4 py-4 text-[13px] leading-[1.7]">{message}</div>
      </div>
    </div>
  );
}

const PODIUM = [
  { place: 2, height: 'h-24', color: 'bg-slate-300', medal: 'text-slate-500' },
  { place: 1, height: 'h-36', color: 'bg-amber-300', medal: 'text-amber-600' },
  { place: 3, height: 'h-16', color: 'bg-orange-300', medal: 'text-orange-700' },
];

/** Final standings shown to everyone once the instructor ends the round. */
export function LeaderboardReveal({
  rows,
  myIdentityHex,
  avatarFor,
  hidden,
  onToggleHidden,
}: {
  rows: readonly LeaderboardEntry[];
  myIdentityHex: string;
  avatarFor: (identityHex: string) => AvatarType;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const ranked = useMemo(() => rankLeaderboard(rows), [rows]);
  const myIndex = ranked.findIndex(r => r.identity.toHexString() === myIdentityHex);

  if (hidden) {
    return (
      <div className="pointer-events-auto fixed left-1/2 top-[110px] z-40 -translate-x-1/2">
        <button className="sign sign-active sign-glow" onClick={onToggleHidden}>
          Show Final Results
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
      <div className="panel pop-in flex max-h-[92vh] w-full max-w-2xl flex-col">
        <div className="border-b-4 border-ink px-5 py-4 text-center">
          <div className="text-[9px] text-slate-500">THE BELL HAS RUNG</div>
          <div className="mt-3 text-[20px]">ROUND OVER</div>
          <div className="mt-3 text-[9px] leading-relaxed text-slate-600">Trading is closed. Ranked by total net worth.</div>
        </div>

        <div className="overflow-y-auto px-5 pb-5">
          {ranked.length === 0 ? (
            <div className="py-10 text-center text-[10px] text-slate-500">Tallying the books…</div>
          ) : (
            <>
              {/* Podium */}
              <div className="mt-6 flex items-end justify-center gap-3">
                {PODIUM.map(slot => {
                  const row = ranked[slot.place - 1];
                  return (
                    <div key={slot.place} className="flex w-[30%] max-w-[170px] flex-col items-center">
                      {row ? (
                        <>
                          <img
                            src={`${AVATARS[avatarFor(row.identity.toHexString())].dir}/idle/south.png`}
                            alt=""
                            className={`h-16 w-16 object-contain object-bottom [image-rendering:pixelated] ${slot.place === 1 ? 'animate-bounce' : ''}`}
                          />
                          <div className="mt-2 w-full truncate text-center text-[9px]" title={row.username}>
                            {row.username}
                          </div>
                          <div className="mt-2 text-[10px] text-emerald-700">{formatCents(row.netWorthCents)}</div>
                        </>
                      ) : (
                        <div className="h-16" />
                      )}
                      <div
                        className={`mt-3 flex w-full ${slot.height} items-start justify-center border-4 border-ink pt-3 ${slot.color} shadow-[inset_-4px_-4px_0_rgba(0,0,0,0.15)]`}
                      >
                        <span className={`text-[22px] ${slot.medal}`}>{slot.place}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Everyone else */}
              {ranked.length > 3 && (
                <div className="panel-inset mt-6 divide-y-2 divide-slate-300">
                  {ranked.slice(3, 10).map((r, i) => (
                    <div key={r.identity.toHexString()} className="flex items-center justify-between px-3 py-2 text-[9px]">
                      <span>
                        <span className="text-slate-500">#{i + 4}</span> {r.username}
                      </span>
                      <span className="text-emerald-700">{formatCents(r.netWorthCents)}</span>
                    </div>
                  ))}
                </div>
              )}

              {myIndex >= 0 && (
                <div className="mt-4 flex items-center justify-between border-4 border-ink bg-signblue px-3 py-3 text-[10px]">
                  <span>YOU FINISHED #{myIndex + 1}</span>
                  <span>{formatCents(ranked[myIndex].netWorthCents)}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t-4 border-ink px-5 py-3 text-right">
          <button className="sign text-[10px]" onClick={onToggleHidden}>
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}
