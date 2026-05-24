use table_view_lib::{
    db::{
        DbAdapter, KvAdapter, KvKeyScanRequest, KvSetStringRequest, KvStreamReadRequest, KvValue,
        KvValueReadRequest, KvWriteSafety, RedisAdapter,
    },
    models::{ConnectionConfig, DatabaseType},
};
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::redis::{Redis as RedisImage, REDIS_PORT};

const OWNED_LABEL: &str = "table-view.tests";

#[tokio::test]
async fn redis_testcontainer_covers_live_kv_catalog_values_and_streams() {
    let container = match RedisImage::default()
        .with_label(OWNED_LABEL, "1")
        .start()
        .await
    {
        Ok(container) => container,
        Err(error) => {
            println!(
                "SKIP: Redis testcontainer start failed ({}). Docker daemon required.",
                error
            );
            return;
        }
    };
    let port = match container.get_host_port_ipv4(REDIS_PORT).await {
        Ok(port) => port,
        Err(error) => {
            println!("SKIP: Redis container port mapping failed ({})", error);
            return;
        }
    };
    let config = redis_config(port, "2");
    seed_redis(port).await;

    RedisAdapter::test(&config).await.unwrap();
    let adapter = RedisAdapter::new();
    adapter.connect(&config).await.unwrap();
    adapter.ping().await.unwrap();

    let databases = adapter.list_databases().await.unwrap();
    assert!(databases
        .iter()
        .any(|database| database.index == 2 && database.key_count.unwrap_or_default() >= 3));

    let keys = adapter
        .scan_keys(
            KvKeyScanRequest {
                database: Some(2),
                cursor: None,
                pattern: Some("tv:*".into()),
                limit: Some(25),
            },
            None,
        )
        .await
        .unwrap();
    assert!(keys.keys.iter().any(|key| key.key == "tv:string"));
    assert!(keys.keys.iter().any(|key| key.key == "tv:hash"));

    match adapter
        .read_value(
            KvValueReadRequest {
                key: "tv:string".into(),
                database: Some(2),
                limit: Some(10),
                cursor: None,
            },
            None,
        )
        .await
        .unwrap()
        .value
    {
        KvValue::String(value) => assert_eq!(value.text.as_deref(), Some("hello")),
        other => panic!("expected string value, got {other:?}"),
    }

    let stream = adapter
        .read_stream(
            KvStreamReadRequest {
                key: "tv:events".into(),
                database: Some(2),
                start: Some("0-0".into()),
                end: Some("+".into()),
                limit: Some(10),
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(stream.entries[0].fields[0].field, "type");
    assert_eq!(stream.entries[0].fields[0].value, "login");

    let write = adapter
        .set_string(KvSetStringRequest {
            key: "tv:written".into(),
            value: "ok".into(),
            database: Some(2),
            ttl_seconds: Some(30),
            safety: KvWriteSafety::RejectOverwrite,
        })
        .await
        .unwrap();
    assert!(write.changed);
}

async fn seed_redis(port: u16) {
    let client = ::redis::Client::open(format!("redis://127.0.0.1:{port}/2")).unwrap();
    let mut connection = client.get_multiplexed_async_connection().await.unwrap();
    let _: () = ::redis::cmd("FLUSHDB")
        .query_async(&mut connection)
        .await
        .unwrap();
    let _: () = ::redis::cmd("SET")
        .arg("tv:string")
        .arg("hello")
        .arg("EX")
        .arg(60)
        .query_async(&mut connection)
        .await
        .unwrap();
    let _: () = ::redis::cmd("HSET")
        .arg("tv:hash")
        .arg("name")
        .arg("Ada")
        .query_async(&mut connection)
        .await
        .unwrap();
    let _: String = ::redis::cmd("XADD")
        .arg("tv:events")
        .arg("*")
        .arg("type")
        .arg("login")
        .query_async(&mut connection)
        .await
        .unwrap();
}

fn redis_config(port: u16, database: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "redis-live".into(),
        name: "Redis live".into(),
        db_type: DatabaseType::Redis,
        host: "127.0.0.1".into(),
        port,
        user: String::new(),
        password: String::new(),
        database: database.into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(10),
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
    }
}
