use super::helpers::{
    bounded_limit, connection_info, ensure_not_cancelled, redis_connection_error,
    redis_database_error, require_confirm_key, validate_key, DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT,
};
use super::test_support::{runtime_config, spawn_redis_catalog_stub};
use super::values::{map_key_type, ttl_from_seconds};
use super::{build_set_string_command, RedisAdapter};
use crate::db::{
    DbAdapter, KvAdapter, KvDeleteRequest, KvKeyScanRequest, KvKeyType, KvSetStringRequest,
    KvStreamReadRequest, KvStringEncoding, KvTtlState, KvTtlUpdate, KvTtlUpdateRequest, KvValue,
    KvValueReadRequest, KvWriteSafety,
};
use crate::error::AppError;
use crate::models::{ConnectionConfig, DatabaseType};
use tokio_util::sync::CancellationToken;

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
        trust_server_certificate: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    }
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
fn destructive_delete_requires_exact_key_confirmation() {
    assert!(require_confirm_key("prod:1", "prod:1").is_ok());
    assert!(matches!(
        require_confirm_key("prod:1", "prod"),
        Err(AppError::Validation(_))
    ));
}

// Issue #1090 — a bare "must match the target key" message is a dead-end: the
// editor DEL/PERSIST caller has no key input, so the mismatch error must name
// the expected key and the confirm path instead of just stating the rule.
#[test]
fn confirm_key_mismatch_names_target_key_and_resolution() {
    let Err(AppError::Validation(message)) = require_confirm_key("prod:1", "prod") else {
        panic!("expected a validation error on key mismatch");
    };
    assert!(
        message.contains("prod:1"),
        "error should name the target key, got: {message}"
    );
    assert!(
        message.to_lowercase().contains("confirm"),
        "error should point at the confirm path, got: {message}"
    );
}

#[tokio::test]
async fn valkey_direct_mutations_validate_requests_without_unsupported_gate() {
    let adapter = RedisAdapter::new_valkey();

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
            .set_string(KvSetStringRequest {
                key: "tv:direct".into(),
                value: "v".into(),
                database: Some(0),
                ttl_seconds: Some(0),
                safety: KvWriteSafety::RejectOverwrite,
            })
            .await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        adapter
            .delete_key(KvDeleteRequest {
                key: "tv:direct".into(),
                database: Some(0),
                confirm_key: "wrong".into(),
            })
            .await,
        Err(AppError::Validation(_))
    ));
}

// Issue #1454 (P2-4) — the connection info must carry host/port/db/user/password
// as structured fields, never as an assembled `redis://user:pw@host` URL string
// (a single debug log of that string leaks the credential). Credentials are the
// raw values (no percent-encoding, which was only a URL artifact) and the
// loggable connect target (`ConnectionAddr` Display, which the driver echoes on
// error) carries no password.
#[test]
fn connection_info_keeps_credentials_in_structured_fields_not_a_url() {
    let (info, db) = connection_info(&config("2")).unwrap();
    assert_eq!(db, 2);
    assert_eq!(info.redis.db, 2);
    assert_eq!(info.redis.username.as_deref(), Some("acl user"));
    assert_eq!(info.redis.password.as_deref(), Some("p@ss"));
    assert_eq!(
        info.addr,
        ::redis::ConnectionAddr::Tcp("redis.local".into(), 6379)
    );
    let target = format!("{}", info.addr);
    assert_eq!(target, "redis.local:6379");
    assert!(
        !target.contains("p@ss"),
        "credential leaked into loggable connect target: {target}"
    );
}

#[test]
fn connection_info_uses_tcp_tls_target_when_tls_is_enabled() {
    let mut config = config("5");
    config.tls_enabled = Some(true);

    let (info, db) = connection_info(&config).unwrap();

    assert_eq!(db, 5);
    assert_eq!(
        info.addr,
        ::redis::ConnectionAddr::TcpTls {
            host: "redis.local".into(),
            port: 6379,
            insecure: false,
            tls_params: None,
        }
    );
    assert_eq!(info.redis.password.as_deref(), Some("p@ss"));
}

