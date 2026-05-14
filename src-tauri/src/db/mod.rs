//! Database adapter layer — entry module.
//!
//! Sprint 213 (P5 step 2) split the previous 1425-line `mod.rs` into:
//! - `types`   — paradigm-neutral DTOs and the `BoxFuture` alias.
//! - `traits`  — `DbAdapter` lifecycle + 4 paradigm extension traits.
//! - `active`  — `ActiveAdapter` enum + paradigm-typed accessors.
//! - `tests`   — unit tests (Sprint P5 step 1, commit a60074d).
//!
//! Concrete adapters (`mongodb`, `postgres`) live in their own sibling
//! directories. The public API is preserved via the `pub use` block below
//! so external call sites continue to import `crate::db::DbAdapter`,
//! `crate::db::ActiveAdapter`, `crate::db::DocumentId`, etc. unchanged.

pub mod active;
pub mod mongodb;
pub mod mysql;
pub mod postgres;
pub mod traits;
pub mod types;

pub use mongodb::MongoAdapter;
pub use mysql::MysqlAdapter;
pub use postgres::PostgresAdapter;

pub use active::ActiveAdapter;
pub use traits::{DbAdapter, DocumentAdapter, KvAdapter, RdbAdapter, SearchAdapter};
pub use types::{
    BoxFuture, BulkWriteOp, BulkWriteResult, DocumentId, DocumentQueryResult, DocumentRow,
    FindBody, NamespaceInfo, NamespaceLabel, RdbQueryResult,
};

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) mod testing;
