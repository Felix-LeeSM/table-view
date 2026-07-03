//! Commands scoped to the relational-database (RDB) paradigm.
//!
//! Sprint 64 split the former flat `commands/{schema,query}.rs` into three
//! submodules under `commands/rdb/`:
//!   - `schema` — read-only catalog introspection (list_schemas, list_tables,
//!     get_table_columns, list_schema_columns, get_table_indexes,
//!     get_table_constraints, list_views, list_functions, get_view_definition,
//!     get_view_columns, get_function_source).
//!   - `query`  — query execution/cancellation and tabular paging
//!     (`execute_query`, `cancel_query`, `query_table_data`).
//!   - `ddl`    — schema-changing operations (drop_table, rename_table,
//!     alter_table, create_index, drop_index, add_constraint, drop_constraint).
//!
//! All command function names are preserved unchanged so that frontend
//! `invoke("…")` call sites remain valid after the reorganization.
//!
//! Sprint 237 P5+ (2026-05-08) — `register_cancel_token` /
//! `release_cancel_token` helpers were hoisted to `commands/mod.rs` (twin
//! copy with `commands/document/mod.rs` collapsed). 본 모듈은 sub-files
//! 가 `use super::{register_cancel_token, release_cancel_token}` 패턴을
//! 그대로 유지하도록 re-export 만 둔다.
//!
//! Sprint 271c (2026-05-13) — `ensure_expected_db` hoisted from
//! `schema.rs` to this module so the 11 DDL handlers can share the same
//! mismatch-probe helper as the 12 schema introspection handlers (23
//! call sites total). `query.rs` keeps the probe inline because its
//! `cancel_handle` release ordering differs (271b decision).

pub mod ddl;
pub mod query;
pub mod schema;

pub(super) use crate::commands::{not_connected, register_cancel_token, release_cancel_token};

use crate::error::AppError;

/// Sprint 271 — shared mismatch probe. Issue #1087 — the caller now holds a
/// resolved `Arc<ActiveAdapter>` handle (via `AppState::active_adapter`)
/// rather than the `active_connections` lock. The probe and the eventual
/// trait invocation target the same adapter instance but are separate awaits:
/// a concurrent same-connection `switch_active_db` landing between them is a
/// narrow TOCTOU this best-effort guard cannot catch (recorded in
/// docs/product/known-limitations.md). Returns `Ok(())` when the guard is
/// satisfied (or opted out via `None`), otherwise
/// `AppError::DbMismatch { expected, actual }` — byte-equivalent to the
/// Sprint 266 reference probe at
/// `src-tauri/src/commands/rdb/query.rs:83–92`.
///
/// Sprint 271c (2026-05-13) hoisted this helper from `schema.rs` to
/// `mod.rs` so DDL handlers share the same body. `query.rs` still
/// inlines the probe because it must call `release_cancel_token` on the
/// mismatch early-return path before dropping the lock guard — a leaky
/// signature to add here for two call sites.
pub(super) async fn ensure_expected_db(
    adapter: &dyn crate::db::RdbAdapter,
    expected_database: Option<&str>,
) -> Result<(), AppError> {
    if let Some(expected) = expected_database {
        let actual = adapter.current_database().await?.unwrap_or_default();
        if actual != expected {
            return Err(AppError::DbMismatch {
                expected: expected.to_string(),
                actual,
            });
        }
    }
    Ok(())
}
