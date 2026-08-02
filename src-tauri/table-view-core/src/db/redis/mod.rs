mod command;
mod command_parser;
mod command_result;
mod helpers;
#[cfg(test)]
mod test_support;
mod values;

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::db::{
    BoxFuture, DbAdapter, KvAdapter, KvDatabaseInfo, KvDeleteRequest, KvKeyMetadata, KvKeyScanPage,
    KvKeyScanRequest, KvKeyType, KvMutationResult, KvSetStringRequest, KvStreamReadRequest,
    KvStreamReadResult, KvTtlState, KvTtlUpdate, KvTtlUpdateRequest, KvValue, KvValueEnvelope,
    KvValueReadRequest, KvWriteSafety, RdbQueryResult,
};
use crate::error::AppError;
use crate::models::{ConnectionConfig, DatabaseType};

use helpers::{
    bounded_limit, connection_info, connection_info_for, ensure_not_cancelled,
    redis_connection_error, redis_database_error, require_confirm_key, validate_key,
    RedisConnection, DEFAULT_REDIS_DATABASES,
};
use values::{
    read_database_count, read_hash, read_json, read_key_length, read_key_type,
    read_keyspace_counts, read_list, read_memory_usage, read_set, read_stream_range, read_string,
    read_zset, ttl_from_seconds,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
enum RedisProtocolProduct {
    #[default]
    Redis,
    Valkey,
}

impl RedisProtocolProduct {
    fn label(self) -> &'static str {
        match self {
            Self::Redis => "Redis",
            Self::Valkey => "Valkey",
        }
    }

    fn kind(self) -> DatabaseType {
        match self {
            Self::Redis => DatabaseType::Redis,
            Self::Valkey => DatabaseType::Valkey,
        }
    }

    fn connection_info(
        self,
        config: &ConnectionConfig,
    ) -> Result<(::redis::ConnectionInfo, u16), AppError> {
        match self {
            Self::Redis => connection_info(config),
            Self::Valkey => connection_info_for(self.label(), config),
        }
    }

    fn connection_error(self, err: ::redis::RedisError) -> AppError {
        match self {
            Self::Redis => redis_connection_error(err),
            // Issue #1453 — redact: the URL echo can carry the password.
            Self::Valkey => {
                AppError::connection_redacted(format!("Valkey connection failed: {err}"))
            }
        }
    }

    fn database_error(self, err: ::redis::RedisError) -> AppError {
        match self {
            Self::Redis => redis_database_error(err),
            Self::Valkey => AppError::Database(format!("Valkey command failed: {err}")),
        }
    }

    fn unsupported_key_type_message(self) -> String {
        format!("Unsupported {} key type", self.label())
    }
}

#[derive(Debug, Default)]
pub struct RedisAdapter {
    product: RedisProtocolProduct,
    connection: Mutex<Option<RedisConnection>>,
    current_database: Mutex<u16>,
    database_count: Mutex<u16>,
}

impl RedisAdapter {
    pub fn new() -> Self {
        Self::new_for(RedisProtocolProduct::Redis)
    }

    pub fn new_valkey() -> Self {
        Self::new_for(RedisProtocolProduct::Valkey)
    }

    fn new_for(product: RedisProtocolProduct) -> Self {
        Self {
            product,
            connection: Mutex::new(None),
            current_database: Mutex::new(0),
            database_count: Mutex::new(DEFAULT_REDIS_DATABASES),
        }
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        Self::test_for(RedisProtocolProduct::Redis, config).await
    }

    pub async fn test_valkey(config: &ConnectionConfig) -> Result<(), AppError> {
        Self::test_for(RedisProtocolProduct::Valkey, config).await
    }

