//! Sprint 370 (Phase 4 W2→W3) — boot-time mismatch metric.
//!
//! sprint-358 부터 dual-write (file/LS + SQLite mirror) 로 4 도메인이 둘 다
//! 저장된다. W2 dogfood 동안 두 source 가 byte-equivalent 임을 확인하기 위해
//! boot 시점에 row count + content hash 를 비교한다.
//!
//! 4 도메인:
//!   - `connections` (file `connections.json` ↔ SQLite `connections`)
//!   - `favorites`   (file `favorites.json`   ↔ SQLite `favorites`)
//!   - `mru`         (file `mru.json`         ↔ SQLite `mru`)
//!   - `settings`    (file `settings.json`    ↔ SQLite `settings`)
//!
//! 결과:
//!   - 모든 도메인이 일치 → counter 변경 없음 + `tracing::info!` 로 "ok" log.
//!   - 불일치 → counter += 1 + `tracing::warn!` 로 도메인 + 두 source 의 row
//!     count + truncated hash 를 log. **본 모듈은 사용자 visible 영향 0** —
//!     모든 dual-read fallback 은 reconcile 가 다음 boot 에 처리.
//!
//! Phase 6 (sprint-375) 의 file/LS 폐기 후 본 모듈도 retire — SQLite 가 단일
//! source 이므로 비교할 대상이 사라진다.
//!
//! `mismatch_counter` 는 `reconcile.rs` 의 dual-write 실패 counter 와 별 atomic.
//! 두 counter 는 의미가 다르다:
//!   - `reconcile::mismatch_counter` — dual-write 시점에 SQLite write 가 실패
//!   - `mismatch_metric::counter`    — boot 시점에 file/LS 와 SQLite 가 drift

