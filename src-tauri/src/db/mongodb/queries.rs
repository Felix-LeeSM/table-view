//! MongoDB query path — `find` / `aggregate` + cursor flattening helpers.
//!
//! Sprint 197 split — extracted from `db/mongodb.rs` (1809-line monolith)
//! together with `connection.rs` / `schema.rs` / `mutations.rs`. Body kept
//! verbatim from the pre-split file (Sprint 66 + Sprint 72 contract); the
//! split is module-organisational only, no runtime behavior change.

use std::time::Instant;

use ::mongodb::options::{AggregateOptions, FindOneOptions, FindOptions};
use bson::{Bson, Document};
use futures_util::stream::StreamExt;

use super::category::map_mongo_data_type;
use crate::error::AppError;
use crate::models::QueryColumn;

use super::super::{DocumentQueryResult, DocumentRow, FindBody};
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
            comment,
        } = body;

        let mut opts = FindOptions::default();
        if let Some(s) = sort {
            opts.sort = Some(s);
        }
        if let Some(p) = projection {
            opts.projection = Some(p);
        }
        // Issue #1269 (P1) — stamp the cancel tag so the running op is
        // discoverable via `$currentOp` matched on `command.comment`.
        if let Some(c) = comment {
            opts.comment = Some(Bson::String(c));
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

        // Issue #1231 — stop draining the cursor at cap+1 so a huge find can't
        // buffer the whole collection into the Rust Vec.
        let row_cap = crate::db::row_cap::current();
        let mut raw_documents: Vec<Document> = Vec::new();
        let mut truncated = false;
        while let Some(next) = cursor.next().await {
            match next {
                Ok(d) => {
                    if raw_documents.len() >= row_cap {
                        truncated = true;
                        break;
                    }
                    raw_documents.push(d);
                }
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
            truncated,
            columns,
            rows,
            raw_documents,
            total_count,
            execution_time_ms,
        })
    }

    /// Sprint 308 — body of `DocumentAdapter::find_one`.
    ///
    /// 작성 이유 (2026-05-14): A1 mongosh 파서가 `findOne(<filter>)` 을
    /// dispatch 하면 단일 row 의 projection 이 필요. `find_impl` 의 column
    /// inference + `project_row` + `flatten_cell` 를 그대로 재사용해
    /// `DocumentQueryResult` 와 동일 shape 의 슬라이스 (`DocumentRow`) 를
    /// 만든다. 매칭이 없으면 `Ok(None)`.
    pub(super) async fn find_one_impl(
        &self,
        db: &str,
        collection: &str,
        filter: Document,
    ) -> Result<Option<DocumentRow>, AppError> {
        validate_ns(db, collection)?;
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let opts = FindOneOptions::default();
        let maybe = coll
            .find_one(filter)
            .with_options(opts)
            .await
            .map_err(|e| AppError::Database(format!("find_one failed: {e}")))?;

        let Some(raw) = maybe else { return Ok(None) };

        // Reuse the same column-inference + row-projection helpers `find`
        // uses so wire shape (column ordering, sentinel cells, canonical
        // extjson) is byte-for-byte identical between the two read paths.
        let docs_slice: Vec<Document> = vec![raw.clone()];
        let columns = columns_from_docs(&docs_slice);
        let row = project_row(&raw, &columns);

        Ok(Some(DocumentRow { columns, row, raw }))
    }

    /// Sprint 308 — body of `DocumentAdapter::count_documents`.
    ///
    /// 작성 이유 (2026-05-14): exact count 가 필요한 A1 dispatch path.
    /// Mongo driver 의 `count_documents` 는 collection scan 을 수행.
    pub(super) async fn count_documents_impl(
        &self,
        db: &str,
        collection: &str,
        filter: Document,
    ) -> Result<i64, AppError> {
        validate_ns(db, collection)?;
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let count_u64 = coll
            .count_documents(filter)
            .await
            .map_err(|e| AppError::Database(format!("count_documents failed: {e}")))?;
        Ok(clamp_u64_to_i64(count_u64))
    }

    /// Sprint 308 — body of `DocumentAdapter::estimated_document_count`.
    ///
    /// 작성 이유 (2026-05-14): metadata-based O(1) estimate.
    pub(super) async fn estimated_document_count_impl(
        &self,
        db: &str,
        collection: &str,
    ) -> Result<i64, AppError> {
        validate_ns(db, collection)?;
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let count_u64 = coll
            .estimated_document_count()
            .await
            .map_err(|e| AppError::Database(format!("estimated_document_count failed: {e}")))?;
        Ok(clamp_u64_to_i64(count_u64))
    }

    /// Sprint 308 — body of `DocumentAdapter::distinct`.
    ///
    /// 작성 이유 (2026-05-14): unique field-value set. Result 의 각 BSON
    /// scalar 는 `flatten_cell` 로 wrap (canonical extjson + 수치 unwrap)
    /// 해서 grid / Quick Look 가 동일 shape 으로 소비.
    pub(super) async fn distinct_impl(
        &self,
        db: &str,
        collection: &str,
        field: &str,
        filter: Document,
    ) -> Result<Vec<serde_json::Value>, AppError> {
        validate_ns(db, collection)?;
        if field.trim().is_empty() {
            return Err(AppError::Validation(
                "distinct: field name must not be empty".into(),
            ));
        }
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let values: Vec<Bson> = coll
            .distinct(field, filter)
            .await
            .map_err(|e| AppError::Database(format!("distinct failed: {e}")))?;

        Ok(values.iter().map(flatten_cell).collect())
    }

    /// Sprint 197 — body of `DocumentAdapter::aggregate`.
    ///
    /// Issue #1269 (P1) — `comment` stamps the cancel tag on the aggregate op
    /// (mirrors `find_impl`) so it is discoverable via `$currentOp` matched on
    /// `command.comment` for native `killOp`.
    pub(super) async fn aggregate_impl(
        &self,
        db: &str,
        collection: &str,
        pipeline: Vec<Document>,
        comment: Option<String>,
    ) -> Result<DocumentQueryResult, AppError> {
        validate_ns(db, collection)?;
        let started = Instant::now();
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let mut opts = AggregateOptions::default();
        if let Some(c) = comment {
            opts.comment = Some(Bson::String(c));
        }
        let mut cursor = coll
            .aggregate(pipeline)
            .with_options(opts)
            .await
            .map_err(|e| AppError::Database(format!("aggregate failed: {e}")))?;

        // Issue #1231 — cap the aggregate output like `find` (cap+1 break).
        let row_cap = crate::db::row_cap::current();
        let mut raw_documents: Vec<Document> = Vec::new();
        let mut truncated = false;
        while let Some(next) = cursor.next().await {
            match next {
                Ok(d) => {
                    if raw_documents.len() >= row_cap {
                        truncated = true;
                        break;
                    }
                    raw_documents.push(d);
                }
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
            truncated,
            columns,
            rows,
            raw_documents,
            total_count,
            execution_time_ms,
        })
    }
}