    async fn test_for(
        product: RedisProtocolProduct,
        config: &ConnectionConfig,
    ) -> Result<(), AppError> {
        let (info, _) = product.connection_info(config)?;
        let client = ::redis::Client::open(info).map_err(|err| product.connection_error(err))?;
        let mut connection = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|err| product.connection_error(err))?;
        let _: String = ::redis::cmd("PING")
            .query_async(&mut connection)
            .await
            .map_err(|err| product.connection_error(err))?;
        Ok(())
    }

    pub(super) async fn with_connection<T, F>(&self, f: F) -> Result<T, AppError>
    where
        F: AsyncFnOnce(&mut RedisConnection) -> Result<T, AppError>,
    {
        let mut guard = self.connection.lock().await;
        let connection = guard.as_mut().ok_or_else(|| {
            AppError::Connection(format!("{} connection is not open", self.product.label()))
        })?;
        f(connection).await
    }

    pub(super) fn database_error(&self, err: ::redis::RedisError) -> AppError {
        self.product.database_error(err)
    }

    async fn ensure_database(&self, database: Option<u16>) -> Result<u16, AppError> {
        let target = database.unwrap_or(*self.current_database.lock().await);
        let mut current = self.current_database.lock().await;
        if *current == target {
            return Ok(target);
        }
        self.with_connection(async |connection| {
            let _: () = ::redis::cmd("SELECT")
                .arg(target)
                .query_async(connection)
                .await
                .map_err(|err| self.product.database_error(err))?;
            Ok(())
        })
        .await?;
        *current = target;
        Ok(target)
    }

    async fn key_metadata(&self, key: &str) -> Result<KvKeyMetadata, AppError> {
        self.with_connection(async |connection| {
            let key_type = read_key_type(connection, key).await?;
            let ttl_seconds: i64 = ::redis::cmd("TTL")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(|err| self.product.database_error(err))?;
            let length = read_key_length(connection, key, key_type).await?;
            let memory_bytes = read_memory_usage(connection, key).await;
            Ok(KvKeyMetadata {
                key: key.to_string(),
                key_type,
                ttl: ttl_from_seconds(ttl_seconds),
                length,
                memory_bytes,
            })
        })
        .await
    }
}

impl DbAdapter for RedisAdapter {
    fn kind(&self) -> DatabaseType {
        self.product.kind()
    }

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            let (info, database) = self.product.connection_info(config)?;
            let client =
                ::redis::Client::open(info).map_err(|err| self.product.connection_error(err))?;
            let mut connection = client
                .get_multiplexed_async_connection()
                .await
                .map_err(|err| self.product.connection_error(err))?;
            let _: String = ::redis::cmd("PING")
                .query_async(&mut connection)
                .await
                .map_err(|err| self.product.connection_error(err))?;

            *self.database_count.lock().await = read_database_count(&mut connection).await;
            *self.current_database.lock().await = database;
            *self.connection.lock().await = Some(connection);
            Ok(())
        })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            *self.connection.lock().await = None;
            Ok(())
        })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            self.with_connection(async |connection| {
                let _: String = ::redis::cmd("PING")
                    .query_async(connection)
                    .await
                    .map_err(|err| self.product.connection_error(err))?;
                Ok(())
            })
            .await
        })
    }
}

impl KvAdapter for RedisAdapter {
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<KvDatabaseInfo>, AppError>> {
        Box::pin(async move {
            let count = *self.database_count.lock().await;
            let key_counts = self
                .with_connection(async |connection| Ok(read_keyspace_counts(connection).await))
                .await
                .unwrap_or_default();
            Ok((0..count)
                .map(|index| KvDatabaseInfo {
                    name: index.to_string(),
                    index,
                    key_count: key_counts.get(index as usize).copied().flatten(),
                })
                .collect())
        })
    }

