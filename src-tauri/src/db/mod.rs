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
pub(crate) mod ddl_fragment;
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
pub mod row_cap;
pub mod search;
pub(crate) mod search_destructive;
pub(crate) mod search_dsl;
pub(crate) mod search_executor;
pub(crate) mod search_http;
pub(crate) mod search_live_destructive;
pub(crate) mod search_live_query;
pub mod sqlite;
pub(crate) mod tls;
pub mod traits;
pub mod types;

pub use adapters::sqlite::SqliteAdapter;
pub use duckdb::DuckdbAdapter;
pub use mongodb::MongoAdapter;
pub use mssql::{MssqlAdapter, MssqlConnectionOnlyAdapter};
pub use mysql::MysqlAdapter;
pub use oracle::{OracleAdapter, OracleRuntimeAdapter};
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

/// Issue #1079 — grid inline-edit commit contract: every statement in an
/// `execute_query_batch` targets exactly one row (single-cell UPDATE,
/// single-row DELETE/INSERT). A primary-key-less table can hold fully-
/// duplicate rows, and the grid's all-column WHERE fallback then matches every
/// duplicate, so a one-row intent silently becomes an N-row write with no
/// Safe Mode confirm/dry-run in the way. This guard rolls the whole
/// transaction back when a committed statement affects anything other than one
/// row. The `statement K of N failed:` prefix mirrors the per-statement
/// failure shape `executeRdbBatch` already routes on, so the commit banner
/// highlights the offending line without a frontend change.
///
/// ponytail: unconditional one-row rule — both current batch callers (the
/// structured grid commit and the raw-query grid edit) emit one-row
/// statements; a future multi-row batch caller would need an opt-out flag on
/// the IPC. MySQL reports *changed* (not matched) rows, so a no-op re-save of
/// an already-equal value can read 0 and roll back — harmless (no data loss)
/// and the grid skips unchanged edits anyway.
pub(crate) fn enforce_single_row_effect(
    statement_index: usize,
    total: usize,
    rows_affected: u64,
) -> Result<(), crate::error::AppError> {
    if rows_affected == 1 {
        return Ok(());
    }
    // Split the cause hint: 0 rows means the target vanished/changed (a primary
    // key would not have helped), N rows means it was not uniquely identified.
    let cause = if rows_affected == 0 {
        "the target row no longer matches — it may have been changed or removed since it was loaded"
    } else {
        "row is not uniquely identifiable — add a primary key or unique constraint"
    };
    Err(crate::error::AppError::Database(format!(
        "statement {} of {} failed: expected to affect exactly 1 row but affected {}; \
         transaction rolled back ({})",
        statement_index + 1,
        total,
        rows_affected,
        cause
    )))
}

/// Parse an ORDER BY direction token case-insensitively, normalizing to the
/// canonical uppercase `ASC`/`DESC`. Returns `None` for anything else so
/// callers skip malformed input. #1354 — postgres/mysql/duckdb previously
/// matched only the exact-case `"ASC"`/`"DESC"` literals and silently dropped a
/// valid lowercase `asc`, while oracle/mssql already folded case; this is the
/// single entry point that makes every adapter agree.
pub(crate) fn parse_order_direction(token: &str) -> Option<&'static str> {
    if token.eq_ignore_ascii_case("ASC") {
        Some("ASC")
    } else if token.eq_ignore_ascii_case("DESC") {
        Some("DESC")
    } else {
        None
    }
}

/// Clamp a caller-supplied `page_size` to at least 1. #1354 — only mssql/oracle
/// guarded this; a 0 (or negative) page size otherwise built an empty/invalid
/// `LIMIT`/`FETCH NEXT` clause per adapter. Shared entry point so every adapter
/// clamps identically.
pub(crate) fn clamp_page_size(page_size: i32) -> i32 {
    page_size.max(1)
}

#[cfg(test)]
mod query_param_tests {
    use super::{clamp_page_size, parse_order_direction};

    #[test]
    fn order_direction_folds_case_and_rejects_junk() {
        for token in ["ASC", "asc", "Asc", "aSc"] {
            assert_eq!(parse_order_direction(token), Some("ASC"), "{token}");
        }
        for token in ["DESC", "desc", "Desc"] {
            assert_eq!(parse_order_direction(token), Some("DESC"), "{token}");
        }
        for token in ["", "ascending", "DROP", "asc;"] {
            assert_eq!(parse_order_direction(token), None, "{token}");
        }
    }

    #[test]
    fn page_size_clamps_to_at_least_one() {
        assert_eq!(clamp_page_size(0), 1);
        assert_eq!(clamp_page_size(-5), 1);
        assert_eq!(clamp_page_size(1), 1);
        assert_eq!(clamp_page_size(100), 100);
    }
}

#[cfg(test)]
mod single_row_guard_tests {
    use super::enforce_single_row_effect;
    use crate::error::AppError;

    #[test]
    fn exactly_one_row_is_ok() {
        assert!(enforce_single_row_effect(0, 3, 1).is_ok());
    }

    #[test]
    fn zero_or_many_rows_roll_back_with_routable_message() {
        // 0-row (vanished row / NULL match) and N-row (duplicate mass write)
        // both violate the one-row contract. The message keeps the
        // `statement K of N failed:` prefix (1-based) so the commit banner
        // routes the failure back to the right preview line, and the cause
        // hint splits: 0-row must NOT claim a primary key would have helped.
        for (idx, total, affected, count_marker, cause_marker) in [
            (1usize, 2usize, 0u64, "affected 0", "no longer matches"),
            (2, 3, 4, "affected 4", "not uniquely identifiable"),
        ] {
            match enforce_single_row_effect(idx, total, affected) {
                Err(AppError::Database(msg)) => {
                    assert!(msg.contains(&format!("statement {} of {} failed", idx + 1, total)));
                    assert!(msg.contains(count_marker), "message missing count: {msg}");
                    assert!(msg.contains(cause_marker), "wrong cause hint: {msg}");
                }
                other => panic!("expected rollback error, got {other:?}"),
            }
        }
        // 0-row must not misattribute the cause to a missing key.
        let zero = enforce_single_row_effect(0, 1, 0).unwrap_err().to_string();
        assert!(
            !zero.contains("add a primary key"),
            "0-row cause misleads: {zero}"
        );
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) mod testing;
