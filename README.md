# Spacetime CLOB: Real-Time Prediction Market (Cal Hacks 13.0)

A high-frequency binary prediction market (like Kalshi / Polymarket) powered by a **Central Limit Order Book (CLOB)** and an **Automated Market Maker (AMM) Liquidity Bot** running entirely inside **SpacetimeDB** (TypeScript backend module hitting up to 300,000 TPS).

Built for **Cal Hacks 13.0** on the **SpacetimeDB Track**.

---

## ⚡ Architectural Highlights

1. **Database IS the Server**: Zero traditional REST/GraphQL APIs or middleware servers. All state, tables, and matching logic run directly inside SpacetimeDB.
2. **Deterministic Matching Engine**:
   - Price-time priority (FIFO) execution.
   - Strict integer math: prices are in cents ($1 \le P \le 99$).
   - Binary constraint: $1\text{ YES} + 1\text{ NO} = \$1.00\text{ (100¢)}$.
   - Crossing resting orders: YES bids match NO bids when $P_{\text{YES}} + P_{\text{NO}} \ge 100$. Unfilled remainders rest in the order book.
   - Immediate price improvement refunds to takers.
3. **Automated Liquidity Bot (AMM)**:
   - Server-side bot constantly provides baseline depth around fair value.
   - Dynamic tick simulation for demonstrating high-frequency real-time updates.
4. **Zero-Latency Reactive UI**:
   - React + TypeScript + Tailwind CSS terminal.
   - Subscribes directly to SpacetimeDB tables via WebSockets (`useTable`, `useReducer`, `useSpacetimeDB`).
   - Zero polling, zero manual refetching.

---

## 📁 Project Structure

```text
TradingGame/
├── spacetimedb/                   # SpacetimeDB TypeScript Server Module
│   ├── src/
│   │   └── index.ts               # Tables, reducers (CLOB matching engine, AMM, settlement)
│   ├── package.json
│   └── tsconfig.json
├── src/                           # React Frontend Client
│   ├── components/
│   │   ├── Navbar.tsx             # Header, connection status, cash balance, faucet
│   │   ├── MarketBanner.tsx       # Implied probability bar, market stats, resolution actions
│   │   ├── OrderBook.tsx          # Live visual CLOB stack with depth bars
│   │   ├── TradeTicket.tsx        # Buy YES / Buy NO ticket with price & quantity sliders
│   │   ├── RecentTrades.tsx       # Live tape stream of matched fills
│   │   ├── Portfolio.tsx          # User positions, open resting orders with cancel action
│   │   └── CreateMarketModal.tsx  # Launch custom prediction markets
│   ├── module_bindings/           # Auto-generated SpacetimeDB TypeScript SDK glue
│   ├── App.tsx                    # Main terminal dashboard
│   ├── main.tsx                   # SpacetimeDBProvider connection setup
│   └── index.css                  # Dark-mode terminal theme
├── .agents/skills/                # SpacetimeDB agent skills (cli, concepts, ts-server, ts-client...)
├── .cursor/rules/                 # Cursor AI agent rules
├── AGENTS.md / CLAUDE.md          # Multi-agent rules and guides
├── spacetime.json                 # SpacetimeDB configuration
└── package.json                   # Client build scripts
```

---

## 🚀 Quick Start (Running Locally)

### 1. Prerequisites
- **Node.js** (v18+)
- **SpacetimeDB CLI** installed (`spacetime --version`)

### 2. Start the Local SpacetimeDB Server
```powershell
spacetime start --listen-addr 127.0.0.1:3000 --in-memory
```

### 3. Build & Publish the Module
```powershell
# In a new terminal:
npm run server:publish
```

### 4. Start the Frontend Trading Terminal
```powershell
npm run dev
```
Navigate to `http://localhost:5173`.

---

## 🎮 Demo & Judge Walkthrough

1. **Live Order Book & Spread**: Watch resting orders placed by the AMM bot around the fair price.
2. **Instant Trading**:
   - Use the **Trade Ticket** to place a limit order for **BUY YES** or **BUY NO**.
   - If crossed against the book, watch the trade instantly execute on the tape and update your position.
   - If not crossed, watch it appear in the **Live Order Book** and in **Open Orders**.
3. **AMM Liquidity Bot**:
   - Click **"AMM Replenish"** in the top navigation to watch the bot recalculate and refill resting bids and asks.
   - Click **"Simulate Tick"** to observe real-time micro-movements powered by SpacetimeDB's sub-millisecond reactive subscriptions.
4. **Market Settlement**:
   - Click **"Resolve YES"** or **"Resolve NO"** in the Market Banner.
   - Winning shares pay out **100¢ ($1.00)** each directly into the player's cash balance; losing shares pay 0¢.
   - Click **"Reset Market"** to reset and trade again.
5. **Faucet**:
   - Click **"+$500 Faucet"** anytime to claim test cash.

---

## 🤖 Agent Skills & Rules
The project ships with the full suite of SpacetimeDB skills in `.agents/skills/`:
- `cli`: SpacetimeDB CLI reference
- `concepts`: Architecture, "Zen of Spacetime", and transactional rules
- `typescript-server`: Server module table definitions, schema builders, and reducers
- `typescript-client`: React hooks, connection management, and reactive subscriptions
- Pre-configured rules for Claude Code, Cursor, Windsurf, Copilot, and Codex.
