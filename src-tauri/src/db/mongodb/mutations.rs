//! MongoDB single-document mutations — `insert_document` /
//! `update_document` / `delete_document` + `DocumentId` ↔ `Bson`
//! round-trip helpers.
//!
//! Sprint 197 split — extracted from `db/mongodb.rs`. Sprint 198 will
//! land bulk-write commands (`delete_many` / `update_many` /
//! `drop_collection`) in this same file so the mutation surface stays
//! co-located.

use bson::{doc, Bson, Document};

use crate::error::AppError;

use super::super::DocumentId;
use super::queries::validate_ns;
use super::MongoAdapter;

impl MongoAdapter {
    /// Sprint 197 — body of `DocumentAdapter::insert_document`.
    pub(super) async fn insert_document_impl(
        &self,
        db: &str,
        collection: &str,
        doc: Document,
    ) -> Result<DocumentId, AppError> {
        validate_ns(db, collection)?;
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let inserted = coll
            .insert_one(doc)
            .await
            .map_err(|e| AppError::Database(format!("insert_one failed: {e}")))?;

        Ok(bson_id_to_document_id(&inserted.inserted_id))
    }

    /// Sprint 197 — body of `DocumentAdapter::update_document`.
    pub(super) async fn update_document_impl(
        &self,
        db: &str,
        collection: &str,
        id: DocumentId,
        patch: Document,
    ) -> Result<(), AppError> {
        validate_ns(db, collection)?;

        // Sprint 80 contract: reject `_id` in the patch up-front so the
        // driver never sees a mutating update on the identity column.
        // The guard runs before `current_client()` so a misuse does not
        // burn a connection/round-trip.
        if patch.contains_key("_id") {
            return Err(AppError::Validation(
                "update_document: patch must not contain _id".into(),
            ));
        }

        let filter_value = document_id_to_bson(&id)?;
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let filter = doc! { "_id": filter_value };
        let update = doc! { "$set": patch };

        let result = coll
            .update_one(filter, update)
            .await
            .map_err(|e| AppError::Database(format!("update_one failed: {e}")))?;

        if result.matched_count == 0 {
            return Err(AppError::NotFound(format!(
                "document with _id {} not found",
                describe_document_id(&id)
            )));
        }

        Ok(())
    }

    /// Sprint 197 — body of `DocumentAdapter::delete_document`.
    pub(super) async fn delete_document_impl(
        &self,
        db: &str,
        collection: &str,
        id: DocumentId,
    ) -> Result<(), AppError> {
        validate_ns(db, collection)?;

        let filter_value = document_id_to_bson(&id)?;
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let filter = doc! { "_id": filter_value };

        let result = coll
            .delete_one(filter)
            .await
            .map_err(|e| AppError::Database(format!("delete_one failed: {e}")))?;

        if result.deleted_count == 0 {
            return Err(AppError::NotFound(format!(
                "document with _id {} not found",
                describe_document_id(&id)
            )));
        }

        Ok(())
    }

    /// Sprint 198 — body of `DocumentAdapter::delete_many`.
    ///
    /// Empty filter `{}` is allowed at this layer — the Safe Mode
    /// classifier (`analyzeMongoOperation`) gates on the frontend before
    /// the call ever reaches the adapter.
    pub(super) async fn delete_many_impl(
        &self,
        db: &str,
        collection: &str,
        filter: Document,
    ) -> Result<u64, AppError> {
        validate_ns(db, collection)?;
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let result = coll
            .delete_many(filter)
            .await
            .map_err(|e| AppError::Database(format!("delete_many failed: {e}")))?;

        Ok(result.deleted_count)
    }

    /// Sprint 198 — body of `DocumentAdapter::update_many`.
    ///
    /// Mirrors `update_document_impl`'s `_id` rejection: a bulk update
    /// must never rewrite the identity column. The check runs before
    /// `current_client()` so a misuse does not burn a round-trip.
    pub(super) async fn update_many_impl(
        &self,
        db: &str,
        collection: &str,
        filter: Document,
        patch: Document,
    ) -> Result<u64, AppError> {
        validate_ns(db, collection)?;

        if patch.contains_key("_id") {
            return Err(AppError::Validation(
                "update_many: patch must not contain _id".into(),
            ));
        }

        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        let update = doc! { "$set": patch };

        let result = coll
            .update_many(filter, update)
            .await
            .map_err(|e| AppError::Database(format!("update_many failed: {e}")))?;

        Ok(result.modified_count)
    }