use crate::error::AppError;
use crate::storage::load_storage_redacted;
use crate::storage::local_files::{
    load_favorites_file, load_mru_file, load_settings_file, FavoriteRecord, MruRecord,
};
use sqlx::SqlitePool;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// counter — process-wide. 4 도메인 중 하나라도 drift 발견 시 +1.
// `current()` 는 dev console / debug IPC 가 read. `reset()` 은 테스트 전용.
// ---------------------------------------------------------------------------

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub mod counter {
    use super::{Ordering, COUNTER};

    pub fn current() -> u64 {
        COUNTER.load(Ordering::SeqCst)
    }

    pub fn increment() -> u64 {
        COUNTER.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn reset() {
        COUNTER.store(0, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// MismatchReport — 4 도메인 결과 묶음. 테스트가 직접 단언, 프로덕션 path 는
// tracing log 로만 surface.
// ---------------------------------------------------------------------------

/// 한 도메인의 비교 결과. `Ok` → file/LS 와 SQLite 의 row count + hash 가 일치.
/// `Mismatch` → drift 감지, counter += 1 + warn log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainResult {
    Ok {
        domain: &'static str,
        rows: usize,
    },
    Mismatch {
        domain: &'static str,
        file_rows: usize,
        sqlite_rows: usize,
        file_hash_hex: String,
        sqlite_hash_hex: String,
    },
}

impl DomainResult {
    pub fn is_mismatch(&self) -> bool {
        matches!(self, DomainResult::Mismatch { .. })
    }
}

/// Boot 시점 4 도메인 비교 결과. log + counter update 후 caller 에 반환.
/// 테스트 / debug IPC 가 read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MismatchReport {
    pub domains: Vec<DomainResult>,
}

impl MismatchReport {
    pub fn mismatches(&self) -> usize {
        self.domains.iter().filter(|d| d.is_mismatch()).count()
    }
}

// ---------------------------------------------------------------------------
// Entry — boot 직후 호출. 호출자는 `lib.rs` 의 setup callback (또는 dev IPC).
// ---------------------------------------------------------------------------

/// 4 도메인 (connections / favorites / mru / settings) 의 file/LS SOT 와 SQLite
/// mirror 를 비교. 각 도메인 결과를 `DomainResult` 로 만들고 mismatch 시
/// counter += 1 + warn log. 한 도메인 read 실패는 silent — warn log + 그 도메인
/// 만 skip (다른 도메인 진행).
pub async fn measure_all(pool: &SqlitePool) -> Result<MismatchReport, AppError> {
    let mut domains = Vec::with_capacity(4);

    domains.push(measure_connections(pool).await);
    domains.push(measure_favorites(pool).await);
    domains.push(measure_mru(pool).await);
    domains.push(measure_settings(pool).await);

    let mismatch_count = domains.iter().filter(|d| d.is_mismatch()).count();
    if mismatch_count == 0 {
        info!(
            target: "mismatch_metric",
            "boot mismatch metric: all 4 domains match"
        );
    } else {
        for dr in &domains {
            if let DomainResult::Mismatch {
                domain,
                file_rows,
                sqlite_rows,
                file_hash_hex,
                sqlite_hash_hex,
            } = dr
            {
                warn!(
                    target: "mismatch_metric",
                    domain = domain,
                    file_rows = file_rows,
                    sqlite_rows = sqlite_rows,
                    file_hash = %truncate_hash(file_hash_hex),
                    sqlite_hash = %truncate_hash(sqlite_hash_hex),
                    "drift detected — file/LS SOT diverges from SQLite mirror"
                );
                counter::increment();
            }
        }
    }

    Ok(MismatchReport { domains })
}

fn truncate_hash(hex: &str) -> &str {
    if hex.len() >= 16 {
        &hex[..16]
    } else {
        hex
    }
}

// ---------------------------------------------------------------------------
// Per-domain helpers — 각 도메인의 file SOT + SQLite mirror 를 read 한 뒤
// row count + canonical content hash 비교.
// ---------------------------------------------------------------------------

type ConnectionMirrorRow = (String, String, String, String, i64, String, String, i64);

async fn measure_connections(pool: &SqlitePool) -> DomainResult {
    let file_data = match load_storage_redacted() {
        Ok(d) => d,
        Err(e) => {
            warn!(target: "mismatch_metric", error = %e, "skip connections — file read failed");
            return DomainResult::Ok {
                domain: "connections",
                rows: 0,
            };
        }
    };

    let mut file_payload: Vec<(String, String)> = file_data
        .connections
        .iter()
        .map(|c| {
            let canonical = format!(
                "{}|{}|{}|{}|{}|{}|{}|{}",
                c.id,
                c.name,
                serde_json::to_string(&c.db_type).unwrap_or_default(),
                c.host,
                c.port,
                c.user,
                c.database,
                c.read_only
            );
            (c.id.clone(), canonical)
        })
        .collect();
    file_payload.sort_by(|a, b| a.0.cmp(&b.0));
    let file_count = file_payload.len();
    let file_hash = hash_pairs(&file_payload);

    let sqlite_rows_result = sqlx::query_as::<_, ConnectionMirrorRow>(
        "SELECT id, name, db_type, host, port, user, database, read_only FROM connections ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await;
    let sqlite_rows = match sqlite_rows_result {
        Ok(rows) => rows,
        Err(e) => {
            warn!(target: "mismatch_metric", error = %e, "skip connections — SQLite read failed");
            return DomainResult::Ok {
                domain: "connections",
                rows: file_count,
            };
        }
    };

    let mut sqlite_payload: Vec<(String, String)> = sqlite_rows
        .into_iter()
        .map(
            |(id, name, db_type, host, port, user, database, read_only)| {
                // serialize db_type to match `serde_json::to_string(&c.db_type)` of
                // the file path. The file uses serde's PascalCase tag — the SQLite
                // column stores the literal lowercase tag, so we wrap it in
                // explicit quotes to match `serde_json::to_string` output for a
                // bare enum variant.
                let db_type_quoted = format!("\"{}\"", db_type);
                let canonical = format!(
                    "{}|{}|{}|{}|{}|{}|{}|{}",
                    id,
                    name,
                    db_type_quoted,
                    host,
                    port,
                    user,
                    database,
                    read_only != 0
                );
                (id, canonical)
            },
        )
        .collect();
    sqlite_payload.sort_by(|a, b| a.0.cmp(&b.0));
    let sqlite_count = sqlite_payload.len();
    let sqlite_hash = hash_pairs(&sqlite_payload);

    if file_count == sqlite_count && file_hash == sqlite_hash {
        DomainResult::Ok {
            domain: "connections",
            rows: file_count,
        }
    } else {
        DomainResult::Mismatch {
            domain: "connections",
            file_rows: file_count,
            sqlite_rows: sqlite_count,
            file_hash_hex: file_hash,
            sqlite_hash_hex: sqlite_hash,
        }
    }
}

async fn measure_favorites(pool: &SqlitePool) -> DomainResult {
    let file: Vec<FavoriteRecord> = match load_favorites_file() {
        Ok(v) => v,
        Err(e) => {
            warn!(target: "mismatch_metric", error = %e, "skip favorites — file read failed");
            return DomainResult::Ok {
                domain: "favorites",
                rows: 0,
            };
        }
    };

    let mut file_payload: Vec<(String, String)> = file
        .iter()
        .map(|f| {
            (
                f.id.clone(),
                format!(
                    "{}|{}|{}|{}",
                    f.id,
                    f.name,
                    f.sql,
                    f.connection_id.clone().unwrap_or_default()
                ),
            )
        })
        .collect();
    file_payload.sort_by(|a, b| a.0.cmp(&b.0));
    let file_count = file_payload.len();
    let file_hash = hash_pairs(&file_payload);

    let sqlite_rows: Vec<(String, String, String, Option<String>)> =
        match sqlx::query_as("SELECT id, name, sql, connection_id FROM favorites ORDER BY id ASC")
            .fetch_all(pool)
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                warn!(target: "mismatch_metric", error = %e, "skip favorites — SQLite read failed");
                return DomainResult::Ok {
                    domain: "favorites",
                    rows: file_count,
                };
            }
        };

    let mut sqlite_payload: Vec<(String, String)> = sqlite_rows
        .into_iter()
        .map(|(id, name, sql, conn_id)| {
            let canonical = format!("{}|{}|{}|{}", id, name, sql, conn_id.unwrap_or_default());
            (id, canonical)
        })
        .collect();
    sqlite_payload.sort_by(|a, b| a.0.cmp(&b.0));
    let sqlite_count = sqlite_payload.len();
    let sqlite_hash = hash_pairs(&sqlite_payload);

    if file_count == sqlite_count && file_hash == sqlite_hash {
        DomainResult::Ok {
            domain: "favorites",
            rows: file_count,
        }
    } else {
        DomainResult::Mismatch {
            domain: "favorites",
            file_rows: file_count,
            sqlite_rows: sqlite_count,
            file_hash_hex: file_hash,
            sqlite_hash_hex: sqlite_hash,
        }
    }
}

async fn measure_mru(pool: &SqlitePool) -> DomainResult {
    let file: Vec<MruRecord> = match load_mru_file() {
        Ok(v) => v,
        Err(e) => {
            warn!(target: "mismatch_metric", error = %e, "skip mru — file read failed");
            return DomainResult::Ok {
                domain: "mru",
                rows: 0,
            };
        }
    };

    let mut file_payload: Vec<(String, String)> = file
        .iter()
        .map(|m| {
            (
                m.connection_id.clone(),
                format!("{}|{}", m.connection_id, m.last_used),
            )
        })
        .collect();
    file_payload.sort_by(|a, b| a.0.cmp(&b.0));
    let file_count = file_payload.len();
    let file_hash = hash_pairs(&file_payload);

    let sqlite_rows: Vec<(String, i64)> =
        match sqlx::query_as("SELECT connection_id, last_used FROM mru ORDER BY connection_id ASC")
            .fetch_all(pool)
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                warn!(target: "mismatch_metric", error = %e, "skip mru — SQLite read failed");
                return DomainResult::Ok {
                    domain: "mru",
                    rows: file_count,
                };
            }
        };

    let mut sqlite_payload: Vec<(String, String)> = sqlite_rows
        .into_iter()
        .map(|(cid, ts)| (cid.clone(), format!("{}|{}", cid, ts)))
        .collect();
    sqlite_payload.sort_by(|a, b| a.0.cmp(&b.0));
    let sqlite_count = sqlite_payload.len();
    let sqlite_hash = hash_pairs(&sqlite_payload);

    if file_count == sqlite_count && file_hash == sqlite_hash {
        DomainResult::Ok {
            domain: "mru",
            rows: file_count,
        }
    } else {
        DomainResult::Mismatch {
            domain: "mru",
            file_rows: file_count,
            sqlite_rows: sqlite_count,
            file_hash_hex: file_hash,
            sqlite_hash_hex: sqlite_hash,
        }
    }
}

