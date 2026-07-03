//! Sprint 357 (Phase 1) — `get_initial_app_state` snapshot IPC.
//!
//! Strategy F.2 (line 911–998) 의 wire shape 을 byte-equivalent 으로 반환.
//! Boot 시점에 frontend 가 단일 IPC 로 5 boot-critical stores + runtime
//! activeStatuses 를 atomic 으로 받아 hydration. Lazy stores (favorites /
//! queryHistory / schemaCache / datagrid_prefs) 는 mount 시 별도 IPC.
//!
//! Atomic guarantee — 모든 store read 는 단일 `BEGIN IMMEDIATE` 트랜잭션 안에서
//! 수행. Transaction 시작 후 다른 thread 의 write 는 snapshot 결과에 반영 X.
//!
//! Partial fallback (F.2 line 1125) — 한 store 의 SQLite query 실패 시 그 슬롯에
//! `{ error: "..." }` 채우고 `partial: true`. 다른 store 는 정상 진행. 본
//! Phase 1 구현은 single tx 안에서 read 하므로 partial 진입 분기는 코드 형태로
//! 만 두고 실제 trigger 는 향후 store별 hydrate 가 별 코드 path 가 되었을 때.
//!
//! Q9 perf — 10 connection × 50 tab 시드 환경에서 p95 < 50ms (cargo test --release).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::State;

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{ConnectionConfigPublic, ConnectionGroup, ConnectionStatus};

// ---------------------------------------------------------------------------
// snapshotVersion — monotonic 단조 증가. 같은 process 안에서 호출마다 +1.
// frontend event dedup baseline (Phase 3 의 store mirror event 가 snapshot 보다
// stale 인지 비교).
// ---------------------------------------------------------------------------
static SNAPSHOT_VERSION: AtomicU64 = AtomicU64::new(0);

/// Workspace window label 의 prefix. workspace-{conn_id} 형태.
const WORKSPACE_LABEL_PREFIX: &str = "workspace-";

// ---------------------------------------------------------------------------
// Wire types — F.2 line 911–998 정합.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialAppState {
    pub schema_version: u32,
    pub snapshot_version: u64,
    pub generated_at: i64,
    pub partial: bool,
    /// v0.3.1: boot 자동 복구(quarantine + fresh)가 이 process lifetime 에
    /// 발생했으면 `true`. runtime meta 이지 wire shape change 가 아니므로
    /// `schema_version` 은 1 유지.
    pub recovered: bool,
    pub stores: Stores,
    pub runtime: Runtime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stores {
    pub connections: StoreSlot<ConnectionsStore>,
    pub workspaces: StoreSlot<WorkspacesStore>,
    pub mru: StoreSlot<MruStore>,
    pub theme: StoreSlot<ThemeStore>,
    pub safe_mode: StoreSlot<SafeModeStore>,
}

