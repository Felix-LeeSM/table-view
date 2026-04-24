//! MongoDB adapter (Sprint 65).
//!
//! This sprint introduces the first document-paradigm adapter. Per the Sprint
//! 65 contract only lifecycle + namespace-enumeration paths are fully wired:
//!
//! * `connect` / `disconnect` / `ping`
//! * `list_databases` (via `Client::list_database_names`)
//! * `list_collections(db)` (via `database.list_collection_names`)
//!
//! The remaining `DocumentAdapter` methods (`find`, `aggregate`,
//! `insert_document`, `update_document`, `delete_document`,
//! `infer_collection_fields`) return `AppError::Unsupported` stubs — each
//! stub is exercised by a unit test in this module so regressions in the
//! not-yet-implemented paths surface immediately.
//!
//! ## State
//!
//! The adapter holds `(Option<Client>, Option<String>)` under two
//! `tokio::sync::Mutex`es — mirroring `PostgresAdapter`'s `Arc<Mutex<_>>`
//! pattern. The second slot stores the configured default database so
//! `list_collections(default_db)` can be routed without the caller passing
//! the name on every hop (Sprint 66+ will lean on this).
//!
//! ## Connection options
//!
//! Rather than assembling a URI string (which forces percent-encoding of user
//! / password and TLS/replica-set flags), we build
//! `mongodb::options::ClientOptions` programmatically. `auth_source`,
//! `replica_set`, and `tls_enabled` from `ConnectionConfig` flow straight
//! into the corresponding option fields.

use std::sync::Arc;

use ::mongodb::options::{ClientOptions, Credential, ServerAddress, Tls, TlsOptions};
use ::mongodb::Client;
use bson::{doc, Document};
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::models::{ColumnInfo, ConnectionConfig, DatabaseType, TableInfo};

use super::{
    BoxFuture, DbAdapter, DocumentAdapter, DocumentId, DocumentQueryResult, FindBody, NamespaceInfo,
};

/// Document-paradigm adapter backed by the official `mongodb` driver.
pub struct MongoAdapter {
    client: Arc<Mutex<Option<Client>>>,
    default_db: Arc<Mutex<Option<String>>>,
}

impl Default for MongoAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl MongoAdapter {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            default_db: Arc::new(Mutex::new(None)),
        }
    }

    /// Build a `ClientOptions` from the caller's `ConnectionConfig`.
    ///
    /// Done programmatically (rather than via URI parsing) so that password
    /// special characters never need to be percent-encoded, and TLS / replica
    /// set / auth-source flags map to typed option fields.
    fn build_options(config: &ConnectionConfig) -> Result<ClientOptions, AppError> {
        let mut opts = ClientOptions::default();

        opts.hosts = vec![ServerAddress::Tcp {
            host: config.host.clone(),
            port: Some(config.port),
        }];

        if !config.user.is_empty() {
            let mut cred = Credential::default();
            cred.username = Some(config.user.clone());
            if !config.password.is_empty() {
                cred.password = Some(config.password.clone());
            }
            if let Some(source) = config
                .auth_source
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                cred.source = Some(source.to_string());
            } else if !config.database.is_empty() {
                cred.source = Some(config.database.clone());
            }
            opts.credential = Some(cred);
        }

        if let Some(rs) = config
            .replica_set
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            opts.repl_set_name = Some(rs.to_string());
        }

        if matches!(config.tls_enabled, Some(true)) {
            opts.tls = Some(Tls::Enabled(TlsOptions::default()));
        }

        if let Some(timeout_secs) = config.connection_timeout {
            opts.connect_timeout = Some(std::time::Duration::from_secs(timeout_secs as u64));
            opts.server_selection_timeout =
                Some(std::time::Duration::from_secs(timeout_secs as u64));
        }

        opts.app_name = Some("table-view".to_string());
        Ok(opts)
    }

    async fn current_client(&self) -> Result<Client, AppError> {
        let guard = self.client.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| AppError::Connection("MongoDB connection is not established".into()))
    }
}

