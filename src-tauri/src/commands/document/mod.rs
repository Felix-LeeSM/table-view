//! Commands scoped to the document paradigm (Phase 6 / Sprints 66 + 72).
//!
//! Sprint 66 introduced the first four document-flavoured Tauri commands,
//! each a thin dispatcher that resolves the active connection, grabs the
//! `DocumentAdapter` via `ActiveAdapter::as_document()?`, and forwards to
//! the adapter trait method. Sprint 72 adds `aggregate_documents` alongside
//! `find_documents` so the frontend can submit an aggregation pipeline. All
//! commands are registered in `src-tauri/src/lib.rs::run()`.
//!
//! Module split follows the RDB convention:
//!   - `browse` — read-only namespace/collection catalog introspection
//!     (`list_mongo_databases`, `list_mongo_collections`,
//!     `infer_collection_fields`).
//!   - `query`  — document read-path execution (`find_documents`,
//!     `aggregate_documents`).
//!
//! Future sprints will extend this directory with write-path commands
//! (insert/update/delete) and MQL preview.

pub mod browse;
pub mod query;
