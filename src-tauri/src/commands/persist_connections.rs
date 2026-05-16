//! Sprint 358 (Phase 1 W1 dual-write) — `persist_connection` IPC.
//!
//! 호출 flow:
//!   1. `guard_legacy_import_done(pool)` — pending/importing/failed 면 reject.
//!   2. file SOT (`storage::save_connection`) 에 write — 기존 인터페이스 그대로.
//!   3. SQLite mirror `INSERT OR REPLACE INTO connections(...)` — 실패 시
//!      `reconcile::record_sqlite_result(domain, Err)` 로 dev 로그 + counter
//!      증가. 외부 시그니처는 file write 의 결과를 따른다 (silent).
//!
//! 본 sprint 의 In Scope 는 IPC + dual-write + guard. snapshot IPC / hydration
//! consumer / tab affinity 는 후속 sprint.

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use crate::models::{ConnectionConfig, DatabaseType};
use crate::storage::reconcile::{is_force_failure_for_tests, record_sqlite_result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

/// IPC request body for `persist_connection`. password 는 별 IPC
/// (`save_connection`) 가 keyring SOT 로 관리하므로 본 dual-write 에서는 다루지
/// 않는다 — 단지 file/SQLite mirror 의 메타데이터 path 만.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistConnectionRequest {
    pub id: String,
    pub name: String,
    /// `"postgresql" | "mysql" | "sqlite" | "mongodb" | "redis"` snake-lower.
    pub db_type: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub connection_timeout: Option<u32>,
    #[serde(default)]
    pub keep_alive_interval: Option<u32>,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub auth_source: Option<String>,
    #[serde(default)]
    pub replica_set: Option<String>,
    #[serde(default)]
    pub tls_enabled: Option<bool>,
    #[serde(default)]
    pub sort_order: i64,
}

fn parse_db_type(s: &str) -> DatabaseType {
    match s {
        "postgresql" => DatabaseType::Postgresql,
        "mysql" => DatabaseType::Mysql,
        "sqlite" => DatabaseType::Sqlite,
        "mongodb" => DatabaseType::Mongodb,
        "redis" => DatabaseType::Redis,
        _ => DatabaseType::Postgresql,
    }
}

pub async fn persist_connection_inner(
    pool: &SqlitePool,
    req: PersistConnectionRequest,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    // file SOT write — password = None preserves existing ciphertext.
    let config = ConnectionConfig {
        id: req.id.clone(),
        name: req.name.clone(),
        db_type: parse_db_type(&req.db_type),
        host: req.host.clone(),
        port: req.port,
        user: req.user.clone(),
        password: String::new(),
        database: req.database.clone(),
        group_id: req.group_id.clone(),
        color: req.color.clone(),
        connection_timeout: req.connection_timeout,
        keep_alive_interval: req.keep_alive_interval,
        environment: req.environment.clone(),
        auth_source: req.auth_source.clone(),
        replica_set: req.replica_set.clone(),
        tls_enabled: req.tls_enabled,
    };
    crate::storage::save_connection(config, None)?;

    // SQLite mirror — silent failure path 로 처리.
    let sqlite_result = if is_force_failure_for_tests() {
        Err(AppError::Storage("forced failure for tests".into()))
    } else {
        write_sqlite_mirror(pool, &req).await
    };
    record_sqlite_result("connections", sqlite_result);

    Ok(())
}

async fn write_sqlite_mirror(
    pool: &SqlitePool,
    req: &PersistConnectionRequest,
) -> Result<(), AppError> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    sqlx::query(
        "INSERT INTO connections \
         (id, name, db_type, host, port, user, password_enc, database, group_id, color, \
         connection_timeout, keep_alive_interval, environment, auth_source, replica_set, \
         tls_enabled, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET \
            name=excluded.name, db_type=excluded.db_type, host=excluded.host, \
            port=excluded.port, user=excluded.user, database=excluded.database, \
            group_id=excluded.group_id, color=excluded.color, \
            connection_timeout=excluded.connection_timeout, \
            keep_alive_interval=excluded.keep_alive_interval, environment=excluded.environment, \
            auth_source=excluded.auth_source, replica_set=excluded.replica_set, \
            tls_enabled=excluded.tls_enabled, sort_order=excluded.sort_order, \
            updated_at=excluded.updated_at",
    )
    .bind(&req.id)
    .bind(&req.name)
    .bind(&req.db_type)
    .bind(&req.host)
    .bind(req.port as i64)
    .bind(&req.user)
    .bind("") // password_enc = keyring SOT 가 별도; file/SQLite mirror 는 둘 다 빈 문자열로 둠.
    .bind(&req.database)
    .bind(&req.group_id)
    .bind(&req.color)
    .bind(req.connection_timeout.map(|v| v as i64))
    .bind(req.keep_alive_interval.map(|v| v as i64))
    .bind(&req.environment)
    .bind(&req.auth_source)
    .bind(&req.replica_set)
    .bind(req.tls_enabled.map(|v| if v { 1i64 } else { 0i64 }))
    .bind(req.sort_order)
    .bind(now_ms)
    .bind(now_ms)
    .execute(pool)
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn persist_connection(
    req: PersistConnectionRequest,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    persist_connection_inner(&pool, req).await
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 1 sprint-358) — inline unit smoke for
    //! `parse_db_type` 와 happy-path dual-write 1회. 전체 시나리오 (guard /
    //! upsert) 는 `tests/dual_write_connections.rs` 가 담당.

    use super::*;
    use crate::storage::local;
    use crate::storage::meta::{set_legacy_import_state, LegacyImportState};
    use crate::storage::reconcile::mismatch_counter;
    use serial_test::serial;
    use tempfile::TempDir;

    async fn setup() -> (TempDir, sqlx::SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        set_legacy_import_state(&pool, LegacyImportState::Done)
            .await
            .unwrap();
        (dir, pool)
    }

    fn cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
        mismatch_counter::reset();
    }

    fn sample_req(id: &str) -> PersistConnectionRequest {
        PersistConnectionRequest {
            id: id.into(),
            name: format!("name-{}", id),
            db_type: "postgresql".into(),
            host: "h".into(),
            port: 5432,
            user: "u".into(),
            database: "d".into(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
            sort_order: 0,
        }
    }

    #[test]
    fn parse_db_type_maps_each_known_variant() {
        // 5 known variants → corresponding enum. unknown → fallback Postgresql.
        assert!(matches!(
            parse_db_type("postgresql"),
            DatabaseType::Postgresql
        ));
        assert!(matches!(parse_db_type("mysql"), DatabaseType::Mysql));
        assert!(matches!(parse_db_type("sqlite"), DatabaseType::Sqlite));
        assert!(matches!(parse_db_type("mongodb"), DatabaseType::Mongodb));
        assert!(matches!(parse_db_type("redis"), DatabaseType::Redis));
        assert!(matches!(parse_db_type("???"), DatabaseType::Postgresql));
    }

    #[tokio::test]
    #[serial]
    async fn happy_path_persists_to_file_and_sqlite() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_connection_inner(&pool, sample_req("c-unit"))
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM connections")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        let data = crate::storage::load_storage_redacted().unwrap();
        assert_eq!(data.connections.len(), 1);
        cleanup();
    }
}
