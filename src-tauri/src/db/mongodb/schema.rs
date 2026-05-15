//! MongoDB metadata path — `list_databases` / `list_collections` /
//! `infer_collection_fields` + sample-driven column inference helpers.
//!
//! Sprint 197 split — extracted from `db/mongodb.rs`. The
//! `DocumentAdapter` trait surface stays in `mod.rs`; this file holds the
//! `_impl` bodies (verbatim) plus the pure inference helpers.

use std::collections::HashMap;

use bson::{doc, Bson, Document};
use futures_util::stream::StreamExt;
use serde_json::Value as JsonValue;

use crate::error::AppError;
use crate::models::{ColumnInfo, IndexInfo, TableInfo};

use super::super::NamespaceInfo;
use super::category::map_mongo_data_type;
use super::queries::{bson_type_name, validate_ns};
use super::MongoAdapter;

impl MongoAdapter {
    /// Sprint 197 — body of `DocumentAdapter::list_databases`.
    pub(super) async fn list_databases_impl(&self) -> Result<Vec<NamespaceInfo>, AppError> {
        let client = self.current_client().await?;
        let names = client
            .list_database_names()
            .await
            .map_err(|e| AppError::Database(format!("list_database_names failed: {e}")))?;
        Ok(names
            .into_iter()
            .map(|name| NamespaceInfo { name })
            .collect())
    }

    /// Sprint 197 — body of `DocumentAdapter::list_collections`.
    ///
    /// Routes through `resolved_db_name` so a `use_db("alpha")` swap takes
    /// effect even when an upstream caller still passes an empty /
    /// whitespace-only `db` string. When the caller passes a non-empty
    /// name, that name still wins (preserves the original Sprint 65
    /// per-row expand contract). Falls back to the connection's
    /// `default_db` only when no `switch_active_db` has ever been called.
    pub(super) async fn list_collections_impl(&self, db: &str) -> Result<Vec<TableInfo>, AppError> {
        let requested = if db.trim().is_empty() { None } else { Some(db) };
        let resolved = self
            .resolved_db_name(requested)
            .await
            .ok_or_else(|| AppError::Validation("Database name must not be empty".into()))?;
        let client = self.current_client().await?;
        let names = client
            .database(&resolved)
            .list_collection_names()
            .await
            .map_err(|e| AppError::Database(format!("list_collection_names failed: {e}")))?;
        Ok(names
            .into_iter()
            .map(|name| TableInfo {
                name,
                schema: resolved.clone(),
                row_count: None,
            })
            .collect())
    }

    /// Sprint 197 — body of `DocumentAdapter::infer_collection_fields`.
    pub(super) async fn infer_collection_fields_impl(
        &self,
        db: &str,
        collection: &str,
        sample_size: usize,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        validate_ns(db, collection)?;
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        // Sprint 66 uses a best-effort sample: `find(None)` + `limit`.
        // Aggregation with `$sample` would be more uniform but requires
        // pipeline support which is still stubbed. The first N documents
        // is plenty for P0 inference and matches what the Quick Open
        // grid will preview initially.
        let limit_i64: i64 = sample_size.max(1).min(i64::MAX as usize) as i64;
        let mut cursor = coll
            .find(Document::new())
            .limit(limit_i64)
            .await
            .map_err(|e| AppError::Database(format!("find(sample) failed: {e}")))?;

        let mut samples: Vec<Document> = Vec::new();
        while let Some(next) = cursor.next().await {
            match next {
                Ok(d) => samples.push(d),
                Err(e) => {
                    return Err(AppError::Database(format!("cursor iteration failed: {e}")));
                }
            }
        }

        Ok(infer_columns_from_samples(&samples))
    }

    /// Sprint 332 (Slice J live wire) — collection 의 인덱스 메타데이터를
    /// driver `Collection::list_indexes()` 로 받아 RDB 와 같은 `IndexInfo`
    /// shape 으로 매핑한다. Mongo 의 IndexModel 은 `{ name, key, unique?,
    /// hidden?, expire_after_seconds?, ... }` — 우리는 그 중 (name, key
    /// fields, unique, hashed/text/geo special index name) 만 노출한다.
    ///
    /// Routing 은 `list_collections_impl` 과 동일 — caller 가 빈 db 를
    /// 넘기면 `resolved_db_name` 으로 active DB 까지 fallback. 빈 collection
    /// 은 `validate_ns` 가 거부.
    pub(super) async fn list_collection_indexes_impl(
        &self,
        db: &str,
        collection: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let requested = if db.trim().is_empty() { None } else { Some(db) };
        let resolved = self
            .resolved_db_name(requested)
            .await
            .ok_or_else(|| AppError::Validation("Database name must not be empty".into()))?;
        validate_ns(&resolved, collection)?;
        let client = self.current_client().await?;
        let coll = client
            .database(&resolved)
            .collection::<Document>(collection);

        let mut cursor = coll
            .list_indexes()
            .await
            .map_err(|e| AppError::Database(format!("list_indexes failed: {e}")))?;

        let mut out: Vec<IndexInfo> = Vec::new();
        while let Some(next) = cursor.next().await {
            let model =
                next.map_err(|e| AppError::Database(format!("list_indexes cursor: {e}")))?;
            out.push(map_index_model(&model));
        }

        Ok(out)
    }

