use tokio_util::sync::CancellationToken;

use crate::error::AppError;

use super::types::BoxFuture;
use super::{
    DbAdapter, KvDatabaseInfo, KvDeleteRequest, KvKeyScanPage, KvKeyScanRequest, KvMutationResult,
    KvSetStringRequest, KvStreamReadRequest, KvStreamReadResult, KvTtlUpdateRequest,
    KvValueEnvelope, KvValueReadRequest,
};

pub trait KvAdapter: DbAdapter {
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<KvDatabaseInfo>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This key-value adapter does not list databases".into(),
            ))
        })
    }

    fn switch_database<'a>(&'a self, _database: u16) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This key-value adapter does not support database switching".into(),
            ))
        })
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<u16>, AppError>> {
        Box::pin(async { Ok(None) })
    }

    fn scan_keys<'a>(
        &'a self,
        _request: KvKeyScanRequest,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<KvKeyScanPage, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This key-value adapter does not support bounded key scan".into(),
            ))
        })
    }

    fn read_value<'a>(
        &'a self,
        _request: KvValueReadRequest,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<KvValueEnvelope, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This key-value adapter does not read values".into(),
            ))
        })
    }

    fn set_string<'a>(
        &'a self,
        _request: KvSetStringRequest,
    ) -> BoxFuture<'a, Result<KvMutationResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This key-value adapter does not edit string values".into(),
            ))
        })
    }

    fn delete_key<'a>(
        &'a self,
        _request: KvDeleteRequest,
    ) -> BoxFuture<'a, Result<KvMutationResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This key-value adapter does not delete keys".into(),
            ))
        })
    }

    fn update_ttl<'a>(
        &'a self,
        _request: KvTtlUpdateRequest,
    ) -> BoxFuture<'a, Result<KvMutationResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This key-value adapter does not update TTL".into(),
            ))
        })
    }

    fn read_stream<'a>(
        &'a self,
        _request: KvStreamReadRequest,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<KvStreamReadResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This key-value adapter does not read streams".into(),
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{BoxFuture, KvTtlUpdate, KvWriteSafety};
    use crate::models::{ConnectionConfig, DatabaseType};

    // Purpose: mock conformance for the KV adapter contract before Redis
    // implementation claims support (sprint 465, 2026-05-24).

    struct UnsupportedKvAdapter;

    impl DbAdapter for UnsupportedKvAdapter {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Redis
        }

        fn connect<'a>(
            &'a self,
            _config: &'a ConnectionConfig,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }

        fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }

        fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }

    impl KvAdapter for UnsupportedKvAdapter {}

    #[tokio::test]
    async fn marker_defaults_return_explicit_unsupported() {
        // Reason: marker-only adapters must not silently look supported (2026-05-24).
        let adapter = UnsupportedKvAdapter;
        assert!(matches!(
            adapter.list_databases().await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            adapter.switch_database(1).await,
            Err(AppError::Unsupported(_))
        ));
        assert_eq!(adapter.current_database().await.unwrap(), None);
        assert!(matches!(
            adapter
                .scan_keys(
                    KvKeyScanRequest {
                        database: Some(0),
                        cursor: None,
                        pattern: None,
                        limit: Some(10),
                    },
                    None,
                )
                .await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            adapter
                .read_value(
                    KvValueReadRequest {
                        key: "k".into(),
                        database: Some(0),
                        limit: Some(10),
                        cursor: None,
                    },
                    None,
                )
                .await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            adapter
                .set_string(KvSetStringRequest {
                    key: "k".into(),
                    value: "v".into(),
                    database: Some(0),
                    ttl_seconds: None,
                    safety: KvWriteSafety::RejectOverwrite,
                })
                .await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            adapter
                .delete_key(KvDeleteRequest {
                    key: "k".into(),
                    database: Some(0),
                    confirm_key: "k".into(),
                })
                .await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            adapter
                .update_ttl(KvTtlUpdateRequest {
                    key: "k".into(),
                    database: Some(0),
                    update: KvTtlUpdate::Expire { seconds: 60 },
                })
                .await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            adapter
                .read_stream(
                    KvStreamReadRequest {
                        key: "stream".into(),
                        database: Some(0),
                        start: None,
                        end: None,
                        limit: Some(10),
                    },
                    None,
                )
                .await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn ttl_persist_request_carries_confirmation_key() {
        // Reason: destructive TTL removal must carry explicit key confirmation (2026-05-24).
        let request = KvTtlUpdateRequest {
            key: "session:1".into(),
            database: Some(0),
            update: KvTtlUpdate::Persist {
                confirm_key: "session:1".into(),
            },
        };
        let json = serde_json::to_value(request).unwrap();
        assert_eq!(json["update"]["mode"], "persist");
        assert_eq!(json["update"]["confirmKey"], "session:1");
    }
}