async fn measure_settings(pool: &SqlitePool) -> DomainResult {
    let file = match load_settings_file() {
        Ok(v) => v,
        Err(e) => {
            warn!(target: "mismatch_metric", error = %e, "skip settings — file read failed");
            return DomainResult::Ok {
                domain: "settings",
                rows: 0,
            };
        }
    };

    let mut file_payload: Vec<(String, String)> = file
        .iter()
        .map(|(k, v)| (k.clone(), format!("{}|{}", k, v)))
        .collect();
    file_payload.sort_by(|a, b| a.0.cmp(&b.0));
    let file_count = file_payload.len();
    let file_hash = hash_pairs(&file_payload);

    let sqlite_rows: Vec<(String, String)> =
        match sqlx::query_as("SELECT key, value_json FROM settings ORDER BY key ASC")
            .fetch_all(pool)
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                warn!(target: "mismatch_metric", error = %e, "skip settings — SQLite read failed");
                return DomainResult::Ok {
                    domain: "settings",
                    rows: file_count,
                };
            }
        };

    let mut sqlite_payload: Vec<(String, String)> = sqlite_rows
        .into_iter()
        .map(|(k, v)| (k.clone(), format!("{}|{}", k, v)))
        .collect();
    sqlite_payload.sort_by(|a, b| a.0.cmp(&b.0));
    let sqlite_count = sqlite_payload.len();
    let sqlite_hash = hash_pairs(&sqlite_payload);

    if file_count == sqlite_count && file_hash == sqlite_hash {
        DomainResult::Ok {
            domain: "settings",
            rows: file_count,
        }
    } else {
        DomainResult::Mismatch {
            domain: "settings",
            file_rows: file_count,
            sqlite_rows: sqlite_count,
            file_hash_hex: file_hash,
            sqlite_hash_hex: sqlite_hash,
        }
    }
}

