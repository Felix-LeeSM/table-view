use crate::db::{KvKeyType, KvTtl};
use crate::error::AppError;

use super::helpers::{redis_database_error, RedisConnection, DEFAULT_REDIS_DATABASES};

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

pub(super) fn ttl_from_seconds(seconds: i64) -> KvTtl {
    KvTtl::from_redis_ttl(seconds)
}