    /// Sprint 333 (Slice K live wire) — read the collection's stored
    /// validator via `listCollections({filter: {name}})`. Returns
    /// `Ok(None)` when no validator is set, `Ok(Some(json))` otherwise.
    /// `json` is the validator expression as canonical JSON so the
    /// frontend can hand it directly to a JSON textarea.
    pub(super) async fn get_collection_validator_impl(
        &self,
        db: &str,
        collection: &str,
    ) -> Result<Option<JsonValue>, AppError> {
        let requested = if db.trim().is_empty() { None } else { Some(db) };
        let resolved = self
            .resolved_db_name(requested)
            .await
            .ok_or_else(|| AppError::Validation("Database name must not be empty".into()))?;
        validate_ns(&resolved, collection)?;
        let client = self.current_client().await?;
        let resp = client
            .database(&resolved)
            .run_command(doc! {
                "listCollections": 1,
                "filter": { "name": collection },
                "nameOnly": false,
            })
            .await
            .map_err(|e| AppError::Database(format!("listCollections failed: {e}")))?;

        let validator = resp
            .get_document("cursor")
            .ok()
            .and_then(|c| c.get_array("firstBatch").ok())
            .and_then(|arr| arr.first())
            .and_then(|b| b.as_document())
            .and_then(|spec| spec.get_document("options").ok())
            .and_then(|opts| opts.get_document("validator").ok())
            .cloned();

        match validator {
            None => Ok(None),
            Some(doc) => {
                let json = bson::Bson::Document(doc).into_canonical_extjson();
                Ok(Some(json))
            }
        }
    }

    /// Sprint 333 (Slice K live wire) — apply / clear the collection
    /// validator via `runCommand(collMod)`. `None` resets the validator
    /// (`{}` per Mongo manual). validationLevel / validationAction are
    /// hard-coded to "moderate" / "error" — the per-collection toggles
    /// belong to a follow-up sprint.
    pub(super) async fn set_collection_validator_impl(
        &self,
        db: &str,
        collection: &str,
        validator: Option<JsonValue>,
    ) -> Result<(), AppError> {
        let requested = if db.trim().is_empty() { None } else { Some(db) };
        let resolved = self
            .resolved_db_name(requested)
            .await
            .ok_or_else(|| AppError::Validation("Database name must not be empty".into()))?;
        validate_ns(&resolved, collection)?;

        let validator_bson: Document = match validator {
            None => Document::new(),
            Some(val) => match bson::to_bson(&val) {
                Ok(Bson::Document(d)) => d,
                Ok(_) => {
                    return Err(AppError::Validation(
                        "Validator must be a JSON object".into(),
                    ));
                }
                Err(e) => {
                    return Err(AppError::Validation(format!(
                        "Validator JSON could not be encoded: {e}"
                    )));
                }
            },
        };

        let client = self.current_client().await?;
        client
            .database(&resolved)
            .run_command(doc! {
                "collMod": collection,
                "validator": validator_bson,
                "validationLevel": "moderate",
                "validationAction": "error",
            })
            .await
            .map_err(|e| AppError::Database(format!("collMod failed: {e}")))?;
        Ok(())
    }

    /// Sprint 334 (Slice L live wire) — `runCommand({create: coll, ...})`.
    /// `options` is merged in as additional fields on the command body.
    pub(super) async fn create_collection_impl(
        &self,
        db: &str,
        collection: &str,
        options: Option<JsonValue>,
    ) -> Result<(), AppError> {
        let requested = if db.trim().is_empty() { None } else { Some(db) };
        let resolved = self
            .resolved_db_name(requested)
            .await
            .ok_or_else(|| AppError::Validation("Database name must not be empty".into()))?;
        validate_ns(&resolved, collection)?;

        let mut cmd = doc! { "create": collection };
        if let Some(opts) = options {
            let opts_doc: Document = match bson::to_bson(&opts) {
                Ok(Bson::Document(d)) => d,
                Ok(_) => {
                    return Err(AppError::Validation(
                        "Collection options must be a JSON object".into(),
                    ));
                }
                Err(e) => {
                    return Err(AppError::Validation(format!(
                        "Options JSON could not be encoded: {e}"
                    )));
                }
            };
            for (k, v) in opts_doc {
                cmd.insert(k, v);
            }
        }

        let client = self.current_client().await?;
        client
            .database(&resolved)
            .run_command(cmd)
            .await
            .map_err(|e| AppError::Database(format!("create collection failed: {e}")))?;
        Ok(())
    }

