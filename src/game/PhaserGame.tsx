import { useEffect, useRef } from 'react';
import * as Phaser from 'phaser';
import { TradingPitScene, PlayerData } from './TradingPitScene';

interface PhaserGameProps {
  players: PlayerData[];
  myIdentityHex: string;
  activeMarketQuestion?: string;
  lastTradedPrice?: number;
  marketVolume?: number;
  onPlayerMove: (x: number, y: number, direction: string) => void;
  onTogglePitOverlay: (open?: boolean) => void;
  onProximityChange?: (inPit: boolean) => void;
}

export function PhaserGame({
  players,
  myIdentityHex,
  activeMarketQuestion = 'CAL HACKS 13.0 FLOOR OPEN',
  lastTradedPrice = 50,
  marketVolume = 0,
  onPlayerMove,
  onTogglePitOverlay,
  onProximityChange,
}: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<TradingPitScene | null>(null);

  // Initialize Phaser Game instance once
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 640,
      height: 360,
      pixelArt: true,
      backgroundColor: '#070a13',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [TradingPitScene],
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    // Grab scene reference once created
    game.events.once('ready', () => {
      const scene = game.scene.getScene('TradingPitScene') as TradingPitScene;
      if (scene) {
        sceneRef.current = scene;
        scene.setCallbacks({
          onPlayerMove,
          onTogglePitOverlay,
          onProximityChange,
          myIdentityHex,
        });
      }
    });

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
        sceneRef.current = null;
      }
    };
  }, []);

  // Update callbacks when React handlers change
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setCallbacks({
        onPlayerMove,
        onTogglePitOverlay,
        onProximityChange,
        myIdentityHex,
      });
    }
  }, [onPlayerMove, onTogglePitOverlay, onProximityChange, myIdentityHex]);

  // Sync multiplayer players into Phaser
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.syncPlayers(players, myIdentityHex);
    }
  }, [players, myIdentityHex]);

  // Update ticker display when market data updates
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.updateMarketTicker(
        activeMarketQuestion,
        lastTradedPrice,
        marketVolume
      );
    }
  }, [activeMarketQuestion, lastTradedPrice, marketVolume]);

  return (
    <div className="relative w-full aspect-[16/9] max-w-[960px] mx-auto bg-slate-950 rounded-xl overflow-hidden border-2 border-indigo-500/40 shadow-[0_0_50px_-12px_rgba(99,102,241,0.25)]">
      {/* Canvas Mount Target */}
      <div
        ref={containerRef}
        id="phaser-game-canvas-container"
        className="w-full h-full flex items-center justify-center select-none"
      />

      {/* Retro Arcade Glass Bezel / CRT Scanline Overlay */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/30" />
      <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
    </div>
  );
}