    /// Sprint 198 — body of `DocumentAdapter::drop_collection`.
    pub(super) async fn drop_collection_impl(
        &self,
        db: &str,
        collection: &str,
    ) -> Result<(), AppError> {
        validate_ns(db, collection)?;
        let client = self.current_client().await?;
        let coll = client.database(db).collection::<Document>(collection);

        coll.drop()
            .await
            .map_err(|e| AppError::Database(format!("drop collection failed: {e}")))?;

        Ok(())
    }
}

// ── Mutate helpers (Sprint 80) ─────────────────────────────────────────

/// Convert a `DocumentId` into the `Bson` shape MongoDB expects in an
/// `_id` filter position.
///
/// The four `DocumentId` variants map as follows:
///   * `ObjectId(hex)` — parsed via `bson::oid::ObjectId::parse_str`; an
///     invalid hex string surfaces as `AppError::Validation` so the caller
///     can distinguish "bad client input" from a driver failure.
///   * `String(s)`     — `Bson::String` (pass-through).
///   * `Number(n)`     — `Bson::Int64` (the wire type of `DocumentId::Number`).
///   * `Raw(b)`        — the wrapped `Bson` is cloned through, reserving an
///     escape hatch for composite / binary `_id` shapes that do not fit the
///     top three cases.
pub(super) fn document_id_to_bson(id: &DocumentId) -> Result<Bson, AppError> {
    match id {
        DocumentId::ObjectId(hex) => bson::oid::ObjectId::parse_str(hex)
            .map(Bson::ObjectId)
            .map_err(|e| AppError::Validation(format!("invalid ObjectId hex '{hex}': {e}"))),
        DocumentId::String(s) => Ok(Bson::String(s.clone())),
        DocumentId::Number(n) => Ok(Bson::Int64(*n)),
        DocumentId::Raw(b) => Ok(b.clone()),
    }
}

/// Convert the BSON `_id` emitted by the driver (e.g. `InsertOneResult::inserted_id`)
/// into the `DocumentId` shape that the frontend consumes.
///
/// Reverses `document_id_to_bson` for the three well-typed variants and
/// falls through to `DocumentId::Raw` for everything else so new BSON types
/// do not force a breaking change to the public enum.
pub(super) fn bson_id_to_document_id(value: &Bson) -> DocumentId {
    match value {
        Bson::ObjectId(oid) => DocumentId::ObjectId(oid.to_hex()),
        Bson::String(s) => DocumentId::String(s.clone()),
        Bson::Int32(n) => DocumentId::Number(i64::from(*n)),
        Bson::Int64(n) => DocumentId::Number(*n),
        other => DocumentId::Raw(other.clone()),
    }
}

