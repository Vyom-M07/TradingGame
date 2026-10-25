import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Lobby } from '../module_bindings/types';
import { PixelDialog } from './Dialogs';

interface LobbyModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeLobby: Lobby | null;
  /** The player owns this solo room, so they run its round. */
  isRoomOwner: boolean;
  onJoinCode: (code: string) => Promise<unknown>;
  onPlaySolo: () => Promise<unknown>;
  onLeave: () => Promise<unknown>;
  onEndRound: () => Promise<unknown>;
  onStartRound: () => Promise<unknown>;
}

const inputCls = 'panel-inset w-full px-3 py-2.5 text-[10px] outline-none focus:bg-white';

/** The room you're in, its invite, and the way to another room or the menu. */
export function LobbyModal({
  isOpen,
  onClose,
  activeLobby,
  isRoomOwner,
  onJoinCode,
  onPlaySolo,
  onLeave,
  onEndRound,
  onStartRound,
}: LobbyModalProps) {
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isSolo = !!activeLobby?.isSolo;
  const inviteUrl =
    activeLobby && !isSolo ? `${window.location.origin}${window.location.pathname}?lobby=${activeLobby.code}` : '';

  const act = async (call: () => Promise<unknown>, closeAfter = true) => {
    setBusy(true);
    setErrorMsg('');
    try {
      await call();
      if (closeAfter) onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyLink = () => {
    if (navigator.clipboard && inviteUrl) {
      void navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const cleanCode = code.trim().toUpperCase();

  return (
    <PixelDialog isOpen={isOpen} onClose={onClose} title="Lobby">
      <div className="space-y-5 text-[9px]">
        <div className="text-center">
          <div className="text-slate-500">{isSolo ? 'SOLO ROOM' : 'ROOM CODE'}</div>
          <div className="mt-2 text-[24px] tracking-widest text-amber-600">{activeLobby?.code ?? '----'}</div>
          <div className="mt-2 leading-relaxed">{activeLobby?.title}</div>
          {activeLobby?.roundOver && <div className="mt-2 text-rose-600">ROUND OVER</div>}
        </div>

        {inviteUrl && (
          <div className="flex flex-col items-center space-y-3">
            <div className="panel-inset bg-white p-3">
              <QRCodeSVG value={inviteUrl} size={160} level="M" includeMargin={false} />
            </div>
            <div className="flex w-full items-stretch gap-2">
              <input type="text" readOnly value={inviteUrl} className={`${inputCls} select-all !text-[8px]`} />
              <button onClick={handleCopyLink} className="sign !px-3 text-[10px]">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {isRoomOwner && activeLobby && (
          <button
            className={`sign w-full text-[10px] disabled:opacity-50 ${activeLobby.roundOver ? 'sign-active' : '!bg-rose-300'}`}
            disabled={busy}
            onClick={() => void act(activeLobby.roundOver ? onStartRound : onEndRound)}
          >
            {activeLobby.roundOver ? 'Start new round' : 'End round & see results'}
          </button>
        )}

        <form
          className="space-y-2"
          onSubmit={e => {
            e.preventDefault();
            if (cleanCode) void act(() => onJoinCode(cleanCode));
          }}
        >
          <div className="text-slate-500">JOIN ANOTHER ROOM</div>
          <div className="flex items-stretch gap-2">
            <input
              maxLength={16}
              placeholder="ROOM CODE"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              className={`${inputCls} uppercase`}
            />
            <button type="submit" disabled={busy || !cleanCode} className="sign sign-active !px-3 text-[10px] disabled:opacity-50">
              Join
            </button>
          </div>
        </form>

        <div className="grid grid-cols-2 gap-3">
          <button className="sign text-[10px] disabled:opacity-50" disabled={busy || isSolo} onClick={() => void act(onPlaySolo)}>
            Play solo
          </button>
          <button className="sign text-[10px] disabled:opacity-50" disabled={busy} onClick={() => void act(onLeave)}>
            Leave to menu
          </button>
        </div>

        {errorMsg && <div className="border-[3px] border-rose-600 bg-rose-50 p-2 text-rose-700">{errorMsg}</div>}
      </div>
    </PixelDialog>
  );
}
