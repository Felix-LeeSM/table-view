//! Sprint 358 (Phase 1 W1 dual-write) — file-based SOT 의 4 도메인 read/write
//! helper. `connections.json` 은 기존 `storage::mod.rs` 가 보유하므로 본 module
//! 은 그 외 3 도메인 (favorites / mru / settings) 의 file SOT 만 다룬다.
//!
//! 각 도메인 파일은 `storage::app_data_dir()` 하위에 위치:
//!   - `favorites.json` — `[{id,name,sql,connection_id,created_at,updated_at}]` 배열
//!   - `mru.json`       — `[{connection_id,last_used}]` 배열
//!   - `settings.json`  — `{key: value_json}` map. key 는 6 known + 임의 확장 가능
//!
//! Atomic write — write_via_tempfile (write+sync → rename). 이미 corrupt JSON 은
//! 빈 시드로 fallback (corrupt connections.json 패턴과 동일).

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FavoriteRecord {
    pub id: String,
    pub name: String,
    pub sql: String,
    #[serde(default)]
    pub connection_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MruRecord {
    pub connection_id: String,
    pub last_used: i64,
}

fn favorites_path() -> Result<PathBuf, AppError> {
    Ok(super::local::app_data_dir()?.join("favorites.json"))
}

fn mru_path() -> Result<PathBuf, AppError> {
    Ok(super::local::app_data_dir()?.join("mru.json"))
}

fn settings_path() -> Result<PathBuf, AppError> {
    Ok(super::local::app_data_dir()?.join("settings.json"))
}

/// Atomic write via tempfile + rename. 0600 mode (Unix) — 같은 데이터 디렉토리
/// 의 connections.json 과 동일 정책.
fn save_json_atomic<T: Serialize + ?Sized>(path: &PathBuf, data: &T) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Storage("Path has no parent directory".into()))?;
    let json = serde_json::to_string_pretty(data)?;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("data.json");
    let tmp_path = parent.join(format!("{file_name}.tmp.{}.{}", std::process::id(), nanos));

    {
        let mut opts = fs::OpenOptions::new();
        opts.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp_path)?;
        use std::io::Write;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }

    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e.into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// favorites
// ---------------------------------------------------------------------------

pub fn load_favorites_file() -> Result<Vec<FavoriteRecord>, AppError> {
    let path = favorites_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)?;
    match serde_json::from_str::<Vec<FavoriteRecord>>(&content) {
        Ok(v) => Ok(v),
        Err(e) => {
            // corrupt: log + return empty. Dual-write 의 다음 호출이 file 을
            // 덮어쓸 것 — 손실은 corrupt 파일 한 줄.
            warn!(
                target: "storage",
                path = %path.display(),
                error = %e,
                "favorites.json corrupt — treating as empty"
            );
            Ok(Vec::new())
        }
    }
}

pub fn save_favorites_file(favs: &[FavoriteRecord]) -> Result<(), AppError> {
    let path = favorites_path()?;
    save_json_atomic(&path, favs)
}

// ---------------------------------------------------------------------------
// mru
// ---------------------------------------------------------------------------

pub fn load_mru_file() -> Result<Vec<MruRecord>, AppError> {
    let path = mru_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)?;
    match serde_json::from_str::<Vec<MruRecord>>(&content) {
        Ok(v) => Ok(v),
        Err(e) => {
            warn!(
                target: "storage",
                path = %path.display(),
                error = %e,
                "mru.json corrupt — treating as empty"
            );
            Ok(Vec::new())
        }
    }
}

pub fn save_mru_file(mru: &[MruRecord]) -> Result<(), AppError> {
    let path = mru_path()?;
    save_json_atomic(&path, mru)
}

// ---------------------------------------------------------------------------
// settings — key-value (string → JSON-string) map. BTreeMap 으로 정렬 보장.
// ---------------------------------------------------------------------------

pub fn load_settings_file() -> Result<BTreeMap<String, String>, AppError> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let content = fs::read_to_string(&path)?;
    match serde_json::from_str::<BTreeMap<String, String>>(&content) {
        Ok(v) => Ok(v),
        Err(e) => {
            warn!(
                target: "storage",
                path = %path.display(),
                error = %e,
                "settings.json corrupt — treating as empty"
            );
            Ok(BTreeMap::new())
        }
    }
}

pub fn save_settings_file(settings: &BTreeMap<String, String>) -> Result<(), AppError> {
    let path = settings_path()?;
    save_json_atomic(&path, settings)
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 1 sprint-358) — JSON round-trip + corrupt fallback
    //! 검증. atomic write 의 rename 보장은 connections.json 의 기존 테스트가
    //! 검증.

    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    fn setup() -> TempDir {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        dir
    }

    fn cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    #[test]
    #[serial]
    fn favorites_round_trip() {
        let _dir = setup();
        let favs = vec![FavoriteRecord {
            id: "fav-1".into(),
            name: "Find Users".into(),
            sql: "SELECT * FROM users".into(),
            connection_id: Some("c1".into()),
            created_at: 100,
            updated_at: 200,
        }];
        save_favorites_file(&favs).unwrap();
        let loaded = load_favorites_file().unwrap();
        assert_eq!(loaded, favs);
        cleanup();
    }

    #[test]
    #[serial]
    fn mru_round_trip() {
        let _dir = setup();
        let mru = vec![MruRecord {
            connection_id: "c1".into(),
            last_used: 42,
        }];
        save_mru_file(&mru).unwrap();
        let loaded = load_mru_file().unwrap();
        assert_eq!(loaded, mru);
        cleanup();
    }

    #[test]
    #[serial]
    fn settings_round_trip() {
        let _dir = setup();
        let mut s = BTreeMap::new();
        s.insert("theme".into(), r#"{"themeId":"x","mode":"dark"}"#.into());
        s.insert("safe_mode".into(), r#"{"mode":"on"}"#.into());
        save_settings_file(&s).unwrap();
        let loaded = load_settings_file().unwrap();
        assert_eq!(loaded, s);
        cleanup();
    }

    #[test]
    #[serial]
    fn corrupt_settings_returns_empty() {
        let dir = setup();
        std::fs::write(dir.path().join("settings.json"), b"{ not json").unwrap();
        let loaded = load_settings_file().unwrap();
        assert!(loaded.is_empty());
        cleanup();
    }

    #[test]
    #[serial]
    fn missing_files_return_empty() {
        let _dir = setup();
        // 파일이 없을 때 each load returns empty.
        assert!(load_favorites_file().unwrap().is_empty());
        assert!(load_mru_file().unwrap().is_empty());
        assert!(load_settings_file().unwrap().is_empty());
        cleanup();
    }
}
