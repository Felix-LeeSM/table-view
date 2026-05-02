//! MongoDB adapter — Sprint 197 split (4-way module reorg).
//!
//! Pre-split the entire adapter lived in a 1809-line `db/mongodb.rs`. Sprint
//! 197 carved that into four topic files:
//!
//! * [`connection`] — `MongoAdapter` struct + connection lifecycle (build /
//!   probe / `current_client` / `switch_active_db` / `resolved_db_name`)
//!   + `impl DbAdapter`.
//! * [`schema`] — `list_databases` / `list_collections` /
//!   `infer_collection_fields` bodies + sample-driven column inference
//!   helpers.
//! * [`queries`] — `find` / `aggregate` bodies + cursor flattening helpers
//!   (`validate_ns`, `flatten_cell`, `columns_from_docs`, `project_row`).
//! * [`mutations`] — `insert_document` / `update_document` /
//!   `delete_document` bodies + `DocumentId` ↔ `Bson` round-trip helpers.
//!   Sprint 198 will land bulk-write commands here.
//!
//! ## Trait dispatch pattern
//!
//! Each topic file defines a `pub(super) async fn <method>_impl(...)` on
//! `MongoAdapter` (inherent impl). This module holds the single
//! `impl DocumentAdapter for MongoAdapter` block which wraps each impl in
//! `BoxFuture` + `tokio::select!` (cancel-token cooperation, ADR-0018) and
//! delegates. Behavior is identical to the pre-split monolith — the split
//! is module-organisational only.
//!
//! Pre-split history docs (Sprint 65 / 66 / 72 / 80 / 131 / 137 / 180)
//! moved verbatim into the topic files; this `mod.rs` only carries the
//! dispatch + module composition.
//!
//! ## State
//!
//! The adapter holds `(Option<Client>, Option<String>, Option<String>)`
//! under three `tokio::sync::Mutex`es — see `connection.rs` for the
//! struct + lock discipline rationale.
//!
//! ## BSON → row cell flattening
//!
//! Per the execution brief, each document field becomes exactly one cell:
//!
//! * scalar BSON (`String`, `Int32/64`, `Double`, `Bool`, `Null`,
//!   `ObjectId`, `DateTime`) — serialised via `bson::Bson::serialize` which
//!   emits canonical extended JSON (`{"$oid": "..."}`, `{"$date": "..."}`),
//!   matching what the Quick Look panel (Sprint 67) expects to see.
//! * `Document(_)` — replaced with the sentinel string `"{...}"`.
//! * `Array(arr)` — replaced with the sentinel string `"[N items]"`.
//!
//! The sentinel strings are the contract the DataGrid consumes to decide
//! whether to render a muted/read-only cell and block inline edit; the
//! frontend regex is `^\[\d+ items\]$` / exact match `"{...}"`.

mod connection;
mod mutations;
mod queries;
mod schema;

pub use connection::MongoAdapter;

use bson::Document;

use crate::error::AppError;
use crate::models::{ColumnInfo, TableInfo};

use super::{BoxFuture, DocumentAdapter, DocumentId, DocumentQueryResult, FindBody, NamespaceInfo};

impl DocumentAdapter for MongoAdapter {
    /// Sprint 131 — delegates to the inherent `switch_active_db` so the
    /// trait dispatcher can drive Mongo DB swaps from the unified
    /// `switch_active_db` Tauri command. Mirrors
    /// `PostgresAdapter::switch_database` (S130).
    fn switch_database<'a>(&'a self, db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.switch_active_db(db_name).await })
    }

    /// Sprint 132 — surface the in-memory `active_db` selection without a
    /// driver round-trip. The `verify_active_db` Tauri command compares
    /// this against the optimistic `setActiveDb` value the frontend wrote
    /// after a raw-query DB switch, so the answer must mirror exactly
    /// what `current_active_db()` would return — same accessor.
    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async move { Ok(self.current_active_db().await) })
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move { self.list_databases_impl().await })
    }

    fn list_collections<'a>(
        &'a self,
        db: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        // Sprint 180 (AC-180-04): the `tokio::select!` races driver work
        // against the cancel-token's `cancelled()` future. On cancel we
        // return the same `AppError::Database("Operation cancelled")`
        // shape used by `PostgresAdapter::execute_query`. The Mongo
        // driver's bundled version does NOT expose `killOperations`
        // so cancellation is cooperative-only — the future drops
        // locally; server-side work may continue briefly until the
        // driver's connection-level cleanup applies. This is the
        // documented per-adapter policy in ADR-0018.
        Box::pin(async move {
            let work = self.list_collections_impl(db);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn infer_collection_fields<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        sample_size: usize,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move {
            let work = self.infer_collection_fields_impl(db, collection, sample_size);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn find<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        body: FindBody,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async move {
            let work = self.find_impl(db, collection, body);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn aggregate<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        pipeline: Vec<Document>,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async move {
            let work = self.aggregate_impl(db, collection, pipeline);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn insert_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        doc: Document,
    ) -> BoxFuture<'a, Result<DocumentId, AppError>> {
        Box::pin(async move { self.insert_document_impl(db, collection, doc).await })
    }

    fn update_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        id: DocumentId,
        patch: Document,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.update_document_impl(db, collection, id, patch).await })
    }

    fn delete_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        id: DocumentId,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.delete_document_impl(db, collection, id).await })
    }

    fn delete_many<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: Document,
    ) -> BoxFuture<'a, Result<u64, AppError>> {
        Box::pin(async move { self.delete_many_impl(db, collection, filter).await })
    }

    fn update_many<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: Document,
        patch: Document,
    ) -> BoxFuture<'a, Result<u64, AppError>> {
        Box::pin(async move { self.update_many_impl(db, collection, filter, patch).await })
    }

    fn drop_collection<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.drop_collection_impl(db, collection).await })
    }
}