    /// Sprint 334 (Slice L live wire) — `admin.runCommand({renameCollection,
    /// to})`. Same-DB rename only; cross-DB rename is out of scope.
    pub(super) async fn rename_collection_impl(
        &self,
        db: &str,
        from: &str,
        to: &str,
    ) -> Result<(), AppError> {
        let requested = if db.trim().is_empty() { None } else { Some(db) };
        let resolved = self
            .resolved_db_name(requested)
            .await
            .ok_or_else(|| AppError::Validation("Database name must not be empty".into()))?;
        validate_ns(&resolved, from)?;
        validate_ns(&resolved, to)?;

        let from_ns = format!("{resolved}.{from}");
        let to_ns = format!("{resolved}.{to}");

        let client = self.current_client().await?;
        client
            .database("admin")
            .run_command(doc! {
                "renameCollection": from_ns,
                "to": to_ns,
            })
            .await
            .map_err(|e| AppError::Database(format!("renameCollection failed: {e}")))?;
        Ok(())
    }
}

/// Sprint 332 — `mongodb::IndexModel` → `crate::models::IndexInfo`.
///
/// 매핑 규칙:
/// - `columns` = key spec 의 field 이름 (insertion order). text / geo index
///   는 weights spec 의 field 도 같은 슬롯에 담긴다.
/// - `index_type` = special key value 우선 ("text", "hashed", "2dsphere",
///   "2d", "geoHaystack"). 일반 (1 / -1 BTree) 이면 compound vs single 로
///   "compound" / "btree" 분기.
/// - `is_unique` = options.unique == Some(true).
/// - `is_primary` = name == "_id_" (Mongo 가 자동 생성하는 primary key
///   인덱스).
fn map_index_model(model: &mongodb::IndexModel) -> IndexInfo {
    let name = model
        .options
        .as_ref()
        .and_then(|o| o.name.clone())
        .unwrap_or_else(|| keys_to_default_name(&model.keys));
    let is_unique = model
        .options
        .as_ref()
        .and_then(|o| o.unique)
        .unwrap_or(false);
    let is_primary = name == "_id_";

    let columns: Vec<String> = model.keys.keys().cloned().collect();
    let mut index_type = "btree".to_string();
    for (_, v) in model.keys.iter() {
        if let Bson::String(s) = v {
            // text / hashed / 2dsphere / 2d / geoHaystack
            index_type = s.clone();
            break;
        }
    }
    if index_type == "btree" && columns.len() > 1 {
        index_type = "compound".to_string();
    }

    IndexInfo {
        name,
        columns,
        index_type,
        is_unique,
        is_primary,
    }
}

/// Mongo driver 가 IndexModel.options.name 을 비워둔 경우의 fallback —
/// `field_1_other_-1` 같은 기본 명명 규칙. 실제로는 driver 가 거의
/// 항상 name 을 채워 보내므로 방어용.
fn keys_to_default_name(keys: &Document) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(keys.len());
    for (k, v) in keys.iter() {
        let suffix = match v {
            Bson::Int32(n) => n.to_string(),
            Bson::Int64(n) => n.to_string(),
            Bson::Double(n) => format!("{n}"),
            Bson::String(s) => s.clone(),
            _ => "unknown".to_string(),
        };
        parts.push(format!("{k}_{suffix}"));
    }
    parts.join("_")
}

// ── Helpers (Sprint 66) ────────────────────────────────────────────────

