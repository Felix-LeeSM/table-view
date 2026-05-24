use super::helpers::{
    bounded_limit, connection_url, ensure_not_cancelled, redis_connection_error,
    redis_database_error, DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT,
};
use super::values::{map_key_type, ttl_from_seconds};
use super::RedisAdapter;
use crate::db::{
    DbAdapter, KvAdapter, KvDeleteRequest, KvKeyScanRequest, KvKeyType, KvSetStringRequest,
    KvStreamReadRequest, KvTtlState, KvTtlUpdate, KvTtlUpdateRequest, KvValueReadRequest,
    KvWriteSafety,
};
use crate::error::AppError;
use crate::models::{ConnectionConfig, DatabaseType};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
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
    }
}

fn runtime_config(port: u16, database: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "r-live".into(),
        name: "redis-runtime".into(),
        db_type: DatabaseType::Redis,
        host: "127.0.0.1".into(),
        port,
        user: String::new(),
        password: String::new(),
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

async fn spawn_redis_catalog_stub() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind redis stub");
    let port = listener.local_addr().expect("redis stub addr").port();
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(handle_redis_stub_connection(stream));
        }
    });
    port
}

async fn handle_redis_stub_connection(mut stream: tokio::net::TcpStream) {
    let mut buffer = Vec::new();
    let mut scratch = [0_u8; 1024];
    loop {
        let Ok(read) = stream.read(&mut scratch).await else {
            break;
        };
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&scratch[..read]);
        while let Some(command) = parse_resp_command(&mut buffer) {
            let response = redis_stub_response(&command);
            if stream.write_all(response.as_bytes()).await.is_err() {
                return;
            }
        }
    }
}

fn parse_resp_command(buffer: &mut Vec<u8>) -> Option<Vec<String>> {
    if buffer.first().copied()? != b'*' {
        buffer.clear();
        return None;
    }
    let mut offset = 1;
    let count_end = find_crlf(buffer, offset)?;
    let count = std::str::from_utf8(&buffer[offset..count_end])
        .ok()?
        .parse::<usize>()
        .ok()?;
    offset = count_end + 2;
    let mut parts = Vec::with_capacity(count);
    for _ in 0..count {
        if buffer.get(offset).copied()? != b'$' {
            buffer.clear();
            return None;
        }
        offset += 1;
        let len_end = find_crlf(buffer, offset)?;
        let len = std::str::from_utf8(&buffer[offset..len_end])
            .ok()?
            .parse::<usize>()
            .ok()?;
        offset = len_end + 2;
        if buffer.len() < offset + len + 2 {
            return None;
        }
        let part = String::from_utf8_lossy(&buffer[offset..offset + len]).to_string();
        parts.push(part);
        offset += len + 2;
    }
    buffer.drain(..offset);
    Some(parts)
}

fn find_crlf(buffer: &[u8], start: usize) -> Option<usize> {
    buffer[start..]
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|relative| start + relative)
}

fn redis_stub_response(command: &[String]) -> &'static str {
    match command.first().map(|value| value.to_ascii_uppercase()).as_deref() {
        Some("CLIENT") => "+OK\r\n",
        Some("PING") => "+PONG\r\n",
        Some("CONFIG") => "*2\r\n$9\r\ndatabases\r\n$1\r\n4\r\n",
        Some("INFO") => {
            "$77\r\n# Keyspace\r\ndb0:keys=2,expires=1,avg_ttl=42\r\ndb2:keys=1,expires=0,avg_ttl=0\r\n\r\n"
        }
        Some("SELECT") => "+OK\r\n",
        Some("SCAN") => "*2\r\n$1\r\n0\r\n*2\r\n$5\r\nalpha\r\n$4\r\nbeta\r\n",
        Some("TYPE") if command.get(1).is_some_and(|key| key == "alpha") => "+string\r\n",
        Some("TYPE") if command.get(1).is_some_and(|key| key == "beta") => "+hash\r\n",
        Some("TTL") if command.get(1).is_some_and(|key| key == "alpha") => ":30\r\n",
        Some("TTL") if command.get(1).is_some_and(|key| key == "beta") => ":-1\r\n",
        Some("STRLEN") => ":5\r\n",
        Some("HLEN") => ":2\r\n",
        Some("MEMORY") if command.get(2).is_some_and(|key| key == "alpha") => ":64\r\n",
        Some("MEMORY") if command.get(2).is_some_and(|key| key == "beta") => ":96\r\n",
        _ => "-ERR unsupported test command\r\n",
    }
}

#[test]
fn connection_url_percent_encodes_auth_and_database() {
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
async fn disconnected_adapter_covers_key_browser_and_future_contract_paths() {
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
                None,
            )
            .await,
        Err(AppError::Unsupported(_))
    ));
    assert!(matches!(
        adapter
            .set_string(KvSetStringRequest {
                key: "session:1".into(),
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
                key: "session:1".into(),
                database: Some(0),
                confirm_key: "session:1".into(),
            })
            .await,
        Err(AppError::Unsupported(_))
    ));
    assert!(matches!(
        adapter
            .update_ttl(KvTtlUpdateRequest {
                key: "session:1".into(),
                database: Some(0),
                update: KvTtlUpdate::Expire { seconds: 30 },
            })
            .await,
        Err(AppError::Unsupported(_))
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
                None,
            )
            .await,
        Err(AppError::Unsupported(_))
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
