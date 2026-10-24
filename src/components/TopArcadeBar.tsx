import { Player, Lobby } from '../module_bindings/types';
import { QrCode, Bot, User, Shield, Compass, Sparkles } from 'lucide-react';

interface TopArcadeBarProps {
  connected: boolean;
  player: Player | null;
  activeLobby: Lobby | null;
  isInstructor: boolean;
  isInsidePit: boolean;
  isAutoBotRunning: boolean;
  botSpeedMs: number;
  onToggleAutoBot: () => void;
  onOpenLobbyModal: () => void;
  onOpenInstructorModal: () => void;
  onOpenTradingPit: () => void;
  onChangeUsername: (name: string) => void;
}

export function TopArcadeBar({
  connected,
  player,
  activeLobby,
  isInstructor,
  isInsidePit,
  isAutoBotRunning,
  onToggleAutoBot,
  onOpenLobbyModal,
  onOpenInstructorModal,
  onOpenTradingPit,
  onChangeUsername,
}: TopArcadeBarProps) {
  const cashDollars = ((Number(player?.cashBalance ?? 0n)) / 100).toFixed(2);

  return (
    <header className="w-full bg-slate-950/95 border-b border-indigo-500/40 px-3 sm:px-6 py-2.5 backdrop-blur-md sticky top-0 z-40 select-none">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Left: Arcade Logo & Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-indigo-500 rotate-45 animate-pulse" />
            <h1 className="font-['Press_Start_2P'] text-[12px] sm:text-[14px] text-white tracking-wider">
              OPEN OUTCRY
            </h1>
          </div>
          <span className="hidden sm:inline-block px-2 py-0.5 text-[8px] font-['Press_Start_2P'] bg-indigo-950 text-indigo-300 border border-indigo-700/60 rounded">
            CAL HACKS 13.0
          </span>
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span className="text-[10px] text-slate-400 uppercase">
              {connected ? 'LIVE' : 'CONNECTING...'}
            </span>
          </div>
        </div>

        {/* Center: Lobby Badge & Pit Proximity Alert */}
        <div className="flex items-center gap-2">
          {/* Lobby Badge with QR trigger */}
          <button
            onClick={onOpenLobbyModal}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:border-indigo-400 text-xs font-mono text-slate-200 transition group"
            title="View Lobby & QR Code"
          >
            <QrCode className="w-3.5 h-3.5 text-indigo-400 group-hover:scale-110 transition" />
            <span>LOBBY:</span>
            <span className="font-bold text-yellow-400">
              {activeLobby?.code || 'CAL13'}
            </span>
          </button>

          {/* Pit Status Indicator */}
          {isInsidePit ? (
            <button
              onClick={onOpenTradingPit}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-500 text-[10px] font-['Press_Start_2P'] text-emerald-400 animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.3)] transition"
              title="Open Trading Pit Overlay"
            >
              <Sparkles className="w-3 h-3 text-emerald-400" />
              IN PIT [E]
            </button>
          ) : (
            <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900/60 border border-slate-800 text-[10px] font-mono text-slate-400">
              <Compass className="w-3 h-3 text-slate-500" />
              <span>OUTSIDE PIT (WALK TO CENTER)</span>
            </div>
          )}
        </div>

        {/* Right: Cash, Bots & Instructor controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Auto-Bot Toggle */}
          <button
            onClick={onToggleAutoBot}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border transition ${
              isAutoBotRunning
                ? 'bg-amber-950/80 border-amber-500 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle autonomous market-making bot orders"
          >
            <Bot className={`w-3.5 h-3.5 ${isAutoBotRunning ? 'text-amber-400 animate-spin' : ''}`} />
            <span className="hidden sm:inline">BOT AMM:</span>
            <span className="font-bold">{isAutoBotRunning ? 'ON' : 'OFF'}</span>
          </button>

          {/* Instructor Controls button */}
          {isInstructor && (
            <button
              onClick={onOpenInstructorModal}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-purple-950/80 border border-purple-500 text-purple-300 hover:bg-purple-900 text-xs font-mono transition"
              title="Instructor Classroom & Market Resolution Tools"
            >
              <Shield className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">INSTRUCTOR</span>
            </button>
          )}

          {/* Cash Balance Display */}
          <div className="px-3 py-1 bg-slate-900 border border-indigo-500/50 rounded font-mono text-xs flex items-center gap-1.5">
            <span className="text-slate-400 text-[10px]">BANKROLL:</span>
            <span className="font-bold text-emerald-400">${cashDollars}</span>
          </div>

          {/* Username / Profile */}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-900/80 border border-slate-800 rounded text-xs font-mono">
            <User className="w-3.5 h-3.5 text-indigo-400" />
            <input
              type="text"
              defaultValue={player?.username || 'Trader'}
              onBlur={e => {
                const val = e.target.value.trim();
                if (val && val !== player?.username) onChangeUsername(val);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="w-16 sm:w-20 bg-transparent text-slate-200 focus:outline-none focus:text-white"
              title="Click to rename"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
