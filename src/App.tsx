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
import { SettingsDialog } from './components/SettingsDialog';
import { BreakingBanner, LeaderboardReveal } from './components/RoundOverlays';
import { LoginScreen, type RoomChoice } from './components/LoginScreen';

const botKey = (botId: bigint) => `bot-${botId}`;

// Room code shared as ?lobby=CAL13 pre-fills the login screen.
const URL_LOBBY_CODE = (new URLSearchParams(window.location.search).get('lobby') ?? '').trim().toUpperCase();

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
  const [botTraders] = useTable(tables.botTrader);
  const [whaleAvatars] = useTable(tables.whaleAvatar);

  // SpacetimeDB reducers
  const movePlayerReducer = useReducer(reducers.movePlayer);
  const placeOrderReducer = useReducer(reducers.placeOrder);
  const cancelOrderReducer = useReducer(reducers.cancelOrder);
  const joinLobbyReducer = useReducer(reducers.joinLobby);
  const setUsernameReducer = useReducer(reducers.setUsername);
  const joinGameReducer = useReducer(reducers.joinGame);
  const startSoloReducer = useReducer(reducers.startSolo);
  const leaveLobbyReducer = useReducer(reducers.leaveLobby);
  const setLobbyBotsReducer = useReducer(reducers.setLobbyBots);
  const endLobbyRoundReducer = useReducer(reducers.endLobbyRound);
  const startLobbyRoundReducer = useReducer(reducers.startLobbyRound);

  // Login gate: Phaser only mounts after join_game succeeds this session.
  const [joined, setJoined] = useState(false);

  // Overlay state
  const [isPitOverlayOpen, setIsPitOverlayOpen] = useState(false);
  const [nearPit, setNearPit] = useState<string | null>(null);
  const [overlayPit, setOverlayPit] = useState<string | null>(null);
  const [isLobbyModalOpen, setIsLobbyModalOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [news, setNews] = useState<{ title: string; content: string } | null>(null);
  const [breaking, setBreaking] = useState<{ message: string; key: string } | null>(null);
  const [resultsHidden, setResultsHidden] = useState(false);

  const gameState = gameStates[0] ?? null;
  const alertMessage = gameState?.newsTickerMessage ?? '';

  const anyOverlayOpen = isPitOverlayOpen || isLobbyModalOpen || isHelpOpen || isProfileOpen || isSettingsOpen;

  const sceneRef = useRef<TradingPitScene | null>(null);

  const myHex = myIdentity?.toHexString() ?? '';

  const currentPlayer = useMemo(
    () => (myHex ? players.find(p => p.identity.toHexString() === myHex) ?? null : null),
    [players, myHex]
  );

  // The room you're in comes from the server; 0 means you're at the menu.
  const activeLobby = useMemo(
    () => (currentPlayer ? lobbies.find(l => l.lobbyId === currentPlayer.lobbyId) ?? null : null),
    [lobbies, currentPlayer]
  );
  const roomId = activeLobby?.lobbyId ?? null;
  const roundOver = !!activeLobby?.roundOver;
  const isRoomOwner = !!activeLobby?.isSolo && activeLobby.instructor.toHexString() === myHex;

  // The lobby's market lives in the central pit.
  const activeMarket = useMemo(
    () => (activeLobby ? markets.find(m => m.marketId === activeLobby.marketId) ?? null : null),
    [markets, activeLobby]
  );

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

  // The whale sidecar's player row; onFloor means the process is running.
  const whalePlayer = useMemo(
    () => players.find(p => p.avatarType === 'whale' && p.onFloor) ?? null,
    [players]
  );
  const roomBots = useMemo(() => botTraders.filter(b => b.lobbyId === roomId), [botTraders, roomId]);
  const roomWhale = whalePlayer ? whaleAvatars.find(w => w.lobbyId === roomId) ?? null : null;
  const isInstructor = currentPlayer?.role === 'INSTRUCTOR';
  const canControlBots = isRoomOwner || (isInstructor && !!activeLobby && !activeLobby.isSolo);
  // Back to the login screen if the server took us off the floor (2 min
  // disconnect) or we left our room.
  const needsLogin = !joined || currentPlayer?.onFloor === false || !activeLobby;

  const focusPosition = useMemo(() => {
    if (!myHex || !focusMarket) return null;
    return positions.find(p => p.marketId === focusMarket.marketId && p.owner.toHexString() === myHex) ?? null;
  }, [positions, focusMarket, myHex]);

  // Instructors observe invisibly; everyone else in your room walks the floor.
  const phaserPlayers: PlayerData[] = useMemo(
    () =>
      players
        .filter(
          p =>
            p.identity.toHexString() === myHex ||
            (p.onFloor && p.role !== 'INSTRUCTOR' && p.avatarType !== 'whale' && p.lobbyId === roomId)
        )
        .map(p => ({
          identityHex: p.identity.toHexString(),
          username: p.username,
          cashBalance: Number(p.cashBalance),
          x: p.x,
          y: p.y,
          direction: p.direction,
          kind: agentKindFor(p.username, p.avatarType),
          avatarType: avatarTypeFor(p.avatarType),
        }))
        // Robot traders the server spawns while this room's bots are on.
        .concat(
          roomBots.map(b => ({
            identityHex: botKey(b.botId),
            username: b.name,
            cashBalance: 0,
            x: b.x,
            y: b.y,
            direction: b.direction,
            kind: 'bot' as const,
            avatarType: 'robot' as const,
          }))
        )
        // The AI whale, while it's switched on in this room. Keyed by its
        // identity so its fills get speech bubbles.
        .concat(
          roomWhale && whalePlayer
            ? [
                {
                  identityHex: whalePlayer.identity.toHexString(),
                  username: whalePlayer.username,
                  cashBalance: Number(whalePlayer.cashBalance),
                  x: roomWhale.x,
                  y: roomWhale.y,
                  direction: roomWhale.direction,
                  kind: 'whale' as const,
                  avatarType: 'whale' as const,
                },
              ]
            : []
        ),
    [players, roomBots, roomWhale, whalePlayer, myHex, roomId]
  );

  // Who is behind a trade, for the tape.
  const traderName = useCallback(
    (identity: { toHexString(): string }, botId: bigint) => {
      if (botId > 0n) return botTraders.find(b => b.botId === botId)?.name ?? 'Bot';
      const hex = identity.toHexString();
      if (hex === myHex) return 'You';
      return players.find(p => p.identity.toHexString() === hex)?.username ?? 'House';
    },
    [botTraders, players, myHex]
  );

  // Markets the instructor deployed onto the class floor get their own pit.
  const pits: PitData[] = useMemo(
    () =>
      markets
        .filter(m => !activeLobby?.isSolo && m.lobbyId === 0n && m.status === 'OPEN' && m.locationX >= 0 && m.locationY >= 0)
        .map(m => ({
          id: m.marketId.toString(),
          x: m.locationX,
          y: m.locationY,
          title: m.question,
          price: m.lastTradedPrice,
        })),
    [markets, activeLobby?.isSolo]
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
      const takerKey = t.takerBotId > 0n ? botKey(t.takerBotId) : t.taker.toHexString();
      const makerKey = t.makerBotId > 0n ? botKey(t.makerBotId) : t.maker.toHexString();
      scene.say(takerKey, `${t.takerSide === 'YES' ? 'BUY' : 'SELL'} ${t.quantity} @ ${takerPrice}¢!`, t.takerSide === 'YES' ? '#15803d' : '#be123c');
      if (makerKey !== takerKey) {
        scene.say(makerKey, `Filled ${t.makerSide} @ ${makerPrice}¢`, '#1d1b2a');
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

  // Sent back to the menu without pressing Leave: an instructor kicked us.
  const leavingRef = useRef(false);
  const lastLobbyId = useRef<bigint | null>(null);
  useEffect(() => {
    const lobbyId = currentPlayer?.lobbyId ?? null;
    if (lastLobbyId.current && lobbyId === 0n && !leavingRef.current) {
      setIsPitOverlayOpen(false);
      setBreaking({ message: 'You were removed from the room by the instructor.', key: `kick-${Date.now()}` });
    }
    if (lobbyId !== 0n) leavingRef.current = false;
    lastLobbyId.current = lobbyId;
  }, [currentPlayer?.lobbyId]);

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

  const handleJoin = async (name: string, avatarType: AvatarType, room: RoomChoice) => {
    await joinGameReducer({ name, avatarType });
    if (room.kind === 'solo') await startSoloReducer();
    else await joinLobbyReducer({ code: room.code });
    setJoined(true);
  };

  if (needsLogin) {
    return (
      <LoginScreen
        connected={connected}
        ready={playersReady}
        players={players}
        me={currentPlayer}
        initialCode={URL_LOBBY_CODE}
        onJoin={handleJoin}
      />
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
        isBotsActive={!!activeLobby?.botsEnabled}
        minimapVisible={minimapVisible}
        onToggleMinimap={() => setMinimapVisible(v => !v)}
        onOpenTradingPit={openTerminal}
        onOpenLobby={() => setIsLobbyModalOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
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
        traderName={traderName}
        onPlaceOrder={handlePlaceOrder}
        onCancelOrder={handleCancelOrder}
      />

      <LobbyModal
        isOpen={isLobbyModalOpen}
        onClose={() => setIsLobbyModalOpen(false)}
        activeLobby={activeLobby}
        isRoomOwner={isRoomOwner}
        onJoinCode={code => joinLobbyReducer({ code })}
        onPlaySolo={() => startSoloReducer()}
        onLeave={() => {
          leavingRef.current = true;
          return leaveLobbyReducer();
        }}
        onEndRound={() => endLobbyRoundReducer({ lobbyId: activeLobby!.lobbyId })}
        onStartRound={() => startLobbyRoundReducer({ lobbyId: activeLobby!.lobbyId })}
      />

      <HelpDialog isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      <ProfileDialog
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        username={currentPlayer?.username ?? ''}
        onSave={name => setUsernameReducer({ username: name })}
      />
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        lobby={activeLobby}
        canControl={canControlBots}
        bots={roomBots}
        whaleRunning={!!whalePlayer}
        onSetBots={(botsEnabled, whaleEnabled, tickMs) =>
          setLobbyBotsReducer({ lobbyId: activeLobby!.lobbyId, botsEnabled, whaleEnabled, tickMs })
        }
      />

      {roundOver && (
        <LeaderboardReveal
          rows={leaderboard}
          myIdentityHex={myHex}
          avatarFor={hex => avatarTypeFor(players.find(p => p.identity.toHexString() === hex)?.avatarType ?? '')}
          hidden={resultsHidden}
          onToggleHidden={() => setResultsHidden(h => !h)}
          onStartRound={isRoomOwner ? () => void startLobbyRoundReducer({ lobbyId: activeLobby!.lobbyId }) : undefined}
        />
      )}
    </div>
  );
}
