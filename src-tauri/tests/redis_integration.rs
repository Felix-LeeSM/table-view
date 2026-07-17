use std::mem;

use table_view_lib::{
    db::{
        DbAdapter, KvAdapter, KvCommandRequest, KvDeleteRequest, KvKeyScanRequest,
        KvSetStringRequest, KvStreamReadRequest, KvTtlState, KvTtlUpdate, KvTtlUpdateRequest,
        KvValue, KvValueReadRequest, KvWriteSafety, RedisAdapter,
    },
    models::{ConnectionConfig, DatabaseType},
};
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{GenericImage, ImageExt};
use testcontainers_modules::redis::{Redis as RedisImage, REDIS_PORT};

#[path = "support/testcontainer_lifecycle.rs"]
mod testcontainer_lifecycle;

#[tokio::test]
async fn redis_testcontainer_covers_live_kv_catalog_values_and_streams() {
    testcontainer_lifecycle::ensure_sweep_once().await;
    let pid = testcontainer_lifecycle::current_pid_label();
    let container = match RedisImage::default()
        .with_label(testcontainer_lifecycle::OWNED_LABEL, "1")
        .with_label(testcontainer_lifecycle::OWNER_PID_LABEL, &pid)
        .start()
        .await
    {
        Ok(container) => {
            testcontainer_lifecycle::register_container_for_process_cleanup(
                container.id().to_string(),
            );
            container
        }
        Err(error) => {
            skip_or_fail_on_ci(format!(
                "Redis testcontainer start failed ({error}). Docker daemon required."
            ));
            return;
        }
    };
    let port = match container.get_host_port_ipv4(REDIS_PORT).await {
        Ok(port) => port,
        Err(error) => {
            skip_or_fail_on_ci(format!("Redis container port mapping failed ({error})"));
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

    let command_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "HGETALL tv:hash".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(command_result.columns[0].name, "field");
    assert_eq!(command_result.rows[0][0], serde_json::json!("name"));

    let stream_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "XRANGE tv:events - + COUNT 10".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(stream_result.columns[1].name, "fields");

    assert!(adapter
        .execute_command(
            KvCommandRequest {
                command: "FLUSHDB".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .is_err());
}

#[tokio::test]
async fn valkey_testcontainer_covers_connection_key_browse_and_command_policy() {
    testcontainer_lifecycle::ensure_sweep_once().await;
    let pid = testcontainer_lifecycle::current_pid_label();
    let container = match GenericImage::new("valkey/valkey", "8.0-alpine")
        .with_exposed_port(6379.tcp())
        .with_wait_for(WaitFor::message_on_stdout("Ready to accept connections"))
        .with_label(testcontainer_lifecycle::OWNED_LABEL, "1")
        .with_label(testcontainer_lifecycle::OWNER_PID_LABEL, &pid)
        .start()
        .await
    {
        Ok(container) => {
            testcontainer_lifecycle::register_container_for_process_cleanup(
                container.id().to_string(),
            );
            container
        }
        Err(error) => {
            skip_or_fail_on_ci(format!(
                "Valkey testcontainer start failed ({error}). Docker daemon required."
            ));
            return;
        }
    };
    let port = match container.get_host_port_ipv4(6379.tcp()).await {
        Ok(port) => port,
        Err(error) => {
            skip_or_fail_on_ci(format!("Valkey container port mapping failed ({error})"));
            return;
        }
    };
    let config = valkey_config(port, "2");
    seed_valkey(port).await;

    RedisAdapter::test_valkey(&config).await.unwrap();
    let adapter = RedisAdapter::new_valkey();
    assert_eq!(
        mem::discriminant(&adapter.kind()),
        mem::discriminant(&DatabaseType::Valkey)
    );
    adapter.connect(&config).await.unwrap();
    adapter.ping().await.unwrap();

    let databases = adapter.list_databases().await.unwrap();
    assert!(databases
        .iter()
        .any(|database| database.index == 2 && database.key_count.unwrap_or_default() >= 2));

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

    let read_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "HGETALL tv:hash".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(read_result.columns[0].name, "field");
    assert_eq!(read_result.rows[0][0], serde_json::json!("name"));

    let write_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "SET tv:cmd written EX 30".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(write_result.rows[0][1], serde_json::json!("set"));

    let stream_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "XRANGE tv:events - + COUNT 10".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(stream_result.columns[1].name, "fields");

    let list_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "LRANGE tv:list 0 1".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        list_result.rows[0],
        vec![serde_json::json!(0), serde_json::json!("alpha")]
    );
    assert_eq!(
        list_result.rows[1],
        vec![serde_json::json!(1), serde_json::json!("beta")]
    );

    let set_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "SMEMBERS tv:set".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap();
    let set_members: Vec<_> = set_result.rows.iter().map(|row| row[0].clone()).collect();
    assert!(set_members.contains(&serde_json::json!("one")));
    assert!(set_members.contains(&serde_json::json!("two")));

    let zset_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "ZRANGE tv:zset 0 1 WITHSCORES".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        zset_result.rows[0],
        vec![serde_json::json!("low"), serde_json::json!(1.5)]
    );
    assert_eq!(
        zset_result.rows[1],
        vec![serde_json::json!("high"), serde_json::json!(3.25)]
    );

    let ttl_read_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "TTL tv:string".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(ttl_read_result.rows[0][1], serde_json::json!("expires"));
    assert!(ttl_read_result.rows[0][2].as_i64().unwrap_or_default() > 0);

    let ttl_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "EXPIRE tv:cmd 60".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(ttl_result.rows[0][1], serde_json::json!("expire"));

    let persist_error = adapter
        .execute_command(
            KvCommandRequest {
                command: "PERSIST tv:cmd".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap_err();
    assert!(persist_error
        .to_string()
        .contains("Confirmation key must exactly match the target key"));

    let persist_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "PERSIST tv:cmd".into(),
                database: Some(2),
                confirm_key: Some("tv:cmd".into()),
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(persist_result.rows[0][1], serde_json::json!("persist"));

    let delete_error = adapter
        .execute_command(
            KvCommandRequest {
                command: "DEL tv:cmd".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap_err();
    assert!(delete_error
        .to_string()
        .contains("Confirmation key must exactly match the target key"));

    let delete_result = adapter
        .execute_command(
            KvCommandRequest {
                command: "DEL tv:cmd".into(),
                database: Some(2),
                confirm_key: Some("tv:cmd".into()),
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(delete_result.rows[0][1], serde_json::json!("delete"));

    let unsupported_error = adapter
        .execute_command(
            KvCommandRequest {
                command: "FLUSHDB".into(),
                database: Some(2),
                confirm_key: None,
            },
            None,
        )
        .await
        .unwrap_err();
    assert!(unsupported_error
        .to_string()
        .contains("outside the bounded runtime slice"));

    let direct_set = adapter
        .set_string(KvSetStringRequest {
            key: "tv:direct".into(),
            value: "typed".into(),
            database: Some(2),
            ttl_seconds: Some(30),
            safety: KvWriteSafety::RejectOverwrite,
        })
        .await
        .unwrap();
    assert!(direct_set.changed);
    assert_eq!(direct_set.ttl.unwrap().state, KvTtlState::Expires);

    match adapter
        .read_value(
            KvValueReadRequest {
                key: "tv:direct".into(),
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
        KvValue::String(value) => assert_eq!(value.text.as_deref(), Some("typed")),
        other => panic!("expected direct string mutation readback, got {other:?}"),
    }

    let overwrite_error = adapter
        .set_string(KvSetStringRequest {
            key: "tv:hash".into(),
            value: "blocked".into(),
            database: Some(2),
            ttl_seconds: None,
            safety: KvWriteSafety::AllowOverwrite,
        })
        .await
        .unwrap_err();
    assert!(overwrite_error
        .to_string()
        .contains("Cannot overwrite existing Valkey hash key with a string"));

    let direct_expire = adapter
        .update_ttl(KvTtlUpdateRequest {
            key: "tv:direct".into(),
            database: Some(2),
            update: KvTtlUpdate::Expire { seconds: 60 },
        })
        .await
        .unwrap();
    assert!(direct_expire.changed);
    assert_eq!(direct_expire.ttl.unwrap().state, KvTtlState::Expires);

    let direct_persist = adapter
        .update_ttl(KvTtlUpdateRequest {
            key: "tv:direct".into(),
            database: Some(2),
            update: KvTtlUpdate::Persist {
                confirm_key: "tv:direct".into(),
            },
        })
        .await
        .unwrap();
    assert!(direct_persist.changed);
    assert_eq!(direct_persist.ttl.unwrap().state, KvTtlState::Persistent);

    let direct_delete_error = adapter
        .delete_key(KvDeleteRequest {
            key: "tv:direct".into(),
            database: Some(2),
            confirm_key: "wrong".into(),
        })
        .await
        .unwrap_err();
    assert!(direct_delete_error
        .to_string()
        .contains("Confirmation key must exactly match the target key"));

    let direct_delete = adapter
        .delete_key(KvDeleteRequest {
            key: "tv:direct".into(),
            database: Some(2),
            confirm_key: "tv:direct".into(),
        })
        .await
        .unwrap();
    assert!(direct_delete.changed);

    match adapter
        .read_value(
            KvValueReadRequest {
                key: "tv:direct".into(),
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
        KvValue::Missing => {}
        other => panic!("expected direct deletion readback to miss, got {other:?}"),
    }
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

async fn seed_valkey(port: u16) {
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
    let _: () = ::redis::cmd("RPUSH")
        .arg("tv:list")
        .arg("alpha")
        .arg("beta")
        .arg("gamma")
        .query_async(&mut connection)
        .await
        .unwrap();
    let _: () = ::redis::cmd("SADD")
        .arg("tv:set")
        .arg("one")
        .arg("two")
        .query_async(&mut connection)
        .await
        .unwrap();
    let _: () = ::redis::cmd("ZADD")
        .arg("tv:zset")
        .arg(1.5)
        .arg("low")
        .arg(3.25)
        .arg("high")
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

fn skip_or_fail_on_ci(reason: String) {
    if std::env::var_os("CI").is_some() || std::env::var_os("GITHUB_ACTIONS").is_some() {
        panic!("{reason}");
    }
    println!("SKIP: {reason}");
}

fn valkey_config(port: u16, database: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "valkey-live".into(),
        name: "Valkey live".into(),
        db_type: DatabaseType::Valkey,
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
        trust_server_certificate: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    }
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
        trust_server_certificate: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    }
}
