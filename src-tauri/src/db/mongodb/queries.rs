//! MongoDB query path — `find` / `aggregate` + cursor flattening helpers.
//!
//! Sprint 197 split — extracted from `db/mongodb.rs` (1809-line monolith)
//! together with `connection.rs` / `schema.rs` / `mutations.rs`. Body kept
//! verbatim from the pre-split file (Sprint 66 + Sprint 72 contract); the
//! split is module-organisational only, no runtime behavior change.

use std::time::Instant;

use ::mongodb::options::FindOptions;
use bson::{Bson, Document};
use futures_util::stream::StreamExt;

use crate::error::AppError;
use crate::models::QueryColumn;

use super::super::{DocumentQueryResult, FindBody};
use super::MongoAdapter;

impl MongoAdapter {
    /// Sprint 197 — body of `DocumentAdapter::find`. The trait dispatcher in
    /// `mod.rs` wraps this in `BoxFuture` and `tokio::select!` for cancel
    /// cooperation; logic identical to pre-split.
    pub(super) async fn find_impl(
        &self,
        db: &str,
        collection: &str,
        body: FindBody,
    ) -> Result<DocumentQueryResult, AppError> {
        validate_ns(db, collection)?;
        let started = Instant::now();
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let FindBody {
            filter,
            sort,
            projection,
            skip,
            limit,
        } = body;

        let mut opts = FindOptions::default();
        if let Some(s) = sort {
            opts.sort = Some(s);
        }
        if let Some(p) = projection {
            opts.projection = Some(p);
        }
        if skip > 0 {
            opts.skip = Some(skip);
        }
        // `limit = 0` is treated as "no explicit limit" to match the
        // default behaviour documented on the DocumentAdapter trait;
        // values > 0 are forwarded verbatim.
        if limit > 0 {
            opts.limit = Some(limit);
        }

        let mut cursor = coll
            .find(filter)
            .with_options(opts)
            .await
            .map_err(|e| AppError::Database(format!("find failed: {e}")))?;

        let mut raw_documents: Vec<Document> = Vec::new();
        while let Some(next) = cursor.next().await {
            match next {
                Ok(d) => raw_documents.push(d),
                Err(e) => {
                    return Err(AppError::Database(format!("cursor iteration failed: {e}")));
                }
            }
        }

        // Derive the column order from the returned batch so the grid
        // has a stable projection even when the caller did not pre-call
        // `infer_collection_fields`. `_id` is forced to the leading
        // position to match the inference helper's contract.
        let columns = columns_from_docs(&raw_documents);

        // Flatten each document into the projected row order.
        let rows: Vec<Vec<serde_json::Value>> = raw_documents
            .iter()
            .map(|doc| project_row(doc, &columns))
            .collect();

        // `estimated_document_count` is O(1) via collection metadata and
        // is acceptable for the P0 total-count badge — exact counts
        // require a full collection scan which Sprint 66 explicitly
        // defers.
        let total_count_u64 = coll
            .estimated_document_count()
            .await
            .map_err(|e| AppError::Database(format!("estimated_document_count failed: {e}")))?;
        let total_count = total_count_u64.min(i64::MAX as u64) as i64;

        let elapsed = started.elapsed();
        let execution_time_ms = elapsed.as_millis().min(u128::from(u64::MAX)) as u64;

        Ok(DocumentQueryResult {
            columns,
            rows,
            raw_documents,
            total_count,
            execution_time_ms,
        })
    }

