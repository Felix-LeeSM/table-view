// Domain barrel for Tauri command wrappers.
//
// Pre-split (≤ Sprint 211) every wrapper lived in one ~688-line `tauri.ts`.
// The split lifts the pure invoke-passthroughs into domain files —
// `connection`, `schema`, `query`, `ddl`, `document`, `export` — while this
// barrel keeps the `@lib/tauri` import surface unchanged so the 30-odd
// call sites don't need touch-up. Adding a new command should land in the
// matching domain file (or a new one) rather than here.

export * from "./connection";
export * from "./schema";
export * from "./query";
export * from "./ddl";
export * from "./document";
export * from "./export";
