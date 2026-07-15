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
 *   the renderer (`normalizeConnectionConfig`, the Rust→TS IPC boundary).
 * - `TabId` — asserted once where a tab id is minted (`nextTabId` /
 *   `nextQueryId`). Rust `String` wire types stay unchanged; TS→Rust
 *   serialisation is automatic and needs no unwrap.
 *
 * Scope is deliberately narrow (issue #1493 과설계 경계): only identifiers
 * with a real swap-confusion history are branded. Do not brand SQL strings,
 * UI labels, or db/schema/table names here — those are Phase 2/3.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ConnectionId = Brand<string, "ConnectionId">;
export type TabId = Brand<string, "TabId">;