#[test]
fn connection_info_trust_maps_to_insecure_tls_target() {
    // Reason: #1063 — redis/valkey gain the shared skip-verify opt-in; a
    // `trust_server_certificate = true` draft must set `insecure: true` on the
    // TcpTls target, while the default (trust absent) keeps verification.
    // (2026-07-17)
    let mut config = config("5");
    config.tls_enabled = Some(true);
    config.trust_server_certificate = Some(true);

    let (info, _db) = connection_info(&config).unwrap();

    assert_eq!(
        info.addr,
        ::redis::ConnectionAddr::TcpTls {
            host: "redis.local".into(),
            port: 6379,
            insecure: true,
            tls_params: None,
        }
    );
}

#[test]
fn bounded_limit_clamps_large_keyspace_scan_count() {
    assert_eq!(bounded_limit(None), DEFAULT_SCAN_LIMIT);
    assert_eq!(bounded_limit(Some(0)), 1);
    assert_eq!(bounded_limit(Some(50_000)), MAX_SCAN_LIMIT);
}

#[test]
fn redis_type_mapping_covers_key_browser_metadata_types() {
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
}

#[tokio::test]
async fn redis_adapter_runtime_covers_catalog_scan_and_metadata() {
    let port = spawn_redis_catalog_stub().await;
    let config = runtime_config(port, "2");
    RedisAdapter::test(&config).await.unwrap();

    let adapter = RedisAdapter::new();
    adapter.connect(&config).await.unwrap();
    adapter.ping().await.unwrap();
    assert_eq!(adapter.current_database().await.unwrap(), Some(2));

    let databases = adapter.list_databases().await.unwrap();
    assert_eq!(databases.len(), 4);
    assert_eq!(databases[0].key_count, Some(2));
    assert_eq!(databases[2].key_count, Some(1));

    adapter.switch_database(1).await.unwrap();
    assert_eq!(adapter.current_database().await.unwrap(), Some(1));

    let page = adapter
        .scan_keys(
            KvKeyScanRequest {
                database: Some(1),
                cursor: None,
                pattern: Some("a*".into()),
                limit: Some(25),
            },
            None,
        )
        .await
        .unwrap();

    assert_eq!(page.database, 1);
    assert!(page.done);
    assert_eq!(page.next_cursor, "0");
    assert_eq!(page.limit, 25);
    assert_eq!(page.keys.len(), 2);
    assert_eq!(page.keys[0].key, "alpha");
    assert_eq!(page.keys[0].key_type, KvKeyType::String);
    assert_eq!(page.keys[0].length, Some(5));
    assert_eq!(page.keys[0].memory_bytes, Some(64));
    assert_eq!(page.keys[0].ttl.state, KvTtlState::Expires);
    assert_eq!(page.keys[1].key_type, KvKeyType::Hash);
    assert_eq!(page.keys[1].length, Some(2));
    assert_eq!(page.keys[1].memory_bytes, Some(96));
    assert_eq!(page.keys[1].ttl.state, KvTtlState::Persistent);
}

