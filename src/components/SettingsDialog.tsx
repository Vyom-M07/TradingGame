import { useState } from 'react';
import { PixelDialog } from './Dialogs';
import type { BotConfig, BotTrader, Player } from '../module_bindings/types';

export const BOT_SPEEDS = [600, 1000, 2000] as const;

/** [BOTS] — put the robot traders on the floor when playing solo. */
export function SettingsDialog({
  isOpen,
  onClose,
  botConfig,
  bots,
  whale,
  onSetBots,
}: {
  isOpen: boolean;
  onClose: () => void;
  botConfig: BotConfig | null;
  bots: readonly BotTrader[];
  whale: Player | null;
  onSetBots: (enabled: boolean, tickMs: number) => Promise<unknown>;
}) {
  const [error, setError] = useState('');
  const enabled = !!botConfig?.ammEnabled;
  const tickMs = botConfig?.tickMs ?? 1000;
  const lockedByInstructor = enabled && botConfig?.controlledBy === 'INSTRUCTOR';
  const whaleOnline = !!whale?.onFloor && botConfig?.whaleEnabled !== false;

  const apply = async (nextEnabled: boolean, nextTickMs: number) => {
    setError('');
    try {
      await onSetBots(nextEnabled, nextTickMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <PixelDialog isOpen={isOpen} onClose={onClose} title="Bots" accent="bg-sky-400" width="max-w-md">
      <div className="space-y-4 text-[10px] leading-[1.8]">
        <div className="panel-inset space-y-3 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div>ROBOT TRADERS</div>
              <div className="text-[8px] text-slate-500">Makers quote, snipers pounce, noise bots trade</div>
            </div>
            <button
              className={`sign text-[9px] ${enabled ? 'sign-active' : ''}`}
              disabled={lockedByInstructor}
              onClick={() => void apply(!enabled, tickMs)}
            >
              {enabled ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span>SPEED</span>
            <div className="flex gap-2">
              {BOT_SPEEDS.map(ms => (
                <button
                  key={ms}
                  className={`sign !px-2 !py-1 text-[9px] ${tickMs === ms ? 'sign-active' : ''}`}
                  disabled={lockedByInstructor}
                  onClick={() => void apply(enabled, ms)}
                >
                  {ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
                </button>
              ))}
            </div>
          </div>

          {enabled && (
            <div className="text-[8px] text-slate-500">
              {bots.length} bots on the floor · {bots.reduce((n, b) => n + b.tradeCount, 0)} trades so far
            </div>
          )}

          {lockedByInstructor && (
            <div className="border-[3px] border-sky-600 bg-sky-50 p-2 text-[9px] text-sky-800">
              Your instructor is running the bots for the whole class.
            </div>
          )}
          {error && <div className="border-[3px] border-rose-600 bg-rose-50 p-2 text-[9px] text-rose-700">{error}</div>}
        </div>

        <div className="panel-inset flex items-center justify-between gap-3 p-3">
          <div>
            <div>THE WHALE [AI]</div>
            <div className="text-[8px] text-slate-500">
              {whaleOnline ? 'Trading on the floor' : 'Start it with npm run whale'}
            </div>
          </div>
          <span className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 ${whaleOnline ? 'bg-amber-400' : 'bg-slate-400'} shadow-[0_0_0_2px_#1d1b2a]`}
            />
            {whaleOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>

        <p className="text-[9px] text-slate-500">
          Bots stand around the open pits and trade on the house's account. Everyone on the floor sees them.
        </p>
      </div>
    </PixelDialog>
  );
}
