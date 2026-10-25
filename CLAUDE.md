# SpacetimeDB Core Concepts

## Critical Rules

1. **Reducers are transactional.** They do not return data to callers. Use subscriptions to read data.
2. **Reducers must be deterministic.** Do not use filesystem, network, external clocks, or external random sources in reducers. Use the reducer context (`ctx`) for SpacetimeDB-provided timestamp and deterministic random values.
3. **Read data via tables/subscriptions**, not reducer return values. Clients get data through subscribed queries.
4. **Auto-increment IDs are not sequential.** Gaps are normal, do not use for ordering. Use timestamps or explicit sequence columns.
5. **`ctx.sender` is the authenticated principal.** Never trust identity passed as arguments.

## Tables

- **Private tables** (default): Only accessible by reducers and the database owner.
- **Public tables**: Exposed for client read access through subscriptions. Writes still require reducers.

## Event Tables

Event tables broadcast reducer-specific data to clients. Rows are never stored in the client cache (`count()` returns 0, `iter()` yields nothing); only `onInsert` callbacks fire.

## Further reference

- Server module (TypeScript SDK) reference: `spacetimedb/CLAUDE.md`
- Client SDK reference (React and vanilla, also used by `scripts/whale_bot.ts`): `src/CLAUDE.md`
