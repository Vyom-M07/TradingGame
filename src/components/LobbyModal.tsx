import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Lobby, Market } from '../module_bindings/types';
import { PixelDialog } from './Dialogs';

interface LobbyModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeLobby: Lobby | null;
  allLobbies: readonly Lobby[];
  markets: readonly Market[];
  onSelectLobby: (lobby: Lobby) => void;
  /** Lobby creation is instructor-only; omit to hide the Create tab. */
  onCreateLobby?: (code: string, title: string, marketId: bigint, initialBalanceDollars: number) => Promise<void> | void;
}

const inputCls = 'panel-inset w-full px-3 py-2.5 text-[10px] outline-none focus:bg-white';

export function LobbyModal({
  isOpen,
  onClose,
  activeLobby,
  allLobbies,
  markets,
  onSelectLobby,
  onCreateLobby,
}: LobbyModalProps) {
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
      setErrorMsg('Enter a lobby code (e.g. CAL13, ROOM1)');
      return;
    }
    if (!selectedMarketId) {
      setErrorMsg('Pick a market contract');
      return;
    }
    if (!onCreateLobby) return;

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

  const tabs: [typeof activeTab, string][] = [
    ['qr', 'Invite'],
    ...(onCreateLobby ? [['create', 'Create'] as [typeof activeTab, string]] : []),
    ['list', `Rooms (${allLobbies.length})`],
  ];

  return (
    <PixelDialog isOpen={isOpen} onClose={onClose} title="Lobby">
      <div className="mb-4 flex gap-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`sign flex-1 !px-2 text-[10px] ${activeTab === id ? 'sign-active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'qr' && (
        <div className="flex flex-col items-center space-y-4 text-center">
          <div>
            <div className="text-[9px] text-slate-500">ROOM CODE</div>
            <div className="mt-2 text-[24px] tracking-widest text-amber-600">{activeLobby?.code || 'CAL13'}</div>
            <div className="mt-2 text-[9px] leading-relaxed">{activeLobby?.title || 'Cal Hacks 13.0 Main Arena'}</div>
          </div>

          <div className="panel-inset bg-white p-3">
            <QRCodeSVG value={currentUrl || 'https://localhost:5173'} size={180} level="M" includeMargin={false} />
          </div>

          <div className="w-full space-y-2">
            <p className="text-[9px] leading-relaxed text-slate-600">Scan with a phone camera or share the link:</p>
            <div className="flex items-stretch gap-2">
              <input type="text" readOnly value={currentUrl} className={`${inputCls} select-all !text-[8px]`} />
              <button onClick={handleCopyLink} className="sign !px-3 text-[10px]">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'create' && (
        <form onSubmit={handleCreate} className="space-y-4 text-[9px]">
          <label className="block space-y-2">
            <span>LOBBY CODE</span>
            <input
              type="text"
              maxLength={10}
              placeholder="ROOM1"
              value={newLobbyCode}
              onChange={e => setNewLobbyCode(e.target.value.toUpperCase())}
              required
              className={`${inputCls} uppercase`}
            />
          </label>

          <label className="block space-y-2">
            <span>ARENA TITLE</span>
            <input
              type="text"
              placeholder="Econ 101 Trading Pit"
              value={newLobbyTitle}
              onChange={e => setNewLobbyTitle(e.target.value)}
              className={inputCls}
            />
          </label>

          <label className="block space-y-2">
            <span>MARKET</span>
            <select
              value={selectedMarketId?.toString() || ''}
              onChange={e => setSelectedMarketId(BigInt(e.target.value))}
              className={inputCls}
            >
              {markets.map(m => (
                <option key={m.marketId.toString()} value={m.marketId.toString()}>
                  {m.question}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span>STARTING CASH PER PLAYER ($)</span>
            <input
              type="number"
              min={10}
              max={10000}
              step={10}
              value={initialBalance}
              onChange={e => setInitialBalance(Number(e.target.value))}
              className={`${inputCls} !w-40`}
            />
          </label>

          {errorMsg && <div className="border-[3px] border-rose-600 bg-rose-50 p-2 text-rose-700">{errorMsg}</div>}

          <button type="submit" disabled={isSubmitting} className="sign sign-active w-full disabled:opacity-50">
            {isSubmitting ? 'Creating...' : 'Launch Lobby'}
          </button>
        </form>
      )}

      {activeTab === 'list' && (
        <div className="space-y-3">
          {allLobbies.map(l => {
            const isSelected = activeLobby?.lobbyId === l.lobbyId;
            return (
              <button
                key={l.lobbyId.toString()}
                onClick={() => {
                  onSelectLobby(l);
                  setActiveTab('qr');
                }}
                className={`sign w-full !justify-between !py-3 text-left ${isSelected ? 'sign-active' : ''}`}
              >
                <span className="space-y-2">
                  <span className="block text-[11px] text-amber-600">{l.code}</span>
                  <span className="block max-w-[260px] overflow-hidden text-ellipsis text-[8px] text-slate-600">{l.title}</span>
                </span>
                <span className="text-right text-[9px]">
                  <span className="block text-emerald-700">${(Number(l.initialBalance) / 100).toFixed(0)}</span>
                  {isSelected && <span className="mt-2 block text-[8px] text-sky-700">ACTIVE</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </PixelDialog>
  );
}
