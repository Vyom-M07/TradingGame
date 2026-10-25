import { useState } from 'react';
import { PixelDialog } from './Dialogs';
import type { BotTrader, Lobby } from '../module_bindings/types';

export const BOT_SPEEDS = [600, 1000, 2000] as const;

/** Models the whale can run on, keyed by lobby.whaleModel. */
export const WHALE_MODEL_LABELS: Record<string, string> = {
  claude: 'Claude Haiku',
  gemini: 'Gemini 3.8 Flash',
};

/** [BOTS] — the robot traders and the AI whale in the room you're in. */
export function SettingsDialog({
  isOpen,
  onClose,
  lobby,
  canControl,
  bots,
  whaleRunning,
  onSetBots,
  onSetWhaleModel,
}: {
  isOpen: boolean;
  onClose: () => void;
  lobby: Lobby | null;
  /** Solo owners run their own room's bots; instructors run class rooms from the dashboard. */
  canControl: boolean;
  bots: readonly BotTrader[];
  /** The whale sidecar (npm run whale) is connected. */
  whaleRunning: boolean;
  onSetBots: (botsEnabled: boolean, whaleEnabled: boolean, tickMs: number) => Promise<unknown>;
  onSetWhaleModel: (model: string) => Promise<unknown>;
}) {
  const [error, setError] = useState('');
  const enabled = !!lobby?.botsEnabled;
  const whaleOn = !!lobby?.whaleEnabled;
  const tickMs = lobby?.botTickMs ?? 1000;
  const locked = !canControl || !lobby;

  const attempt = async (call: () => Promise<unknown>) => {
    setError('');
    try {
      await call();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const apply = (nextBots: boolean, nextWhale: boolean, nextTickMs: number) =>
    attempt(() => onSetBots(nextBots, nextWhale, nextTickMs));

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
              disabled={locked}
              onClick={() => void apply(!enabled, whaleOn, tickMs)}
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
                  disabled={locked}
                  onClick={() => void apply(enabled, whaleOn, ms)}
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
        </div>

        <div className="panel-inset space-y-3 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div>WHALE AI</div>
              <div className="text-[8px] text-slate-500">
                {!whaleRunning ? 'Offline: start it with npm run whale' : whaleOn ? 'Trading in this room' : 'Online, not in this room'}
              </div>
            </div>
            <button
              className={`sign text-[9px] disabled:opacity-50 ${whaleOn ? 'sign-active' : ''}`}
              disabled={locked || (!whaleOn && !whaleRunning)}
              onClick={() => void apply(enabled, !whaleOn, tickMs)}
            >
              {whaleOn ? 'ON' : 'OFF'}
            </button>
          </div>

          {whaleOn && lobby && (
            <label className="flex items-center justify-between gap-3">
              <span>MODEL</span>
              <select
                className="panel-inset px-2 py-1.5 text-[9px] outline-none disabled:opacity-50"
                disabled={locked}
                value={lobby.whaleModel}
                onChange={e => {
                  const model = e.target.value;
                  void attempt(() => onSetWhaleModel(model));
                }}
              >
                {Object.entries(WHALE_MODEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {locked && lobby && (
          <div className="border-[3px] border-sky-600 bg-sky-50 p-2 text-[9px] text-sky-800">
            Your instructor runs the bots for this room.
          </div>
        )}
        {error && <div className="border-[3px] border-rose-600 bg-rose-50 p-2 text-[9px] text-rose-700">{error}</div>}

        <p className="text-[9px] text-slate-500">
          Bots stand around the open pits and trade on the house's account. Everyone in this room sees them.
        </p>
      </div>
    </PixelDialog>
  );
}
