use std::collections::BTreeSet;

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
    KvStreamReadRequest, KvTtlState, KvTtlUpdate, KvTtlUpdateRequest, KvValue, KvValueReadRequest,
    KvWriteSafety,
};
use crate::error::AppError;
use crate::models::{ConnectionConfig, DatabaseType};
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::redis::{Redis as RedisImage, REDIS_PORT};
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

#[tokio::test]
async fn live_redis_adapter_covers_scan_read_write_ttl_and_delete() {
    let container = match RedisImage::default().start().await {
        Ok(container) => container,
        Err(err) => {
            println!("SKIP: Redis testcontainer start failed ({err})");
            return;
        }
    };
    let port = match container.get_host_port_ipv4(REDIS_PORT).await {
        Ok(port) => port,
        Err(err) => {
            println!("SKIP: Redis testcontainer port lookup failed ({err})");
            return;
        }
    };

    let mut redis_config = config("0");
    redis_config.host = "127.0.0.1".into();
    redis_config.port = port;
    redis_config.user.clear();
    redis_config.password.clear();

    RedisAdapter::test(&redis_config).await.unwrap();
    let adapter = RedisAdapter::new();
    adapter.connect(&redis_config).await.unwrap();
    adapter.ping().await.unwrap();

    adapter
        .with_connection(async |connection| {
            let _: () = ::redis::cmd("FLUSHDB")
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let _: () = ::redis::cmd("SET")
                .arg("kv:string")
                .arg("hello")
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let _: () = ::redis::cmd("RPUSH")
                .arg("kv:list")
                .arg("a")
                .arg("b")
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let _: () = ::redis::cmd("SADD")
                .arg("kv:set")
                .arg("a")
                .arg("b")
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let _: () = ::redis::cmd("ZADD")
                .arg("kv:zset")
                .arg(1)
                .arg("a")
                .arg(2)
                .arg("b")
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let _: () = ::redis::cmd("HSET")
                .arg("kv:hash")
                .arg("field")
                .arg("value")
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let _: String = ::redis::cmd("XADD")
                .arg("kv:stream")
                .arg("*")
                .arg("field")
                .arg("value")
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            Ok(())
        })
        .await
        .unwrap();

    let databases = adapter.list_databases().await.unwrap();
    assert_eq!(databases[0].index, 0);
    assert!(databases[0].key_count.unwrap_or_default() >= 6);

    let page = adapter
        .scan_keys(
            KvKeyScanRequest {
                database: Some(0),
                cursor: None,
                pattern: Some("kv:*".into()),
                limit: Some(50),
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(page.database, 0);
    assert!(page.keys.iter().any(|metadata| metadata.key == "kv:string"));

    assert!(matches!(
        read_value(&adapter, "kv:string").await.value,
        KvValue::String(_)
    ));
    assert!(matches!(
        read_value(&adapter, "kv:list").await.value,
        KvValue::List(_)
    ));
    assert!(matches!(
        read_value(&adapter, "kv:set").await.value,
        KvValue::Set(_)
    ));
    assert!(matches!(
        read_value(&adapter, "kv:zset").await.value,
        KvValue::ZSet(_)
    ));
    assert!(matches!(
        read_value(&adapter, "kv:hash").await.value,
        KvValue::Hash(_)
    ));
    assert!(matches!(
        read_value(&adapter, "kv:stream").await.value,
        KvValue::Stream(_)
    ));

    let stream = adapter
        .read_stream(
            KvStreamReadRequest {
                key: "kv:stream".into(),
                database: Some(0),
                start: None,
                end: None,
                limit: Some(10),
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(stream.entries.len(), 1);

    assert!(matches!(
        adapter
            .set_string(KvSetStringRequest {
                key: "kv:string".into(),
                value: "new".into(),
                database: Some(0),
                ttl_seconds: None,
                safety: KvWriteSafety::RejectOverwrite,
            })
            .await,
        Err(AppError::Validation(_))
    ));
    adapter
        .set_string(KvSetStringRequest {
            key: "kv:string".into(),
            value: "new".into(),
            database: Some(0),
            ttl_seconds: Some(60),
            safety: KvWriteSafety::AllowOverwrite,
        })
        .await
        .unwrap();
    let ttl = adapter
        .update_ttl(KvTtlUpdateRequest {
            key: "kv:string".into(),
            database: Some(0),
            update: KvTtlUpdate::Persist {
                confirm_key: "kv:string".into(),
            },
        })
        .await
        .unwrap();
    assert_eq!(ttl.ttl.unwrap().state, KvTtlState::Persistent);

    let deleted = adapter
        .delete_key(KvDeleteRequest {
            key: "kv:string".into(),
            database: Some(0),
            confirm_key: "kv:string".into(),
        })
        .await
        .unwrap();
    assert!(deleted.changed);
}

#[tokio::test]
async fn live_redis_scan_keeps_every_key_returned_by_consumed_cursor() {
    let container = match RedisImage::default().start().await {
        Ok(container) => container,
        Err(err) => {
            println!("SKIP: Redis testcontainer start failed ({err})");
            return;
        }
    };
    let port = match container.get_host_port_ipv4(REDIS_PORT).await {
        Ok(port) => port,
        Err(err) => {
            println!("SKIP: Redis testcontainer port lookup failed ({err})");
            return;
        }
    };

    let mut redis_config = config("0");
    redis_config.host = "127.0.0.1".into();
    redis_config.port = port;
    redis_config.user.clear();
    redis_config.password.clear();

    let adapter = RedisAdapter::new();
    adapter.connect(&redis_config).await.unwrap();

    let expected_keys: Vec<String> = (0..128)
        .map(|i| format!("kv:scan-overreturn:{i:03}"))
        .collect();
    adapter
        .with_connection(async |connection| {
            let _: () = ::redis::cmd("FLUSHDB")
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            for key in &expected_keys {
                let _: () = ::redis::cmd("SET")
                    .arg(key)
                    .arg("v")
                    .query_async(connection)
                    .await
                    .map_err(redis_database_error)?;
            }
            Ok(())
        })
        .await
        .unwrap();

    let mut raw_cursor = "0".to_string();
    let mut redis_overreturned_for_count_hint = false;
    loop {
        let (next_cursor, keys): (String, Vec<String>) = adapter
            .with_connection(async |connection| {
                ::redis::cmd("SCAN")
                    .arg(&raw_cursor)
                    .arg("MATCH")
                    .arg("kv:scan-overreturn:*")
                    .arg("COUNT")
                    .arg(1)
                    .query_async(connection)
                    .await
                    .map_err(redis_database_error)
            })
            .await
            .unwrap();
        redis_overreturned_for_count_hint |= keys.len() > 1;
        if next_cursor == "0" {
            break;
        }
        raw_cursor = next_cursor;
    }
    if !redis_overreturned_for_count_hint {
        println!("SKIP: Redis did not over-return for SCAN COUNT 1 in this run");
        return;
    }

    let mut cursor = None;
    let mut seen = BTreeSet::new();
    loop {
        let page = adapter
            .scan_keys(
                KvKeyScanRequest {
                    database: Some(0),
                    cursor,
                    pattern: Some("kv:scan-overreturn:*".into()),
                    limit: Some(1),
                },
                None,
            )
            .await
            .unwrap();
        seen.extend(page.keys.into_iter().map(|metadata| metadata.key));
        if page.done {
            break;
        }
        cursor = Some(page.next_cursor);
    }

    let expected = expected_keys.into_iter().collect::<BTreeSet<_>>();
    assert_eq!(seen, expected);
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