impl DbAdapter for MongoAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Mongodb
    }

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            let opts = Self::build_options(config)?;
            let client = Client::with_options(opts)
                .map_err(|e| AppError::Connection(format!("MongoDB client build failed: {e}")))?;

            // Probe the server once so connect() actually fails fast when the
            // host is unreachable. MongoDB's driver is lazy otherwise and
            // later operations would be the first to notice.
            client
                .database("admin")
                .run_command(doc! { "ping": 1 })
                .await
                .map_err(|e| AppError::Connection(format!("MongoDB ping failed: {e}")))?;

            {
                let mut guard = self.client.lock().await;
                *guard = Some(client);
            }
            {
                let mut guard = self.default_db.lock().await;
                *guard = if config.database.trim().is_empty() {
                    None
                } else {
                    Some(config.database.clone())
                };
            }
            Ok(())
        })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            // Explicitly drop the client so pooled sockets are released.
            let mut guard = self.client.lock().await;
            *guard = None;
            let mut db_guard = self.default_db.lock().await;
            *db_guard = None;
            Ok(())
        })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            let client = self.current_client().await?;
            client
                .database("admin")
                .run_command(doc! { "ping": 1 })
                .await
                .map(|_| ())
                .map_err(|e| AppError::Connection(format!("MongoDB ping failed: {e}")))
        })
    }
}

