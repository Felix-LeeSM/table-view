//! Commands scoped to the document paradigm (Phase 6 / Sprints 66 + 72 + 80).
//!
//! Sprint 66 introduced the first four document-flavoured Tauri commands,
//! each a thin dispatcher that resolves the active connection, grabs the
//! `DocumentAdapter` via `ActiveAdapter::as_document()?`, and forwards to
//! the adapter trait method. Sprint 72 adds `aggregate_documents` alongside
//! `find_documents` so the frontend can submit an aggregation pipeline.
//! Sprint 80 (Phase 6 F-1) closes the backend half of the write path by
//! adding `insert_document` / `update_document` / `delete_document`.
//! All commands are registered in `src-tauri/src/lib.rs::run()`.
//!
//! Module split follows the RDB convention:
//!   - `browse` — read-only namespace/collection catalog introspection
//!     (`list_mongo_databases`, `list_mongo_collections`,
//!     `infer_collection_fields`).
//!   - `query`  — document read-path execution (`find_documents`,
//!     `aggregate_documents`).
//!   - `mutate` — write-path dispatch (`insert_document`,
//!     `update_document`, `delete_document`). Sprint 86 (F-2) will wire the
//!     frontend `mqlGenerator.ts` + `useDataGridEdit` paradigm dispatch, and
//!     Sprint 87 (F-3) will complete the inline-edit UI + AddDocumentModal.
//!
//! Sprint 237 P5+ (2026-05-08) — `register_cancel_token` /
//! `release_cancel_token` helpers were hoisted to `commands/mod.rs` (twin
//! copy with `commands/rdb/mod.rs` collapsed). sub-files 의
//! `use super::{register_cancel_token, release_cancel_token}` 호환을 위해
//! re-export 만 둔다.

pub mod browse;
pub mod mutate;
pub mod query;

pub(super) use crate::commands::{not_connected, register_cancel_token, release_cancel_token};
