//! Sprint 359 (Phase 2 Q5.4) — runtime state modules split off from
//! `commands::connection::AppState`.
//!
//! `AppState` itself stays in `commands::connection` to preserve the
//! historical re-export shape (every command + test file imports
//! `crate::commands::connection::AppState`). New per-domain shards land
//! here so the introspection pool and future tab-affinity helpers have
//! a single owner without bloating `commands::connection`.

pub mod introspection_pool;