/// Short, human-friendly rendering of a `DocumentId` for error messages —
/// keeps the `AppError::NotFound` payload informative without leaking the
/// full `Bson` shape when the id is a `Raw` variant.
pub(super) fn describe_document_id(id: &DocumentId) -> String {
    match id {
        DocumentId::ObjectId(hex) => hex.clone(),
        DocumentId::String(s) => s.clone(),
        DocumentId::Number(n) => n.to_string(),
        DocumentId::Raw(b) => format!("{b:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DocumentAdapter;

    #[tokio::test]
    async fn insert_document_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.insert_document("db", "c", Document::new()).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn insert_document_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter.insert_document("   ", "c", Document::new()).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
        match adapter.insert_document("db", "   ", Document::new()).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_document_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter
            .update_document("db", "c", DocumentId::Number(1), doc! { "name": "x" })
            .await
        {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_document_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter
            .update_document("   ", "c", DocumentId::Number(1), doc! { "name": "x" })
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_document_rejects_id_in_patch() {
        use bson::oid::ObjectId;
        let adapter = MongoAdapter::new();
        // Guard runs before the connection probe so this does not need a
        // live MongoDB instance to exercise.
        let patch = doc! { "_id": ObjectId::new(), "name": "x" };
        match adapter
            .update_document("db", "c", DocumentId::Number(1), patch)
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("patch must not contain _id"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn delete_document_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter
            .delete_document("db", "c", DocumentId::Number(1))
            .await
        {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn delete_document_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter
            .delete_document("db", "   ", DocumentId::Number(1))
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[test]
    fn document_id_to_bson_parses_objectid_hex() {
        let hex = "507f1f77bcf86cd799439011";
        let bson = document_id_to_bson(&DocumentId::ObjectId(hex.into()))
            .expect("valid ObjectId hex should parse");
        match bson {
            Bson::ObjectId(oid) => assert_eq!(oid.to_hex(), hex),
            other => panic!("expected Bson::ObjectId, got {other:?}"),
        }
    }

    #[test]
    fn document_id_to_bson_rejects_invalid_objectid_hex() {
        let err = document_id_to_bson(&DocumentId::ObjectId("not-hex".into()))
            .expect_err("invalid hex must surface a Validation error");
        match err {
            AppError::Validation(msg) => assert!(
                msg.contains("invalid ObjectId hex"),
                "unexpected message: {msg}"
            ),
            other => panic!("expected Validation error, got {other:?}"),
        }
    }

    #[test]
    fn document_id_to_bson_preserves_string_and_number() {
        let s = document_id_to_bson(&DocumentId::String("abc".into()))
            .expect("string id should pass through");
        assert_eq!(s, Bson::String("abc".into()));

        let n = document_id_to_bson(&DocumentId::Number(42))
            .expect("number id should pass through as Int64");
        assert_eq!(n, Bson::Int64(42));
    }

    #[test]
    fn document_id_to_bson_preserves_raw_variant() {
        let raw = Bson::Boolean(true);
        let out = document_id_to_bson(&DocumentId::Raw(raw.clone()))
            .expect("raw variant should pass through");
        assert_eq!(out, raw);
    }

    #[test]
    fn bson_id_to_document_id_maps_objectid_and_int32() {
        use bson::oid::ObjectId;
        let oid = ObjectId::new();
        let id = bson_id_to_document_id(&Bson::ObjectId(oid));
        match id {
            DocumentId::ObjectId(hex) => assert_eq!(hex, oid.to_hex()),
            other => panic!("expected DocumentId::ObjectId, got {other:?}"),
        }

        // Int32 must widen to i64.
        let id32 = bson_id_to_document_id(&Bson::Int32(5));
        match id32 {
            DocumentId::Number(n) => assert_eq!(n, 5_i64),
            other => panic!("expected DocumentId::Number(5), got {other:?}"),
        }
    }

    // ── Sprint 198 — bulk-write smoke tests ───────────────────────────
    //
    // Each `*_without_connection` case probes the same `current_client()`
    // gate as the single-doc variants so we know the new methods plug into
    // the same connection-state machinery (no hidden bypass). The
    // `_rejects_empty_namespace` and `_rejects_id_in_patch` cases run
    // before any connection call, exercising the validators that the UI
    // (Safe Mode + `analyzeMongoOperation`) relies on as a backend
    // safety net.
    //
    // Sprint 198 / 2026-05-02.

    #[tokio::test]
    async fn delete_many_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.delete_many("db", "c", Document::new()).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn delete_many_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter.delete_many("   ", "c", Document::new()).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_many_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter
            .update_many("db", "c", Document::new(), doc! { "name": "x" })
            .await
        {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_many_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter
            .update_many("db", "   ", Document::new(), doc! { "name": "x" })
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_many_rejects_id_in_patch() {
        use bson::oid::ObjectId;
        let adapter = MongoAdapter::new();
        let patch = doc! { "_id": ObjectId::new(), "name": "x" };
        match adapter.update_many("db", "c", Document::new(), patch).await {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("patch must not contain _id"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn drop_collection_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.drop_collection("db", "c").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn drop_collection_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter.drop_collection("   ", "c").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[test]
    fn bson_id_to_document_id_maps_string_int64_and_raw() {
        let id_str = bson_id_to_document_id(&Bson::String("x".into()));
        match id_str {
            DocumentId::String(s) => assert_eq!(s, "x"),
            other => panic!("expected DocumentId::String, got {other:?}"),
        }

        let id64 = bson_id_to_document_id(&Bson::Int64(9_999_999_999));
        match id64 {
            DocumentId::Number(n) => assert_eq!(n, 9_999_999_999_i64),
            other => panic!("expected DocumentId::Number, got {other:?}"),
        }

        // Boolean falls through to Raw — it has no lossless DocumentId
        // representation so the enum escape hatch is the correct mapping.
        let id_raw = bson_id_to_document_id(&Bson::Boolean(true));
        match id_raw {
            DocumentId::Raw(b) => assert_eq!(b, Bson::Boolean(true)),
            other => panic!("expected DocumentId::Raw, got {other:?}"),
        }
    }
}
