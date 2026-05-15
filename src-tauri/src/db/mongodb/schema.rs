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

use super::super::{
    CreateMongoIndexRequest, CreateMongoIndexResult, MongoIndexCollation, MongoIndexDirection,
    NamespaceInfo,
};
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

    /// Sprint 351 — create a Mongo collection index from a fully-typed
    /// request. Translates `CreateMongoIndexRequest` into a
    /// `mongodb::IndexModel` + `mongodb::options::IndexOptions` and
    /// forwards driver errors verbatim as `AppError::Database(<msg>)`
    /// so the UI can surface MongoDB's native message (E11000 duplicate,
    /// IndexOptionsConflict, etc.).
    pub(super) async fn create_collection_index_impl(
        &self,
        db: &str,
        collection: &str,
        request: CreateMongoIndexRequest,
    ) -> Result<CreateMongoIndexResult, AppError> {
        let requested = if db.trim().is_empty() { None } else { Some(db) };
        let resolved = self
            .resolved_db_name(requested)
            .await
            .ok_or_else(|| AppError::Validation("Database name must not be empty".into()))?;
        validate_ns(&resolved, collection)?;

        if request.fields.is_empty() {
            return Err(AppError::Validation(
                "create_index requires at least one field".into(),
            ));
        }
        if request.expire_after_seconds.is_some() && request.fields.len() > 1 {
            return Err(AppError::Validation(
                "expireAfterSeconds requires a single-field index".into(),
            ));
        }

        // Assemble the keys document. Insertion order matters — Mongo
        // treats `(a:1, b:-1)` and `(b:-1, a:1)` as distinct compound
        // indexes. `bson::Document` preserves insertion order so the
        // user's UI ordering is honoured byte-for-byte.
        let mut keys = Document::new();
        for field in &request.fields {
            if field.name.trim().is_empty() {
                return Err(AppError::Validation(
                    "Index field name must not be empty".into(),
                ));
            }
            let dir: i32 = match field.direction {
                MongoIndexDirection::Asc => 1,
                MongoIndexDirection::Desc => -1,
            };
            keys.insert(&field.name, Bson::Int32(dir));
        }

        let mut options = mongodb::options::IndexOptions::builder().build();
        if let Some(name) = request.name.as_deref() {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                options.name = Some(trimmed.to_string());
            }
        }
        if let Some(true) = request.unique {
            options.unique = Some(true);
        }
        if let Some(true) = request.sparse {
            options.sparse = Some(true);
        }
        if let Some(secs) = request.expire_after_seconds {
            options.expire_after = Some(std::time::Duration::from_secs(secs as u64));
        }
        if let Some(filter_value) = request.partial_filter_expression {
            let doc = match bson::to_bson(&filter_value) {
                Ok(Bson::Document(d)) => d,
                Ok(_) => {
                    return Err(AppError::Validation(
                        "partialFilterExpression must be a JSON object".into(),
                    ));
                }
                Err(e) => {
                    return Err(AppError::Validation(format!(
                        "partialFilterExpression JSON could not be encoded: {e}"
                    )));
                }
            };
            options.partial_filter_expression = Some(doc);
        }
        if let Some(collation) = request.collation {
            options.collation = Some(build_collation(collation)?);
        }

        let model = mongodb::IndexModel::builder()
            .keys(keys)
            .options(options)
            .build();

        let client = self.current_client().await?;
        let coll = client
            .database(&resolved)
            .collection::<Document>(collection);

        let result = coll
            .create_index(model)
            .await
            .map_err(|e| AppError::Database(format!("create_index failed: {e}")))?;

        Ok(CreateMongoIndexResult {
            name: result.index_name,
        })
    }

    /// Sprint 351 — drop a Mongo collection index by canonical name.
    /// Driver errors (e.g. `IndexNotFound`) flow through as
    /// `AppError::Database` so the panel-level alert reads the verbatim
    /// driver message. The `_id_` guard lives in the Tauri command layer
    /// — at the adapter we let MongoDB enforce the same rule server-side
    /// in case a future caller bypasses the command shim.
    pub(super) async fn drop_collection_index_impl(
        &self,
        db: &str,
        collection: &str,
        name: &str,
    ) -> Result<(), AppError> {
        let requested = if db.trim().is_empty() { None } else { Some(db) };
        let resolved = self
            .resolved_db_name(requested)
            .await
            .ok_or_else(|| AppError::Validation("Database name must not be empty".into()))?;
        validate_ns(&resolved, collection)?;

        if name.trim().is_empty() {
            return Err(AppError::Validation("Index name must not be empty".into()));
        }

        let client = self.current_client().await?;
        let coll = client
            .database(&resolved)
            .collection::<Document>(collection);

        coll.drop_index(name)
            .await
            .map_err(|e| AppError::Database(format!("drop_index failed: {e}")))?;
        Ok(())
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

    /// Sprint 336 (U1 live wire) — `adminCommand({currentOp: 1, "$all":
    /// true})`. Maps each op into the same `ServerActivityRow` shape the
    /// PG `pg_stat_activity` query produces. Mongo "opid" is the kill
    /// id used by `killOp`.
    pub(super) async fn current_op_impl(
        &self,
    ) -> Result<Vec<crate::models::ServerActivityRow>, AppError> {
        let client = self.current_client().await?;
        let resp = client
            .database("admin")
            .run_command(doc! { "currentOp": 1, "$all": true })
            .await
            .map_err(|e| AppError::Database(format!("currentOp failed: {e}")))?;

        let inprog = resp
            .get_array("inprog")
            .map_err(|e| AppError::Database(format!("currentOp inprog missing: {e}")))?;

        let mut out: Vec<crate::models::ServerActivityRow> = Vec::with_capacity(inprog.len());
        for entry in inprog {
            let Some(op) = entry.as_document() else {
                continue;
            };
            let id = op
                .get_i64("opid")
                .or_else(|_| op.get_i32("opid").map(|v| v as i64))
                .unwrap_or(0);
            let ns = op.get_str("ns").ok().map(|s| s.to_string());
            let user = op
                .get_document("client_metadata")
                .ok()
                .and_then(|m| m.get_str("user").ok())
                .map(|s| s.to_string())
                .or_else(|| op.get_str("effectiveUsers").ok().map(|s| s.to_string()));
            let state = op.get_str("op").ok().map(|s| s.to_string());
            let query = op
                .get_document("command")
                .ok()
                .map(|d| format!("{:?}", d))
                .or_else(|| op.get_str("desc").ok().map(|s| s.to_string()));
            let wait_event = op
                .get_str("waitingForLock")
                .ok()
                .map(|s| s.to_string())
                .or_else(|| {
                    op.get_bool("waitingForLock")
                        .ok()
                        .map(|b| if b { "lock" } else { "" }.to_string())
                });
            let started_at = op
                .get_i32("secs_running")
                .ok()
                .map(|n| format!("{n}s ago"))
                .or_else(|| op.get_i64("secs_running").ok().map(|n| format!("{n}s ago")));

            out.push(crate::models::ServerActivityRow {
                id,
                db: ns,
                user,
                state,
                query,
                wait_event,
                started_at,
            });
        }
        Ok(out)
    }

    /// Sprint 336 (U1 live wire) — `adminCommand({killOp: 1, op: id})`.
    pub(super) async fn kill_op_impl(&self, id: i64) -> Result<(), AppError> {
        let client = self.current_client().await?;
        client
            .database("admin")
            .run_command(doc! { "killOp": 1, "op": id })
            .await
            .map_err(|e| AppError::Database(format!("killOp failed: {e}")))?;
        Ok(())
    }

    /// Sprint 335 (Slice M live wire) — `db.dropDatabase()`. The Mongo
    /// driver's `Database::drop()` is idempotent: dropping a non-existent
    /// database succeeds.
    pub(super) async fn drop_database_impl(&self, name: &str) -> Result<(), AppError> {
        if name.trim().is_empty() {
            return Err(AppError::Validation(
                "Database name must not be empty".into(),
            ));
        }
        let client = self.current_client().await?;
        client
            .database(name)
            .drop()
            .await
            .map_err(|e| AppError::Database(format!("dropDatabase failed: {e}")))?;
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

    /// Sprint 339 (U4 live wire) — server identity (`buildInfo`) +
    /// runtime info (`serverStatus`). Two `adminCommand` round trips
    /// merged into the same `ServerInfoRow` slot.
    pub(super) async fn server_info_impl(&self) -> Result<crate::models::ServerInfoRow, AppError> {
        let client = self.current_client().await?;
        let build = client
            .database("admin")
            .run_command(doc! { "buildInfo": 1 })
            .await
            .map_err(|e| AppError::Database(format!("buildInfo failed: {e}")))?;
        let status = client
            .database("admin")
            .run_command(doc! { "serverStatus": 1 })
            .await
            .map_err(|e| AppError::Database(format!("serverStatus failed: {e}")))?;

        let version = build.get_str("version").unwrap_or("").to_string();
        let host = status.get_str("host").ok().map(|s| s.to_string());
        let uptime = status
            .get_f64("uptime")
            .ok()
            .map(|f| f as i64)
            .or_else(|| status.get_i64("uptime").ok())
            .or_else(|| status.get_i32("uptime").ok().map(|n| n as i64));
        let connections_active = status
            .get_document("connections")
            .ok()
            .and_then(|c| c.get_i32("active").ok().map(|n| n as i64))
            .or_else(|| {
                status
                    .get_document("connections")
                    .ok()
                    .and_then(|c| c.get_i64("active").ok())
            });

        let mut extras: std::collections::HashMap<String, serde_json::Value> =
            std::collections::HashMap::new();
        for key in &[
            "connections",
            "opcounters",
            "mem",
            "repl",
            "wiredTiger",
            "process",
            "pid",
            "storageEngine",
            "uptimeMillis",
            "localTime",
        ] {
            if let Some(value) = status.get(*key) {
                if let Ok(jv) = serde_json::to_value(value) {
                    extras.insert((*key).to_string(), jv);
                }
            }
        }
        for key in &["gitVersion", "modules", "openssl", "javascriptEngine"] {
            if let Some(value) = build.get(*key) {
                if let Ok(jv) = serde_json::to_value(value) {
                    extras.insert((*key).to_string(), jv);
                }
            }
        }

        Ok(crate::models::ServerInfoRow {
            version,
            host,
            uptime_sec: uptime,
            connections_active,
            extras,
        })
    }

    /// Sprint 338 (U3 live wire) — `runCommand({collStats: <coll>})`.
    ///
    /// PG `pg_stat_user_tables` row 와 같은 `CollectionStatsRow` 슬롯
    /// 으로 매핑. Mongo-only 필드 (`capped`, `avgObjSize`, `totalIndexSize`,
    /// `paddingFactor`, …) 는 `extras` 에 raw JSON 값으로 surface 한다.
    pub(super) async fn collection_stats_impl(
        &self,
        db: &str,
        collection: &str,
    ) -> Result<crate::models::CollectionStatsRow, AppError> {
        let requested = if db.trim().is_empty() { None } else { Some(db) };
        let resolved = self
            .resolved_db_name(requested)
            .await
            .ok_or_else(|| AppError::Validation("Database name must not be empty".into()))?;
        if collection.trim().is_empty() {
            return Err(AppError::Validation(
                "Collection name must not be empty".into(),
            ));
        }
        let client = self.current_client().await?;
        let resp = client
            .database(&resolved)
            .run_command(doc! { "collStats": collection })
            .await
            .map_err(|e| AppError::Database(format!("collStats failed: {e}")))?;

        let rows = resp
            .get_i64("count")
            .or_else(|_| resp.get_i32("count").map(|v| v as i64))
            .unwrap_or(0);
        let size_bytes = resp
            .get_i64("storageSize")
            .or_else(|_| resp.get_i32("storageSize").map(|v| v as i64))
            .or_else(|_| resp.get_i64("size"))
            .unwrap_or(0);
        let indexes = resp
            .get_i64("nindexes")
            .or_else(|_| resp.get_i32("nindexes").map(|v| v as i64))
            .unwrap_or(0);

        // Surface Mongo-only fields verbatim into `extras`.
        let mut extras: std::collections::HashMap<String, serde_json::Value> =
            std::collections::HashMap::new();
        for key in &[
            "capped",
            "avgObjSize",
            "totalIndexSize",
            "paddingFactor",
            "wiredTiger",
            "ns",
        ] {
            if let Some(value) = resp.get(*key) {
                if let Ok(jv) = serde_json::to_value(value) {
                    extras.insert((*key).to_string(), jv);
                }
            }
        }

        Ok(crate::models::CollectionStatsRow {
            rows,
            size_bytes,
            indexes,
            last_vacuum: None,
            last_analyze: None,
            seq_scans: None,
            idx_scans: None,
            n_dead: None,
            extras,
        })
    }

    /// Sprint 337 (U2 live wire) — Mongo `find` query plan.
    ///
    /// `runCommand({explain: {find, filter}, verbosity})` 를 target DB 에
    /// dispatch. verbosity 는 `"queryPlanner"`, `"executionStats"`,
    /// `"allPlansExecution"` 중 하나 — 비어 있으면 `"queryPlanner"` 로
    /// fallback. 응답 Document 를 raw `serde_json::Value` 로 변환 —
    /// frontend tree viewer 가 paradigm-neutral shape 으로 렌더.
    pub(super) async fn explain_query_impl(
        &self,
        db: &str,
        collection: &str,
        filter: bson::Document,
        verbosity: &str,
    ) -> Result<serde_json::Value, AppError> {
        let requested = if db.trim().is_empty() { None } else { Some(db) };
        let resolved = self
            .resolved_db_name(requested)
            .await
            .ok_or_else(|| AppError::Validation("Database name must not be empty".into()))?;
        if collection.trim().is_empty() {
            return Err(AppError::Validation(
                "Collection name must not be empty".into(),
            ));
        }
        let v = if verbosity.trim().is_empty() {
            "queryPlanner"
        } else {
            verbosity
        };
        let client = self.current_client().await?;
        let cmd = doc! {
            "explain": {
                "find": collection,
                "filter": filter,
            },
            "verbosity": v,
        };
        let resp = client
            .database(&resolved)
            .run_command(cmd)
            .await
            .map_err(|e| AppError::Database(format!("explain failed: {e}")))?;
        serde_json::to_value(&resp)
            .map_err(|e| AppError::Database(format!("explain response decode failed: {e}")))
    }

    /// Sprint 340 (U5 live wire) — top-N slow queries from
    /// `system.profile` of the currently-active DB. Mongo profiling is
    /// off by default — when the collection is empty/absent we return
    /// an empty Vec rather than erroring. Caller enables profiling via
    /// `db.setProfilingLevel(level, slowms)`.
    pub(super) async fn slow_queries_impl(
        &self,
        limit: i64,
    ) -> Result<Vec<crate::models::SlowQueryRow>, AppError> {
        let resolved = self
            .resolved_db_name(None)
            .await
            .ok_or_else(|| AppError::Validation("No active database for profiling".into()))?;
        let client = self.current_client().await?;
        let coll = client
            .database(&resolved)
            .collection::<Document>("system.profile");

        let cap: i64 = limit.clamp(1, 500);
        // system.profile may not exist when profiling is OFF — list it
        // first and short-circuit to an empty Vec instead of bubbling the
        // "NamespaceNotFound" error to the user.
        let names = client
            .database(&resolved)
            .list_collection_names()
            .await
            .map_err(|e| AppError::Database(format!("list_collection_names failed: {e}")))?;
        if !names.iter().any(|n| n == "system.profile") {
            return Ok(Vec::new());
        }

        let mut cursor = coll
            .find(Document::new())
            .sort(doc! { "ts": -1 })
            .limit(cap)
            .await
            .map_err(|e| AppError::Database(format!("system.profile find failed: {e}")))?;

        let mut out: Vec<crate::models::SlowQueryRow> = Vec::new();
        while let Some(next) = cursor.next().await {
            let doc =
                next.map_err(|e| AppError::Database(format!("system.profile cursor: {e}")))?;

            let millis = doc
                .get_f64("millis")
                .ok()
                .or_else(|| doc.get_i64("millis").ok().map(|n| n as f64))
                .or_else(|| doc.get_i32("millis").ok().map(|n| n as f64))
                .unwrap_or(0.0);
            let nreturned = doc
                .get_i64("nreturned")
                .ok()
                .or_else(|| doc.get_i32("nreturned").ok().map(|n| n as i64))
                .unwrap_or(0);

            let query_text = if let Ok(cmd) = doc.get_document("command") {
                bson::Bson::Document(cmd.clone())
                    .into_canonical_extjson()
                    .to_string()
            } else if let Ok(q) = doc.get_document("query") {
                bson::Bson::Document(q.clone())
                    .into_canonical_extjson()
                    .to_string()
            } else {
                doc.get_str("op").unwrap_or("").to_string()
            };

            let mut extras: std::collections::HashMap<String, serde_json::Value> =
                std::collections::HashMap::new();
            for key in &[
                "ts",
                "ns",
                "op",
                "keysExamined",
                "docsExamined",
                "planSummary",
                "user",
                "client",
                "appName",
            ] {
                if let Some(value) = doc.get(*key) {
                    if let Ok(jv) = serde_json::to_value(value) {
                        extras.insert((*key).to_string(), jv);
                    }
                }
            }

            out.push(crate::models::SlowQueryRow {
                query: query_text,
                calls: 1,
                total_exec_time_ms: millis,
                mean_exec_time_ms: millis,
                rows: nreturned,
                extras,
            });
        }

        Ok(out)
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

/// Sprint 351 — build a `mongodb::options::Collation` from the wire-side
/// `MongoIndexCollation`. The frontend only exposes the two ICU knobs we
/// care about for index tuning (`locale` + `strength` 1..5); the other
/// Collation flags stay at the driver's defaults.
fn build_collation(input: MongoIndexCollation) -> Result<mongodb::options::Collation, AppError> {
    if input.locale.trim().is_empty() {
        return Err(AppError::Validation(
            "Collation locale must not be empty".into(),
        ));
    }
    let mut collation = mongodb::options::Collation::builder()
        .locale(input.locale)
        .build();
    if let Some(level) = input.strength {
        let strength = match level {
            1 => mongodb::options::CollationStrength::Primary,
            2 => mongodb::options::CollationStrength::Secondary,
            3 => mongodb::options::CollationStrength::Tertiary,
            4 => mongodb::options::CollationStrength::Quaternary,
            5 => mongodb::options::CollationStrength::Identical,
            other => {
                return Err(AppError::Validation(format!(
                    "Collation strength must be 1..=5, got {other}"
                )));
            }
        };
        collation.strength = Some(strength);
    }
    Ok(collation)
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
    async fn drop_database_rejects_empty_name() {
        let adapter = MongoAdapter::new();
        match DocumentAdapter::drop_database(&adapter, "   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn drop_database_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match DocumentAdapter::drop_database(&adapter, "db").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn current_op_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.current_op().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn kill_op_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.kill_op(99).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    // Sprint 337 (U2 live wire) — explain_query unit cases.
    #[tokio::test]
    async fn explain_query_rejects_empty_db_and_no_active() {
        // 작성 이유 (2026-05-15): 빈 db 입력은 active-db fallback 으로
        // 떨어지는데 active 가 없으므로 Validation 으로 reject.
        let adapter = MongoAdapter::new();
        match adapter
            .explain_query("", "c", bson::Document::new(), "queryPlanner")
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn explain_query_rejects_empty_collection() {
        let adapter = MongoAdapter::new();
        match adapter
            .explain_query("db", "   ", bson::Document::new(), "queryPlanner")
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn explain_query_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter
            .explain_query("db", "c", bson::Document::new(), "queryPlanner")
            .await
        {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    // Sprint 338 (U3 live wire) — collection_stats unit cases.
    #[tokio::test]
    async fn collection_stats_rejects_empty_db_and_no_active() {
        let adapter = MongoAdapter::new();
        match adapter.collection_stats("", "c").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn collection_stats_rejects_empty_collection() {
        let adapter = MongoAdapter::new();
        match adapter.collection_stats("db", "   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn collection_stats_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.collection_stats("db", "c").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    // Sprint 339 (U4 live wire) — server_info no-param path. Real
    // buildInfo/serverStatus shape mapping is covered by Mongo
    // integration tests; unit test only asserts the no-connection guard.
    #[tokio::test]
    async fn server_info_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.server_info_impl().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    // Sprint 340 (U5 live wire) — slow_queries: no-DB path bails at
    // `resolved_db_name` with a Validation error before touching the
    // client. Real system.profile shape mapping (millis/nreturned/extras)
    // is covered by Mongo integration tests.
    #[tokio::test]
    async fn slow_queries_without_active_db_returns_validation_error() {
        let adapter = MongoAdapter::new();
        match adapter.slow_queries_impl(10).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("active database"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
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