#[tokio::test]
async fn redis_adapter_runtime_covers_values_ttl_mutations_and_streams() {
    let port = spawn_redis_catalog_stub().await;
    let config = runtime_config(port, "0");
    let adapter = RedisAdapter::new();
    adapter.connect(&config).await.unwrap();

    let string_value = read_value(&adapter, "alpha").await.value;
    match string_value {
        KvValue::String(value) => {
            assert_eq!(value.encoding, KvStringEncoding::Utf8);
            assert_eq!(value.text.as_deref(), Some("hello"));
        }
        other => panic!("expected string value, got {other:?}"),
    }

    let binary_value = read_value(&adapter, "binary").await.value;
    match binary_value {
        KvValue::String(value) => {
            assert_eq!(value.encoding, KvStringEncoding::Binary);
            assert_eq!(value.hex.as_deref(), Some("ff0041"));
        }
        other => panic!("expected binary string value, got {other:?}"),
    }

    for (key, expected) in [
        ("list", "list"),
        ("set", "set"),
        ("zset", "zset"),
        ("beta", "hash"),
        ("json", "json"),
        ("stream", "stream"),
        ("missing", "missing"),
    ] {
        assert_eq!(
            kv_value_kind(&read_value(&adapter, key).await.value),
            expected
        );
    }

    let stream = adapter
        .read_stream(
            KvStreamReadRequest {
                key: "events".into(),
                database: Some(0),
                start: Some("0-0".into()),
                end: Some("+".into()),
                limit: Some(10),
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(stream.entries[0].id, "1-0");
    assert_eq!(stream.entries[0].fields[0].field, "type");
    assert_eq!(stream.entries[0].fields[0].value, "login");

    assert!(matches!(
        adapter
            .set_string(KvSetStringRequest {
                key: "alpha".into(),
                value: "new".into(),
                database: Some(0),
                ttl_seconds: None,
                safety: KvWriteSafety::RejectOverwrite,
            })
            .await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        adapter
            .set_string(set_string_request("beta", KvWriteSafety::AllowOverwrite))
            .await,
        Err(AppError::Validation(message)) if message.contains("hash")
    ));

    let set_result = adapter
        .set_string(set_string_request(
            "mut:string",
            KvWriteSafety::AllowOverwrite,
        ))
        .await
        .unwrap();
    assert!(set_result.changed);
    assert_eq!(set_result.ttl.unwrap().state, KvTtlState::Expires);

    let expire_result = adapter
        .update_ttl(KvTtlUpdateRequest {
            key: "mut:string".into(),
            database: Some(0),
            update: KvTtlUpdate::Expire { seconds: 60 },
        })
        .await
        .unwrap();
    assert!(expire_result.changed);

    let persist_result = adapter
        .update_ttl(KvTtlUpdateRequest {
            key: "mut:string".into(),
            database: Some(0),
            update: KvTtlUpdate::Persist {
                confirm_key: "mut:string".into(),
            },
        })
        .await
        .unwrap();
    assert!(persist_result.changed);

    let delete_result = adapter
        .delete_key(KvDeleteRequest {
            key: "mut:string".into(),
            database: Some(0),
            confirm_key: "mut:string".into(),
        })
        .await
        .unwrap();
    assert!(delete_result.changed);
}

fn set_string_request(key: &str, safety: KvWriteSafety) -> KvSetStringRequest {
    KvSetStringRequest {
        key: key.into(),
        value: "new".into(),
        database: Some(0),
        ttl_seconds: Some(30),
        safety,
    }
}

fn kv_value_kind(value: &KvValue) -> &'static str {
    match value {
        KvValue::String(_) => "string",
        KvValue::List(_) => "list",
        KvValue::Set(_) => "set",
        KvValue::ZSet(_) => "zset",
        KvValue::Hash(_) => "hash",
        KvValue::Stream(_) => "stream",
        KvValue::Json(_) => "json",
        KvValue::Unsupported { .. } => "unsupported",
        KvValue::Missing => "missing",
    }
}

async fn read_value(adapter: &RedisAdapter, key: &str) -> crate::db::KvValueEnvelope {
    adapter
        .read_value(
            KvValueReadRequest {
                key: key.into(),
                database: Some(0),
                limit: Some(10),
                cursor: None,
            },
            None,
        )
        .await
        .unwrap()
}

// Reason: issue #1453 — the Redis/Valkey connection URL embeds the password
// (`redis://user:pw@host` / empty-user `redis://:pw@host`); driver errors
// that echo it must be masked by the connection-error mappers (2026-07-10).
#[test]
fn redis_and_valkey_connection_errors_mask_credential_echo() {
    let redis_err = ::redis::RedisError::from((
        ::redis::ErrorKind::IoError,
        "failed to connect",
        "redis://:S3cretPw1@redis.local:6379/0".to_string(),
    ));
    let message = redis_connection_error(redis_err).to_string();
    assert!(
        !message.contains("S3cretPw1"),
        "leaked plaintext credential: {message}"
    );
    assert!(message.contains("redis.local"));

    let valkey_err = ::redis::RedisError::from((
        ::redis::ErrorKind::IoError,
        "failed to connect",
        "rediss://acl:S3cretPw1@valkey.local:6380/0".to_string(),
    ));
    let message = super::RedisProtocolProduct::Valkey
        .connection_error(valkey_err)
        .to_string();
    assert!(
        !message.contains("S3cretPw1"),
        "leaked plaintext credential: {message}"
    );
    assert!(message.contains("valkey.local"));
}