/// Cheap non-cryptographic hash over the canonical payload. We just need a
/// fingerprint that flips when content drifts — std's `DefaultHasher` is
/// sufficient and avoids pulling in a new crypto crate just to detect a
/// dev-only dogfood mismatch. Hex of the 64-bit digest keeps the log
/// surface human-readable.
fn hash_pairs(payload: &[(String, String)]) -> String {
    let mut hasher = DefaultHasher::new();
    for (_, canonical) in payload {
        canonical.hash(&mut hasher);
        // record separator so two adjacent payloads with concatenated bytes
        // don't accidentally collide.
        0u8.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 4 W2→W3 sprint-370)
    //!
    //! 사유: boot 시점 4 도메인 비교 모듈의 core invariant — 같은 데이터일
    //! 때 counter 변경 없음 + 불일치 시 counter += 1 — 을 unit 레벨에서 lock.
    //! E2E 시나리오 (lib.rs setup 호출) 는 `tests/mismatch_metric.rs` 가 담당.

    use super::*;
    use crate::models::{ConnectionConfig, DatabaseType};
    use crate::storage::local;
    use crate::storage::local_files::{
        save_favorites_file, save_mru_file, save_settings_file, FavoriteRecord, MruRecord,
    };
    use serial_test::serial;
    use std::collections::BTreeMap;
    use tempfile::TempDir;

    async fn pool_setup() -> (TempDir, sqlx::SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        (dir, pool)
    }

    fn pool_cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
        counter::reset();
    }

    #[test]
    #[serial]
    fn counter_round_trip() {
        counter::reset();
        assert_eq!(counter::current(), 0);
        let v1 = counter::increment();
        let v2 = counter::increment();
        assert_eq!(v1, 1);
        assert_eq!(v2, 2);
        counter::reset();
        assert_eq!(counter::current(), 0);
    }

    #[test]
    fn hash_pairs_deterministic_for_same_input() {
        let a = vec![("k1".into(), "v1".into()), ("k2".into(), "v2".into())];
        let b = vec![("k1".into(), "v1".into()), ("k2".into(), "v2".into())];
        assert_eq!(hash_pairs(&a), hash_pairs(&b));
    }

    #[test]
    fn hash_pairs_differs_for_different_content() {
        let a = vec![("k1".into(), "v1".into())];
        let b = vec![("k1".into(), "v2".into())];
        assert_ne!(hash_pairs(&a), hash_pairs(&b));
    }

    #[tokio::test]
    #[serial]
    async fn measure_all_reports_ok_when_both_sources_empty() {
        let (_dir, pool) = pool_setup().await;
        counter::reset();
        let report = measure_all(&pool).await.unwrap();
        assert_eq!(report.mismatches(), 0);
        assert_eq!(counter::current(), 0);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn measure_all_detects_mru_drift_and_increments_counter() {
        let (_dir, pool) = pool_setup().await;
        counter::reset();

        // file SOT 에 entry — SQLite 는 empty.
        save_mru_file(&[MruRecord {
            connection_id: "c-drift".into(),
            last_used: 1_700_000_000_000,
        }])
        .unwrap();

        let report = measure_all(&pool).await.unwrap();
        let mru = report
            .domains
            .iter()
            .find(|d| matches!(d, DomainResult::Mismatch { domain, .. } if *domain == "mru"));
        assert!(
            mru.is_some(),
            "mru drift must surface as Mismatch (file=1, sqlite=0)"
        );
        assert!(counter::current() >= 1, "drift must increment counter");
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn measure_all_reports_ok_when_mru_matches_both_sources() {
        let (_dir, pool) = pool_setup().await;
        counter::reset();

        save_mru_file(&[MruRecord {
            connection_id: "c-match".into(),
            last_used: 42,
        }])
        .unwrap();
        sqlx::query("INSERT INTO mru(connection_id, last_used) VALUES (?, ?)")
            .bind("c-match")
            .bind(42i64)
            .execute(&pool)
            .await
            .unwrap();

        let report = measure_all(&pool).await.unwrap();
        let mru = report.domains.iter().find(|d| {
            matches!(
                d,
                DomainResult::Ok { domain, rows: 1 } if *domain == "mru"
            )
        });
        assert!(mru.is_some(), "mru must be Ok when both sources match");
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn measure_all_detects_favorites_count_drift() {
        let (_dir, pool) = pool_setup().await;
        counter::reset();
        save_favorites_file(&[FavoriteRecord {
            id: "fav-x".into(),
            name: "n".into(),
            sql: "SELECT 1".into(),
            connection_id: None,
            created_at: 1,
            updated_at: 1,
        }])
        .unwrap();

        let report = measure_all(&pool).await.unwrap();
        let fav = report.domains.iter().find(
            |d| matches!(d, DomainResult::Mismatch { domain, file_rows: 1, sqlite_rows: 0, .. } if *domain == "favorites"),
        );
        assert!(
            fav.is_some(),
            "favorites drift (file=1, sqlite=0) must surface"
        );
        assert!(counter::current() >= 1);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn measure_all_detects_settings_value_drift() {
        let (_dir, pool) = pool_setup().await;
        counter::reset();
        let mut m = BTreeMap::new();
        m.insert(
            "theme".into(),
            r#"{"themeId":"slate","mode":"dark"}"#.into(),
        );
        save_settings_file(&m).unwrap();
        // SQLite 에 다른 값.
        sqlx::query("INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
            .bind("theme")
            .bind(r#"{"themeId":"github","mode":"light"}"#)
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();

        let report = measure_all(&pool).await.unwrap();
        let s = report.domains.iter().find(|d| {
            matches!(
                d,
                DomainResult::Mismatch { domain, file_rows: 1, sqlite_rows: 1, .. } if *domain == "settings"
            )
        });
        assert!(
            s.is_some(),
            "settings value drift (file=1, sqlite=1 but different content) must surface as Mismatch"
        );
        assert!(counter::current() >= 1);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn measure_all_detects_connections_drift() {
        let (_dir, pool) = pool_setup().await;
        counter::reset();
        // file SOT 에 connection 1 개.
        let conn = ConnectionConfig {
            id: "c-1".into(),
            name: "X".into(),
            db_type: DatabaseType::Postgresql,
            host: "h".into(),
            port: 5432,
            user: "u".into(),
            password: String::new(),
            database: "d".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
            trust_server_certificate: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        };
        crate::storage::save_connection(conn, None).unwrap();

        let report = measure_all(&pool).await.unwrap();
        let c = report.domains.iter().find(|d| {
            matches!(
                d,
                DomainResult::Mismatch { domain, file_rows: 1, sqlite_rows: 0, .. } if *domain == "connections"
            )
        });
        assert!(c.is_some(), "connections drift must surface");
        assert!(counter::current() >= 1);
        pool_cleanup();
    }

    #[test]
    fn truncate_hash_limits_to_16_chars() {
        assert_eq!(truncate_hash("abc"), "abc");
        // 16 char digest stays untouched; longer input clamps to the first 16.
        assert_eq!(truncate_hash("0123456789abcdef").len(), 16);
        let long = "a".repeat(64);
        assert_eq!(truncate_hash(&long).len(), 16);
    }
}
