/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** SpacetimeDB WebSocket URI, e.g. ws://localhost:3000 or wss://maincloud.spacetimedb.com */
  readonly VITE_SPACETIMEDB_URI?: string;
  /** Published database name, e.g. serious-trading */
  readonly VITE_SPACETIMEDB_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