/// Build a `Vec<ColumnInfo>` from a document sample.
///
/// Rules:
///   * `_id` is always the first column (even when absent from every sample
///     — MongoDB guarantees `_id` on every persisted doc, so showing the
///     column lets the grid render "missing" cells as NULL coherently).
///   * For every other top-level key encountered, record the **modal**
///     BSON type across the sample (ties broken by insertion order).
///   * A field is `nullable = true` when it is missing from at least one
///     sampled document OR any sampled occurrence is `Bson::Null`.
///   * Deep / nested inference is explicitly out of scope in Sprint 66.
pub(super) fn infer_columns_from_samples(samples: &[Document]) -> Vec<ColumnInfo> {
    // Preserve first-seen order so UI column layout is stable across
    // repeated inferences on the same sample set.
    let mut order: Vec<String> = Vec::new();
    // For each field: count occurrences per BSON type name.
    let mut type_counts: HashMap<String, HashMap<&'static str, usize>> = HashMap::new();
    // Track which docs actually contained each field (by index). After the
    // pass, any field whose presence count differs from `samples.len()` is
    // flagged as nullable — this catches both "absent from every earlier
    // doc before first appearance" and "missing from a later doc" cases in
    // a single uniform rule.
    let mut presence_count: HashMap<String, usize> = HashMap::new();
    // A field is `nullable = true` when any sampled occurrence is
    // `Bson::Null` — presence-driven nullability is applied below.
    let mut has_null: HashMap<String, bool> = HashMap::new();

    for doc in samples {
        for (k, v) in doc {
            if !type_counts.contains_key(k) {
                order.push(k.clone());
                type_counts.insert(k.clone(), HashMap::new());
                presence_count.insert(k.clone(), 0);
                has_null.insert(k.clone(), false);
            }
            // The `if !contains_key` block above synchronizes all four
            // HashMaps, so these `get_mut` calls are guaranteed `Some` —
            // we still pattern-match defensively to avoid panicking on an
            // invariant break.
            if let Some(c) = presence_count.get_mut(k) {
                *c += 1;
            }
            match v {
                Bson::Null => {
                    has_null.insert(k.clone(), true);
                }
                _ => {
                    if let Some(by_type) = type_counts.get_mut(k) {
                        *by_type.entry(bson_type_name(v)).or_insert(0) += 1;
                    }
                }
            }
        }
    }

    // A field is nullable when it is missing from at least one sample
    // (presence_count < samples.len()) OR any sampled occurrence is Null.
    let total = samples.len();
    let null_or_absent: HashMap<String, bool> = order
        .iter()
        .map(|k| {
            let missing_from_some = presence_count.get(k).copied().unwrap_or(0) < total;
            let any_null = has_null.get(k).copied().unwrap_or(false);
            (k.clone(), missing_from_some || any_null)
        })
        .collect();

    let seen_id = order.iter().any(|n| n == "_id");
    let mut columns: Vec<ColumnInfo> = Vec::with_capacity(order.len() + 1);
    // `_id` always first.
    if seen_id {
        let counts = type_counts.get("_id").cloned().unwrap_or_default();
        let data_type = modal_type(&counts).unwrap_or("ObjectId");
        let nullable = *null_or_absent.get("_id").unwrap_or(&false);
        let category = map_mongo_data_type(data_type);
        columns.push(ColumnInfo {
            name: "_id".into(),
            data_type: data_type.to_string(),
            nullable,
            default_value: None,
            is_primary_key: true,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
            check_clauses: Vec::new(),
            category,
        });
    } else {
        columns.push(ColumnInfo {
            name: "_id".into(),
            data_type: "ObjectId".into(),
            // Empty collection / sample: placeholder _id column is not
            // nullable because MongoDB will auto-assign one on write.
            nullable: false,
            default_value: None,
            is_primary_key: true,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
            check_clauses: Vec::new(),
            category: map_mongo_data_type("ObjectId"),
        });
    }

    for name in order.iter() {
        if name == "_id" {
            continue;
        }
        let counts = type_counts.get(name).cloned().unwrap_or_default();
        let data_type = modal_type(&counts).unwrap_or("Null");
        let nullable = *null_or_absent.get(name).unwrap_or(&true);
        let category = map_mongo_data_type(data_type);
        columns.push(ColumnInfo {
            name: name.clone(),
            data_type: data_type.to_string(),
            nullable,
            default_value: None,
            is_primary_key: false,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
            check_clauses: Vec::new(),
            category,
        });
    }

    columns
}

