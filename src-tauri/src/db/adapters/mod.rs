//! Canonical backend adapter modules.
//!
//! New adapter work lands under `db::adapters::<dbms>`. Legacy sibling modules
//! stay as compatibility shims until each adapter is migrated in a focused PR.
//!
//! Migration follow-up map:
//! - Keep root re-exports and legacy `db::<dbms>` paths while moving one DBMS
//!   at a time.
//! - Move file-backed adapters before server-backed adapters because they have
//!   deterministic local contract tests and no external runtime dependency.
//! - Do not widen product support or capability claims during topology moves.

pub mod sqlite;

pub use sqlite::SqliteAdapter;

#[cfg(test)]
mod tests;
