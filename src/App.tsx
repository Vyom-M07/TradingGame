import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings';
import { PhaserGame } from './game/PhaserGame';
import { PlayerData, TradingPitScene } from './game/TradingPitScene';
import { agentKindFor } from './game/assets';
import { TradingPitOverlay } from './components/TradingPitOverlay';
import { Hud, NewsFlash } from './components/Hud';
import { LobbyModal } from './components/LobbyModal';
import { InstructorModal } from './components/InstructorModal';
import { HelpDialog, ProfileDialog } from './components/Dialogs';

export default function App() {
  const { isActive: connected, identity: myIdentity } = useSpacetimeDB();

  // SpacetimeDB table subscriptions
  const [markets] = useTable(tables.market);
  const [orders] = useTable(tables.order);
  const [players] = useTable(tables.player);
  const [positions] = useTable(tables.position);
  const [trades, tradesReady] = useTable(tables.trade);
  const [clues, cluesReady] = useTable(tables.clue);
  const [lobbies] = useTable(tables.lobby);

  // SpacetimeDB reducers
  const movePlayerReducer = useReducer(reducers.movePlayer);
  const placeOrderReducer = useReducer(reducers.placeOrder);
  const cancelOrderReducer = useReducer(reducers.cancelOrder);
  const createLobbyReducer = useReducer(reducers.createLobby);
  const joinLobbyReducer = useReducer(reducers.joinLobby);
  const setUsernameReducer = useReducer(reducers.setUsername);
  const revealClueReducer = useReducer(reducers.revealClue);
  const clearCluesReducer = useReducer(reducers.clearClues);
  const resolveMarketReducer = useReducer(reducers.resolveMarket);
  const resetMarketReducer = useReducer(reducers.resetMarket);
  const resetLobbyBalancesReducer = useReducer(reducers.resetLobbyBalances);
  const optimalBotTickReducer = useReducer(reducers.optimalBotTick);

  // Overlay state
  const [isPitOverlayOpen, setIsPitOverlayOpen] = useState(false);
  const [isInsidePit, setIsInsidePit] = useState(false);
  const [isLobbyModalOpen, setIsLobbyModalOpen] = useState(false);
  const [isInstructorModalOpen, setIsInstructorModalOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [news, setNews] = useState<{ title: string; content: string } | null>(null);

  const anyOverlayOpen =
    isPitOverlayOpen || isLobbyModalOpen || isInstructorModalOpen || isHelpOpen || isProfileOpen;

  const sceneRef = useRef<TradingPitScene | null>(null);

  // Active Lobby State & URL Parameter (?lobby=CAL13)
  const [selectedLobbyCode, setSelectedLobbyCode] = useState<string | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<bigint | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlLobby = params.get('lobby');
    if (urlLobby) setSelectedLobbyCode(urlLobby.trim().toUpperCase());
  }, []);

  const activeLobby = useMemo(() => {
    if (lobbies.length === 0) return null;
    if (selectedLobbyCode) {
      const found = lobbies.find(l => l.code.toUpperCase() === selectedLobbyCode);
      if (found) return found;
    }
    return lobbies.find(l => l.code === 'CAL13') || lobbies[0];
  }, [lobbies, selectedLobbyCode]);

  // Sync market and join lobby
  useEffect(() => {
    if (activeLobby && connected) {
      if (activeLobby.marketId) setSelectedMarketId(activeLobby.marketId);
      try {
        joinLobbyReducer({ code: activeLobby.code });
      } catch {
        // Ignored
      }
    }
  }, [activeLobby?.code, activeLobby?.marketId, connected, joinLobbyReducer]);

  // Fallback to first market if none selected
  useEffect(() => {
    if (markets.length > 0 && selectedMarketId === null) {
      setSelectedMarketId(markets[0].marketId);
    }
  }, [markets, selectedMarketId]);

  const activeMarket = useMemo(() => {
    if (!selectedMarketId && markets.length > 0) return markets[0];
    return markets.find(m => m.marketId === selectedMarketId) ?? null;
  }, [markets, selectedMarketId]);

  const myHex = myIdentity?.toHexString() ?? '';

  const currentPlayer = useMemo(
    () => (myHex ? players.find(p => p.identity.toHexString() === myHex) ?? null : null),
    [players, myHex]
  );

  const currentPosition = useMemo(() => {
    if (!myHex || !activeMarket) return null;
    return positions.find(p => p.marketId === activeMarket.marketId && p.owner.toHexString() === myHex) ?? null;
  }, [positions, activeMarket, myHex]);

  // Check if current user is the Instructor for this lobby
  const isInstructor = useMemo(() => {
    if (!myIdentity || !activeLobby) return false;
    const instHex = activeLobby.instructor.toHexString();
    return instHex === myHex || instHex.replace(/0/g, '') === '';
  }, [myIdentity, myHex, activeLobby]);

  // Map SpacetimeDB players for the Phaser scene
  const phaserPlayers: PlayerData[] = useMemo(
    () =>
      players.map(p => ({
        identityHex: p.identity.toHexString(),
        username: p.username,
        cashBalance: Number(p.cashBalance),
        x: p.x,
        y: p.y,
        direction: p.direction,
        kind: agentKindFor(p.username),
      })),
    [players]
  );

  // Speech bubbles for new fills on the active market.
  const seenTrades = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!tradesReady) return;
    if (seenTrades.current === null) {
      seenTrades.current = new Set(trades.map(t => t.tradeId.toString()));
      return;
    }
    for (const t of trades) {
      const id = t.tradeId.toString();
      if (seenTrades.current.has(id)) continue;
      seenTrades.current.add(id);
      if (activeMarket && t.marketId !== activeMarket.marketId) continue;
      const scene = sceneRef.current;
      if (!scene) continue;
      const takerPrice = t.takerSide === 'YES' ? t.price : 100 - t.price;
      const makerPrice = t.makerSide === 'YES' ? t.price : 100 - t.price;
      scene.say(t.taker.toHexString(), `${t.quantity} ${t.takerSide} @ ${takerPrice}¢!`, t.takerSide === 'YES' ? '#15803d' : '#be123c');
      if (t.maker.toHexString() !== t.taker.toHexString()) {
        scene.say(t.maker.toHexString(), `Filled ${t.makerSide} @ ${makerPrice}¢`, '#1d1b2a');
      }
      scene.triggerTradeExecutionEffect(t.price, t.quantity);
    }
  }, [trades, tradesReady, activeMarket]);

  // News flash when the host reveals a clue.
  const seenClues = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!cluesReady) return;
    if (seenClues.current === null) {
      seenClues.current = new Set(clues.map(c => c.clueId.toString()));
      return;
    }
    for (const c of clues) {
      const id = c.clueId.toString();
      if (seenClues.current.has(id)) continue;
      seenClues.current.add(id);
      if (!activeMarket || c.marketId === activeMarket.marketId) setNews({ title: c.title, content: c.content });
    }
  }, [clues, cluesReady, activeMarket]);

  // Auto-bot AMM tick loop
  const [isAutoBotRunning, setIsAutoBotRunning] = useState(false);
  const botSpeedMs = 600;
  const activeMarketIdRef = useRef<bigint | null>(null);
  activeMarketIdRef.current = activeMarket?.marketId ?? null;

  useEffect(() => {
    if (!isAutoBotRunning || !connected) return;
    const interval = setInterval(() => {
      const currentId = activeMarketIdRef.current;
      if (currentId) optimalBotTickReducer({ marketId: currentId });
    }, botSpeedMs);
    return () => clearInterval(interval);
  }, [isAutoBotRunning, connected, optimalBotTickReducer]);

  const handlePlayerMove = useCallback(
    (x: number, y: number, direction: string) => {
      if (!connected) return;
      try {
        movePlayerReducer({ x, y, direction });
      } catch {
        // Ignored
      }
    },
    [connected, movePlayerReducer]
  );

  const handleTogglePitOverlay = useCallback((open?: boolean) => {
    setIsPitOverlayOpen(prev => (open !== undefined ? open : !prev));
  }, []);

  const handlePlaceOrder = async (side: 'YES' | 'NO', price: number, quantity: number) => {
    if (!activeMarket) return;
    placeOrderReducer({ marketId: activeMarket.marketId, side, price, quantity });
  };

  const handleCancelOrder = (orderId: bigint) => {
    cancelOrderReducer({ orderId });
  };

  const handleCreateLobby = async (code: string, title: string, marketId: bigint, initialBalanceDollars: number) => {
    const initialBalanceCents = BigInt(Math.round(initialBalanceDollars * 100));
    createLobbyReducer({ code, title, marketId, initialBalance: initialBalanceCents });
    setSelectedLobbyCode(code);
    setSelectedMarketId(marketId);
  };

  const closeNews = useCallback(() => setNews(null), []);

  return (
    <div className="fixed inset-0 overflow-hidden">
      <PhaserGame
        players={phaserPlayers}
        myIdentityHex={myHex}
        activeMarketQuestion={activeMarket?.question}
        lastTradedPrice={activeMarket?.lastTradedPrice ?? 50}
        marketVolume={Number(activeMarket?.volume ?? 0n)}
        inputEnabled={!anyOverlayOpen}
        minimapVisible={minimapVisible}
        onPlayerMove={handlePlayerMove}
        onTogglePitOverlay={handleTogglePitOverlay}
        onProximityChange={setIsInsidePit}
        onSceneReady={scene => (sceneRef.current = scene)}
      />

      <Hud
        connected={connected}
        player={currentPlayer}
        market={activeMarket}
        position={currentPosition}
        activeLobby={activeLobby}
        isInstructor={isInstructor}
        isInsidePit={isInsidePit}
        isAutoBotRunning={isAutoBotRunning}
        minimapVisible={minimapVisible}
        onToggleMinimap={() => setMinimapVisible(v => !v)}
        onToggleAutoBot={() => setIsAutoBotRunning(prev => !prev)}
        onOpenTradingPit={() => setIsPitOverlayOpen(true)}
        onOpenLobby={() => setIsLobbyModalOpen(true)}
        onOpenInstructor={() => setIsInstructorModalOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        onDirection={dir => sceneRef.current?.setVirtualDirection(dir)}
      />

      {news && <NewsFlash title={news.title} content={news.content} onDone={closeNews} />}

      <TradingPitOverlay
        isOpen={isPitOverlayOpen}
        onClose={() => setIsPitOverlayOpen(false)}
        market={activeMarket}
        orders={orders}
        trades={activeMarket ? trades.filter(t => t.marketId === activeMarket.marketId) : trades}
        player={currentPlayer}
        positions={positions}
        myIdentity={myIdentity ?? null}
        onPlaceOrder={handlePlaceOrder}
        onCancelOrder={handleCancelOrder}
      />

      <LobbyModal
        isOpen={isLobbyModalOpen}
        onClose={() => setIsLobbyModalOpen(false)}
        activeLobby={activeLobby}
        allLobbies={lobbies}
        markets={markets}
        onSelectLobby={l => {
          setSelectedLobbyCode(l.code);
          setSelectedMarketId(l.marketId);
        }}
        onCreateLobby={handleCreateLobby}
      />

      <InstructorModal
        isOpen={isInstructorModalOpen}
        onClose={() => setIsInstructorModalOpen(false)}
        market={activeMarket}
        clues={clues}
        activeLobbyCode={activeLobby?.code || 'CAL13'}
        onRevealClue={(title, content, newFairPrice) => {
          if (activeMarket) {
            revealClueReducer({ marketId: activeMarket.marketId, title, content, newFairPrice });
          }
        }}
        onClearClues={() => {
          if (activeMarket) clearCluesReducer({ marketId: activeMarket.marketId });
        }}
        onResolveMarket={winningSide => {
          if (activeMarket) resolveMarketReducer({ marketId: activeMarket.marketId, winningSide });
        }}
        onResetMarket={() => {
          if (activeMarket) {
            resetMarketReducer({ marketId: activeMarket.marketId, defaultPrice: activeMarket.fairPrice || 50 });
          }
        }}
        onResetBalances={code => resetLobbyBalancesReducer({ code })}
      />

      <HelpDialog isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      <ProfileDialog
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        username={currentPlayer?.username ?? ''}
        onSave={name => setUsernameReducer({ username: name })}
      />
    </div>
  );
}
