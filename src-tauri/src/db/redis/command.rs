use std::time::Instant;

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::db::{KvCommandRequest, KvHashField, KvKeyMetadata, RdbQueryResult};
use crate::error::AppError;
use crate::models::QueryResult;

use super::command_parser::{parse_redis_command, range_limit, RedisCommand, RedisCommandEffect};
use super::command_result::{
    float_col, int_col, key_type_label, mutation_result, object_col, rows_result, single_row,
    string_cell, text_col, ttl_state_label,
};
use super::helpers::{
    bounded_limit, ensure_not_cancelled, require_confirm_key, require_confirm_pattern,
};
use super::values::{read_hash, read_set, read_stream_range, read_string};
use super::RedisAdapter;

pub(super) async fn execute_command(
    adapter: &RedisAdapter,
    request: KvCommandRequest,
    cancel: Option<&CancellationToken>,
) -> Result<RdbQueryResult, AppError> {
    ensure_not_cancelled(cancel)?;
    adapter.ensure_database(request.database).await?;
    let command = parse_redis_command(&request.command)?;
    require_command_confirmation(&command, request.confirm_key.as_deref())?;
    let start = Instant::now();
    let result = dispatch_command(adapter, command, cancel).await?;
    Ok(QueryResult {
        truncated: false,
        execution_time_ms: start.elapsed().as_millis() as u64,
        ..result
    })
}

async fn dispatch_command(
    adapter: &RedisAdapter,
    command: RedisCommand,
    cancel: Option<&CancellationToken>,
) -> Result<RdbQueryResult, AppError> {
    ensure_not_cancelled(cancel)?;
    match command {
        RedisCommand::Scan {
            cursor,
            pattern,
            count,
        } => scan_command(adapter, cursor, pattern, count, cancel).await,
        RedisCommand::Keys { pattern } => keys_command(adapter, pattern, cancel).await,
        RedisCommand::Get { key } => read_string_command(adapter, key).await,
        RedisCommand::HGetAll { key } => read_hash_command(adapter, key).await,
        RedisCommand::LRange { key, start, stop } => {
            read_list_command(adapter, key, start, stop).await
        }
        RedisCommand::SMembers { key } => read_set_command(adapter, key).await,
        RedisCommand::ZRange {
            key,
            start,
            stop,
            with_scores,
        } => read_zset_command(adapter, key, start, stop, with_scores).await,
        RedisCommand::XRange {
            key,
            start,
            end,
            count,
        } => read_stream_command(adapter, key, start, end, count).await,
        RedisCommand::Type { key } => type_command(adapter, key).await,
        RedisCommand::Ttl { key } => ttl_command(adapter, key).await,
        RedisCommand::Exists { keys } => exists_command(adapter, keys).await,
        RedisCommand::Set {
            key,
            value,
            ttl_seconds,
        } => set_command(adapter, key, value, ttl_seconds).await,
        RedisCommand::HSet { key, field, value } => hset_command(adapter, key, field, value).await,
        RedisCommand::HDel { key, fields } => {
            member_removal_command(adapter, "HDEL", "hdel", key, fields).await
        }
        RedisCommand::LPush { key, values } => {
            list_push_command(adapter, "LPUSH", key, values).await
        }
        RedisCommand::RPush { key, values } => {
            list_push_command(adapter, "RPUSH", key, values).await
        }
        RedisCommand::LSet { key, index, value } => lset_command(adapter, key, index, value).await,
        RedisCommand::LRem { key, count, value } => lrem_command(adapter, key, count, value).await,
        RedisCommand::SAdd { key, members } => sadd_command(adapter, key, members).await,
        RedisCommand::SRem { key, members } => {
            member_removal_command(adapter, "SREM", "srem", key, members).await
        }
        RedisCommand::ZAdd { key, score, member } => {
            zadd_command(adapter, key, score, member).await
        }
        RedisCommand::ZRem { key, members } => {
            member_removal_command(adapter, "ZREM", "zrem", key, members).await
        }
        RedisCommand::JsonSet { key, path, value } => {
            json_set_command(adapter, key, path, value).await
        }
        RedisCommand::Expire { key, seconds } => expire_command(adapter, key, seconds).await,
        RedisCommand::Persist { key } => persist_command(adapter, key).await,
        RedisCommand::Del { key } => delete_command(adapter, key).await,
    }
}

