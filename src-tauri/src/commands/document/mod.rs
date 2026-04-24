//! Commands scoped to the document paradigm (Phase 6 / Sprint 66).
//!
//! Sprint 66 introduces the first four document-flavoured Tauri commands,
//! each a thin dispatcher that resolves the active connection, grabs the
//! `DocumentAdapter` via `ActiveAdapter::as_document()?`, and forwards to
//! the adapter trait method. All four commands are registered in
//! `src-tauri/src/lib.rs::run()`.
//!
//! Module split follows the RDB convention:
//!   - `browse` — read-only namespace/collection catalog introspection
//!     (`list_mongo_databases`, `list_mongo_collections`,
//!     `infer_collection_fields`).
//!   - `query`  — document read-path execution (`find_documents`).
//!
//! Future sprints will extend this directory with write-path commands
//! (insert/update/delete) and aggregate/MQL preview.

pub mod browse;
pub mod query;
