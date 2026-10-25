import { useEffect, useState, type ReactNode } from 'react';

interface PixelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  accent?: string;
  width?: string;
  children: ReactNode;
}

/** White sign-style dialog used by every non-terminal overlay. */
export function PixelDialog({ isOpen, onClose, title, accent = 'bg-amber-300', width = 'max-w-lg', children }: PixelDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`panel pop-in flex max-h-[88vh] w-full ${width} flex-col`}>
        <div className="flex items-center justify-between border-b-4 border-ink px-4 py-3">
          <div className="flex items-center gap-3">
            <span className={`inline-block h-3 w-3 ${accent} shadow-[0_0_0_3px_#1d1b2a]`} />
            <span className="text-[13px]">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="sign !px-2 !py-1 text-[11px]"
            title="Close (Esc)"
          >
            X
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function HelpDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ['WASD / Arrows', 'Walk around the floor'],
    ['E', 'Open the order book (in the pit)'],
    ['Esc', 'Close any window'],
  ];
  return (
    <PixelDialog isOpen={isOpen} onClose={onClose} title="How to Play" accent="bg-sky-300">
      <div className="space-y-4 text-[10px] leading-[1.8]">
        <div className="panel-inset space-y-2 p-3">
          {rows.map(([key, what]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="bg-ink px-2 py-1 text-white">{key}</span>
              <span className="text-right">{what}</span>
            </div>
          ))}
        </div>
        <p>
          Every contract pays <span className="text-emerald-700">$1.00</span> if its side wins. A YES at 62¢ means the
          floor thinks there is a 62% chance.
        </p>
        <p>
          Walk onto the <span className="text-emerald-700">green carpet</span> in the middle of the hall and press{' '}
          <span className="bg-ink px-1 text-white">E</span> to open the order book. Place a{' '}
          <span className="text-emerald-700">Bid</span> if you think the price is too low, an{' '}
          <span className="text-rose-600">Ask</span> if it is too high. Your cash is held in escrow until the order fills or you
          cancel it.
        </p>
        <p>
          Watch the ticker and the news flashes: the host reveals clues that move the fair price. Bots (blue) and the
          Claude agent (orange) trade alongside you.
        </p>
      </div>
    </PixelDialog>
  );
}

export function ProfileDialog({
  isOpen,
  onClose,
  username,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(username);
  const [error, setError] = useState('');
  useEffect(() => {
    if (isOpen) {
      setValue(username);
      setError('');
    }
  }, [isOpen, username]);

  const trimmed = value.trim();
  const valid = trimmed.length >= 2 && trimmed.length <= 24;

  return (
    <PixelDialog isOpen={isOpen} onClose={onClose} title="Trader Name" width="max-w-sm">
      <form
        className="space-y-4 text-[10px]"
        onSubmit={async e => {
          e.preventDefault();
          if (!valid) return;
          try {
            await onSave(trimmed);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <input
          autoFocus
          maxLength={24}
          value={value}
          onChange={e => setValue(e.target.value)}
          className="panel-inset w-full px-3 py-3 text-[12px] outline-none focus:bg-white"
        />
        <div className="text-slate-500">2-24 characters, unique on the floor. Shown above your head.</div>
        {error && <div className="border-[3px] border-rose-600 bg-rose-50 p-2 text-rose-700">{error}</div>}
        <button type="submit" disabled={!valid} className="sign sign-active w-full disabled:opacity-50">
          Save
        </button>
      </form>
    </PixelDialog>
  );
}
