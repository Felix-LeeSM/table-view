// Domain barrel for Tauri command wrappers.
//
// Wrappers are split into domain files — `connection`, `schema`, `query`,
// `ddl`, `document`, `export` — while this barrel keeps the `@lib/tauri`
// import surface stable so call sites don't need touch-up. Adding a new
// command should land in the matching domain file (or a new one) rather
// than here.

export * from "./connection";
export * from "./schema";
export * from "./query";
export * from "./ddl";
export * from "./document";
export * from "./export";
export * from "./fileAnalytics";
// Sprint 361 (Phase 3, Q13) — per-conn workspace window launcher.
export * from "./window";

// Sprint 247 (ADR 0022 Phase 3) — explicit re-export so a verbatim grep
// against this barrel surfaces the dry-run symbol used by Phase 3 wiring.
// The `export * from "./query"` line above already re-exports it
// transitively; this line is the canonical, symbol-by-name landing.
export { executeQueryDryRun } from "./query";