    /// Sprint 197 — body of `DocumentAdapter::aggregate`.
    pub(super) async fn aggregate_impl(
        &self,
        db: &str,
        collection: &str,
        pipeline: Vec<Document>,
    ) -> Result<DocumentQueryResult, AppError> {
        validate_ns(db, collection)?;
        let started = Instant::now();
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let mut cursor = coll
            .aggregate(pipeline)
            .await
            .map_err(|e| AppError::Database(format!("aggregate failed: {e}")))?;

        let mut raw_documents: Vec<Document> = Vec::new();
        while let Some(next) = cursor.next().await {
            match next {
                Ok(d) => raw_documents.push(d),
                Err(e) => {
                    return Err(AppError::Database(format!(
                        "aggregate cursor iteration failed: {e}"
                    )));
                }
            }
        }

        // Derive the column order from the pipeline output so grid layout
        // is stable without a pre-inference round-trip. Mirrors `find`.
        let columns = columns_from_docs(&raw_documents);
        let rows: Vec<Vec<serde_json::Value>> = raw_documents
            .iter()
            .map(|doc| project_row(doc, &columns))
            .collect();

        // `total_count` reflects aggregate output cardinality, not the
        // backing collection's document count. `estimated_document_count`
        // is deliberately NOT called here: pipelines like `$match` /
        // `$group` / `$limit` reshape the row set, so the upstream
        // estimate would be misleading.
        let total_count = rows.len() as i64;

        let elapsed = started.elapsed();
        let execution_time_ms = elapsed.as_millis().min(u128::from(u64::MAX)) as u64;

        Ok(DocumentQueryResult {
            columns,
            rows,
            raw_documents,
            total_count,
            execution_time_ms,
        })
    }
}

// ── Helpers (Sprint 66) ────────────────────────────────────────────────

/// Reject empty database or collection names before the driver does.
///
/// The driver eventually returns a descriptive error on empty inputs, but
/// validating up-front keeps the error surface uniform with
/// `list_collections` and skips a network round-trip when the caller
/// forgot to supply a value.
pub(super) fn validate_ns(db: &str, collection: &str) -> Result<(), AppError> {
    if db.trim().is_empty() {
        return Err(AppError::Validation(
            "Database name must not be empty".into(),
        ));
    }
    if collection.trim().is_empty() {
        return Err(AppError::Validation(
            "Collection name must not be empty".into(),
        ));
    }
    Ok(())
}

/// Human-readable BSON type tag used in `ColumnInfo::data_type` and
/// `QueryColumn::data_type`.
///
/// Kept short so it fits the grid's data-type subheader; scalars use their
/// canonical BSON variant name so the frontend can render type-specific
/// hints later without re-parsing the raw document.
pub(super) fn bson_type_name(b: &Bson) -> &'static str {
    match b {
        Bson::Double(_) => "Double",
        Bson::String(_) => "String",
        Bson::Array(_) => "Array",
        Bson::Document(_) => "Document",
        Bson::Boolean(_) => "Boolean",
        Bson::Null => "Null",
        Bson::RegularExpression(_) => "RegularExpression",
        Bson::JavaScriptCode(_) => "JavaScriptCode",
        Bson::JavaScriptCodeWithScope(_) => "JavaScriptCodeWithScope",
        Bson::Int32(_) => "Int32",
        Bson::Int64(_) => "Int64",
        Bson::Timestamp(_) => "Timestamp",
        Bson::Binary(_) => "Binary",
        Bson::ObjectId(_) => "ObjectId",
        Bson::DateTime(_) => "DateTime",
        Bson::Symbol(_) => "Symbol",
        Bson::Decimal128(_) => "Decimal128",
        Bson::Undefined => "Undefined",
        Bson::MaxKey => "MaxKey",
        Bson::MinKey => "MinKey",
        Bson::DbPointer(_) => "DbPointer",
    }
}

/// Flatten a single BSON value into the JSON cell shape the grid consumes.
///
/// Invariant (Sprint 66 contract):
///   * `Bson::Document(_) → Value::String("{...}")` (sentinel)
///   * `Bson::Array(arr)  → Value::String("[N items]")` (sentinel)
///   * anything else      → canonical extended JSON through
///     `bson::Bson::into_canonical_extjson` so that
///     `ObjectId` ≈ `{"$oid": "..."}` and `DateTime`
///     ≈ `{"$date": "..."}` match Quick Look later.
pub(super) fn flatten_cell(b: &Bson) -> serde_json::Value {
    match b {
        Bson::Document(_) => serde_json::Value::String("{...}".into()),
        Bson::Array(arr) => serde_json::Value::String(format!("[{} items]", arr.len())),
        other => other.clone().into_canonical_extjson(),
    }
}

