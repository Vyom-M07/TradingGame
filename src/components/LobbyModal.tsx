import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Lobby, Market } from '../module_bindings/types';
import { Identity } from 'spacetimedb';
import { reducers } from '../module_bindings';
import { useReducer } from 'spacetimedb/react';
import {
  QrCode,
  Copy,
  Check,
  Crown,
  User,
  X,
  PlusCircle,
  LogIn,
  ExternalLink,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';

interface LobbyModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeLobby: Lobby | null;
  allLobbies: readonly Lobby[];
  markets: readonly Market[];
  myIdentity: Identity | null;
  onSelectLobby: (lobby: Lobby) => void;
}

export const LobbyModal: React.FC<LobbyModalProps> = ({
  isOpen,
  onClose,
  activeLobby,
  allLobbies,
  markets,
  myIdentity,
  onSelectLobby,
}) => {
  const [tab, setTab] = useState<'invite' | 'create' | 'switch'>('invite');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [startingBankrollDollars, setStartingBankrollDollars] = useState<number>(100);
  const [selectedMarketId, setSelectedMarketId] = useState<string>(
    markets.length > 0 ? markets[0].marketId.toString() : '0'
  );
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const createLobbyReducer = useReducer(reducers.createLobby);
  const resetLobbyBalancesReducer = useReducer(reducers.resetLobbyBalances);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const myHex = myIdentity ? myIdentity.toHexString() : '';
  const isInstructor = activeLobby
    ? activeLobby.instructor.toHexString() === myHex ||
      activeLobby.instructor.toHexString().replace(/0/g, '') === ''
    : false;

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const joinUrl = activeLobby ? `${currentOrigin}/?lobby=${activeLobby.code}` : currentOrigin;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(joinUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyCode = () => {
    if (!activeLobby) return;
    navigator.clipboard.writeText(activeLobby.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const code = newCode.trim().toUpperCase();
    if (code.length < 3 || code.length > 16) {
      setErrorMsg('Lobby code must be between 3 and 16 characters.');
      return;
    }
    const mId = BigInt(selectedMarketId);
    const initialCents = BigInt(Math.max(1, Math.min(100000, startingBankrollDollars))) * 100n;

    try {
      createLobbyReducer({
        code,
        title: newTitle.trim() || `Arena ${code}`,
        marketId: mId,
        initialBalance: initialCents,
      });

      setNewCode('');
      setNewTitle('');
      setTab('invite');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create lobby');
    }
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const code = joinCodeInput.trim().toUpperCase();
    const found = allLobbies.find(l => l.code.toUpperCase() === code);
    if (!found) {
      setErrorMsg(`No active lobby found with code '${code}'. Check code or create a new one.`);
      return;
    }
    onSelectLobby(found);
    setTab('invite');
    setJoinCodeInput('');
  };

  const handleResetBalances = () => {
    if (!activeLobby) return;
    try {
      resetLobbyBalancesReducer({ code: activeLobby.code });
      setResetMsg(`Reset all student balances back to $${(Number(activeLobby.initialBalance || 10000n) / 100).toFixed(0)}`);
      setTimeout(() => setResetMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to reset balances');
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] my-auto"
      >
        {/* Modal Header (Fixed at top) */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 sm:px-6 py-3.5 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center flex-shrink-0">
              <QrCode className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Multiplayer Arena & QR Lobby
              </h2>
              <p className="text-[11px] text-slate-400">
                Join or invite judges and students to trade in real-time
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs (Fixed below header) */}
        <div className="flex-shrink-0 flex border-b border-slate-800 bg-slate-950/40 px-5 sm:px-6 pt-2.5 gap-2">
          <button
            onClick={() => setTab('invite')}
            className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 cursor-pointer flex items-center gap-1.5 ${
              tab === 'invite'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="h-3.5 w-3.5" />
            <span>Invite & QR Code</span>
          </button>

          <button
            onClick={() => setTab('create')}
            className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 cursor-pointer flex items-center gap-1.5 ${
              tab === 'create'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlusCircle className="h-3.5 w-3.5" />
            <span>Create Lobby</span>
          </button>

          <button
            onClick={() => setTab('switch')}
            className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 cursor-pointer flex items-center gap-1.5 ${
              tab === 'switch'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>Switch / Join Code</span>
          </button>
        </div>

        {/* Tab Content (Scrolls cleanly if viewport is constrained) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
          {errorMsg && (
            <div className="p-3 bg-rose-950/50 border border-rose-500/40 rounded-xl text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          {resetMsg && (
            <div className="p-3 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-xs text-emerald-300">
              {resetMsg}
            </div>
          )}

          {/* TAB 1: INVITE & QR CODE */}
          {tab === 'invite' && (
            <div className="space-y-4">
              {activeLobby ? (
                <>
                  {/* Current Lobby Info Card */}
                  <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        Active Lobby
                      </div>
                      <div className="text-xl font-mono font-black text-white tracking-wide">
                        {activeLobby.code}
                      </div>
                      <div className="text-xs text-slate-300 font-medium truncate max-w-[220px]">
                        {activeLobby.title}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Initial Cash: <strong className="text-emerald-400">${(Number(activeLobby.initialBalance || 10000n) / 100).toFixed(2)}</strong>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        Your Permission
                      </div>
                      {isInstructor ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          <Crown className="h-3 w-3" />
                          <span>Instructor</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                          <User className="h-3 w-3" />
                          <span>Student Trader</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* QR Code Container */}
                  <div className="flex flex-col items-center justify-center p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2.5">
                    <div className="p-2.5 bg-white rounded-xl shadow-xl">
                      <QRCodeSVG
                        value={joinUrl}
                        size={160}
                        level="H"
                        includeMargin={false}
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 text-center max-w-xs leading-relaxed">
                      Point phone camera at QR code or open URL to join this trading room
                    </p>
                  </div>

                  {/* Link / Code Quick Copy */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-xs font-mono text-slate-300 truncate">
                        {joinUrl}
                      </div>
                      <button
                        onClick={handleCopyLink}
                        className="py-2 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-indigo-600/30 flex-shrink-0"
                      >
                        {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                      <span>Lobby Code: <strong className="font-mono text-white">{activeLobby.code}</strong></span>
                      <button
                        onClick={handleCopyCode}
                        className="text-indigo-400 hover:text-indigo-300 cursor-pointer flex items-center gap-1"
                      >
                        {copiedCode ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Instructor Action: Reset Balances */}
                  {isInstructor && (
                    <div className="flex items-center justify-between p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs">
                      <span className="text-slate-400">Restart round with starting cash:</span>
                      <button
                        type="button"
                        onClick={handleResetBalances}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition border border-slate-700"
                      >
                        <RotateCcw className="h-3 w-3 text-emerald-400" />
                        <span>Reset All to ${(Number(activeLobby.initialBalance || 10000n) / 100).toFixed(0)}</span>
                      </button>
                    </div>
                  )}

                  {/* RBAC Explanatory Note */}
                  <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl text-[11px] text-slate-400 space-y-1">
                    <div className="flex items-center gap-1 text-slate-300 font-semibold">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Role-Based Access Enforcement (RBAC)</span>
                    </div>
                    <p className="leading-relaxed">
                      {isInstructor
                        ? 'You created this lobby: you have exclusive permission to reveal clues, resolve, and reset.'
                        : 'You are a student trader: all trading features are live; market resolution is reserved for the instructor.'}
                    </p>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 space-y-3">
                  <p className="text-sm text-slate-400">No active lobby selected.</p>
                  <button
                    onClick={() => setTab('create')}
                    className="py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer"
                  >
                    Create Your First Lobby
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CREATE LOBBY */}
          {tab === 'create' && (
            <form onSubmit={handleCreate} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Lobby Code (e.g. CAL13, HACKS, ROOM1)
                </label>
                <input
                  type="text"
                  value={newCode}
                  onChange={e => setNewCode(e.target.value.toUpperCase())}
                  placeholder="CAL13"
                  maxLength={16}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-indigo-500 uppercase"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Lobby Title / Class Name
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Cal Hacks 13.0 Main Stage Arena"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Initial Starting Balance Configuration */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <label className="font-semibold text-slate-300">
                    Default Initial Cash Balance Per Player
                  </label>
                  <span className="font-mono text-emerald-400 font-bold">
                    ${startingBankrollDollars.toFixed(2)}
                  </span>
                </div>
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={startingBankrollDollars}
                  onChange={e => setStartingBankrollDollars(Math.max(1, Number(e.target.value)))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
                />
                <div className="flex items-center gap-1.5 pt-0.5">
                  {[50, 100, 250, 500, 1000].map(val => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setStartingBankrollDollars(val)}
                      className={`flex-1 py-1 text-[11px] font-mono rounded-lg border transition cursor-pointer ${
                        startingBankrollDollars === val
                          ? 'bg-emerald-600 text-white border-emerald-500 font-bold'
                          : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                      }`}
                    >
                      ${val}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Target Prediction Market
                </label>
                <select
                  value={selectedMarketId}
                  onChange={e => setSelectedMarketId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {markets.map(m => (
                    <option key={m.marketId.toString()} value={m.marketId.toString()}>
                      [{m.category}] {m.question}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl text-[11px] text-amber-200/90 leading-relaxed">
                <strong>Instructor Rights:</strong> Creating this lobby gives you exclusive room host controls. Only you will be able to reveal clue cards and resolve the market.
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-indigo-600/30"
              >
                Create Lobby as Instructor
              </button>
            </form>
          )}

          {/* TAB 3: SWITCH / JOIN CODE */}
          {tab === 'switch' && (
            <div className="space-y-4">
              <form onSubmit={handleJoinByCode} className="space-y-3">
                <label className="text-xs font-semibold text-slate-300">
                  Enter 4–16 Character Lobby Code
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={joinCodeInput}
                    onChange={e => setJoinCodeInput(e.target.value.toUpperCase())}
                    placeholder="CAL13"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm font-mono text-white focus:outline-none focus:border-indigo-500 uppercase"
                  />
                  <button
                    type="submit"
                    className="py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer"
                  >
                    Join
                  </button>
                </div>
              </form>

              {allLobbies.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Discovered Active Lobbies ({allLobbies.length})
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {allLobbies.map(l => (
                      <div
                        key={l.lobbyId.toString()}
                        onClick={() => {
                          onSelectLobby(l);
                          setTab('invite');
                        }}
                        className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                          activeLobby?.lobbyId === l.lobbyId
                            ? 'bg-indigo-950/40 border-indigo-500/50 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-mono font-bold text-sm text-indigo-300">
                            {l.code}
                          </div>
                          <div className="text-xs text-slate-400">{l.title}</div>
                          <div className="text-[10px] text-emerald-400 font-mono">
                            Starts with: ${(Number(l.initialBalance || 10000n) / 100).toFixed(0)}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {l.instructor.toHexString() === myHex && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">
                              Your Lobby
                            </span>
                          )}
                          <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