fn require_command_confirmation(
    command: &RedisCommand,
    confirm_key: Option<&str>,
) -> Result<(), AppError> {
    if let RedisCommand::Keys { pattern } = command {
        return require_confirm_pattern(pattern, confirm_key.unwrap_or_default());
    }
    match command.effect() {
        RedisCommandEffect::Destructive | RedisCommandEffect::Ttl
            if command.required_confirmation_key().is_some() =>
        {
            require_confirm_key(
                command.required_confirmation_key().unwrap_or_default(),
                confirm_key.unwrap_or_default(),
            )
        }
        _ => Ok(()),
    }
}

async fn scan_command(
    adapter: &RedisAdapter,
    cursor: String,
    pattern: Option<String>,
    count: Option<u32>,
    cancel: Option<&CancellationToken>,
) -> Result<RdbQueryResult, AppError> {
    let limit = bounded_limit(count);
    let pattern = pattern.unwrap_or_else(|| "*".into());
    let (next_cursor, keys): (String, Vec<String>) = adapter
        .with_connection(async |connection| {
            ::redis::cmd("SCAN")
                .arg(&cursor)
                .arg("MATCH")
                .arg(&pattern)
                .arg("COUNT")
                .arg(limit)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    let mut rows = Vec::with_capacity(keys.len());
    for key in keys {
        ensure_not_cancelled(cancel)?;
        let metadata = adapter.key_metadata(&key).await?;
        let mut row = vec![json!(&cursor), json!(&next_cursor)];
        row.extend(key_metadata_cells(metadata));
        rows.push(row);
    }
    Ok(rows_result(
        &[
            text_col("cursor"),
            text_col("nextCursor"),
            text_col("key"),
            text_col("type"),
            text_col("ttlState"),
            int_col("ttlSeconds"),
            int_col("length"),
            int_col("memoryBytes"),
        ],
        rows,
    ))
}
async fn keys_command(
    adapter: &RedisAdapter,
    pattern: String,
    cancel: Option<&CancellationToken>,
) -> Result<RdbQueryResult, AppError> {
    let mut keys: Vec<String> = adapter
        .with_connection(async |connection| {
            ::redis::cmd("KEYS")
                .arg(&pattern)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    keys.sort();
    let mut rows = Vec::with_capacity(keys.len());
    for key in keys {
        ensure_not_cancelled(cancel)?;
        rows.push(key_metadata_cells(adapter.key_metadata(&key).await?));
    }
    Ok(rows_result(
        &[
            text_col("key"),
            text_col("type"),
            text_col("ttlState"),
            int_col("ttlSeconds"),
            int_col("length"),
            int_col("memoryBytes"),
        ],
        rows,
    ))
}
fn key_metadata_cells(metadata: KvKeyMetadata) -> Vec<Value> {
    vec![
        json!(metadata.key),
        json!(key_type_label(metadata.key_type)),
        json!(ttl_state_label(metadata.ttl.state)),
        json!(metadata.ttl.seconds),
        json!(metadata.length),
        json!(metadata.memory_bytes),
    ]
}

async fn read_string_command(
    adapter: &RedisAdapter,
    key: String,
) -> Result<RdbQueryResult, AppError> {
    let value = read_string(adapter, &key).await?;
    Ok(single_row(
        &[text_col("key"), text_col("encoding"), text_col("value")],
        vec![
            json!(key),
            json!(format!("{:?}", value.encoding).to_ascii_lowercase()),
            string_cell(value.text, value.hex),
        ],
    ))
}

async fn read_hash_command(
    adapter: &RedisAdapter,
    key: String,
) -> Result<RdbQueryResult, AppError> {
    let value = read_hash(adapter, &key, "0", bounded_limit(None)).await?;
    Ok(rows_result(
        &[text_col("field"), text_col("value")],
        value
            .fields
            .into_iter()
            .map(|KvHashField { field, value }| vec![json!(field), json!(value)])
            .collect(),
    ))
}

async fn read_list_command(
    adapter: &RedisAdapter,
    key: String,
    start: i64,
    stop: i64,
) -> Result<RdbQueryResult, AppError> {
    let limit = range_limit(start, stop)?;
    let values: Vec<String> = adapter
        .with_connection(async |connection| {
            ::redis::cmd("LRANGE")
                .arg(&key)
                .arg(start)
                .arg(stop)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(rows_result(
        &[int_col("index"), text_col("value")],
        values
            .into_iter()
            .enumerate()
            .take(limit as usize)
            .map(|(offset, value)| vec![json!(start + offset as i64), json!(value)])
            .collect(),
    ))
}

async fn read_set_command(adapter: &RedisAdapter, key: String) -> Result<RdbQueryResult, AppError> {
    let value = read_set(adapter, &key, "0", bounded_limit(None)).await?;
    Ok(rows_result(
        &[text_col("member")],
        value
            .members
            .into_iter()
            .map(|member| vec![json!(member)])
            .collect(),
    ))
}

async fn read_zset_command(
    adapter: &RedisAdapter,
    key: String,
    start: i64,
    stop: i64,
    with_scores: bool,
) -> Result<RdbQueryResult, AppError> {
    let limit = range_limit(start, stop)? as usize;
    if with_scores {
        let entries: Vec<(String, f64)> = adapter
            .with_connection(async |connection| {
                ::redis::cmd("ZRANGE")
                    .arg(&key)
                    .arg(start)
                    .arg(stop)
                    .arg("WITHSCORES")
                    .query_async(connection)
                    .await
                    .map_err(|err| adapter.database_error(err))
            })
            .await?;
        return Ok(rows_result(
            &[text_col("member"), float_col("score")],
            entries
                .into_iter()
                .take(limit)
                .map(|(member, score)| vec![json!(member), json!(score)])
                .collect(),
        ));
    }

    let members: Vec<String> = adapter
        .with_connection(async |connection| {
            ::redis::cmd("ZRANGE")
                .arg(&key)
                .arg(start)
                .arg(stop)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(rows_result(
        &[text_col("member")],
        members
            .into_iter()
            .take(limit)
            .map(|member| vec![json!(member)])
            .collect(),
    ))
}

async fn read_stream_command(
    adapter: &RedisAdapter,
    key: String,
    start: String,
    end: String,
    count: Option<u32>,
) -> Result<RdbQueryResult, AppError> {
    let stream = read_stream_range(adapter, &key, &start, &end, bounded_limit(count)).await?;
    Ok(rows_result(
        &[text_col("id"), object_col("fields")],
        stream
            .entries
            .into_iter()
            .map(|entry| {
                let fields: serde_json::Map<String, Value> = entry
                    .fields
                    .into_iter()
                    .map(|KvHashField { field, value }| (field, json!(value)))
                    .collect();
                vec![json!(entry.id), Value::Object(fields)]
            })
            .collect(),
    ))
}

async fn type_command(adapter: &RedisAdapter, key: String) -> Result<RdbQueryResult, AppError> {
    let key_type = adapter.key_metadata(&key).await?.key_type;
    Ok(single_row(
        &[text_col("key"), text_col("type")],
        vec![json!(key), json!(key_type_label(key_type))],
    ))
}

async fn ttl_command(adapter: &RedisAdapter, key: String) -> Result<RdbQueryResult, AppError> {
    let ttl = adapter.key_metadata(&key).await?.ttl;
    Ok(single_row(
        &[text_col("key"), text_col("ttlState"), int_col("seconds")],
        vec![
            json!(key),
            json!(ttl_state_label(ttl.state)),
            json!(ttl.seconds),
        ],
    ))
}

async fn exists_command(
    adapter: &RedisAdapter,
    keys: Vec<String>,
) -> Result<RdbQueryResult, AppError> {
    let count: u64 = adapter
        .with_connection(async |connection| {
            let mut cmd = ::redis::cmd("EXISTS");
            for key in &keys {
                cmd.arg(key);
            }
            cmd.query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(single_row(&[int_col("existingKeys")], vec![json!(count)]))
}

async fn set_command(
    adapter: &RedisAdapter,
    key: String,
    value: String,
    ttl_seconds: Option<u64>,
) -> Result<RdbQueryResult, AppError> {
    adapter
        .with_connection(async |connection| {
            let mut cmd = ::redis::cmd("SET");
            cmd.arg(&key).arg(&value);
            if let Some(seconds) = ttl_seconds {
                cmd.arg("EX").arg(seconds);
            }
            let _: String = cmd
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))?;
            Ok(())
        })
        .await?;
    Ok(mutation_result(&key, "set", 1))
}

async fn hset_command(
    adapter: &RedisAdapter,
    key: String,
    field: String,
    value: String,
) -> Result<RdbQueryResult, AppError> {
    let changed: u64 = adapter
        .with_connection(async |connection| {
            ::redis::cmd("HSET")
                .arg(&key)
                .arg(&field)
                .arg(&value)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(mutation_result(&key, "hset", changed))
}

/// Shared runtime for `<VERB> key member [member...]` removals (HDEL / SREM /
/// ZREM). The driver returns the number of elements actually removed. (#1466)
async fn member_removal_command(
    adapter: &RedisAdapter,
    verb: &str,
    result_name: &str,
    key: String,
    members: Vec<String>,
) -> Result<RdbQueryResult, AppError> {
    let removed: u64 = adapter
        .with_connection(async |connection| {
            let mut cmd = ::redis::cmd(verb);
            cmd.arg(&key);
            for member in &members {
                cmd.arg(member);
            }
            cmd.query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(mutation_result(&key, result_name, removed))
}

async fn lset_command(
    adapter: &RedisAdapter,
    key: String,
    index: i64,
    value: String,
) -> Result<RdbQueryResult, AppError> {
    adapter
        .with_connection(async |connection| {
            // LSET on an out-of-range index errors in Redis; surfaced as-is.
            let _: String = ::redis::cmd("LSET")
                .arg(&key)
                .arg(index)
                .arg(&value)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))?;
            Ok(())
        })
        .await?;
    Ok(mutation_result(&key, "lset", 1))
}

async fn lrem_command(
    adapter: &RedisAdapter,
    key: String,
    count: i64,
    value: String,
) -> Result<RdbQueryResult, AppError> {
    let removed: u64 = adapter
        .with_connection(async |connection| {
            ::redis::cmd("LREM")
                .arg(&key)
                .arg(count)
                .arg(&value)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(mutation_result(&key, "lrem", removed))
}

async fn list_push_command(
    adapter: &RedisAdapter,
    verb: &str,
    key: String,
    values: Vec<String>,
) -> Result<RdbQueryResult, AppError> {
    let length = adapter
        .with_connection(async |connection| {
            let mut cmd = ::redis::cmd(verb);
            cmd.arg(&key);
            for value in &values {
                cmd.arg(value);
            }
            cmd.query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(mutation_result(&key, &verb.to_ascii_lowercase(), length))
}

async fn sadd_command(
    adapter: &RedisAdapter,
    key: String,
    members: Vec<String>,
) -> Result<RdbQueryResult, AppError> {
    let changed = adapter
        .with_connection(async |connection| {
            let mut cmd = ::redis::cmd("SADD");
            cmd.arg(&key);
            for member in &members {
                cmd.arg(member);
            }
            cmd.query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(mutation_result(&key, "sadd", changed))
}

async fn zadd_command(
    adapter: &RedisAdapter,
    key: String,
    score: f64,
    member: String,
) -> Result<RdbQueryResult, AppError> {
    let changed: u64 = adapter
        .with_connection(async |connection| {
            ::redis::cmd("ZADD")
                .arg(&key)
                .arg(score)
                .arg(&member)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(mutation_result(&key, "zadd", changed))
}

/// `JSON.SET key $ <json>` — overwrite the whole ReJSON slot (#PR3). Mirrors
/// `set_command`: the module returns `+OK`, projected as a `json.set` mutation.
async fn json_set_command(
    adapter: &RedisAdapter,
    key: String,
    path: String,
    value: String,
) -> Result<RdbQueryResult, AppError> {
    adapter
        .with_connection(async |connection| {
            let _: String = ::redis::cmd("JSON.SET")
                .arg(&key)
                .arg(&path)
                .arg(&value)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))?;
            Ok(())
        })
        .await?;
    Ok(mutation_result(&key, "json.set", 1))
}

async fn expire_command(
    adapter: &RedisAdapter,
    key: String,
    seconds: u64,
) -> Result<RdbQueryResult, AppError> {
    let changed: bool = adapter
        .with_connection(async |connection| {
            ::redis::cmd("EXPIRE")
                .arg(&key)
                .arg(seconds)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(mutation_result(&key, "expire", u64::from(changed)))
}

async fn persist_command(adapter: &RedisAdapter, key: String) -> Result<RdbQueryResult, AppError> {
    let changed: bool = adapter
        .with_connection(async |connection| {
            ::redis::cmd("PERSIST")
                .arg(&key)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(mutation_result(&key, "persist", u64::from(changed)))
}

async fn delete_command(adapter: &RedisAdapter, key: String) -> Result<RdbQueryResult, AppError> {
    let changed: u64 = adapter
        .with_connection(async |connection| {
            ::redis::cmd("DEL")
                .arg(&key)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await?;
    Ok(mutation_result(&key, "delete", changed))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::db::DbAdapter;

    use super::super::test_support::{runtime_config, spawn_redis_catalog_stub};
    use super::*;

    async fn connected_adapter() -> RedisAdapter {
        let port = spawn_redis_catalog_stub().await;
        let adapter = RedisAdapter::new();
        adapter.connect(&runtime_config(port, "0")).await.unwrap();
        adapter
    }

    fn request(command: &str) -> KvCommandRequest {
        KvCommandRequest {
            command: command.into(),
            database: Some(2),
            confirm_key: None,
        }
    }

    fn confirmed_request(command: &str, confirm_key: &str) -> KvCommandRequest {
        KvCommandRequest {
            command: command.into(),
            database: Some(2),
            confirm_key: Some(confirm_key.into()),
        }
    }

    #[tokio::test]
    async fn command_runtime_projects_read_results() {
        let adapter = connected_adapter().await;

        let string = execute_command(&adapter, request("GET alpha"), None)
            .await
            .unwrap();
        assert_eq!(string.columns[2].name, "value");
        assert_eq!(string.rows[0][2], json!("hello"));

        let hash = execute_command(&adapter, request("HGETALL beta"), None)
            .await
            .unwrap();
        assert_eq!(hash.rows[0], vec![json!("name"), json!("Ada")]);

        let list = execute_command(&adapter, request("LRANGE list 0 1"), None)
            .await
            .unwrap();
        assert_eq!(list.rows[1], vec![json!(1), json!("b")]);

        let set = execute_command(&adapter, request("SMEMBERS set"), None)
            .await
            .unwrap();
        assert_eq!(set.columns[0].name, "member");

        let zset = execute_command(&adapter, request("ZRANGE zset 0 1 WITHSCORES"), None)
            .await
            .unwrap();
        assert_eq!(zset.rows[0], vec![json!("a"), json!(1.5)]);

        let stream = execute_command(&adapter, request("XRANGE stream - + COUNT 10"), None)
            .await
            .unwrap();
        assert_eq!(stream.rows[0][1], json!({ "type": "login" }));

        let key_type = execute_command(&adapter, request("TYPE stream"), None)
            .await
            .unwrap();
        assert_eq!(key_type.rows[0][1], json!("stream"));

        let ttl = execute_command(&adapter, request("TTL alpha"), None)
            .await
            .unwrap();
        assert_eq!(ttl.rows[0][1], json!("expires"));

        let exists = execute_command(&adapter, request("EXISTS alpha missing"), None)
            .await
            .unwrap();
        assert_eq!(exists.rows[0][0], json!(1));

        let scan = execute_command(&adapter, request("SCAN 0 COUNT 25"), None)
            .await
            .unwrap();
        assert_eq!(scan.columns[0].name, "cursor");
        assert_eq!(scan.rows[0][2], json!("alpha"));

        let keys = execute_command(&adapter, confirmed_request("KEYS *", "*"), None)
            .await
            .unwrap();
        assert_eq!(keys.columns[0].name, "key");
        assert_eq!(keys.rows[0][0], json!("alpha"));
    }

    #[tokio::test]
    async fn command_runtime_projects_mutation_results() {
        let adapter = connected_adapter().await;

        for (command, expected_name) in [
            ("SET mut:string ok EX 30", "set"),
            ("HSET beta name Ada", "hset"),
            ("LPUSH list a b", "lpush"),
            ("RPUSH list a b", "rpush"),
            ("SADD set a", "sadd"),
            ("ZADD zset 1 a", "zadd"),
            ("EXPIRE alpha 30", "expire"),
        ] {
            let result = execute_command(&adapter, request(command), None)
                .await
                .unwrap();
            assert_eq!(result.rows[0][1], json!(expected_name));
            assert!(matches!(
                result.query_type,
                crate::models::QueryType::Dml { .. }
            ));
        }
    }

    #[tokio::test]
    async fn command_runtime_projects_element_crud_results() {
        // #1466 — per-element hash/list/set/zSet CRUD dispatches without a
        // typed key confirmation, even though removing the last element drops
        // the key (Redis GCs the now-empty collection).
        let adapter = connected_adapter().await;

        for (command, expected_name) in [
            ("HDEL beta name", "hdel"),
            ("LSET list 0 fixed", "lset"),
            ("LREM list 1 a", "lrem"),
            ("SREM set a", "srem"),
            ("ZREM zset a", "zrem"),
        ] {
            let result = execute_command(&adapter, request(command), None)
                .await
                .unwrap();
            assert_eq!(result.rows[0][1], json!(expected_name));
            assert!(matches!(
                result.query_type,
                crate::models::QueryType::Dml { .. }
            ));
        }
    }

    #[tokio::test]
    async fn command_runtime_projects_json_set_whole_value_overwrite() {
        // PR3 — a ReJSON whole-value overwrite dispatches without a typed
        // confirmation key and projects a `json.set` DML mutation result.
        let adapter = connected_adapter().await;
        let result = execute_command(
            &adapter,
            request("JSON.SET json $ \"{\\\"ok\\\":false}\""),
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.rows[0][1], json!("json.set"));
        assert!(matches!(
            result.query_type,
            crate::models::QueryType::Dml { .. }
        ));
    }

    #[tokio::test]
    async fn command_runtime_requires_typed_confirmation_for_dangerous_commands() {
        let adapter = connected_adapter().await;

        for request in [
            request("KEYS *"),
            confirmed_request("KEYS *", "alpha"),
            request("DEL alpha"),
            confirmed_request("PERSIST alpha", "different"),
        ] {
            assert!(matches!(
                execute_command(&adapter, request, None).await,
                Err(AppError::Validation(_))
            ));
        }

        let persist = execute_command(&adapter, confirmed_request("PERSIST alpha", "alpha"), None)
            .await
            .unwrap();
        assert_eq!(persist.rows[0][1], json!("persist"));

        let delete = execute_command(&adapter, confirmed_request("DEL alpha", "alpha"), None)
            .await
            .unwrap();
        assert_eq!(delete.rows[0][1], json!("delete"));
        assert!(matches!(
            delete.query_type,
            crate::models::QueryType::Dml { .. }
        ));
    }

    #[tokio::test]
    async fn command_runtime_rejects_unsupported_and_cancelled_work() {
        let adapter = connected_adapter().await;

        assert!(matches!(
            execute_command(&adapter, request("FLUSHDB"), None).await,
            Err(AppError::Unsupported(_))
        ));

        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(matches!(
            execute_command(&adapter, request("GET alpha"), Some(&cancel)).await,
            Err(AppError::Database(_))
        ));
    }
}
