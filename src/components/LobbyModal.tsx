import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Lobby, Market } from '../module_bindings/types';
import { X, Copy, Check, Users } from 'lucide-react';

interface LobbyModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeLobby: Lobby | null;
  allLobbies: readonly Lobby[];
  markets: readonly Market[];
  onSelectLobby: (lobby: Lobby) => void;
  onCreateLobby: (code: string, title: string, marketId: bigint, initialBalanceDollars: number) => Promise<void> | void;
}

export function LobbyModal({
  isOpen,
  onClose,
  activeLobby,
  allLobbies,
  markets,
  onSelectLobby,
  onCreateLobby,
}: LobbyModalProps) {
  // ESC key listener to exit modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const [activeTab, setActiveTab] = useState<'qr' | 'create' | 'list'>('qr');
  const [copied, setCopied] = useState(false);

  // Create form state
  const [newLobbyCode, setNewLobbyCode] = useState('');
  const [newLobbyTitle, setNewLobbyTitle] = useState('');
  const [selectedMarketId, setSelectedMarketId] = useState<bigint | null>(null);
  const [initialBalance, setInitialBalance] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (markets.length > 0 && selectedMarketId === null) {
      setSelectedMarketId(markets[0].marketId);
    }
  }, [markets, selectedMarketId]);

  if (!isOpen) return null;

  const currentUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?lobby=${activeLobby?.code || 'CAL13'}`
    : '';

  const handleCopyLink = () => {
    if (navigator.clipboard && currentUrl) {
      navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanCode = newLobbyCode.trim().toUpperCase();
    if (!cleanCode) {
      setErrorMsg('Please enter a unique Lobby Code (e.g. CAL13, ROOM1)');
      return;
    }
    if (!selectedMarketId) {
      setErrorMsg('Please select a market contract');
      return;
    }

    try {
      setIsSubmitting(true);
      await onCreateLobby(
        cleanCode,
        newLobbyTitle.trim() || `${cleanCode} Trading Arena`,
        selectedMarketId,
        initialBalance
      );
      setActiveTab('qr');
      setNewLobbyCode('');
      setNewLobbyTitle('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create lobby');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm select-none"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg max-h-[88vh] bg-slate-950 border-2 border-indigo-500/70 rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-slate-900 border-b border-indigo-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" />
            <span className="font-['Press_Start_2P'] text-[11px] text-white tracking-wide">
              MULTIPLAYER LOBBY
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-900/50 text-xs font-mono">
          <button
            onClick={() => setActiveTab('qr')}
            className={`flex-1 py-2.5 text-center font-bold transition border-b-2 ${
              activeTab === 'qr'
                ? 'border-indigo-400 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            JOIN QR CODE
          </button>
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-2.5 text-center font-bold transition border-b-2 ${
              activeTab === 'create'
                ? 'border-indigo-400 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            CREATE LOBBY
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-2.5 text-center font-bold transition border-b-2 ${
              activeTab === 'list'
                ? 'border-indigo-400 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            ALL ROOMS ({allLobbies.length})
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto max-h-[calc(88vh-120px)] space-y-4">
          {activeTab === 'qr' && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div>
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                  Active Lobby Code
                </span>
                <div className="font-['Press_Start_2P'] text-xl text-yellow-400 mt-1 tracking-widest">
                  {activeLobby?.code || 'CAL13'}
                </div>
                <div className="text-xs text-slate-300 mt-0.5">
                  {activeLobby?.title || 'Cal Hacks 13.0 Main Arena'}
                </div>
              </div>

              {/* QR Code Frame */}
              <div className="p-3 bg-white rounded-xl shadow-lg">
                <QRCodeSVG
                  value={currentUrl || 'https://localhost:5173'}
                  size={180}
                  level="M"
                  includeMargin={false}
                />
              </div>

              <div className="w-full space-y-2">
                <p className="text-xs text-slate-400 font-mono">
                  Scan with your smartphone camera or share link to join this trading pit:
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={currentUrl}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-300 select-all"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-mono text-white flex items-center gap-1.5 transition whitespace-nowrap"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'COPIED' : 'COPY'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'create' && (
            <form onSubmit={handleCreate} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block text-slate-300 mb-1">LOBBY CODE (4-8 chars):</label>
                <input
                  type="text"
                  maxLength={10}
                  placeholder="e.g. ROOM1, HACK13"
                  value={newLobbyCode}
                  onChange={e => setNewLobbyCode(e.target.value.toUpperCase())}
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono uppercase focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">ARENA TITLE:</label>
                <input
                  type="text"
                  placeholder="e.g. Professor Smith Economics Pit"
                  value={newLobbyTitle}
                  onChange={e => setNewLobbyTitle(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">MARKET CONTRACT:</label>
                <select
                  value={selectedMarketId?.toString() || ''}
                  onChange={e => setSelectedMarketId(BigInt(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono focus:border-indigo-500 focus:outline-none"
                >
                  {markets.map(m => (
                    <option key={m.marketId.toString()} value={m.marketId.toString()}>
                      {m.question}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 mb-1">
                  DEFAULT STARTING BANKROLL PER PLAYER ($):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={10}
                    max={10000}
                    step={10}
                    value={initialBalance}
                    onChange={e => setInitialBalance(Number(e.target.value))}
                    className="w-32 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono focus:border-indigo-500 focus:outline-none"
                  />
                  <span className="text-slate-400">USD (Default: $100.00)</span>
                </div>
              </div>

              {errorMsg && (
                <div className="p-2 rounded bg-rose-950/80 border border-rose-700 text-rose-300">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-['Press_Start_2P'] text-[10px] rounded transition disabled:opacity-50"
              >
                {isSubmitting ? 'CREATING...' : 'LAUNCH LOBBY'}
              </button>
            </form>
          )}

          {activeTab === 'list' && (
            <div className="space-y-2">
              {allLobbies.map(l => {
                const isSelected = activeLobby?.lobbyId === l.lobbyId;
                return (
                  <div
                    key={l.lobbyId.toString()}
                    onClick={() => {
                      onSelectLobby(l);
                      setActiveTab('qr');
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition flex items-center justify-between text-xs font-mono ${
                      isSelected
                        ? 'bg-indigo-950/60 border-indigo-500 text-white'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-yellow-400">{l.code}</div>
                      <div className="text-[11px] text-slate-400">{l.title}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-emerald-400 font-bold">
                        ${(Number(l.initialBalance) / 100).toFixed(0)} Initial
                      </div>
                      {isSelected && (
                        <span className="text-[10px] text-indigo-300 uppercase">ACTIVE</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