    fn switch_database<'a>(&'a self, database: u16) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            self.ensure_database(Some(database)).await?;
            Ok(())
        })
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<u16>, AppError>> {
        Box::pin(async move { Ok(Some(*self.current_database.lock().await)) })
    }

    fn scan_keys<'a>(
        &'a self,
        request: KvKeyScanRequest,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<KvKeyScanPage, AppError>> {
        Box::pin(async move {
            ensure_not_cancelled(cancel)?;
            let database = self.ensure_database(request.database).await?;
            let limit = bounded_limit(request.limit);
            let cursor = request.cursor.unwrap_or_else(|| "0".into());
            let pattern = request.pattern.unwrap_or_else(|| "*".into());
            let (next_cursor, keys): (String, Vec<String>) = self
                .with_connection(async |connection| {
                    ::redis::cmd("SCAN")
                        .arg(&cursor)
                        .arg("MATCH")
                        .arg(&pattern)
                        .arg("COUNT")
                        .arg(limit)
                        .query_async(connection)
                        .await
                        .map_err(|err| self.product.database_error(err))
                })
                .await?;

            let mut metadata = Vec::with_capacity(keys.len());
            for key in keys {
                ensure_not_cancelled(cancel)?;
                metadata.push(self.key_metadata(&key).await?);
            }
            Ok(KvKeyScanPage {
                database,
                cursor,
                done: next_cursor == "0",
                next_cursor,
                limit,
                keys: metadata,
            })
        })
    }

    fn read_value<'a>(
        &'a self,
        request: KvValueReadRequest,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<KvValueEnvelope, AppError>> {
        Box::pin(async move {
            ensure_not_cancelled(cancel)?;
            self.ensure_database(request.database).await?;
            let limit = bounded_limit(request.limit);
            let cursor = request.cursor.unwrap_or_else(|| "0".into());
            let metadata = self.key_metadata(&request.key).await?;
            let value = match metadata.key_type {
                KvKeyType::String => KvValue::String(read_string(self, &request.key).await?),
                KvKeyType::List => KvValue::List(read_list(self, &request.key, limit).await?),
                KvKeyType::Set => KvValue::Set(read_set(self, &request.key, &cursor, limit).await?),
                KvKeyType::ZSet => KvValue::ZSet(read_zset(self, &request.key, limit).await?),
                KvKeyType::Hash => {
                    KvValue::Hash(read_hash(self, &request.key, &cursor, limit).await?)
                }
                KvKeyType::Stream => {
                    KvValue::Stream(read_stream_range(self, &request.key, "-", "+", limit).await?)
                }
                KvKeyType::Json => KvValue::Json(read_json(self, &request.key).await?),
                KvKeyType::Unknown if metadata.ttl.state == KvTtlState::Missing => KvValue::Missing,
                KvKeyType::Unknown => KvValue::Unsupported {
                    message: self.product.unsupported_key_type_message(),
                },
            };
            Ok(KvValueEnvelope {
                key: request.key,
                metadata,
                value,
            })
        })
    }

    fn execute_command<'a>(
        &'a self,
        request: crate::db::KvCommandRequest,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
        Box::pin(async move { command::execute_command(self, request, cancel).await })
    }

    fn set_string<'a>(
        &'a self,
        request: KvSetStringRequest,
    ) -> BoxFuture<'a, Result<KvMutationResult, AppError>> {
        Box::pin(async move {
            validate_key(&request.key)?;
            let cmd = build_set_string_command(&request)?;
            self.ensure_database(request.database).await?;
            ensure_string_write_allowed(self, &request).await?;
            let changed = self
                .with_connection(async |connection| {
                    let result: Option<String> = cmd
                        .query_async(connection)
                        .await
                        .map_err(|err| self.product.database_error(err))?;
                    Ok(result.is_some())
                })
                .await?;
            if !changed {
                return Err(AppError::Validation(
                    "Key already exists; enable overwrite to replace it".into(),
                ));
            }
            Ok(KvMutationResult {
                key: request.key.clone(),
                changed: true,
                ttl: Some(self.key_metadata(&request.key).await?.ttl),
            })
        })
    }

    fn delete_key<'a>(
        &'a self,
        request: KvDeleteRequest,
    ) -> BoxFuture<'a, Result<KvMutationResult, AppError>> {
        Box::pin(async move {
            validate_key(&request.key)?;
            require_confirm_key(&request.key, &request.confirm_key)?;
            self.ensure_database(request.database).await?;
            let changed = self
                .with_connection(async |connection| {
                    let deleted: u64 = ::redis::cmd("DEL")
                        .arg(&request.key)
                        .query_async(connection)
                        .await
                        .map_err(|err| self.product.database_error(err))?;
                    Ok(deleted > 0)
                })
                .await?;
            Ok(KvMutationResult {
                key: request.key,
                changed,
                ttl: None,
            })
        })
    }

    fn update_ttl<'a>(
        &'a self,
        request: KvTtlUpdateRequest,
    ) -> BoxFuture<'a, Result<KvMutationResult, AppError>> {
        Box::pin(async move {
            validate_key(&request.key)?;
            self.ensure_database(request.database).await?;
            let changed = match &request.update {
                KvTtlUpdate::Expire { seconds } => expire_key(self, &request.key, *seconds).await?,
                KvTtlUpdate::Persist { confirm_key } => {
                    require_confirm_key(&request.key, confirm_key)?;
                    persist_key(self, &request.key).await?
                }
            };
            Ok(KvMutationResult {
                key: request.key.clone(),
                changed,
                ttl: Some(self.key_metadata(&request.key).await?.ttl),
            })
        })
    }

    fn read_stream<'a>(
        &'a self,
        request: KvStreamReadRequest,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<KvStreamReadResult, AppError>> {
        Box::pin(async move {
            ensure_not_cancelled(cancel)?;
            self.ensure_database(request.database).await?;
            let limit = bounded_limit(request.limit);
            let start = request.start.as_deref().unwrap_or("-");
            let end = request.end.as_deref().unwrap_or("+");
            read_stream_range(self, &request.key, start, end, limit).await
        })
    }
}