impl DocumentAdapter for MongoAdapter {
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move {
            let client = self.current_client().await?;
            let names = client
                .list_database_names()
                .await
                .map_err(|e| AppError::Database(format!("list_database_names failed: {e}")))?;
            Ok(names
                .into_iter()
                .map(|name| NamespaceInfo { name })
                .collect())
        })
    }

    fn list_collections<'a>(
        &'a self,
        db: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async move {
            if db.trim().is_empty() {
                return Err(AppError::Validation(
                    "Database name must not be empty".into(),
                ));
            }
            let client = self.current_client().await?;
            let names = client
                .database(db)
                .list_collection_names()
                .await
                .map_err(|e| AppError::Database(format!("list_collection_names failed: {e}")))?;
            let schema = db.to_string();
            Ok(names
                .into_iter()
                .map(|name| TableInfo {
                    name,
                    schema: schema.clone(),
                    row_count: None,
                })
                .collect())
        })
    }

    fn infer_collection_fields<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _sample_size: usize,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "MongoAdapter::infer_collection_fields is not implemented until Sprint 66".into(),
            ))
        })
    }

    fn find<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _body: FindBody,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "MongoAdapter::find is not implemented until Sprint 66".into(),
            ))
        })
    }

    fn aggregate<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _pipeline: Vec<Document>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "MongoAdapter::aggregate is not implemented until Sprint 66".into(),
            ))
        })
    }

    fn insert_document<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _doc: Document,
    ) -> BoxFuture<'a, Result<DocumentId, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "MongoAdapter::insert_document is not implemented until Sprint 66".into(),
            ))
        })
    }

    fn update_document<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _id: DocumentId,
        _patch: Document,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "MongoAdapter::update_document is not implemented until Sprint 66".into(),
            ))
        })
    }

    fn delete_document<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _id: DocumentId,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "MongoAdapter::delete_document is not implemented until Sprint 66".into(),
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_adapter_reports_mongodb_kind() {
        let adapter = MongoAdapter::new();
        assert!(matches!(adapter.kind(), DatabaseType::Mongodb));
    }

    #[test]
    fn default_is_equivalent_to_new() {
        let a = MongoAdapter::default();
        assert!(matches!(a.kind(), DatabaseType::Mongodb));
    }

    fn sample_config() -> ConnectionConfig {
        ConnectionConfig {
            id: "m1".into(),
            name: "Mongo".into(),
            db_type: DatabaseType::Mongodb,
            host: "localhost".into(),
            port: 27017,
            user: "u".into(),
            password: "p".into(),
            database: "d".into(),
            group_id: None,
            color: None,
            connection_timeout: Some(5),
            keep_alive_interval: None,
            environment: None,
            auth_source: Some("admin".into()),
            replica_set: Some("rs0".into()),
            tls_enabled: Some(true),
        }
    }

    #[test]
    fn build_options_maps_fields_to_client_options() {
        let cfg = sample_config();
        let opts = MongoAdapter::build_options(&cfg).expect("build_options should succeed");

        // Host / port round-trip
        assert_eq!(opts.hosts.len(), 1);
        match &opts.hosts[0] {
            ServerAddress::Tcp { host, port } => {
                assert_eq!(host, "localhost");
                assert_eq!(*port, Some(27017));
            }
            other => panic!("unexpected ServerAddress variant: {other:?}"),
        }

        // Credentials pick up username/password + auth_source override.
        let cred = opts.credential.as_ref().expect("credential expected");
        assert_eq!(cred.username.as_deref(), Some("u"));
        assert_eq!(cred.password.as_deref(), Some("p"));
        assert_eq!(cred.source.as_deref(), Some("admin"));

        // Replica set propagated.
        assert_eq!(opts.repl_set_name.as_deref(), Some("rs0"));

        // TLS enabled.
        assert!(matches!(opts.tls, Some(Tls::Enabled(_))));

        // Timeouts derived from connection_timeout.
        assert_eq!(
            opts.connect_timeout,
            Some(std::time::Duration::from_secs(5))
        );
    }

    #[test]
    fn build_options_defaults_when_mongo_specific_fields_missing() {
        let cfg = ConnectionConfig {
            id: "m1".into(),
            name: "Mongo".into(),
            db_type: DatabaseType::Mongodb,
            host: "localhost".into(),
            port: 27017,
            user: "".into(),
            password: "".into(),
            database: "".into(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        };
        let opts = MongoAdapter::build_options(&cfg).expect("build_options should succeed");
        assert!(opts.credential.is_none());
        assert!(opts.repl_set_name.is_none());
        assert!(opts.tls.is_none());
        assert!(opts.connect_timeout.is_none());
    }

    #[tokio::test]
    async fn ping_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.ping().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got: {:?}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn disconnect_without_connection_is_ok() {
        let adapter = MongoAdapter::new();
        assert!(adapter.disconnect().await.is_ok());
    }

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
        match adapter.list_collections("   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    // -- Unsupported stub coverage ------------------------------------------
    //
    // Each of the five not-yet-implemented DocumentAdapter methods gets a
    // single assertion so regressions in the stub path (e.g. accidental
    // panics, wrong AppError variant) surface immediately.

    #[tokio::test]
    async fn infer_collection_fields_returns_unsupported() {
        let adapter = MongoAdapter::new();
        match adapter.infer_collection_fields("db", "c", 10).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("infer_collection_fields")),
            other => panic!("expected Unsupported, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn find_returns_unsupported() {
        let adapter = MongoAdapter::new();
        let body = FindBody::default();
        match adapter.find("db", "c", body).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("find")),
            other => panic!("expected Unsupported, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn aggregate_returns_unsupported() {
        let adapter = MongoAdapter::new();
        match adapter.aggregate("db", "c", Vec::new()).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("aggregate")),
            other => panic!("expected Unsupported, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn insert_document_returns_unsupported() {
        let adapter = MongoAdapter::new();
        match adapter.insert_document("db", "c", Document::new()).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("insert_document")),
            other => panic!("expected Unsupported, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_document_returns_unsupported() {
        let adapter = MongoAdapter::new();
        match adapter
            .update_document("db", "c", DocumentId::Number(1), Document::new())
            .await
        {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("update_document")),
            other => panic!("expected Unsupported, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn delete_document_returns_unsupported() {
        let adapter = MongoAdapter::new();
        match adapter
            .delete_document("db", "c", DocumentId::Number(1))
            .await
        {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("delete_document")),
            other => panic!("expected Unsupported, got ok? {}", other.is_ok()),
        }
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