/// Pick the most frequently observed BSON type name in the counts map.
///
/// Ties are broken by lexicographic order of the type name; this keeps
/// inference output deterministic across runs with shuffled sample data
/// (the BSON type name is stable and not user-supplied, so the tiebreak
/// order is not surprising).
fn modal_type(counts: &HashMap<&'static str, usize>) -> Option<&'static str> {
    counts
        .iter()
        .max_by(|(a_name, a_count), (b_name, b_count)| {
            a_count.cmp(b_count).then_with(|| b_name.cmp(a_name))
        })
        .map(|(name, _)| *name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DocumentAdapter;
    use bson::doc;

    #[tokio::test]
    async fn list_databases_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.list_databases().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn list_collections_rejects_empty_db_name() {
        let adapter = MongoAdapter::new();
        match adapter.list_collections("   ", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn infer_collection_fields_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.infer_collection_fields("db", "c", 10, None).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn infer_collection_fields_rejects_empty_db_name() {
        let adapter = MongoAdapter::new();
        match adapter.infer_collection_fields("   ", "c", 10, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn infer_collection_fields_rejects_empty_collection_name() {
        let adapter = MongoAdapter::new();
        match adapter.infer_collection_fields("db", "   ", 10, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[test]
    fn infer_columns_from_empty_sample_returns_only_id() {
        let cols = infer_columns_from_samples(&[]);
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "_id");
        assert_eq!(cols[0].data_type, "ObjectId");
        assert!(!cols[0].nullable);
        assert!(cols[0].is_primary_key);
    }

    #[test]
    fn infer_columns_puts_id_first_and_marks_missing_fields_nullable() {
        use bson::oid::ObjectId;
        let sample1 = doc! {
            "_id": ObjectId::new(),
            "name": "alice",
            "age": 30_i32,
        };
        let sample2 = doc! {
            "_id": ObjectId::new(),
            "name": "bob",
            // `age` absent here → nullable flips to true.
        };
        let cols = infer_columns_from_samples(&[sample1, sample2]);
        assert_eq!(cols[0].name, "_id", "_id must be the first column");
        assert_eq!(cols[0].data_type, "ObjectId");
        assert!(cols[0].is_primary_key);

        let name_col = cols.iter().find(|c| c.name == "name").unwrap();
        assert_eq!(name_col.data_type, "String");
        assert!(!name_col.nullable);

        let age_col = cols.iter().find(|c| c.name == "age").unwrap();
        assert_eq!(age_col.data_type, "Int32");
        assert!(
            age_col.nullable,
            "age must be nullable when absent in sample2"
        );
    }

    #[tokio::test]
    async fn list_collection_indexes_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.list_collection_indexes("db", "c").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn list_collection_indexes_rejects_empty_db_name() {
        let adapter = MongoAdapter::new();
        match adapter.list_collection_indexes("   ", "c").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn get_collection_validator_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.get_collection_validator("db", "c").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn get_collection_validator_rejects_empty_db_name() {
        let adapter = MongoAdapter::new();
        match adapter.get_collection_validator("   ", "c").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn get_collection_validator_rejects_empty_collection_name() {
        let adapter = MongoAdapter::new();
        match adapter.get_collection_validator("db", "   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn set_collection_validator_rejects_empty_db_name() {
        let adapter = MongoAdapter::new();
        match adapter.set_collection_validator("   ", "c", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn set_collection_validator_rejects_empty_collection_name() {
        let adapter = MongoAdapter::new();
        match adapter.set_collection_validator("db", "   ", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn create_collection_rejects_empty_db_name() {
        let adapter = MongoAdapter::new();
        match adapter.create_collection("   ", "c", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn create_collection_rejects_empty_collection_name() {
        let adapter = MongoAdapter::new();
        match adapter.create_collection("db", "   ", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn create_collection_rejects_non_object_options() {
        let adapter = MongoAdapter::new();
        match adapter
            .create_collection("db", "c", Some(serde_json::json!([1, 2])))
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("JSON object"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn create_collection_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.create_collection("db", "c", None).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn rename_collection_rejects_empty_db_name() {
        let adapter = MongoAdapter::new();
        match adapter.rename_collection("   ", "a", "b").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn rename_collection_rejects_empty_target_name() {
        let adapter = MongoAdapter::new();
        match adapter.rename_collection("db", "a", "   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn rename_collection_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.rename_collection("db", "a", "b").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn set_collection_validator_rejects_non_object_json() {
        // Sprint 333 — payload 가 array / scalar 이면 collMod validator 가
        // bson Document 일 수 없으므로 fast-fail.
        let adapter = MongoAdapter::new();
        match adapter
            .set_collection_validator("db", "c", Some(serde_json::json!([1, 2, 3])))
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("JSON object"), "unexpected: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[test]
    fn infer_columns_picks_modal_type_over_mixed_samples() {
        // Majority Int32 for "count" across 3 of 4 docs; minority String.
        let samples = vec![
            doc! { "count": 1_i32 },
            doc! { "count": 2_i32 },
            doc! { "count": 3_i32 },
            doc! { "count": "many" },
        ];
        let cols = infer_columns_from_samples(&samples);
        let count_col = cols.iter().find(|c| c.name == "count").unwrap();
        assert_eq!(count_col.data_type, "Int32");
    }
}
