import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings';
import { PhaserGame } from './game/PhaserGame';
import { MAIN_PIT, PitData, PlayerData, TradingPitScene } from './game/TradingPitScene';
import { agentKindFor, avatarTypeFor, type AvatarType } from './game/assets';
import { TradingPitOverlay } from './components/TradingPitOverlay';
import { Hud, NewsFlash } from './components/Hud';
import { LobbyModal } from './components/LobbyModal';
import { HelpDialog, ProfileDialog } from './components/Dialogs';
import { BreakingBanner, LeaderboardReveal } from './components/RoundOverlays';
import { LoginScreen } from './components/LoginScreen';

export default function App() {
  const { isActive: connected, identity: myIdentity } = useSpacetimeDB();

  // SpacetimeDB table subscriptions
  const [markets] = useTable(tables.market);
  const [orders] = useTable(tables.order);
  const [players, playersReady] = useTable(tables.player);
  const [positions] = useTable(tables.position);
  const [trades, tradesReady] = useTable(tables.trade);
  const [clues, cluesReady] = useTable(tables.clue);
  const [lobbies] = useTable(tables.lobby);
  const [gameStates, gameStateReady] = useTable(tables.gameState);
  // Empty for students until the instructor ends the round.
  const [leaderboard] = useTable(tables.leaderboard);

  // SpacetimeDB reducers
  const movePlayerReducer = useReducer(reducers.movePlayer);
  const placeOrderReducer = useReducer(reducers.placeOrder);
  const cancelOrderReducer = useReducer(reducers.cancelOrder);
  const joinLobbyReducer = useReducer(reducers.joinLobby);
  const setUsernameReducer = useReducer(reducers.setUsername);
  const joinGameReducer = useReducer(reducers.joinGame);

  // Login gate: Phaser only mounts after join_game succeeds this session.
  const [joined, setJoined] = useState(false);

  // Overlay state
  const [isPitOverlayOpen, setIsPitOverlayOpen] = useState(false);
  const [nearPit, setNearPit] = useState<string | null>(null);
  const [overlayPit, setOverlayPit] = useState<string | null>(null);
  const [isLobbyModalOpen, setIsLobbyModalOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [news, setNews] = useState<{ title: string; content: string } | null>(null);
  const [breaking, setBreaking] = useState<{ message: string; key: string } | null>(null);
  const [resultsHidden, setResultsHidden] = useState(false);

  const gameState = gameStates[0] ?? null;
  const roundOver = !!gameState?.isLeaderboardRevealed;
  const alertMessage = gameState?.newsTickerMessage ?? '';

  const anyOverlayOpen = isPitOverlayOpen || isLobbyModalOpen || isHelpOpen || isProfileOpen;

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

  // The lobby's market lives in the central pit.
  const activeMarket = useMemo(() => {
    if (!selectedMarketId && markets.length > 0) return markets[0];
    return markets.find(m => m.marketId === selectedMarketId) ?? null;
  }, [markets, selectedMarketId]);

  const marketForPit = useCallback(
    (pit: string | null) => {
      if (!pit || pit === MAIN_PIT) return activeMarket;
      return markets.find(m => m.marketId.toString() === pit) ?? activeMarket;
    },
    [markets, activeMarket]
  );

  // Market the HUD describes: the pit you're standing at, else the lobby's.
  const focusMarket = marketForPit(nearPit);
  const overlayMarket = marketForPit(overlayPit);

  const myHex = myIdentity?.toHexString() ?? '';

  const currentPlayer = useMemo(
    () => (myHex ? players.find(p => p.identity.toHexString() === myHex) ?? null : null),
    [players, myHex]
  );
  const isInstructor = currentPlayer?.role === 'INSTRUCTOR';
  // Back to the login screen if the server took us off the floor (2 min disconnect).
  const needsLogin = !joined || currentPlayer?.onFloor === false;

  const focusPosition = useMemo(() => {
    if (!myHex || !focusMarket) return null;
    return positions.find(p => p.marketId === focusMarket.marketId && p.owner.toHexString() === myHex) ?? null;
  }, [positions, focusMarket, myHex]);

  // Instructors observe invisibly; everyone else walks the floor.
  const phaserPlayers: PlayerData[] = useMemo(
    () =>
      players
        .filter(p => p.identity.toHexString() === myHex || (p.onFloor && p.role !== 'INSTRUCTOR'))
        .map(p => ({
          identityHex: p.identity.toHexString(),
          username: p.username,
          cashBalance: Number(p.cashBalance),
          x: p.x,
          y: p.y,
          direction: p.direction,
          kind: agentKindFor(p.username),
          avatarType: avatarTypeFor(p.avatarType),
        })),
    [players, myHex]
  );

  // Markets the instructor deployed onto the floor get their own pit.
  const pits: PitData[] = useMemo(
    () =>
      markets
        .filter(m => m.status === 'OPEN' && m.locationX >= 0 && m.locationY >= 0)
        .map(m => ({
          id: m.marketId.toString(),
          x: m.locationX,
          y: m.locationY,
          title: m.question,
          price: m.lastTradedPrice,
        })),
    [markets]
  );

  // Speech bubbles for new fills.
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
      const scene = sceneRef.current;
      if (!scene) continue;
      const takerPrice = t.takerSide === 'YES' ? t.price : 100 - t.price;
      const makerPrice = t.makerSide === 'YES' ? t.price : 100 - t.price;
      scene.say(t.taker.toHexString(), `${t.quantity} ${t.takerSide} @ ${takerPrice}¢!`, t.takerSide === 'YES' ? '#15803d' : '#be123c');
      if (t.maker.toHexString() !== t.taker.toHexString()) {
        scene.say(t.maker.toHexString(), `Filled ${t.makerSide} @ ${makerPrice}¢`, '#1d1b2a');
      }
      if (activeMarket && t.marketId === activeMarket.marketId) scene.triggerTradeExecutionEffect(t.price, t.quantity);
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
      setNews({ title: c.title, content: c.content });
    }
  }, [clues, cluesReady]);

  // Red banner whenever the instructor broadcasts an alert.
  const lastAlertAt = useRef<bigint | null>(null);
  useEffect(() => {
    if (!gameStateReady) return;
    const postedAt = gameState?.newsPostedAt.microsSinceUnixEpoch ?? 0n;
    if (lastAlertAt.current === null) {
      lastAlertAt.current = postedAt;
      return;
    }
    if (postedAt === lastAlertAt.current) return;
    lastAlertAt.current = postedAt;
    if (gameState?.newsTickerMessage) {
      setBreaking({ message: gameState.newsTickerMessage, key: postedAt.toString() });
    } else {
      setBreaking(null);
    }
  }, [gameState, gameStateReady]);

  // Round end: freeze the floor and close the terminal.
  useEffect(() => {
    if (roundOver) {
      setIsPitOverlayOpen(false);
      setResultsHidden(false);
    }
  }, [roundOver]);

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

  // Latest pit for the Phaser E-key callback, which is registered once.
  const nearPitRef = useRef<string | null>(null);
  nearPitRef.current = nearPit;

  const openTerminal = useCallback(() => {
    setOverlayPit(nearPitRef.current);
    setIsPitOverlayOpen(true);
  }, []);

  const handleTogglePitOverlay = useCallback(
    (open?: boolean) => {
      if (open === false) setIsPitOverlayOpen(false);
      else openTerminal();
    },
    [openTerminal]
  );

  const handlePlaceOrder = async (side: 'YES' | 'NO', price: number, quantity: number) => {
    if (!overlayMarket) return;
    await placeOrderReducer({ marketId: overlayMarket.marketId, side, price, quantity });
  };

  const handleCancelOrder = (orderId: bigint) => {
    cancelOrderReducer({ orderId });
  };

  const closeNews = useCallback(() => setNews(null), []);
  const closeBreaking = useCallback(() => setBreaking(null), []);

  const handleJoin = async (name: string, avatarType: AvatarType) => {
    await joinGameReducer({ name, avatarType });
    setJoined(true);
  };

  if (needsLogin) {
    return (
      <LoginScreen connected={connected} ready={playersReady} players={players} me={currentPlayer} onJoin={handleJoin} />
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      <PhaserGame
        players={phaserPlayers}
        pits={pits}
        alertMessage={alertMessage}
        myIdentityHex={myHex}
        activeMarketQuestion={activeMarket?.question}
        lastTradedPrice={activeMarket?.lastTradedPrice ?? 50}
        marketVolume={Number(activeMarket?.volume ?? 0n)}
        inputEnabled={!anyOverlayOpen && !roundOver}
        minimapVisible={minimapVisible}
        onPlayerMove={handlePlayerMove}
        onTogglePitOverlay={handleTogglePitOverlay}
        onProximityChange={setNearPit}
        onSceneReady={scene => (sceneRef.current = scene)}
      />

      <Hud
        connected={connected}
        player={currentPlayer}
        market={focusMarket}
        position={focusPosition}
        activeLobby={activeLobby}
        isInstructor={isInstructor}
        isInsidePit={!!nearPit}
        minimapVisible={minimapVisible}
        onToggleMinimap={() => setMinimapVisible(v => !v)}
        onOpenTradingPit={openTerminal}
        onOpenLobby={() => setIsLobbyModalOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        onDirection={dir => sceneRef.current?.setVirtualDirection(dir)}
      />

      {breaking && <BreakingBanner key={breaking.key} message={breaking.message} onDone={closeBreaking} />}
      {news && <NewsFlash title={news.title} content={news.content} onDone={closeNews} />}

      <TradingPitOverlay
        isOpen={isPitOverlayOpen && !roundOver}
        onClose={() => setIsPitOverlayOpen(false)}
        market={overlayMarket}
        orders={orders}
        trades={overlayMarket ? trades.filter(t => t.marketId === overlayMarket.marketId) : trades}
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
      />

      <HelpDialog isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      <ProfileDialog
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        username={currentPlayer?.username ?? ''}
        onSave={name => setUsernameReducer({ username: name })}
      />

      {roundOver && (
        <LeaderboardReveal
          rows={leaderboard}
          myIdentityHex={myHex}
          avatarFor={hex => avatarTypeFor(players.find(p => p.identity.toHexString() === hex)?.avatarType ?? '')}
          hidden={resultsHidden}
          onToggleHidden={() => setResultsHidden(h => !h)}
        />
      )}
    </div>
  );
}
