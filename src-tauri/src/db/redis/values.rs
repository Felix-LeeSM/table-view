use crate::db::{
    bytes_to_kv_string, KvHashField, KvHashValue, KvIndexedValue, KvJsonValue, KvKeyType,
    KvListValue, KvScoredValue, KvSetValue, KvStreamEntry, KvStreamReadResult, KvStringValue,
    KvTtl, KvZSetValue,
};
use crate::error::AppError;

use super::helpers::{redis_database_error, RedisConnection, DEFAULT_REDIS_DATABASES};
use super::RedisAdapter;

pub(super) async fn read_database_count(connection: &mut RedisConnection) -> u16 {
    let result: Result<Vec<String>, ::redis::RedisError> = ::redis::cmd("CONFIG")
        .arg("GET")
        .arg("databases")
        .query_async(connection)
        .await;
    result
        .ok()
        .and_then(|items| items.get(1).and_then(|raw| raw.parse::<u16>().ok()))
        .filter(|count| *count > 0)
        .unwrap_or(DEFAULT_REDIS_DATABASES)
}

pub(super) async fn read_keyspace_counts(connection: &mut RedisConnection) -> Vec<Option<u64>> {
    let info: Result<String, ::redis::RedisError> = ::redis::cmd("INFO")
        .arg("keyspace")
        .query_async(connection)
        .await;
    let mut counts = vec![None; DEFAULT_REDIS_DATABASES as usize];
    if let Ok(info) = info {
        for line in info.lines() {
            if let Some((db, rest)) = line.split_once(':') {
                if let Some(index) = db
                    .strip_prefix("db")
                    .and_then(|raw| raw.parse::<usize>().ok())
                {
                    let keys = rest
                        .split(',')
                        .find_map(|part| part.strip_prefix("keys="))
                        .and_then(|raw| raw.parse::<u64>().ok());
                    if index >= counts.len() {
                        counts.resize(index + 1, None);
                    }
                    counts[index] = keys;
                }
            }
        }
    }
    counts
}

pub(super) async fn read_key_type(
    connection: &mut RedisConnection,
    key: &str,
) -> Result<KvKeyType, AppError> {
    let raw: String = ::redis::cmd("TYPE")
        .arg(key)
        .query_async(connection)
        .await
        .map_err(redis_database_error)?;
    Ok(map_key_type(&raw))
}

pub(super) fn map_key_type(raw: &str) -> KvKeyType {
    match raw.to_ascii_lowercase().as_str() {
        "string" => KvKeyType::String,
        "list" => KvKeyType::List,
        "set" => KvKeyType::Set,
        "zset" => KvKeyType::ZSet,
        "hash" => KvKeyType::Hash,
        "stream" => KvKeyType::Stream,
        "rejson-rl" | "json" => KvKeyType::Json,
        _ => KvKeyType::Unknown,
    }
}

pub(super) async fn read_key_length(
    connection: &mut RedisConnection,
    key: &str,
    key_type: KvKeyType,
) -> Result<Option<u64>, AppError> {
    let command = match key_type {
        KvKeyType::String => "STRLEN",
        KvKeyType::List => "LLEN",
        KvKeyType::Set => "SCARD",
        KvKeyType::ZSet => "ZCARD",
        KvKeyType::Hash => "HLEN",
        KvKeyType::Stream => "XLEN",
        KvKeyType::Json | KvKeyType::Unknown => return Ok(None),
    };
    let len = ::redis::cmd(command)
        .arg(key)
        .query_async(connection)
        .await
        .map_err(redis_database_error)?;
    Ok(Some(len))
}

pub(super) async fn read_memory_usage(connection: &mut RedisConnection, key: &str) -> Option<u64> {
    let result: Result<Option<u64>, ::redis::RedisError> = ::redis::cmd("MEMORY")
        .arg("USAGE")
        .arg(key)
        .query_async(connection)
        .await;
    result.ok().flatten()
}

pub(super) async fn read_string(
    adapter: &RedisAdapter,
    key: &str,
) -> Result<KvStringValue, AppError> {
    adapter
        .with_connection(async |connection| {
            let bytes: Vec<u8> = ::redis::cmd("GET")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            Ok(bytes_to_kv_string(bytes))
        })
        .await
}

