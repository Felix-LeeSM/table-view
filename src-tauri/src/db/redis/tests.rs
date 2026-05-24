use super::helpers::{
    bounded_limit, connection_url, ensure_not_cancelled, redis_connection_error,
    redis_database_error, require_confirm_key, validate_key, DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT,
};
use super::values::{
    map_key_type, read_hash, read_json, read_list, read_set, read_stream_range, read_string,
    read_zset, ttl_from_seconds,
};
use super::{build_set_string_command, RedisAdapter};
use crate::db::{
    DbAdapter, KvAdapter, KvDeleteRequest, KvKeyScanRequest, KvKeyType, KvSetStringRequest,
    KvStreamReadRequest, KvTtlState, KvTtlUpdate, KvTtlUpdateRequest, KvValueReadRequest,
    KvWriteSafety,
};
use crate::error::AppError;
use crate::models::{ConnectionConfig, DatabaseType};
use tokio_util::sync::CancellationToken;

// Purpose: Redis adapter pure contract guards before fixture I/O is layered on
// top (sprint 466-467, 2026-05-24).

fn config(database: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "r1".into(),
        name: "redis".into(),
        db_type: DatabaseType::Redis,
        host: "redis.local".into(),
        port: 6379,
        user: "acl user".into(),
        password: "p@ss".into(),
        database: database.into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
    }
}

#[test]
fn connection_url_percent_encodes_auth_and_database() {
    // Reason: credentials must not break Redis URI parsing or leak through malformed auth (2026-05-24).
    let (url, db) = connection_url(&config("2")).unwrap();
    assert_eq!(db, 2);
    assert_eq!(url, "redis://acl%20user:p%40ss@redis.local:6379/2");
}

#[test]
fn connection_url_uses_rediss_when_tls_is_enabled() {
    let mut config = config("5");
    config.tls_enabled = Some(true);

    let (url, db) = connection_url(&config).unwrap();

    assert_eq!(db, 5);
    assert_eq!(url, "rediss://acl%20user:p%40ss@redis.local:6379/5");
}

#[test]
fn set_string_reject_overwrite_uses_atomic_set_nx_with_ttl() {
    let cmd = build_set_string_command(&KvSetStringRequest {
        key: "session:1".into(),
        value: "v".into(),
        database: Some(0),
        ttl_seconds: Some(30),
        safety: KvWriteSafety::RejectOverwrite,
    })
    .unwrap();

    assert_eq!(
        String::from_utf8(cmd.get_packed_command()).unwrap(),
        "*6\r\n$3\r\nSET\r\n$9\r\nsession:1\r\n$1\r\nv\r\n$2\r\nNX\r\n$2\r\nEX\r\n$2\r\n30\r\n"
    );
}

#[test]
fn bounded_limit_clamps_large_keyspace_scan_count() {
    // Reason: key browsing must never request unbounded SCAN work from Redis (2026-05-24).
    assert_eq!(bounded_limit(None), DEFAULT_SCAN_LIMIT);
    assert_eq!(bounded_limit(Some(0)), 1);
    assert_eq!(bounded_limit(Some(50_000)), MAX_SCAN_LIMIT);
}

#[test]
fn destructive_delete_requires_exact_key_confirmation() {
    // Reason: delete and TTL-persist safety hooks rely on exact key confirmation (2026-05-24).
    assert!(require_confirm_key("prod:1", "prod:1").is_ok());
    assert!(matches!(
        require_confirm_key("prod:1", "prod"),
        Err(AppError::Validation(_))
    ));
}

#[test]
fn redis_type_mapping_covers_common_value_types() {
    // Reason: value renderers dispatch from typed key metadata, not raw Redis TYPE strings (2026-05-24).
    assert_eq!(map_key_type("string"), KvKeyType::String);
    assert_eq!(map_key_type("zset"), KvKeyType::ZSet);
    assert_eq!(map_key_type("stream"), KvKeyType::Stream);
    assert_eq!(map_key_type("ReJSON-RL"), KvKeyType::Json);
    assert_eq!(map_key_type("none"), KvKeyType::Unknown);
    assert_eq!(ttl_from_seconds(-2).state, KvTtlState::Missing);
}