fn build_set_string_command(request: &KvSetStringRequest) -> Result<::redis::Cmd, AppError> {
    let mut cmd = ::redis::cmd("SET");
    cmd.arg(&request.key).arg(&request.value);
    if request.safety == KvWriteSafety::RejectOverwrite {
        cmd.arg("NX");
    }
    if let Some(seconds) = request.ttl_seconds {
        if seconds == 0 {
            return Err(AppError::Validation(
                "ttlSeconds must be greater than zero".into(),
            ));
        }
        cmd.arg("EX").arg(seconds);
    }
    Ok(cmd)
}

async fn ensure_string_write_allowed(
    adapter: &RedisAdapter,
    request: &KvSetStringRequest,
) -> Result<(), AppError> {
    if request.safety != KvWriteSafety::AllowOverwrite {
        return Ok(());
    }

    let (key_type, exists) = adapter
        .with_connection(async |connection| {
            let key_type = read_key_type(connection, &request.key).await?;
            let exists = if key_type == KvKeyType::Unknown {
                ::redis::cmd("EXISTS")
                    .arg(&request.key)
                    .query_async::<u64>(connection)
                    .await
                    .map_err(|err| adapter.database_error(err))?
                    > 0
            } else {
                true
            };
            Ok((key_type, exists))
        })
        .await?;

    match (key_type, exists) {
        (KvKeyType::String, _) | (KvKeyType::Unknown, false) => Ok(()),
        (KvKeyType::Unknown, true) => Err(AppError::Validation(format!(
            "Cannot overwrite existing {} key of unsupported type with a string",
            adapter.product.label()
        ))),
        (existing_type, true) => Err(AppError::Validation(format!(
            "Cannot overwrite existing {} {} key with a string",
            adapter.product.label(),
            key_type_label(existing_type)
        ))),
        (_, false) => Ok(()),
    }
}

fn key_type_label(key_type: KvKeyType) -> &'static str {
    match key_type {
        KvKeyType::String => "string",
        KvKeyType::List => "list",
        KvKeyType::Set => "set",
        KvKeyType::ZSet => "zset",
        KvKeyType::Hash => "hash",
        KvKeyType::Stream => "stream",
        KvKeyType::Json => "json",
        KvKeyType::Unknown => "unknown",
    }
}

async fn expire_key(adapter: &RedisAdapter, key: &str, seconds: u64) -> Result<bool, AppError> {
    if seconds == 0 {
        return Err(AppError::Validation(
            "TTL seconds must be greater than zero".into(),
        ));
    }
    adapter
        .with_connection(async |connection| {
            ::redis::cmd("EXPIRE")
                .arg(key)
                .arg(seconds)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await
}

async fn persist_key(adapter: &RedisAdapter, key: &str) -> Result<bool, AppError> {
    adapter
        .with_connection(async |connection| {
            ::redis::cmd("PERSIST")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(|err| adapter.database_error(err))
        })
        .await
}

#[cfg(test)]
mod tests;