/// Build `QueryColumn`s from a returned batch of documents.
///
/// Used by `find` to produce a column order when the caller did not pre-infer
/// the schema (e.g. ad-hoc queries). Mirrors `infer_columns_from_samples`'s
/// `_id`-first, modal-type rule but emits the lighter `QueryColumn` shape
/// that `DocumentQueryResult` carries.
pub(super) fn columns_from_docs(docs: &[Document]) -> Vec<QueryColumn> {
    let cols = super::schema::infer_columns_from_samples(docs);
    cols.into_iter()
        .map(|c| QueryColumn {
            name: c.name,
            data_type: c.data_type,
        })
        .collect()
}

/// Project a single BSON document into the row shape expected by the grid,
/// using the column order from the enclosing `DocumentQueryResult`.
///
/// Fields absent from `doc` become JSON `null`; extra fields in `doc` that
/// weren't in the column order are dropped so rows always match the column
/// count. This guarantees `rows[i].len() == columns.len()` — a precondition
/// the DataGrid depends on for its `<td>` layout.
pub(super) fn project_row(doc: &Document, columns: &[QueryColumn]) -> Vec<serde_json::Value> {
    columns
        .iter()
        .map(|col| match doc.get(&col.name) {
            Some(b) => flatten_cell(b),
            None => serde_json::Value::Null,
        })
        .collect()
}

// `bson_type_name` is referenced by `schema::infer_columns_from_samples`
// across module boundaries — re-exported via `pub(super)` above. The
// helper-only-import path keeps the topic split clean: schema inference
// logically belongs in schema.rs but reuses one tag-mapping helper from
// queries.rs.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DocumentAdapter;
    use crate::error::AppError;
    use bson::doc;

    #[tokio::test]
    async fn find_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        let body = FindBody::default();
        match adapter.find("db", "c", body, None).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn find_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        let body = FindBody::default();
        match adapter.find("   ", "", body, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn test_aggregate_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.aggregate("db", "c", Vec::new(), None).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn test_aggregate_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter.aggregate("", "c", Vec::new(), None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
        match adapter.aggregate("db", "   ", Vec::new(), None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[test]
    fn flatten_cell_replaces_documents_and_arrays_with_sentinels() {
        let nested = Bson::Document(doc! { "x": 1_i32 });
        assert_eq!(flatten_cell(&nested), serde_json::json!("{...}"));

        let arr = Bson::Array(vec![Bson::Int32(1), Bson::Int32(2), Bson::Int32(3)]);
        assert_eq!(flatten_cell(&arr), serde_json::json!("[3 items]"));

        let empty_arr = Bson::Array(vec![]);
        assert_eq!(flatten_cell(&empty_arr), serde_json::json!("[0 items]"));
    }

    #[test]
    fn flatten_cell_preserves_scalars_through_canonical_extjson() {
        // String round-trips verbatim.
        assert_eq!(
            flatten_cell(&Bson::String("hi".into())),
            serde_json::json!("hi")
        );
        // Int64 becomes extended JSON `{"$numberLong": "..."}`.
        let long = flatten_cell(&Bson::Int64(42));
        assert!(
            long.get("$numberLong").is_some(),
            "Int64 should serialise as canonical extended JSON: {long}"
        );
    }

    #[test]
    fn project_row_fills_absent_fields_with_null() {
        let cols = vec![
            QueryColumn {
                name: "_id".into(),
                data_type: "ObjectId".into(),
            },
            QueryColumn {
                name: "name".into(),
                data_type: "String".into(),
            },
            QueryColumn {
                name: "missing".into(),
                data_type: "String".into(),
            },
        ];
        let doc = doc! {
            "_id": bson::oid::ObjectId::new(),
            "name": "alice",
        };
        let row = project_row(&doc, &cols);
        assert_eq!(row.len(), 3);
        assert_eq!(row[1], serde_json::json!("alice"));
        assert_eq!(row[2], serde_json::Value::Null);
    }

    #[test]
    fn find_body_default_is_empty_filter_no_sort_no_projection() {
        let body = FindBody::default();
        assert!(body.filter.is_empty());
        assert!(body.sort.is_none());
        assert!(body.projection.is_none());
        assert_eq!(body.skip, 0);
        assert_eq!(body.limit, 0);
    }
}