/// 각 store slot 의 partial fallback union — 성공 시 도메인 데이터,
/// 실패 시 `{ error: "..." }`. `#[serde(untagged)]` 로 직렬화 시 두 형태가
/// 그대로 wire 에 노출.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StoreSlot<T> {
    Ok(T),
    Err { error: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionsStore {
    pub items: Vec<ConnectionConfigPublic>,
    pub groups: Vec<ConnectionGroup>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacesStore {
    /// Q13 PK (connection_id, db_name) — nested map. Launcher window → 빈 map;
    /// Workspace window → 그 connection 만.
    pub by_connection_id: HashMap<String, HashMap<String, Value>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MruStore {
    /// `last_used` DESC 정렬된 connection id 배열.
    pub recent_connections: Vec<String>,
    /// 맨 위 (가장 최근) connection id. 비어있으면 `null`.
    pub last_used_connection_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeStore {
    pub theme_id: String,
    /// `"system" | "light" | "dark"`.
    pub mode: String,
}

impl Default for ThemeStore {
    fn default() -> Self {
        // frontend `DEFAULT_THEME_ID` 와 동일해야 한다. 이전 `"default"` 는
        // catalog 에 없는 id 라 `data-theme="default"` 셀렉터가 매칭되지
        // 않아 첫 부팅 시 스타일 깨짐을 일으켰다 (Wave 9.5 회귀 2,
        // 2026-05-16). Frontend test `loadAll.theme-fallback.test.ts` 가
        // boundary 단에서도 catalog 검증을 하지만, wire 의 truth 도
        // 처음부터 valid 한 값이어야 한다.
        Self {
            theme_id: "slate".into(),
            mode: "system".into(),
        }
    }
}

/// Safe Mode 3-tier. Wire value = lowercase variant (`"off"` / `"warn"` /
/// `"strict"`). `#[serde(other)]` 로 미인식/legacy 값(구 `"on"` 등)은
/// `Warn` 으로 역직렬화 fallback — 이슈 #1113 기결정 기본값(warn)과 일치.
/// Default 도 `Warn` (신규 설치의 실효 기본값).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SafeMode {
    Off,
    Strict,
    // `#[serde(other)]` 는 마지막 variant 필수. Warn 이 fallback 겸 기본값.
    #[default]
    #[serde(other)]
    Warn,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeModeStore {
    /// 3-tier `off` / `warn` / `strict`. 미인식 값은 `warn` fallback (#1113).
    pub mode: SafeMode,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub active_statuses: HashMap<String, ConnectionStatus>,
}

// ---------------------------------------------------------------------------
// Inner — pool + window_label + status_map 를 받아 snapshot 을 반환. Tauri
// command wrapper 가 `tauri::Window`, `tauri::State<AppState>` 에서 두 인자를
// 추출해 호출. 본 inner 는 통합 테스트가 직접 호출하므로 mock window 가 필요
// 없음.
// ---------------------------------------------------------------------------

/// Atomic snapshot read. `window_label` 은 `"launcher"` 또는 `"workspace-{conn_id}"`
/// 형태. workspace label 에서 prefix 를 자르면 그 connection 의 sub-workspace 만
/// 반환.
pub async fn get_initial_app_state_inner(
    pool: &SqlitePool,
    window_label: &str,
    status_map: &HashMap<String, ConnectionStatus>,
) -> Result<InitialAppState, AppError> {
    let snapshot_version = SNAPSHOT_VERSION.fetch_add(1, Ordering::SeqCst) + 1;
    let generated_at = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let scope_conn_id = window_label
        .strip_prefix(WORKSPACE_LABEL_PREFIX)
        .map(|s| s.to_string());

    // F.2 line 1122 — `BEGIN IMMEDIATE` 단일 read transaction. 모든 store 가
    // 같은 시점의 일관된 view 를 보도록 잠금.
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| AppError::Storage(format!("snapshot tx begin: {}", e)))?;

    // 각 store 는 별 helper. 한 helper 가 실패해도 partial=true 로 전이.
    let mut partial = false;

    let connections = match read_connections(&mut tx).await {
        Ok(v) => StoreSlot::Ok(v),
        Err(e) => {
            partial = true;
            StoreSlot::Err {
                error: e.to_string(),
            }
        }
    };

    let workspaces = match read_workspaces(&mut tx, scope_conn_id.as_deref()).await {
        Ok(v) => StoreSlot::Ok(v),
        Err(e) => {
            partial = true;
            StoreSlot::Err {
                error: e.to_string(),
            }
        }
    };

    let mru = match read_mru(&mut tx).await {
        Ok(v) => StoreSlot::Ok(v),
        Err(e) => {
            partial = true;
            StoreSlot::Err {
                error: e.to_string(),
            }
        }
    };

    let theme = match read_theme(&mut tx).await {
        Ok(v) => StoreSlot::Ok(v),
        Err(e) => {
            partial = true;
            StoreSlot::Err {
                error: e.to_string(),
            }
        }
    };

    let safe_mode = match read_safe_mode(&mut tx).await {
        Ok(v) => StoreSlot::Ok(v),
        Err(e) => {
            partial = true;
            StoreSlot::Err {
                error: e.to_string(),
            }
        }
    };

    // commit 으로 read 락 해제. tx 자체가 read-only 라 rollback / commit 의
    // semantic 차이는 없으나 sqlx 의 LIFO 보장 위해 commit.
    tx.commit()
        .await
        .map_err(|e| AppError::Storage(format!("snapshot tx commit: {}", e)))?;

    Ok(InitialAppState {
        schema_version: 1,
        snapshot_version,
        generated_at,
        partial,
        recovered: false,
        stores: Stores {
            connections,
            workspaces,
            mru,
            theme,
            safe_mode,
        },
        runtime: Runtime {
            active_statuses: status_map.clone(),
        },
    })
}

// ---------------------------------------------------------------------------
// Store readers — 각 helper 가 SqliteTransaction 안에서 한 도메인 read. JSON
// 컬럼은 serde_json::Value 로 deserialize.
// ---------------------------------------------------------------------------

async fn read_connections(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<ConnectionsStore, AppError> {
    // connections → ConnectionConfigPublic shape. password_enc 는 has_password
    // boolean 으로만 노출 — plaintext / ciphertext 절대 wire 에 안 보냄.
    let conn_rows = sqlx::query_as::<_, ConnectionRow>(
        "SELECT id, name, db_type, host, port, user, password_enc, database, read_only, group_id, color, \
         connection_timeout, keep_alive_interval, environment, auth_source, replica_set, \
         tls_enabled, trust_server_certificate \
         FROM connections ORDER BY sort_order ASC, id ASC",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| AppError::Storage(format!("read connections: {}", e)))?;

    let items: Vec<ConnectionConfigPublic> = conn_rows
        .into_iter()
        .map(ConnectionRow::into_public)
        .collect();

    let group_rows = sqlx::query_as::<_, GroupRow>(
        "SELECT id, name, color, collapsed FROM connection_groups \
         ORDER BY sort_order ASC, id ASC",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| AppError::Storage(format!("read groups: {}", e)))?;

    let groups: Vec<ConnectionGroup> = group_rows
        .into_iter()
        .map(|g| ConnectionGroup {
            id: g.id,
            name: g.name,
            color: g.color,
            collapsed: g.collapsed != 0,
        })
        .collect();

    Ok(ConnectionsStore { items, groups })
}

#[derive(Debug, sqlx::FromRow)]
struct ConnectionRow {
    id: String,
    name: String,
    db_type: String,
    host: String,
    port: i64,
    user: String,
    password_enc: String,
    database: String,
    read_only: i64,
    group_id: Option<String>,
    color: Option<String>,
    connection_timeout: Option<i64>,
    keep_alive_interval: Option<i64>,
    environment: Option<String>,
    auth_source: Option<String>,
    replica_set: Option<String>,
    tls_enabled: Option<i64>,
    trust_server_certificate: Option<i64>,
}

impl ConnectionRow {
    fn into_public(self) -> ConnectionConfigPublic {
        use crate::models::DatabaseType;
        let db_type = self.db_type.parse::<DatabaseType>().unwrap_or_default();
        let paradigm = db_type.paradigm();
        ConnectionConfigPublic {
            id: self.id,
            name: self.name,
            db_type,
            host: self.host,
            port: self.port as u16,
            user: self.user,
            database: self.database,
            read_only: self.read_only != 0,
            group_id: self.group_id,
            color: self.color,
            connection_timeout: self.connection_timeout.map(|v| v as u32),
            keep_alive_interval: self.keep_alive_interval.map(|v| v as u32),
            environment: self.environment,
            has_password: !self.password_enc.is_empty(),
            paradigm,
            auth_source: self.auth_source,
            replica_set: self.replica_set,
            tls_enabled: self.tls_enabled.map(|v| v != 0),
            trust_server_certificate: self.trust_server_certificate.map(|v| v != 0),
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
struct GroupRow {
    id: String,
    name: String,
    color: Option<String>,
    collapsed: i64,
}

async fn read_workspaces(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    scope_conn_id: Option<&str>,
) -> Result<WorkspacesStore, AppError> {
    // Launcher window (scope_conn_id == None) → 빈 byConnectionId. workspace
    // window → 그 conn 만.
    let Some(conn_id) = scope_conn_id else {
        return Ok(WorkspacesStore::default());
    };

    let rows = sqlx::query_as::<_, WorkspaceRow>(
        "SELECT connection_id, db_name, active_tab_id, tabs_json, sidebar_expanded_json, \
         closed_tabs_json FROM workspaces WHERE connection_id = ?",
    )
    .bind(conn_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| AppError::Storage(format!("read workspaces: {}", e)))?;

    let mut by_conn: HashMap<String, HashMap<String, Value>> = HashMap::new();
    for r in rows {
        let tabs: Value = serde_json::from_str(&r.tabs_json).unwrap_or(Value::Array(vec![]));
        let sidebar_expanded: Value =
            serde_json::from_str(&r.sidebar_expanded_json).unwrap_or(Value::Array(vec![]));
        let closed_tabs: Value =
            serde_json::from_str(&r.closed_tabs_json).unwrap_or(Value::Array(vec![]));
        let mut obj = serde_json::Map::new();
        obj.insert(
            "activeTabId".into(),
            r.active_tab_id.map(Value::String).unwrap_or(Value::Null),
        );
        obj.insert("tabs".into(), tabs);
        let mut sidebar = serde_json::Map::new();
        sidebar.insert("expanded".into(), sidebar_expanded);
        obj.insert("sidebar".into(), Value::Object(sidebar));
        obj.insert("closedTabHistory".into(), closed_tabs);
        by_conn
            .entry(r.connection_id)
            .or_default()
            .insert(r.db_name, Value::Object(obj));
    }

    Ok(WorkspacesStore {
        by_connection_id: by_conn,
    })
}

#[derive(Debug, sqlx::FromRow)]
struct WorkspaceRow {
    connection_id: String,
    db_name: String,
    active_tab_id: Option<String>,
    tabs_json: String,
    sidebar_expanded_json: String,
    closed_tabs_json: String,
}

async fn read_mru(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>) -> Result<MruStore, AppError> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT connection_id FROM mru ORDER BY last_used DESC")
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| AppError::Storage(format!("read mru: {}", e)))?;
    let recent: Vec<String> = rows.into_iter().map(|(id,)| id).collect();
    let last_used_connection_id = recent.first().cloned();
    Ok(MruStore {
        recent_connections: recent,
        last_used_connection_id,
    })
}

async fn read_theme(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>) -> Result<ThemeStore, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value_json FROM settings WHERE key = 'theme'")
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| AppError::Storage(format!("read theme: {}", e)))?;
    match row {
        Some((json,)) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(ThemeStore::default()),
    }
}

async fn read_safe_mode(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<SafeModeStore, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value_json FROM settings WHERE key = 'safe_mode'")
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| AppError::Storage(format!("read safe_mode: {}", e)))?;
    match row {
        Some((json,)) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(SafeModeStore::default()),
    }
}

// ---------------------------------------------------------------------------
// Tauri command wrapper — `tauri::Window` 자동 주입 + `AppState::connection_status`
// read. Pool 은 `OnceCell` 의 lazy init.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_initial_app_state(
    window: tauri::Window,
    state: State<'_, AppState>,
) -> Result<InitialAppState, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    let status_map = state.connection_status.lock().await.clone();
    let label = window.label().to_string();
    let mut snap = get_initial_app_state_inner(&pool, &label, &status_map).await?;
    // boot 자동 복구 발생 여부를 frontend toast 로 전달. swap 으로 읽으면서
    // reset — 다음 boot cycle 은 false 로 시작.
    snap.recovered = crate::storage::corrupt_recovery::DID_RECOVER
        .swap(false, std::sync::atomic::Ordering::SeqCst);
    Ok(snap)
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 1 sprint-357) — snapshot 의 default ctor + JSON
    //! serialization shape 의 unit-level 검증. 본 module 의 진짜 통합 검증은
    //! `tests/snapshot_*.rs` 에 있음 — 이 module 은 `cargo llvm-cov --lib`
    //! coverage 가 통합 테스트를 포함하지 않아 `--lib` 측정의 floor 를 유지하기
    //! 위한 최소 unit smoke.
    //!
    //! 시나리오:
    //!   - Default values 의 wire shape (theme = `"slate"` / `"system"`,
    //!     safe_mode = `"warn"`, runtime/workspaces empty)
    //!   - StoreSlot::Ok / Err 의 `#[serde(untagged)]` round-trip
    //!   - WORKSPACE_LABEL_PREFIX strip 로직 (launcher → None, workspace-X → Some("X"))
    //!   - SNAPSHOT_VERSION 단조 증가
    //!   - InitialAppState 의 camelCase serialization (schemaVersion / snapshotVersion / ...)
    //!
    //! Pool 이 필요 없는 pure-shape 테스트만 — DB-touching 시나리오는 통합
    //! 테스트에 위임.

    use super::*;
    use serde_json::json;

    #[test]
    fn theme_store_default_is_slate_themeid_system_mode() {
        // 작성 2026-05-16 — Wave 9.5 회귀 2 (테마 빈 부팅).
        // backend 의 default 는 반드시 frontend `DEFAULT_THEME_ID` ("slate")
        // 와 일치해야 한다. 둘이 어긋나면 첫 부팅 시 unknown `data-theme`
        // 셀렉터가 박혀 themes.css 매칭 실패 → 시각적 스타일 깨짐.
        let t = ThemeStore::default();
        assert_eq!(t.theme_id, "slate");
        assert_eq!(t.mode, "system");
        let json = serde_json::to_value(&t).unwrap();
        assert_eq!(json["themeId"], "slate");
        assert_eq!(json["mode"], "system");
    }

    #[test]
    fn safe_mode_store_default_is_warn() {
        // 이슈 #1113 — 신규 설치의 실효 기본값. 기존 default 는 "off" 였고
        // (frontend hydration 전 snapshot 이 이 default 를 실효값으로 노출),
        // 이 때문에 non-prod 에서 DROP / WHERE-less DELETE 가 무가드 실행됐다.
        let s = SafeModeStore::default();
        assert_eq!(s.mode, SafeMode::Warn);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["mode"], "warn");
    }

    #[test]
    fn safe_mode_deserializes_variants_and_falls_back_to_warn() {
        // 하위 호환 lock (#1113) — 기존 SQLite 에 영속된 3-tier 문자열은
        // 그대로 역직렬화되고, 미인식/legacy 값(구 "on" 등)은 `warn` 으로
        // fallback 한다. `SafeModeStore` 는 object wire (`{"mode":"..."}`)
        // 이므로 struct 레벨과 bare-enum 레벨 둘 다 확인.
        for (raw, expected) in [
            (r#"{"mode":"off"}"#, SafeMode::Off),
            (r#"{"mode":"warn"}"#, SafeMode::Warn),
            (r#"{"mode":"strict"}"#, SafeMode::Strict),
            // legacy / 미인식 → warn fallback.
            (r#"{"mode":"on"}"#, SafeMode::Warn),
            (r#"{"mode":"garbage"}"#, SafeMode::Warn),
        ] {
            let store: SafeModeStore = serde_json::from_str(raw).unwrap();
            assert_eq!(store.mode, expected, "store deserialize of {raw}");
        }
        // Round-trip: 유효 variant 는 serialize → deserialize 항등.
        for m in [SafeMode::Off, SafeMode::Warn, SafeMode::Strict] {
            let s = serde_json::to_string(&m).unwrap();
            assert_eq!(serde_json::from_str::<SafeMode>(&s).unwrap(), m);
        }
    }

    #[test]
    fn workspaces_store_default_is_empty_by_connection_id() {
        let w = WorkspacesStore::default();
        assert!(w.by_connection_id.is_empty());
        let json = serde_json::to_value(&w).unwrap();
        assert_eq!(json["byConnectionId"], json!({}));
    }

    #[test]
    fn mru_store_default_is_empty_and_null_last_used() {
        let m = MruStore::default();
        assert!(m.recent_connections.is_empty());
        assert!(m.last_used_connection_id.is_none());
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["recentConnections"], json!([]));
        assert_eq!(json["lastUsedConnectionId"], serde_json::Value::Null);
    }

    #[test]
    fn store_slot_ok_serializes_as_inner_value() {
        let slot: StoreSlot<MruStore> = StoreSlot::Ok(MruStore::default());
        let json = serde_json::to_value(&slot).unwrap();
        // `untagged` enum — Ok variant 는 inner 그대로 직렬화. error key 없음.
        assert!(!json.as_object().unwrap().contains_key("error"));
        assert!(json.as_object().unwrap().contains_key("recentConnections"));
    }

    #[test]
    fn store_slot_err_serializes_with_error_key() {
        let slot: StoreSlot<MruStore> = StoreSlot::Err {
            error: "table missing".into(),
        };
        let json = serde_json::to_value(&slot).unwrap();
        assert_eq!(json["error"], "table missing");
        assert!(!json.as_object().unwrap().contains_key("recentConnections"));
    }

    #[test]
    fn workspace_label_prefix_strip_for_launcher_returns_none() {
        // Launcher 는 prefix 가 없으므로 strip 결과 None.
        let label = "launcher";
        let scope = label.strip_prefix(WORKSPACE_LABEL_PREFIX);
        assert!(scope.is_none());
    }

    #[test]
    fn workspace_label_prefix_strip_for_workspace_returns_conn_id() {
        let label = "workspace-conn-42";
        let scope = label.strip_prefix(WORKSPACE_LABEL_PREFIX);
        assert_eq!(scope, Some("conn-42"));
    }

    #[test]
    fn workspace_label_prefix_strip_for_unknown_prefix_returns_none() {
        // workspace 가 아닌 다른 prefix (예: "preview-...") → None → launcher 로 fallback.
        let label = "preview-foo";
        let scope = label.strip_prefix(WORKSPACE_LABEL_PREFIX);
        assert!(scope.is_none());
    }

    #[test]
    fn initial_app_state_serializes_with_camel_case_keys() {
        let s = InitialAppState {
            schema_version: 1,
            snapshot_version: 7,
            generated_at: 1_700_000_000_000,
            partial: false,
            recovered: false,
            stores: Stores {
                connections: StoreSlot::Ok(ConnectionsStore {
                    items: vec![],
                    groups: vec![],
                }),
                workspaces: StoreSlot::Ok(WorkspacesStore::default()),
                mru: StoreSlot::Ok(MruStore::default()),
                theme: StoreSlot::Ok(ThemeStore::default()),
                safe_mode: StoreSlot::Ok(SafeModeStore::default()),
            },
            runtime: Runtime::default(),
        };
        let json = serde_json::to_value(&s).unwrap();
        let obj = json.as_object().unwrap();
        // camelCase top-level keys.
        for key in [
            "schemaVersion",
            "snapshotVersion",
            "generatedAt",
            "partial",
            "stores",
            "runtime",
        ] {
            assert!(obj.contains_key(key), "missing camelCase key `{}`", key);
        }
        // snake_case 가 새지 않음.
        for forbidden in [
            "schema_version",
            "snapshot_version",
            "generated_at",
            "safe_mode",
        ] {
            assert!(
                !obj.contains_key(forbidden),
                "snake_case `{}` leaked into wire",
                forbidden
            );
        }
        // stores 의 safeMode (camelCase).
        let stores = obj["stores"].as_object().unwrap();
        assert!(stores.contains_key("safeMode"));
        assert!(!stores.contains_key("safe_mode"));
        // runtime.activeStatuses (camelCase).
        let runtime = obj["runtime"].as_object().unwrap();
        assert!(runtime.contains_key("activeStatuses"));
    }

    #[test]
    fn snapshot_version_atomic_increments_monotonically() {
        // 직접 SNAPSHOT_VERSION 의 monotonic guarantee 를 unit level 에서 확인.
        // 통합 테스트가 inner 호출로 검증하지만, 이 atomic 자체의 round-trip 도
        // 명시적으로 lock — 다른 sprint 가 OrderInversion / Ordering::Relaxed 로
        // 바꾸지 못하게.
        let v1 = SNAPSHOT_VERSION.fetch_add(1, Ordering::SeqCst);
        let v2 = SNAPSHOT_VERSION.fetch_add(1, Ordering::SeqCst);
        let v3 = SNAPSHOT_VERSION.fetch_add(1, Ordering::SeqCst);
        assert!(v2 > v1);
        assert!(v3 > v2);
    }

    #[test]
    fn runtime_default_has_empty_active_statuses() {
        let r = Runtime::default();
        assert!(r.active_statuses.is_empty());
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["activeStatuses"], json!({}));
    }

    // ----------------------------------------------------------------------
    // DB-touching inline tests — `cargo llvm-cov --lib` 가 통합 테스트를
    // 포함하지 않아 `read_*` helpers 의 coverage 가 0 이 된다. 본 핵심
    // 시나리오는 통합 테스트가 풀로 cover 하지만, `--lib` 측정의 floor 유지
    // 위해 일부 happy-path 를 inline 으로 복제.
    // ----------------------------------------------------------------------

    use crate::storage::local;
    use serial_test::serial;
    use tempfile::TempDir;

    async fn pool_setup() -> (TempDir, sqlx::SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        (dir, pool)
    }

    fn pool_cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    #[tokio::test]
    #[serial]
    async fn inner_returns_default_shape_on_empty_db() {
        let (_dir, pool) = pool_setup().await;
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        assert_eq!(snap.schema_version, 1);
        assert!(!snap.partial);
        // schema_version=1 + monotonic snapshot_version > 0
        assert!(snap.snapshot_version > 0);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_workspace_scope_filters_to_one_connection() {
        let (_dir, pool) = pool_setup().await;
        // Seed two connection workspaces.
        for cid in ["conn-A", "conn-B"] {
            sqlx::query(
                "INSERT INTO workspaces(connection_id, db_name, active_tab_id, tabs_json, \
                 sidebar_expanded_json, closed_tabs_json, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(cid)
            .bind("db")
            .bind::<Option<String>>(None)
            .bind("[]")
            .bind("[]")
            .bind("[]")
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        }
        let snap = get_initial_app_state_inner(&pool, "workspace-conn-A", &HashMap::new())
            .await
            .unwrap();
        // launcher would give empty; workspace-conn-A only conn-A.
        if let StoreSlot::Ok(ws) = &snap.stores.workspaces {
            assert!(ws.by_connection_id.contains_key("conn-A"));
            assert!(!ws.by_connection_id.contains_key("conn-B"));
        } else {
            panic!("workspaces slot must be Ok");
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_reads_seeded_settings_for_theme_and_safe_mode() {
        let (_dir, pool) = pool_setup().await;
        sqlx::query("INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
            .bind("theme")
            .bind(r#"{"themeId":"monokai","mode":"light"}"#)
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
            .bind("safe_mode")
            .bind(r#"{"mode":"on"}"#)
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.theme {
            StoreSlot::Ok(t) => {
                assert_eq!(t.theme_id, "monokai");
                assert_eq!(t.mode, "light");
            }
            StoreSlot::Err { error } => panic!("theme must read OK, got error={}", error),
        }
        match &snap.stores.safe_mode {
            // seeded value "on" 은 3-tier 이전 legacy sentinel — warn fallback (#1113).
            StoreSlot::Ok(s) => assert_eq!(s.mode, SafeMode::Warn),
            StoreSlot::Err { error } => panic!("safe_mode must read OK, got error={}", error),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_bare_string_safe_mode_ignored_by_boot_read() {
        // #1190 characterization — frontend `persistSettingValue("safe_mode", mode)`
        // 는 bare JSON string(`"off"`)을 value_json 에 저장하지만 `read_safe_mode`
        // 는 object(`{"mode":...}`) 를 기대해 역직렬화 실패 → `.unwrap_or_default()`.
        // 따라서 boot snapshot 은 영속된 값을 무시하고 항상 default(warn)를 노출한다.
        // 위 시나리오 3개는 전부 object shape 를 seed 해 이 버그를 놓쳤다 (리뷰 blind
        // spot). #1113 의 "실효 기본값 = SafeModeStore::default()" 전제를 코드로 잠근다.
        // #1190 fix 시 이 assertion 이 뒤집힌다 (그때는 영속된 off 를 존중).
        let (_dir, pool) = pool_setup().await;
        sqlx::query("INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
            .bind("safe_mode")
            .bind(r#""off""#) // bare string — frontend 실제 저장 shape
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.safe_mode {
            // 영속값 off 가 무시되고 default(warn)로 fallback (#1190 witness).
            StoreSlot::Ok(s) => assert_eq!(s.mode, SafeMode::Warn),
            StoreSlot::Err { error } => panic!("safe_mode must read OK, got error={}", error),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_reads_mru_in_last_used_desc_order() {
        let (_dir, pool) = pool_setup().await;
        for (id, ts) in [("c-1", 100i64), ("c-2", 500), ("c-3", 200)] {
            sqlx::query("INSERT INTO mru(connection_id, last_used) VALUES (?, ?)")
                .bind(id)
                .bind(ts)
                .execute(&pool)
                .await
                .unwrap();
        }
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.mru {
            StoreSlot::Ok(m) => {
                assert_eq!(m.recent_connections, vec!["c-2", "c-3", "c-1"]);
                assert_eq!(m.last_used_connection_id.as_deref(), Some("c-2"));
            }
            StoreSlot::Err { error } => panic!("mru must read OK, got error={}", error),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_partial_on_dropped_mru_table() {
        let (_dir, pool) = pool_setup().await;
        sqlx::query("DROP TABLE mru").execute(&pool).await.unwrap();
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        assert!(snap.partial, "partial must be true when mru table missing");
        match &snap.stores.mru {
            StoreSlot::Err { error } => assert!(!error.is_empty()),
            StoreSlot::Ok(_) => panic!("mru slot must be Err"),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_returns_seeded_connection_in_items() {
        let (_dir, pool) = pool_setup().await;
        sqlx::query(
            "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, database, \
             sort_order, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("c-test")
        .bind("TestConn")
        .bind("mysql")
        .bind("localhost")
        .bind(3306i64)
        .bind("root")
        .bind("encrypted")
        .bind("test")
        .bind(0i64)
        .bind(1i64)
        .bind(1i64)
        .execute(&pool)
        .await
        .unwrap();
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.connections {
            StoreSlot::Ok(c) => {
                assert_eq!(c.items.len(), 1);
                assert_eq!(c.items[0].id, "c-test");
                assert_eq!(c.items[0].name, "TestConn");
                assert!(
                    c.items[0].has_password,
                    "non-empty password_enc → has_password = true"
                );
            }
            StoreSlot::Err { error } => panic!("connections must read OK, got error={}", error),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_preserves_search_connection_types_from_storage() {
        use crate::models::{DatabaseType, Paradigm};

        let (_dir, pool) = pool_setup().await;
        for (idx, (id, db_type)) in [
            ("c-elastic", "elasticsearch"),
            ("c-opensearch", "opensearch"),
        ]
        .into_iter()
        .enumerate()
        {
            sqlx::query(
                "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, database, \
                 sort_order, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(id)
            .bind(db_type)
            .bind("search.local")
            .bind(9200i64)
            .bind("")
            .bind("")
            .bind("")
            .bind(idx as i64)
            .bind(1i64)
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        }

        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.connections {
            StoreSlot::Ok(c) => {
                assert_eq!(c.items.len(), 2);
                assert!(matches!(c.items[0].db_type, DatabaseType::Elasticsearch));
                assert_eq!(c.items[0].paradigm, Paradigm::Search);
                assert!(matches!(c.items[1].db_type, DatabaseType::Opensearch));
                assert_eq!(c.items[1].paradigm, Paradigm::Search);
            }
            StoreSlot::Err { error } => panic!("connections must read OK, got error={}", error),
        }
        pool_cleanup();
    }
}
