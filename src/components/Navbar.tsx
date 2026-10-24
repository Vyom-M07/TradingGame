import React, { useState } from 'react';
import { Identity } from 'spacetimedb';
import { Player, Lobby } from '../module_bindings/types';
import { reducers } from '../module_bindings';
import { useReducer } from 'spacetimedb/react';
import { useProfile } from '../main';
import {
  Wallet,
  Activity,
  Bot,
  Play,
  Pause,
  Check,
  Edit2,
  Users,
  QrCode,
  Crown,
} from 'lucide-react';

interface NavbarProps {
  connected: boolean;
  myIdentity: Identity | null;
  player: Player | null;
  activeLobby: Lobby | null;
  isInstructor: boolean;
  onOpenLobbyModal: () => void;
  isAutoBotRunning: boolean;
  onToggleAutoBot: () => void;
  botSpeedMs: number;
  onChangeBotSpeed: (ms: number) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  connected,
  myIdentity,
  player,
  activeLobby,
  isInstructor,
  onOpenLobbyModal,
  isAutoBotRunning,
  onToggleAutoBot,
  botSpeedMs,
  onChangeBotSpeed,
}) => {
  const [editingName, setEditingName] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');

  const { activeProfile, setProfile, availableProfiles } = useProfile();

  const setUsernameReducer = useReducer(reducers.setUsername);

  const handleSaveUsername = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim()) return;
    setUsernameReducer({ username: usernameInput.trim() });
    setEditingName(false);
  };

  const cashDollars = player ? (Number(player.cashBalance) / 100).toFixed(2) : '0.00';
  const identityHex = myIdentity ? myIdentity.toHexString().slice(0, 8) + '...' : 'Unknown';

  return (
    <header className="border-b border-slate-800 bg-slate-900/95 backdrop-blur sticky top-0 z-50 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Subtitle */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Activity className="h-5 w-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                SPACETIME CLOB
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Cal Hacks 13.0
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Deterministic CLOB & Autonomous Market Makers
            </p>
          </div>
        </div>

        {/* Lobby & QR Code Pill */}
        <div className="flex items-center">
          <button
            onClick={onOpenLobbyModal}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-indigo-500/50 transition cursor-pointer group shadow-sm"
          >
            <div className="h-7 w-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center group-hover:scale-105 transition">
              <QrCode className="h-4 w-4" />
            </div>
            <div className="text-left">
              <div className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-1">
                <span>Lobby:</span>
                <strong className="text-white font-mono">{activeLobby?.code || 'CAL13'}</strong>
              </div>
              <div className="flex items-center gap-1">
                {isInstructor ? (
                  <span className="text-[10px] text-amber-400 font-bold flex items-center gap-0.5">
                    <Crown className="h-2.5 w-2.5" />
                    <span>Instructor (You)</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-blue-400 font-semibold">
                    Student Trader
                  </span>
                )}
              </div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-600/30 text-indigo-300 font-bold ml-1 border border-indigo-500/40 group-hover:bg-indigo-600 group-hover:text-white transition">
              QR / Invite
            </span>
          </button>
        </div>

        {/* Multi-Player Demo Account Switcher */}
        <div className="flex items-center gap-2 bg-slate-950/80 px-2.5 py-1.5 rounded-xl border border-slate-800">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Users className="h-3.5 w-3.5 text-indigo-400" />
            <span className="font-semibold text-slate-300">Player:</span>
          </div>
          <div className="flex items-center gap-1">
            {availableProfiles.map(p => (
              <button
                key={p.id}
                onClick={() => setProfile(p.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeProfile === p.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {p.name.replace('Trader ', '')}
              </button>
            ))}
          </div>
        </div>

        {/* Autonomous Bot Engine Controls */}
        <div className="flex items-center gap-2 bg-slate-950/80 px-2.5 py-1.5 rounded-xl border border-slate-800">
          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <Bot className="h-4 w-4 text-emerald-400" />
            <span className="font-semibold text-slate-200">Auto-Bots:</span>
          </div>

          <button
            onClick={onToggleAutoBot}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
              isAutoBotRunning
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
            title="Toggle autonomous optimal market makers and value sniper bots"
          >
            {isAutoBotRunning ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>Running</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                <span>Start Bots</span>
              </>
            )}
          </button>

          {/* Speed Switcher */}
          <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
            {[
              { label: '1.5s', ms: 1500 },
              { label: '600ms', ms: 600 },
              { label: '150ms', ms: 150 },
            ].map(s => (
              <button
                key={s.ms}
                onClick={() => onChangeBotSpeed(s.ms)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                  botSpeedMs === s.ms
                    ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* User Identity, Cash & Faucet */}
        <div className="flex items-center gap-3">
          {/* Connection Status */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              connected
                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30'
                : 'bg-rose-950/40 text-rose-400 border-rose-500/30'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? 'bg-emerald-400 animate-ping' : 'bg-rose-400'
              }`}
            />
            <span>{connected ? 'Live' : 'Connecting'}</span>
          </div>

          {/* Handle */}
          <div className="hidden sm:flex items-center gap-2 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/60 text-xs text-slate-300">
            {editingName ? (
              <form onSubmit={handleSaveUsername} className="flex items-center gap-1">
                <input
                  type="text"
                  value={usernameInput}
                  onChange={e => setUsernameInput(e.target.value)}
                  placeholder="New username"
                  className="bg-slate-900 text-white px-2 py-0.5 rounded text-xs border border-slate-600 focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
                <button type="submit" className="text-emerald-400 hover:text-emerald-300">
                  <Check className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <div
                onClick={() => {
                  setUsernameInput(player?.username || '');
                  setEditingName(true);
                }}
                className="flex items-center gap-1.5 cursor-pointer hover:text-white"
                title="Click to rename"
              >
                <span className="font-semibold text-slate-200">
                  {player?.username || identityHex}
                </span>
                <Edit2 className="h-3 w-3 text-slate-400" />
              </div>
            )}
          </div>

          {/* Cash Balance */}
          <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700/80 px-3 py-1.5 rounded-lg shadow-inner">
            <Wallet className="h-4 w-4 text-emerald-400" />
            <div className="flex flex-col text-right">
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider leading-none">
                Cash
              </span>
              <span className="text-sm font-mono font-bold text-emerald-400">
                ${cashDollars}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
