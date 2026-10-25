import { useEffect, useState } from 'react';
import type { Lobby, Market, Player, Position } from '../module_bindings/types';
import { MINIMAP_RECT } from '../game/assets';

interface HudProps {
  connected: boolean;
  player: Player | null;
  market: Market | null;
  position: Position | null;
  activeLobby: Lobby | null;
  isInstructor: boolean;
  isInsidePit: boolean;
  isBotsActive?: boolean;
  minimapVisible: boolean;
  onToggleMinimap: () => void;
  onOpenTradingPit: () => void;
  onOpenLobby: () => void;
  onOpenSettings?: () => void;
  onOpenHelp: () => void;
  onOpenProfile: () => void;
  onDirection: (direction: string | null) => void;
}

export function Hud(props: HudProps) {
  return (
    <div className="pointer-events-none fixed inset-0 z-30 select-none">
      <Logo />
      <WalletSign player={props.player} market={props.market} position={props.position} />
      <TopNav {...props} />
      <MinimapFrame visible={props.minimapVisible} />
      <BottomNav {...props} />
      <TouchPad onDirection={props.onDirection} />
    </div>
  );
}

function Logo() {
  return (
    <div className="absolute left-5 top-4 hidden sm:block">
      <div className="logo-text font-pixel text-[30px] leading-[1.15] tracking-tight">
        SERIOUS
        <br />
        TRADING
      </div>
      <div className="logo-text mt-2 flex items-center gap-2 font-pixel text-[9px]">
        <span className="inline-block h-[3px] w-6 bg-white shadow-[0_0_0_2px_#1d1b2a]" />
        EXCHANGE
        <span className="inline-block h-[3px] w-6 bg-white shadow-[0_0_0_2px_#1d1b2a]" />
      </div>
    </div>
  );
}

function WalletSign({ player, market, position }: { player: Player | null; market: Market | null; position: Position | null }) {
  const cash = (Number(player?.cashBalance ?? 0n) / 100).toFixed(2);
  const last = market?.lastTradedPrice ?? 50;
  return (
    <div className="absolute left-4 top-4 w-[250px] sm:top-[118px]">
      <div className="panel p-3 text-[10px] leading-relaxed">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">CASH</span>
          <span className="text-[14px] text-emerald-700">${cash}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-slate-500">HOLD</span>
          <span>
            <span className="text-emerald-700">{position?.yesShares ?? 0} Y</span>
            <span className="text-slate-400"> / </span>
            <span className="text-rose-600">{position?.noShares ?? 0} N</span>
          </span>
        </div>
        <div className="my-2 h-[3px] bg-ink/80" />
        <div className="line-clamp-2 text-[9px] leading-[1.5]" title={market?.question}>
          {market?.question ?? 'Waiting for market…'}
        </div>
        <div className="mt-2 flex items-center justify-between text-[9px]">
          <span>
            YES <span className="text-emerald-700">{last}¢</span>
          </span>
          <span>
            NO <span className="text-rose-600">{100 - last}¢</span>
          </span>
          <span className={market?.status === 'RESOLVED' ? 'text-rose-600' : 'text-sky-700'}>
            {market?.status === 'RESOLVED' ? `WON:${market.winningSide}` : 'OPEN'}
          </span>
        </div>
      </div>
    </div>
  );
}

function TopNav({
  activeLobby,
  isInstructor,
  isInsidePit,
  isBotsActive,
  player,
  onOpenTradingPit,
  onOpenLobby,
  onOpenSettings,
  onOpenProfile,
}: HudProps) {
  return (
    <nav className="pointer-events-auto absolute right-4 top-0 flex max-w-[calc(100vw-280px)] flex-wrap justify-end gap-x-4 max-sm:max-w-[calc(100vw-20px)] max-sm:top-[190px]">
      <div className="hang-top">
        <button
          className={`sign ${isInsidePit ? 'sign-active sign-glow' : ''}`}
          onClick={onOpenTradingPit}
          title={isInsidePit ? 'Open the order book' : 'Walk into the pit to trade'}
        >
          Trade <span className="text-[10px] text-slate-500">[E]</span>
        </button>
      </div>
      <div className="hang-top">
        <button className="sign" onClick={onOpenLobby} title="Lobby and invite QR code">
          Lobby <span className="text-amber-600">{activeLobby?.code ?? '----'}</span>
        </button>
      </div>
      <div className="hang-top">
        <button
          className={`sign ${isBotsActive ? 'sign-active' : ''}`}
          onClick={onOpenSettings}
          title="Solo bots and AI Whale controls"
        >
          <span className={`inline-block h-2 w-2 ${isBotsActive ? 'bg-amber-400' : 'bg-slate-400'} shadow-[0_0_0_2px_#1d1b2a]`} />
          Bots
        </button>
      </div>
      {isInstructor && (
        <div className="hang-top">
          <a className="sign sign-active" href="/instructor" target="_blank" rel="noreferrer" title="Open the instructor dashboard">
            Dashboard
          </a>
        </div>
      )}
      <div className="hang-top">
        <button className="sign" onClick={onOpenProfile} title="Change your trader name">
          <span className="max-w-[140px] overflow-hidden text-ellipsis">{player?.username ?? 'Trader'}</span>
        </button>
      </div>
    </nav>
  );
}