#[test]
fn redis_helper_error_paths_are_typed() {
    assert!(matches!(validate_key(""), Err(AppError::Validation(_))));

    let token = CancellationToken::new();
    assert!(ensure_not_cancelled(Some(&token)).is_ok());
    token.cancel();
    assert!(matches!(
        ensure_not_cancelled(Some(&token)),
        Err(AppError::Database(_))
    ));

    let parse_err = "redis://[::1"
        .parse::<::redis::ConnectionInfo>()
        .unwrap_err();
    assert!(matches!(
        redis_connection_error(parse_err),
        AppError::Connection(_)
    ));

    let db_err = "redis://[::1"
        .parse::<::redis::ConnectionInfo>()
        .unwrap_err();
    assert!(matches!(
        redis_database_error(db_err),
        AppError::Database(_)
    ));
}

#[tokio::test]
async fn disconnected_adapter_covers_non_network_error_paths() {
    let adapter = RedisAdapter::new();
    assert!(matches!(adapter.kind(), DatabaseType::Redis));
    assert_eq!(adapter.current_database().await.unwrap(), Some(0));
    assert!(adapter.switch_database(0).await.is_ok());
    assert_eq!(adapter.list_databases().await.unwrap().len(), 16);
    assert!(adapter.disconnect().await.is_ok());
    assert!(matches!(adapter.ping().await, Err(AppError::Connection(_))));

    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(matches!(
        adapter
            .scan_keys(
                KvKeyScanRequest {
                    database: Some(0),
                    cursor: None,
                    pattern: None,
                    limit: Some(10),
                },
                Some(&cancelled),
            )
            .await,
        Err(AppError::Database(_))
    ));
    assert!(matches!(
        adapter
            .read_value(
                KvValueReadRequest {
                    key: "session:1".into(),
                    database: Some(0),
                    limit: Some(10),
                    cursor: None,
                },
                Some(&cancelled),
            )
            .await,
        Err(AppError::Database(_))
    ));
    assert!(matches!(
        adapter
            .read_stream(
                KvStreamReadRequest {
                    key: "events".into(),
                    database: Some(0),
                    start: None,
                    end: None,
                    limit: Some(10),
                },
                Some(&cancelled),
            )
            .await,
        Err(AppError::Database(_))
    ));

    assert!(matches!(
        adapter
            .set_string(KvSetStringRequest {
                key: "".into(),
                value: "v".into(),
                database: Some(0),
                ttl_seconds: None,
                safety: KvWriteSafety::RejectOverwrite,
            })
            .await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        adapter
            .delete_key(KvDeleteRequest {
                key: "session:1".into(),
                database: Some(0),
                confirm_key: "different".into(),
            })
            .await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        adapter
            .update_ttl(KvTtlUpdateRequest {
                key: "".into(),
                database: Some(0),
                update: KvTtlUpdate::Expire { seconds: 30 },
            })
            .await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        adapter
            .update_ttl(KvTtlUpdateRequest {
                key: "session:1".into(),
                database: Some(0),
                update: KvTtlUpdate::Expire { seconds: 0 },
            })
            .await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        adapter
            .update_ttl(KvTtlUpdateRequest {
                key: "session:1".into(),
                database: Some(0),
                update: KvTtlUpdate::Persist {
                    confirm_key: "session:1".into(),
                },
            })
            .await,
        Err(AppError::Connection(_))
    ));
}

#[tokio::test]
async fn disconnected_value_readers_return_connection_error() {
    let adapter = RedisAdapter::new();
    assert!(matches!(
        read_string(&adapter, "k").await,
        Err(AppError::Connection(_))
    ));
    assert!(matches!(
        read_list(&adapter, "k", 10).await,
        Err(AppError::Connection(_))
    ));
    assert!(matches!(
        read_set(&adapter, "k", "0", 10).await,
        Err(AppError::Connection(_))
    ));
    assert!(matches!(
        read_zset(&adapter, "k", 10).await,
        Err(AppError::Connection(_))
    ));
    assert!(matches!(
        read_hash(&adapter, "k", "0", 10).await,
        Err(AppError::Connection(_))
    ));
    assert!(matches!(
        read_json(&adapter, "k").await,
        Err(AppError::Connection(_))
    ));
    assert!(matches!(
        read_stream_range(&adapter, "k", "-", "+", 10).await,
        Err(AppError::Connection(_))
    ));
}
