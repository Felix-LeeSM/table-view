//! Backwards-compatibility shim for the pre-Sprint 64 `commands::query`
//! module.
//!
//! Sprint 64 moved the RDB query command handlers into
//! `commands::rdb::query`. Integration tests (which cannot be modified per
//! contract invariant) still import the input validators from this path:
//!
//! ```ignore
//! use table_view_lib::commands::query::{validate_cancel_inputs, validate_query_inputs};
//! ```
//!
//! We keep the legacy path alive as a thin re-export so those tests compile
//! unchanged while the Tauri `invoke_handler` resolves the fresh
//! `commands::rdb::query::{execute_query, cancel_query}` paths.

pub use crate::commands::rdb::query::{validate_cancel_inputs, validate_query_inputs};