pub(super) async fn read_list(
    adapter: &RedisAdapter,
    key: &str,
    limit: u32,
) -> Result<KvListValue, AppError> {
    let end = i64::from(limit.saturating_sub(1));
    adapter
        .with_connection(async |connection| {
            let values: Vec<String> = ::redis::cmd("LRANGE")
                .arg(key)
                .arg(0)
                .arg(end)
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let total: u64 = ::redis::cmd("LLEN")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            Ok(KvListValue {
                entries: values
                    .into_iter()
                    .enumerate()
                    .map(|(index, value)| KvIndexedValue {
                        index: index as i64,
                        value,
                    })
                    .collect(),
                total,
            })
        })
        .await
}

pub(super) async fn read_set(
    adapter: &RedisAdapter,
    key: &str,
    cursor: &str,
    limit: u32,
) -> Result<KvSetValue, AppError> {
    adapter
        .with_connection(async |connection| {
            let (next_cursor, members): (String, Vec<String>) = ::redis::cmd("SSCAN")
                .arg(key)
                .arg(cursor)
                .arg("COUNT")
                .arg(limit)
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let total: u64 = ::redis::cmd("SCARD")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            Ok(KvSetValue {
                members,
                cursor: cursor.to_string(),
                done: next_cursor == "0",
                next_cursor,
                total,
            })
        })
        .await
}

pub(super) async fn read_zset(
    adapter: &RedisAdapter,
    key: &str,
    limit: u32,
) -> Result<KvZSetValue, AppError> {
    let end = i64::from(limit.saturating_sub(1));
    adapter
        .with_connection(async |connection| {
            let entries: Vec<(String, f64)> = ::redis::cmd("ZRANGE")
                .arg(key)
                .arg(0)
                .arg(end)
                .arg("WITHSCORES")
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let total: u64 = ::redis::cmd("ZCARD")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            Ok(KvZSetValue {
                entries: entries
                    .into_iter()
                    .map(|(member, score)| KvScoredValue { member, score })
                    .collect(),
                total,
            })
        })
        .await
}

pub(super) async fn read_hash(
    adapter: &RedisAdapter,
    key: &str,
    cursor: &str,
    limit: u32,
) -> Result<KvHashValue, AppError> {
    adapter
        .with_connection(async |connection| {
            let (next_cursor, fields): (String, Vec<(String, String)>) = ::redis::cmd("HSCAN")
                .arg(key)
                .arg(cursor)
                .arg("COUNT")
                .arg(limit)
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let total: u64 = ::redis::cmd("HLEN")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            Ok(KvHashValue {
                fields: fields
                    .into_iter()
                    .map(|(field, value)| KvHashField { field, value })
                    .collect(),
                cursor: cursor.to_string(),
                done: next_cursor == "0",
                next_cursor,
                total,
            })
        })
        .await
}

pub(super) async fn read_json(adapter: &RedisAdapter, key: &str) -> Result<KvJsonValue, AppError> {
    adapter
        .with_connection(async |connection| {
            let raw: String = ::redis::cmd("JSON.GET")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            let value = serde_json::from_str(&raw).map_err(AppError::from)?;
            Ok(KvJsonValue { value })
        })
        .await
}

pub(super) async fn read_stream_range(
    adapter: &RedisAdapter,
    key: &str,
    start: &str,
    end: &str,
    limit: u32,
) -> Result<KvStreamReadResult, AppError> {
    adapter
        .with_connection(async |connection| {
            let entries: Vec<(String, Vec<(String, String)>)> = ::redis::cmd("XRANGE")
                .arg(key)
                .arg(start)
                .arg(end)
                .arg("COUNT")
                .arg(limit)
                .query_async(connection)
                .await
                .map_err(redis_database_error)?;
            Ok(KvStreamReadResult {
                key: key.to_string(),
                entries: entries
                    .into_iter()
                    .map(|(id, fields)| KvStreamEntry {
                        id,
                        fields: fields
                            .into_iter()
                            .map(|(field, value)| KvHashField { field, value })
                            .collect(),
                    })
                    .collect(),
                start: start.to_string(),
                end: end.to_string(),
                limit,
            })
        })
        .await
}

pub(super) fn ttl_from_seconds(seconds: i64) -> KvTtl {
    KvTtl::from_redis_ttl(seconds)
}
