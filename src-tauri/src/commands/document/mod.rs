//! Commands scoped to the document paradigm.
//!
//! The first four document-flavoured Tauri commands are
//! each a thin dispatcher that resolves the active connection, grabs the
//! `DocumentAdapter` via `ActiveAdapter::as_document()?`, and forwards to
//! the adapter trait method. `aggregate_documents` sits alongside
//! `find_documents` so the frontend can submit an aggregation pipeline.
//! `insert_document` / `update_document` / `delete_document` close the
//! backend half of the write path.
//! All commands are registered in `src-tauri/src/lib.rs::run()`.
//!
//! Module split follows the RDB convention:
//!   - `browse` — read-only namespace/collection catalog introspection
//!     (`list_mongo_databases`, `list_mongo_collections`,
//!     `infer_collection_fields`).
//!   - `query`  — document read-path execution (`find_documents`,
//!     `aggregate_documents`).
//!   - `mutate` — write-path dispatch (`insert_document`,
//!     `update_document`, `delete_document`). The frontend
//!     `mqlGenerator.ts` + `useDataGridEdit` paradigm dispatch and the
//!     inline-edit UI + AddDocumentModal remain to be wired.
//!
//! (2026-05-08) — `register_cancel_token` /
//! `release_cancel_token` helpers were hoisted to `commands/mod.rs` (twin
//! copy with `commands/rdb/mod.rs` collapsed). Only re-exports remain,
//! so the sub-files' `use super::{register_cancel_token,
//! release_cancel_token}` keeps working.

pub mod browse;
mod bulk_write_parse;
pub mod mutate;
pub mod query;

pub(super) use crate::commands::{not_connected, register_cancel_token, release_cancel_token};
