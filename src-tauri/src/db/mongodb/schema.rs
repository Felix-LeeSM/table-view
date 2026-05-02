//! MongoDB metadata path — `list_databases` / `list_collections` /
//! `infer_collection_fields` + sample-driven column inference helpers.
//!
//! Sprint 197 split — extracted from `db/mongodb.rs`. The
//! `DocumentAdapter` trait surface stays in `mod.rs`; this file holds the
//! `_impl` bodies (verbatim) plus the pure inference helpers.

use std::collections::HashMap;

use bson::{Bson, Document};
use futures_util::stream::StreamExt;

use crate::error::AppError;
use crate::models::{ColumnInfo, TableInfo};

use super::super::NamespaceInfo;
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
            *presence_count.get_mut(k).expect("inserted above") += 1;
            match v {
                Bson::Null => {
                    has_null.insert(k.clone(), true);
                }
                _ => {
                    let by_type = type_counts.get_mut(k).expect("inserted above");
                    *by_type.entry(bson_type_name(v)).or_insert(0) += 1;
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
        columns.push(ColumnInfo {
            name: "_id".into(),
            data_type: data_type.to_string(),
            nullable,
            default_value: None,
            is_primary_key: true,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
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
        });
    }

    for name in order.iter() {
        if name == "_id" {
            continue;
        }
        let counts = type_counts.get(name).cloned().unwrap_or_default();
        let data_type = modal_type(&counts).unwrap_or("Null");
        let nullable = *null_or_absent.get(name).unwrap_or(&true);
        columns.push(ColumnInfo {
            name: name.clone(),
            data_type: data_type.to_string(),
            nullable,
            default_value: None,
            is_primary_key: false,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
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