function MinimapFrame({ visible }: { visible: boolean }) {
  const { left, bottom, width, height } = MINIMAP_RECT;
  const pad = 14;
  if (!visible) return null;
  return (
    <div className="max-sm:hidden">
      <div
        className="bezel-ring bezel-pipes absolute"
        style={{ left: left - pad, bottom: bottom - pad, width: width + pad * 2, height: height + pad * 2 }}
      />
      <div
        className="bezel-screen-glass absolute"
        style={{ left: left - 4, bottom: bottom - 4, width: width + 8, height: height + 8 }}
      />
    </div>
  );
}

function BottomNav({ connected, minimapVisible, onToggleMinimap, onOpenHelp }: HudProps) {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <nav className="pointer-events-auto absolute bottom-0 right-4 flex gap-x-4 max-sm:hidden">
      <div className="hang-bottom">
        <button className="sign" onClick={toggleFullscreen} title="Fullscreen">
          {fullscreen ? '][' : '[ ]'}
        </button>
      </div>
      <div className="hang-bottom">
        <button className={`sign ${minimapVisible ? '' : 'sign-active'}`} onClick={onToggleMinimap}>
          MAP
        </button>
      </div>
      <div className="hang-bottom">
        <button className="sign" onClick={onOpenHelp}>
          How to Play
        </button>
      </div>
      <div className="hang-bottom">
        <div className={`sign ${connected ? 'sign-active' : ''}`} title={connected ? 'Connected to SpacetimeDB' : 'Connecting…'}>
          <span className={`inline-block h-2.5 w-2.5 ${connected ? 'bg-emerald-500' : 'animate-pulse bg-rose-500'} shadow-[0_0_0_2px_#1d1b2a]`} />
          {connected ? 'LIVE' : '...'}
        </div>
      </div>
    </nav>
  );
}

function TouchPad({ onDirection }: { onDirection: (direction: string | null) => void }) {
  const btn = (dir: string, label: string, cls: string) => (
    <button
      className={`sign absolute h-14 w-14 !p-0 text-[16px] ${cls}`}
      onPointerDown={e => {
        e.preventDefault();
        onDirection(dir);
      }}
      onPointerUp={() => onDirection(null)}
      onPointerLeave={() => onDirection(null)}
      onPointerCancel={() => onDirection(null)}
    >
      {label}
    </button>
  );
  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 h-44 w-44 sm:hidden">
      {btn('up', '▲', 'top-0 left-14')}
      {btn('left', '◀', 'top-14 left-0')}
      {btn('right', '▶', 'top-14 right-0')}
      {btn('down', '▼', 'bottom-0 left-14')}
    </div>
  );
}

export function NewsFlash({ title, content, onDone }: { title: string; content: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 7000);
    return () => clearTimeout(t);
  }, [title, content, onDone]);

  return (
    <div className="pointer-events-auto fixed left-1/2 top-[22%] z-40 w-[min(560px,90vw)] -translate-x-1/2">
      <div className="panel pop-in relative p-4 text-center cursor-pointer" onClick={onDone}>
        <div className="mb-2 inline-block bg-rose-600 px-2 py-1 text-[9px] text-white">NEWS FLASH</div>
        <div className="text-[13px] leading-relaxed">{title}</div>
        <div className="mt-2 text-[10px] leading-[1.7] text-slate-600">{content}</div>
        <div className="absolute -bottom-[14px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[14px] border-x-transparent border-t-ink" />
      </div>
    </div>
  );
}