// ── Helpers (Sprint 66) ────────────────────────────────────────────────

/// Sprint 308 — clamp `u64` driver counts into `i64` (the wire type the
/// frontend expects). Mongo can theoretically return values above
/// `i64::MAX` for distributed sharded estimated counts; we clamp rather
/// than overflow so the cell stays a finite number.
#[inline]
pub(super) fn clamp_u64_to_i64(n: u64) -> i64 {
    n.min(i64::MAX as u64) as i64
}

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
/// - `Bson::Document(_) → Value::String("{...}")` (sentinel)
/// - `Bson::Array(arr)  → Value::String("[N items]")` (sentinel)
/// - 수치 타입 (Sprint 261 ADR 0026):
///   - `Bson::Int64(n)` → `Value::String(n.to_string())` — frontend wrapper 가 BigInt 로 wrap.
///   - `Bson::Decimal128(d)` → `Value::String(d.to_string())` — frontend wrapper 가 Decimal 로 wrap.
///   - `Bson::Int32(n)` → raw JSON number — JS Number 안전 범위.
///   - `Bson::Double(d)` → raw JSON number — JS Number 와 IEEE 754 동일 표현.
///   - canonical extjson 의 `{"$numberLong": ...}` / `{"$numberInt": ...}` /
///     `{"$numberDouble": ...}` / `{"$numberDecimal": ...}` wrapper 모두 우회.
///     NaN / Infinity 같은 non-finite Double 만 fallback 으로 extjson 유지.
/// - 비-수치 discriminator-bearing 타입 (ObjectId / DateTime / Binary / ...) →
///   canonical extended JSON 유지: `ObjectId` ≈ `{"$oid": "..."}` /
///   `DateTime` ≈ `{"$date": "..."}` (Quick Look 트리 뷰어가 의존).
pub(super) fn flatten_cell(b: &Bson) -> serde_json::Value {
    match b {
        Bson::Document(_) => serde_json::Value::String("{...}".into()),
        Bson::Array(arr) => serde_json::Value::String(format!("[{} items]", arr.len())),
        Bson::Int64(n) => serde_json::Value::String(n.to_string()),
        Bson::Decimal128(d) => serde_json::Value::String(d.to_string()),
        Bson::Int32(n) => serde_json::Value::Number((*n).into()),
        Bson::Double(d) => serde_json::Number::from_f64(*d)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| b.clone().into_canonical_extjson()),
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
        .map(|c| {
            let category = map_mongo_data_type(&c.data_type);
            QueryColumn {
                name: c.name,
                data_type: c.data_type,
                category,
            }
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
    use crate::models::ColumnCategory;
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
        match adapter.aggregate("db", "c", Vec::new(), None, None).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn test_aggregate_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter.aggregate("", "c", Vec::new(), None, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
        match adapter.aggregate("db", "   ", Vec::new(), None, None).await {
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
        // ObjectId / DateTime / Binary 등 비-수치 discriminator-bearing 타입은
        // canonical extjson wrapper 유지 (Sprint 261 ADR 0026 — 수치만 unwrap).
        let oid_bson =
            Bson::ObjectId(bson::oid::ObjectId::parse_str("65abcdef0123456789abcdef").unwrap());
        let oid = flatten_cell(&oid_bson);
        assert!(
            oid.get("$oid").is_some(),
            "ObjectId should remain extjson wrapper: {oid}"
        );
    }

    // Sprint 261 (ADR 0026) — Int64 / Decimal128 은 wire 위에서 plain JSON
    // string 으로 보낸다 (precision-preserving). canonical extjson 의
    // `{"$numberLong": "..."}` / `{"$numberDecimal": "..."}` wrapper 우회.
    // Frontend wrapper 가 column metadata 기반으로 BigInt / Decimal 로 wrap.
    #[test]
    fn flatten_cell_int64_emits_plain_string_sprint_261() {
        assert_eq!(
            flatten_cell(&Bson::Int64(42)),
            serde_json::Value::String("42".into())
        );
        // 정밀도 초과 케이스 (i64 max 근처).
        assert_eq!(
            flatten_cell(&Bson::Int64(9223372036854775807)),
            serde_json::Value::String("9223372036854775807".into())
        );
        // 음수.
        assert_eq!(
            flatten_cell(&Bson::Int64(-9223372036854775808)),
            serde_json::Value::String("-9223372036854775808".into())
        );
    }

    #[test]
    fn flatten_cell_decimal128_emits_plain_string_sprint_261() {
        // Decimal128 → "123.456..." plain string. canonical extjson 의
        // `{"$numberDecimal": "..."}` 우회.
        let d128 = Bson::Decimal128("123.456789012345678901234567890".parse().unwrap());
        let result = flatten_cell(&d128);
        match result {
            serde_json::Value::String(s) => {
                assert!(
                    s.contains("123.45"),
                    "Decimal128 should be plain string, got: {s}"
                );
            }
            other => panic!("expected Value::String, got {other:?}"),
        }
    }

    #[test]
    fn flatten_cell_int32_remains_raw_number_sprint_261() {
        // Int32 는 JS Number 안전 범위라 raw number 유지 — 무손실 round-trip.
        assert_eq!(flatten_cell(&Bson::Int32(42)), serde_json::json!(42));
    }

    #[test]
    fn flatten_cell_double_remains_raw_number_sprint_261() {
        // Double 은 JS Number = IEEE 754 64-bit 동일 표현 — 무손실.
        // 1.5 (정확히 표현 가능한 dyadic rational) 로 clippy::approx_constant
        // 회피.
        assert_eq!(flatten_cell(&Bson::Double(1.5)), serde_json::json!(1.5));
    }

    #[test]
    fn project_row_fills_absent_fields_with_null() {
        let cols = vec![
            QueryColumn {
                name: "_id".into(),
                data_type: "ObjectId".into(),
                category: ColumnCategory::Unknown,
            },
            QueryColumn {
                name: "name".into(),
                data_type: "String".into(),
                category: ColumnCategory::Unknown,
            },
            QueryColumn {
                name: "missing".into(),
                data_type: "String".into(),
                category: ColumnCategory::Unknown,
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
