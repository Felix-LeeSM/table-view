//! Database adapter layer — entry module.
//!
//! Sprint 213 (P5 step 2) split the previous 1425-line `mod.rs` into:
//! - `types`   — paradigm-neutral DTOs and the `BoxFuture` alias.
//! - `traits`  — `DbAdapter` lifecycle + 4 paradigm extension traits.
//! - `active`  — `ActiveAdapter` enum + paradigm-typed accessors.
//! - `tests`   — unit tests (Sprint P5 step 1, commit a60074d).
//!
//! Backend adapter topology now exposes:
//! - `adapters/<dbms>` — canonical concrete adapter modules.
//! - `contracts`      — shared trait and DTO contract surface.
//! - `capabilities`   — backend capability/profile imports.
//!
//! Legacy sibling modules and public re-exports stay in place so external call
//! sites continue to import `crate::db::DbAdapter`, `crate::db::ActiveAdapter`,
//! `crate::db::DocumentId`, etc. unchanged.

pub mod active;
pub mod adapters;
pub mod capabilities;
pub mod contracts;
pub mod duckdb;
pub mod fixtures;
pub mod kv_trait;
pub mod kv_types;
pub mod mongodb;
pub mod mssql;
pub mod mysql;
pub mod oracle;
pub mod postgres;
pub(crate) mod raw_where;
pub mod redis;
pub mod search;
pub(crate) mod search_destructive;
pub(crate) mod search_dsl;
pub(crate) mod search_executor;
pub(crate) mod search_http;
pub(crate) mod search_live_destructive;
pub(crate) mod search_live_query;
pub mod sqlite;
pub mod traits;
pub mod types;

pub use adapters::sqlite::SqliteAdapter;
pub use duckdb::DuckdbAdapter;
pub use mongodb::MongoAdapter;
pub use mssql::{MssqlAdapter, MssqlConnectionOnlyAdapter};
pub use mysql::MysqlAdapter;
pub use oracle::OracleAdapter;
pub use postgres::PostgresAdapter;
pub use redis::RedisAdapter;
pub use search::SearchEngineAdapter;

pub use active::ActiveAdapter;
pub use contracts::KvAdapter;
pub use contracts::{
    BoxFuture, BulkWriteOp, BulkWriteResult, CollectionValidatorRead, CreateMongoIndexRequest,
    CreateMongoIndexResult, DocumentCollectionInfo, DocumentCollectionType, DocumentId,
    DocumentQueryResult, DocumentResultEnvelope, DocumentResultEnvelopeKind, DocumentRow, FindBody,
    MongoIndexCollation, MongoIndexDirection, MongoIndexField, NamespaceInfo, NamespaceLabel,
    RdbQueryResult,
};
pub use contracts::{DbAdapter, DocumentAdapter, RdbAdapter, SearchAdapter};
pub use kv_types::{
    bytes_to_kv_string, KvCommandRequest, KvDatabaseInfo, KvDeleteRequest, KvHashField,
    KvHashValue, KvIndexedValue, KvJsonValue, KvKeyMetadata, KvKeyScanPage, KvKeyScanRequest,
    KvKeyType, KvListValue, KvMutationResult, KvScoredValue, KvSetStringRequest, KvSetValue,
    KvStreamEntry, KvStreamReadRequest, KvStreamReadResult, KvStringEncoding, KvStringValue, KvTtl,
    KvTtlState, KvTtlUpdate, KvTtlUpdateRequest, KvValue, KvValueEnvelope, KvValueReadRequest,
    KvWriteSafety, KvZSetValue,
};

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) mod testing;
