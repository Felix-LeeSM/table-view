/**
 * Nominal (branded) types — Phase 1 (issue #1493).
 *
 * Pure compile-time discipline: a `Brand<string, "X">` is structurally a
 * `string` at runtime (zero cost, erased by the compiler) but is NOT
 * mutually assignable with a differently-branded string. This lets the
 * compiler reject `(connectionId, tabId)` argument swaps that were silently
 * legal while both were plain `string`.
 *
 * Values enter branded types by assertion at their trust boundary only:
 * - `ConnectionId` — asserted once where a connection first materialises in
 *   the renderer (`normalizeConnectionConfig`, the Rust→TS IPC boundary) and
 *   again at the tab-creation boundary (`addTab` / `addQueryTab`), where a
 *   plain-`string` connection id off component props / DOM events is minted
 *   into `TableTab.connectionId` / `QueryTab.connectionId`. Every downstream
 *   tab read (the tab-close purge, the RDB retry path) then flows the brand
 *   un-cast instead of re-asserting it (issue #1494 follow-up).
 * - `TabId` — asserted once where a tab id is minted (`nextTabId` /
 *   `nextQueryId`). Rust `String` wire types stay unchanged; TS→Rust
 *   serialisation is automatic and needs no unwrap.
 * - `DatabaseName` / `SchemaName` / `TableName` — Phase 2 (issue #1494).
 *   The four positional args of `entryKey(connectionId, database, schema,
 *   table)` were all plain `string`, so a schema/table swap silently keyed a
 *   different table's pending edits (wrong-table update, edit loss). Each axis
 *   now carries a distinct brand, so a positional swap is a compile error.
 *   Asserted once at the `entryKey` call boundary (the tab-close purge and the
 *   grid pending-state hook), where the axes are read off a `TableTab`.
 *
 * Scope is deliberately narrow (issue #1493 과설계 경계): only identifiers
 * with a real swap-confusion history are branded. Do not brand SQL strings or
 * UI labels here. The `schemaStore` cache-layer key access
 * (`tableColumnsCache[conn][db][schema][table]`) shares the same swap risk but
 * is a much wider Record-typing surface — deferred to a follow-up.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ConnectionId = Brand<string, "ConnectionId">;
export type TabId = Brand<string, "TabId">;
export type DatabaseName = Brand<string, "DatabaseName">;
export type SchemaName = Brand<string, "SchemaName">;
export type TableName = Brand<string, "TableName">;
