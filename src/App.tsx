import { useState, useMemo, useEffect, useRef } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings';
import { PhaserGame } from './game/PhaserGame';
import { PlayerData } from './game/TradingPitScene';
import { TradingPitOverlay } from './components/TradingPitOverlay';
import { TopArcadeBar } from './components/TopArcadeBar';
import { LobbyModal } from './components/LobbyModal';
import { InstructorModal } from './components/InstructorModal';

export default function App() {
  const { isActive: connected, identity: myIdentity } = useSpacetimeDB();

  // SpacetimeDB table subscriptions
  const [markets] = useTable(tables.market);
  const [orders] = useTable(tables.order);
  const [players] = useTable(tables.player);
  const [positions] = useTable(tables.position);
  const [trades] = useTable(tables.trade);
  const [clues] = useTable(tables.clue);
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

  // UI Modal & Overlay States
  const [isPitOverlayOpen, setIsPitOverlayOpen] = useState(false);
  const [isInsidePit, setIsInsidePit] = useState(false);
  const [isLobbyModalOpen, setIsLobbyModalOpen] = useState(false);
  const [isInstructorModalOpen, setIsInstructorModalOpen] = useState(false);

  // Active Lobby State & URL Parameter (?lobby=CAL13)
  const [selectedLobbyCode, setSelectedLobbyCode] = useState<string | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<bigint | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlLobby = params.get('lobby');
      if (urlLobby) {
        setSelectedLobbyCode(urlLobby.trim().toUpperCase());
      }
    }
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
      if (activeLobby.marketId) {
        setSelectedMarketId(activeLobby.marketId);
      }
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

  // Current player record
  const currentPlayer = useMemo(() => {
    if (!myIdentity) return null;
    const hex = myIdentity.toHexString();
    return players.find(p => p.identity.toHexString() === hex) ?? null;
  }, [players, myIdentity]);

  // Check if current user is the Instructor for this lobby
  const isInstructor = useMemo(() => {
    if (!myIdentity || !activeLobby) return false;
    const myHex = myIdentity.toHexString();
    const instHex = activeLobby.instructor.toHexString();
    return instHex === myHex || instHex.replace(/0/g, '') === '';
  }, [myIdentity, activeLobby]);

  // Map SpacetimeDB players for Phaser scene
  const phaserPlayers: PlayerData[] = useMemo(() => {
    return players.map(p => ({
      identityHex: p.identity.toHexString(),
      username: p.username,
      cashBalance: Number(p.cashBalance),
      x: p.x,
      y: p.y,
      direction: p.direction,
      isBot: p.username.toLowerCase().includes('whale') || p.username.toLowerCase().includes('bot'),
    }));
  }, [players]);

  // Auto-bot AMM tick loop
  const [isAutoBotRunning, setIsAutoBotRunning] = useState(false);
  const botSpeedMs = 600;
  const activeMarketIdRef = useRef<bigint | null>(null);
  activeMarketIdRef.current = activeMarket?.marketId ?? null;

  useEffect(() => {
    if (!isAutoBotRunning || !connected) return;

    const interval = setInterval(() => {
      const currentId = activeMarketIdRef.current;
      if (currentId) {
        optimalBotTickReducer({ marketId: currentId });
      }
    }, botSpeedMs);

    return () => clearInterval(interval);
  }, [isAutoBotRunning, connected, botSpeedMs, optimalBotTickReducer]);

  // Movement handler from Phaser
  const handlePlayerMove = (x: number, y: number, direction: string) => {
    if (!connected) return;
    try {
      movePlayerReducer({ x, y, direction });
    } catch {
      // Ignored
    }
  };

  // Toggle Pit Overlay
  const handleTogglePitOverlay = (open?: boolean) => {
    setIsPitOverlayOpen(prev => (open !== undefined ? open : !prev));
  };

  // Place order wrapper
  const handlePlaceOrder = async (side: 'YES' | 'NO', price: number, quantity: number) => {
    if (!activeMarket) return;
    placeOrderReducer({
      marketId: activeMarket.marketId,
      side,
      price,
      quantity,
    });
  };

  // Cancel order wrapper
  const handleCancelOrder = (orderId: bigint) => {
    cancelOrderReducer({ orderId });
  };

  // Create lobby wrapper
  const handleCreateLobby = async (
    code: string,
    title: string,
    marketId: bigint,
    initialBalanceDollars: number
  ) => {
    const initialBalanceCents = BigInt(Math.round(initialBalanceDollars * 100));
    createLobbyReducer({
      code,
      title,
      marketId,
      initialBalance: initialBalanceCents,
    });
    setSelectedLobbyCode(code);
    setSelectedMarketId(marketId);
  };

  return (
    <div className="min-h-screen bg-[#070a13] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-white">
      {/* Top Arcade Navigation & Bankroll Bar */}
      <TopArcadeBar
        connected={connected}
        player={currentPlayer}
        activeLobby={activeLobby}
        isInstructor={isInstructor}
        isInsidePit={isInsidePit}
        isAutoBotRunning={isAutoBotRunning}
        botSpeedMs={botSpeedMs}
        onToggleAutoBot={() => setIsAutoBotRunning(prev => !prev)}
        onOpenLobbyModal={() => setIsLobbyModalOpen(true)}
        onOpenInstructorModal={() => setIsInstructorModalOpen(true)}
        onOpenTradingPit={() => setIsPitOverlayOpen(true)}
        onChangeUsername={name => setUsernameReducer({ username: name })}
      />

      {/* Main Floor Arena (Phaser 3 Canvas Wrapper) */}
      <main className="flex-1 flex flex-col items-center justify-center p-2 sm:p-4 relative">
        <div className="w-full max-w-5xl flex flex-col items-center space-y-3">
          {/* Active Question Banner */}
          <div className="w-full bg-slate-900/80 border border-indigo-500/30 rounded-lg px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs font-mono shadow-md">
            <div className="flex items-center gap-2 truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-400">CONTRACT:</span>
              <span className="font-bold text-white truncate text-sm">
                {activeMarket?.question || 'Classroom 3-Card Expected Sum > 20'}
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="text-slate-400">
                LAST: <strong className="text-emerald-400">{activeMarket?.lastTradedPrice ?? 50}¢</strong>
              </span>
              <span className="text-slate-400">
                FAIR: <strong className="text-sky-400">{activeMarket?.fairPrice ?? 50}¢</strong>
              </span>
              <span className="text-slate-400">
                VOL: <strong className="text-white">{Number(activeMarket?.volume ?? 0n)}</strong>
              </span>
              <button
                onClick={() => setIsPitOverlayOpen(true)}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-['Press_Start_2P'] text-[8px] transition cursor-pointer"
              >
                OPEN PIT [E]
              </button>
            </div>
          </div>

          {/* Phaser 3 2D Canvas */}
          <PhaserGame
            players={phaserPlayers}
            myIdentityHex={myIdentity ? myIdentity.toHexString() : ''}
            activeMarketQuestion={activeMarket?.question}
            lastTradedPrice={activeMarket?.lastTradedPrice ?? 50}
            marketVolume={Number(activeMarket?.volume ?? 0n)}
            onPlayerMove={handlePlayerMove}
            onTogglePitOverlay={handleTogglePitOverlay}
            onProximityChange={setIsInsidePit}
          />

          {/* Arcade Controls Legend / Floor Guide */}
          <div className="w-full flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-950/90 border border-slate-800 rounded-lg text-[10px] font-mono text-slate-400">
            <div className="flex items-center gap-3">
              <span>🎮 <strong className="text-slate-200">[W][A][S][D] / [ARROWS]</strong> Walk on Floor</span>
              <span>⚡ <strong className="text-yellow-400">[E]</strong> Enter Trading Pit</span>
              <span>❌ <strong className="text-slate-200">[ESC]</strong> Close Terminal</span>
            </div>
            <div className="text-slate-500">
              SpacetimeDB CLOB Engine • 1 YES + 1 NO = $1.00 • 32x32 Open Outcry
            </div>
          </div>
        </div>
      </main>

      {/* Phase 3: The HTML/Tailwind Financial Terminal Overlay */}
      <TradingPitOverlay
        isOpen={isPitOverlayOpen}
        onClose={() => setIsPitOverlayOpen(false)}
        market={activeMarket}
        orders={orders}
        trades={trades}
        player={currentPlayer}
        positions={positions}
        myIdentity={myIdentity ?? null}
        onPlaceOrder={handlePlaceOrder}
        onCancelOrder={handleCancelOrder}
      />

      {/* Multiplayer Lobby & QR Invite Modal */}
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

      {/* Instructor Classroom & Market Resolution Modal */}
      <InstructorModal
        isOpen={isInstructorModalOpen}
        onClose={() => setIsInstructorModalOpen(false)}
        market={activeMarket}
        clues={clues}
        activeLobbyCode={activeLobby?.code || 'CAL13'}
        onRevealClue={(title, content, newFairPrice) => {
          if (activeMarket) {
            revealClueReducer({
              marketId: activeMarket.marketId,
              title,
              content,
              newFairPrice,
            });
          }
        }}
        onClearClues={() => {
          if (activeMarket) {
            clearCluesReducer({ marketId: activeMarket.marketId });
          }
        }}
        onResolveMarket={winningSide => {
          if (activeMarket) {
            resolveMarketReducer({
              marketId: activeMarket.marketId,
              winningSide,
            });
          }
        }}
        onResetMarket={() => {
          if (activeMarket) {
            resetMarketReducer({
              marketId: activeMarket.marketId,
              defaultPrice: activeMarket.fairPrice || 50,
            });
          }
        }}
        onResetBalances={code => {
          resetLobbyBalancesReducer({ code });
        }}
      />
    </div>
  );
}
