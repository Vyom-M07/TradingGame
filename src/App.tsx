import { useState, useMemo, useEffect, useRef } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings';
import { Lobby } from './module_bindings/types';
import { Navbar } from './components/Navbar';
import { MarketBanner } from './components/MarketBanner';
import { ClassroomClues } from './components/ClassroomClues';
import { OrderBook } from './components/OrderBook';
import { TradeTicket } from './components/TradeTicket';
import { RecentTrades } from './components/RecentTrades';
import { Portfolio } from './components/Portfolio';
import { CreateMarketModal } from './components/CreateMarketModal';
import { LobbyModal } from './components/LobbyModal';

export default function App() {
  const { isActive: connected, identity: myIdentity } = useSpacetimeDB();

  // Reactive SpacetimeDB table subscriptions
  const [markets] = useTable(tables.market);
  const [orders] = useTable(tables.order);
  const [players] = useTable(tables.player);
  const [positions] = useTable(tables.position);
  const [trades] = useTable(tables.trade);
  const [clues] = useTable(tables.clue);
  const [lobbies] = useTable(tables.lobby);

  const optimalBotTickReducer = useReducer(reducers.optimalBotTick);
  const joinLobbyReducer = useReducer(reducers.joinLobby);

  const [selectedMarketId, setSelectedMarketId] = useState<bigint | null>(null);
  const [selectedPrice, setSelectedPrice] = useState<{ price: number; side: 'BID' | 'ASK' } | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLobbyModalOpen, setIsLobbyModalOpen] = useState(false);

  // Active Lobby State & URL Parameter Handling (?lobby=CAL13)
  const [selectedLobbyCode, setSelectedLobbyCode] = useState<string | null>(null);

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

  // Sync market and join lobby to receive initial starting bankroll
  useEffect(() => {
    if (activeLobby && connected) {
      if (activeLobby.marketId) {
        setSelectedMarketId(activeLobby.marketId);
      }
      try {
        joinLobbyReducer({ code: activeLobby.code });
      } catch {
        // Ignored if already joined
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

  // RBAC: Check if current player is the Instructor for active lobby
  const isInstructor = useMemo(() => {
    if (!myIdentity || !activeLobby) return false;
    const myHex = myIdentity.toHexString();
    const instHex = activeLobby.instructor.toHexString();
    // Match caller's identity or unassigned system identity
    return instHex === myHex || instHex.replace(/0/g, '') === '';
  }, [myIdentity, activeLobby]);

  // Current player record
  const currentPlayer = useMemo(() => {
    if (!myIdentity) return null;
    const hex = myIdentity.toHexString();
    return players.find(p => p.identity.toHexString() === hex) ?? null;
  }, [players, myIdentity]);

  // Auto-bot autonomous engine state
  const [isAutoBotRunning, setIsAutoBotRunning] = useState(false);
  const [botSpeedMs, setBotSpeedMs] = useState(600);

  // Autonomous Bot Execution Interval Loop
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

  const handleSelectPrice = (price: number, side: 'BID' | 'ASK') => {
    setSelectedPrice({ price, side });
  };

  const handleSelectLobby = (lobby: Lobby) => {
    setSelectedLobbyCode(lobby.code);
    setSelectedMarketId(lobby.marketId);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-white">
      {/* Top Navbar with Account Switcher, Lobby Indicator & QR Button */}
      <Navbar
        connected={connected}
        myIdentity={myIdentity ?? null}
        player={currentPlayer}
        activeLobby={activeLobby}
        isInstructor={isInstructor}
        onOpenLobbyModal={() => setIsLobbyModalOpen(true)}
        isAutoBotRunning={isAutoBotRunning}
        onToggleAutoBot={() => setIsAutoBotRunning(prev => !prev)}
        botSpeedMs={botSpeedMs}
        onChangeBotSpeed={setBotSpeedMs}
      />

      {/* Main Terminal Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-5">
        {/* Market Banner / Stats Header (with Instructor Resolution Controls) */}
        <MarketBanner
          markets={markets}
          activeMarket={activeMarket}
          isInstructor={isInstructor}
          onSelectMarket={id => {
            setSelectedMarketId(id);
            setSelectedPrice(null);
          }}
          onOpenCreateModal={() => setIsCreateModalOpen(true)}
        />

        {/* Classroom / Progressive Card & Information Revelation Stream */}
        <ClassroomClues
          activeMarket={activeMarket}
          clues={clues}
          isInstructor={isInstructor}
        />

        {/* 3-Column Trading Deck */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
          {/* Col 1: Central Limit Order Book (CLOB with YES/NO Dual-Denomination View) */}
          <div className="min-h-[480px]">
            <OrderBook
              orders={orders}
              activeMarketId={activeMarket?.marketId ?? null}
              lastTradedPrice={activeMarket ? activeMarket.lastTradedPrice : 50}
              myIdentity={myIdentity ?? null}
              onSelectPrice={handleSelectPrice}
            />
          </div>

          {/* Col 2: Trade Execution Ticket with EV Optimality Gauge */}
          <div className="min-h-[480px]">
            <TradeTicket
              connected={connected}
              market={activeMarket}
              player={currentPlayer}
              selectedPrice={selectedPrice}
            />
          </div>

          {/* Col 3: Live Trades Tape with Participant Badges */}
          <div className="min-h-[480px] md:col-span-2 lg:col-span-1">
            <RecentTrades
              trades={trades}
              activeMarketId={activeMarket?.marketId ?? null}
              myIdentity={myIdentity ?? null}
            />
          </div>
        </div>

        {/* Bottom Section: Positions & Open Orders */}
        <div>
          <Portfolio
            myIdentity={myIdentity ?? null}
            player={currentPlayer}
            positions={positions}
            orders={orders}
            markets={markets}
            onSelectMarket={id => {
              setSelectedMarketId(id);
              setSelectedPrice(null);
            }}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 px-6 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>
            Deterministic CLOB Engine • Autonomous AMM & Value Sniper Bots
          </span>
          <span className="font-mono text-slate-400">
            Strict Integer-Cents Math (1¢ - 99¢) • Payout $1.00/contract
          </span>
        </div>
      </footer>

      {/* Create Market Modal */}
      <CreateMarketModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      {/* Lobby Management & QR Code Modal */}
      <LobbyModal
        isOpen={isLobbyModalOpen}
        onClose={() => setIsLobbyModalOpen(false)}
        activeLobby={activeLobby}
        allLobbies={lobbies}
        markets={markets}
        myIdentity={myIdentity ?? null}
        onSelectLobby={handleSelectLobby}
      />
    </div>
  );
}
