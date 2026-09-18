//! Q5.4 — runtime state modules split off from
//! `commands::connection::AppState`.
//!
//! `AppState` itself stays in `commands::connection` to preserve the
//! historical re-export shape (every command + test file imports
//! `crate::commands::connection::AppState`). Per-domain shards land
//! here so the introspection pool has a single owner without bloating
//! `commands::connection`.

pub mod introspection_pool;
