//! Sprint 355 (Phase 1) — Q2 corrupt recovery.
//!
//! 정책 (strategy 2026-05-15 Q2):
//! - 앱 boot 시 SQLite 파일이 corrupt 면 `state.db.bak` 으로 quarantine
//! - 그 후 fresh DB 생성 (`open_pool` 이 `create_if_missing` 로 자동)
//! - 사용자 toast 없음 (silent recovery)
//!
//! Probe 전략: SQLite 의 magic header 16 byte (`"SQLite format 3\0"`) 를
//! 검사한다. Header 가 손상되면 sqlx 가 어떤 statement 도 실행 못하므로
//! pre-open 단계에서 잡는 게 가장 견고. integrity_check 까지 돌리면 비용이
//! 큰데, header 손상은 가장 흔한 corruption mode (디스크 풀, 비정상 종료
//! 중 partial write).

use crate::error::AppError;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tracing::info;

const SQLITE_MAGIC_HEADER: &[u8; 16] = b"SQLite format 3\0";

/// Returns `Ok(())` if the file at `path` looks like a valid SQLite database
/// (magic header intact, size ≥ 100 bytes for the database header page).
/// Returns `Err` if corruption is detected — the caller should quarantine.
pub async fn probe(path: &Path) -> Result<(), AppError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || probe_blocking(&path))
        .await
        .map_err(|e| AppError::Storage(format!("Probe task join error: {}", e)))?
}

fn probe_blocking(path: &Path) -> Result<(), AppError> {
    let metadata = fs::metadata(path)?;
    // SQLite database header is 100 bytes — anything smaller cannot be valid.
    // 0-byte file is a common artifact of an aborted `open` and we treat it
    // as recoverable (no data to lose).
    if metadata.len() < 100 {
        return Err(AppError::Storage(format!(
            "SQLite file too small to be valid: {} bytes",
            metadata.len()
        )));
    }
    let mut f = fs::File::open(path)?;
    let mut header = [0u8; 16];
    f.read_exact(&mut header)
        .map_err(|e| AppError::Storage(format!("Failed to read SQLite header: {}", e)))?;
    if &header != SQLITE_MAGIC_HEADER {
        return Err(AppError::Storage(format!(
            "SQLite magic header mismatch: {:?}",
            header
        )));
    }
    Ok(())
}

/// Rename `state.db` to `state.db.bak` (Q2). 기존 `.bak` 가 있으면 timestamp
/// suffix 를 붙여 누적 보존 — 사용자가 manual 복구 시 여러 corruption epoch
/// 을 모두 inspect 가능.
pub fn quarantine(path: &Path) -> Result<PathBuf, AppError> {
    let primary = path.with_extension(format!(
        "{}.bak",
        path.extension().and_then(|e| e.to_str()).unwrap_or("db")
    ));
    let backup = if primary.exists() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        path.with_extension(format!(
            "{}.bak.{}",
            path.extension().and_then(|e| e.to_str()).unwrap_or("db"),
            ts
        ))
    } else {
        primary
    };
    fs::rename(path, &backup)?;
    info!(
        target: "storage",
        path = %path.display(),
        backup = %backup.display(),
        "Quarantined corrupt SQLite file"
    );
    Ok(backup)
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 1 sprint-355) — corrupt header probe + quarantine
    //! 단위 검증. 통합 동작 (open_pool + corrupt 파일 → recovery) 은
    //! `tests/corrupt_recovery.rs` 에서 검증.

    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_probe_accepts_valid_sqlite_header() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("ok.db");
        let mut content = SQLITE_MAGIC_HEADER.to_vec();
        // Pad to >= 100 bytes (header size).
        content.resize(200, 0u8);
        fs::write(&path, &content).unwrap();
        probe(&path).await.unwrap();
    }

    #[tokio::test]
    async fn test_probe_rejects_bad_header() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("bad.db");
        let mut content = vec![0xFFu8; 200];
        // Ensure header bytes are clearly NOT the SQLite magic.
        content[..16].copy_from_slice(b"NOT-SQLITE-HDR\0\0");
        fs::write(&path, &content).unwrap();
        let result = probe(&path).await;
        assert!(result.is_err(), "Probe must reject bad header");
    }

    #[tokio::test]
    async fn test_probe_rejects_tiny_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("tiny.db");
        fs::write(&path, b"x").unwrap();
        let result = probe(&path).await;
        assert!(result.is_err(), "Probe must reject sub-100-byte file");
    }

    #[test]
    fn test_quarantine_renames_to_bak() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.db");
        fs::write(&path, b"corrupt").unwrap();
        let backup = quarantine(&path).unwrap();
        assert!(!path.exists(), "Original should be gone after quarantine");
        assert!(backup.exists(), "Backup must exist");
        assert!(
            backup
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .ends_with(".bak"),
            "Backup must end with .bak; got {}",
            backup.display()
        );
    }

    #[test]
    fn test_quarantine_adds_timestamp_when_bak_already_exists() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.db");
        let primary_bak = dir.path().join("state.db.bak");
        fs::write(&path, b"corrupt2").unwrap();
        fs::write(&primary_bak, b"old corrupt").unwrap();
        let backup = quarantine(&path).unwrap();
        assert!(primary_bak.exists(), "Old .bak preserved");
        assert!(backup.exists(), "Timestamped backup created");
        assert_ne!(backup, primary_bak, "Must NOT overwrite existing .bak");
    }
}
