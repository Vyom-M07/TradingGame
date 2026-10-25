import { useEffect, useRef } from 'react';
import * as Phaser from 'phaser';
import { TradingPitScene, PlayerData, PitData } from './TradingPitScene';

interface PhaserGameProps {
  players: PlayerData[];
  pits: PitData[];
  alertMessage: string;
  myIdentityHex: string;
  activeMarketQuestion?: string;
  lastTradedPrice?: number;
  marketVolume?: number;
  inputEnabled: boolean;
  minimapVisible: boolean;
  onPlayerMove: (x: number, y: number, direction: string) => void;
  onTogglePitOverlay: (open?: boolean) => void;
  onProximityChange?: (pitId: string | null) => void;
  onSceneReady?: (scene: TradingPitScene) => void;
}

export function PhaserGame({
  players,
  pits,
  alertMessage,
  myIdentityHex,
  activeMarketQuestion = 'CAL HACKS 13.0 FLOOR OPEN',
  lastTradedPrice = 50,
  marketVolume = 0,
  inputEnabled,
  minimapVisible,
  onPlayerMove,
  onTogglePitOverlay,
  onProximityChange,
  onSceneReady,
}: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TradingPitScene | null>(null);

  // Keep the latest props available to the scene once it boots.
  const latest = useRef({
    players, pits, alertMessage, myIdentityHex, activeMarketQuestion, lastTradedPrice, marketVolume, inputEnabled,
    minimapVisible, onPlayerMove, onTogglePitOverlay, onProximityChange, onSceneReady,
  });
  latest.current = {
    players, pits, alertMessage, myIdentityHex, activeMarketQuestion, lastTradedPrice, marketVolume, inputEnabled,
    minimapVisible, onPlayerMove, onTogglePitOverlay, onProximityChange, onSceneReady,
  };

  useEffect(() => {
    let game: Phaser.Game | null = null;
    let cancelled = false;

    // Phaser rasterises text once, so wait for the pixel font first.
    document.fonts.load('16px "Press Start 2P"').catch(() => undefined).finally(() => {
      if (cancelled || !containerRef.current) return;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: containerRef.current,
        pixelArt: true,
        backgroundColor: '#3d6b35',
        scale: {
          mode: Phaser.Scale.RESIZE,
          width: '100%',
          height: '100%',
        },
        scene: [TradingPitScene],
      });

      game.events.once(Phaser.Core.Events.READY, () => {
        const scene = game?.scene.getScene('TradingPitScene') as TradingPitScene | undefined;
        if (!scene) return;
        const onCreate = () => {
          const p = latest.current;
          sceneRef.current = scene;
          scene.setCallbacks({
            onPlayerMove: (x, y, d) => latest.current.onPlayerMove(x, y, d),
            onTogglePitOverlay: open => latest.current.onTogglePitOverlay(open),
            onProximityChange: pitId => latest.current.onProximityChange?.(pitId),
            myIdentityHex: p.myIdentityHex,
          });
          scene.setInputEnabled(p.inputEnabled);
          scene.setMinimapVisible(p.minimapVisible);
          scene.updateMarketTicker(p.activeMarketQuestion, p.lastTradedPrice, p.marketVolume);
          scene.setAlert(p.alertMessage);
          scene.syncPlayers(p.players, p.myIdentityHex);
          scene.syncPits(p.pits);
          p.onSceneReady?.(scene);
        };
        if (scene.sys.isActive()) onCreate();
        else scene.events.once(Phaser.Scenes.Events.CREATE, onCreate);
      });
    });

    return () => {
      cancelled = true;
      sceneRef.current = null;
      game?.destroy(true);
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setCallbacks({ myIdentityHex });
  }, [myIdentityHex]);

  useEffect(() => {
    sceneRef.current?.syncPlayers(players, myIdentityHex);
  }, [players, myIdentityHex]);

  useEffect(() => {
    sceneRef.current?.syncPits(pits);
  }, [pits]);

  useEffect(() => {
    sceneRef.current?.setAlert(alertMessage);
  }, [alertMessage]);

  useEffect(() => {
    sceneRef.current?.updateMarketTicker(activeMarketQuestion, lastTradedPrice, marketVolume);
  }, [activeMarketQuestion, lastTradedPrice, marketVolume]);

  useEffect(() => {
    sceneRef.current?.setInputEnabled(inputEnabled);
  }, [inputEnabled]);

  useEffect(() => {
    sceneRef.current?.setMinimapVisible(minimapVisible);
  }, [minimapVisible]);

  return <div ref={containerRef} className="fixed inset-0 select-none" id="phaser-game-canvas-container" />;
}
