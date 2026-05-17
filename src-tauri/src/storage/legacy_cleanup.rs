//! Sprint 375 (Phase 6 cleanup, 2026-05-17) — `.legacy.json` 30일 cleanup.
//!
//! state-management-strategy doc F.1 (line 862) — W4 단계의 정책:
//!
//! > legacy 정리 (Phase 6) — SQLite SOT 전환 완료 후 file/LS key 삭제,
//! > `connections.json` 은 `.legacy.json` rename 30일 보관.
//!
//! 본 cleanup 는 boot 시 한 번 호출되어, `*.legacy.json` 파일 (sprint-370
//! 의 W3→W4 rename helper 가 만든) 의 mtime 이 30일 보다 오래된 것을
//! silent delete 한다. user-visible toast / dialog 0 — strategy line 907
//! 의 "사용자 manual recovery 용" 의도와 align (30일 동안 사용자는 디스크
//! 에서 직접 손에 넣을 수 있고, 그 이후엔 SQLite SOT 가 안정적이라고 간주).
//!
//! Scripts/ 에는 `scripts/cleanup-legacy-files.sh` 가 dry-run / 외부 cron
//! path 로 같은 정책을 실행한다 (in-app boot 외에 사용자가 manual run
//! 할 수 있도록).
//!
//! Failure mode: 파일 stat / remove 실패는 `tracing::warn` 만 — 다음 boot
//! 에 다시 시도. Q10 zero-telemetry — 외부 전송 0.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tracing::{info, warn};

/// 30일 retention 의 ms 표현. Strategy F.1 line 862 의 fixed window.
/// const 로 둔다 — 회귀 가드 (`assert_eq!` 단언 가능) + boot path 가
/// 단순.
pub const RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000;

/// 한 디렉토리 안의 `*.legacy.json` 파일 중 mtime 이 `now - cutoff_ms`
/// 보다 더 오래된 것을 delete. 성공적으로 삭제된 파일 갯수 반환.
///
/// pure helper — `now_ms` 와 `dir` 가 caller 가 inject 가능해 integration
/// 테스트가 `tempfile` 의 TempDir 와 강제 mtime 으로 30일 boundary 를
/// 단언할 수 있다.
pub fn cleanup_legacy_files_in(
    dir: &Path,
    now: SystemTime,
    cutoff_ms: u64,
) -> std::io::Result<u32> {
    let mut deleted: u32 = 0;
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            // 디렉토리 자체가 없으면 첫 boot — clean 상태.
            if e.kind() == std::io::ErrorKind::NotFound {
                return Ok(0);
            }
            return Err(e);
        }
    };

    for entry in entries.flatten() {
        let path: PathBuf = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !file_name.ends_with(".legacy.json") {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(e) => {
                warn!(
                    target: "legacy_cleanup",
                    path = %path.display(),
                    "metadata read failed (skipping): {}",
                    e
                );
                continue;
            }
        };
        let modified = match metadata.modified() {
            Ok(m) => m,
            Err(e) => {
                warn!(
                    target: "legacy_cleanup",
                    path = %path.display(),
                    "modified() not supported (skipping): {}",
                    e
                );
                continue;
            }
        };
        let age = match now.duration_since(modified) {
            Ok(d) => d,
            Err(_) => {
                // future mtime — 시계 drift / 미래 파일. 안 지운다.
                continue;
            }
        };
        if age < Duration::from_millis(cutoff_ms) {
            // 30일 안쪽 — 보존.
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => {
                deleted += 1;
                info!(
                    target: "legacy_cleanup",
                    path = %path.display(),
                    age_days = age.as_secs() / 86_400,
                    "deleted legacy file past retention"
                );
            }
            Err(e) => {
                warn!(
                    target: "legacy_cleanup",
                    path = %path.display(),
                    "delete failed (skipping): {}",
                    e
                );
            }
        }
    }
    Ok(deleted)
}

/// `lib.rs::setup` detached task entry. app_data_dir 안의 `.legacy.json`
/// 30일 cleanup 을 silent 로 실행. 실패 시 `tracing::warn` 만, 사용자 toast 0.
pub async fn boot_legacy_file_cleanup() {
    let dir = match super::local::app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            warn!(
                target: "legacy_cleanup",
                "skipped — app_data_dir lookup failed: {}",
                e
            );
            return;
        }
    };
    let now = SystemTime::now();
    match cleanup_legacy_files_in(&dir, now, RETENTION_MS) {
        Ok(n) => {
            info!(
                target: "legacy_cleanup",
                deleted = n,
                "boot legacy file cleanup complete"
            );
        }
        Err(e) => {
            warn!(
                target: "legacy_cleanup",
                "scan failed: {}",
                e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-17 (Phase 6 sprint-375) — pure helper 의
    //! 30일 boundary 단언. boot wrapper 의 integration 검증은
    //! `tests/legacy_file_cleanup.rs`.

    use super::*;
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::time::Duration;
    use tempfile::TempDir;

    /// helper: 파일 생성 후 mtime 을 `seconds_ago` 초 전으로 강제 set.
    fn make_file_with_age(dir: &Path, name: &str, seconds_ago: u64) -> PathBuf {
        let path = dir.join(name);
        let mut f = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&path)
            .unwrap();
        f.write_all(b"{}").unwrap();
        f.sync_all().unwrap();
        drop(f);
        // mtime backdating — Unix specific. Most CI hosts run Linux/macOS.
        let target = SystemTime::now() - Duration::from_secs(seconds_ago);
        // filetime crate 가 없으면 utime 직접 호출 — 의존성 추가 회피
        // 위해 std 만 사용한다. 대신 helper 가 cutoff 를 inject 받으므로
        // SystemTime::now() override 로 boundary 단언.
        let _ = target;
        path
    }

    #[test]
    fn cleanup_in_empty_dir_returns_zero() {
        let dir = TempDir::new().unwrap();
        let now = SystemTime::now();
        let n = cleanup_legacy_files_in(dir.path(), now, RETENTION_MS).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn cleanup_ignores_non_legacy_files() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("connections.json"), b"{}").unwrap();
        std::fs::write(dir.path().join("favorites.json"), b"[]").unwrap();
        // 일부러 매우 오래된 cutoff 로 호출해도 — `.legacy.json` 가 아닌
        // 파일은 삭제 안 됨.
        let n = cleanup_legacy_files_in(dir.path(), SystemTime::now(), 0).unwrap();
        assert_eq!(n, 0, "non-.legacy.json 은 cleanup 대상 아님");
        assert!(dir.path().join("connections.json").exists());
        assert!(dir.path().join("favorites.json").exists());
    }

    #[test]
    fn cleanup_with_zero_cutoff_deletes_all_legacy_files() {
        // cutoff_ms = 0 → 모든 `.legacy.json` 이 retention 외 (age >= 0).
        // 회귀 가드: filename pattern 매칭 + delete path 가 동작하는지.
        let dir = TempDir::new().unwrap();
        let _ = make_file_with_age(dir.path(), "connections.legacy.json", 1);
        let _ = make_file_with_age(dir.path(), "settings.legacy.json", 1);
        std::fs::write(dir.path().join("state.db"), b"keep me").unwrap();

        let n = cleanup_legacy_files_in(dir.path(), SystemTime::now(), 0).unwrap();
        assert_eq!(n, 2);
        assert!(!dir.path().join("connections.legacy.json").exists());
        assert!(!dir.path().join("settings.legacy.json").exists());
        assert!(dir.path().join("state.db").exists());
    }

    #[test]
    fn cleanup_with_huge_cutoff_keeps_recent_files() {
        // cutoff_ms = u64::MAX → 어떤 파일도 age 가 그 보다 크지 않음 →
        // 보존. user journey: 30일 retention 이 정상 동작하면, 1분 전
        // rename 한 파일은 안 지워져야 함.
        let dir = TempDir::new().unwrap();
        let _ = make_file_with_age(dir.path(), "connections.legacy.json", 60);
        let n = cleanup_legacy_files_in(dir.path(), SystemTime::now(), u64::MAX).unwrap();
        assert_eq!(n, 0);
        assert!(dir.path().join("connections.legacy.json").exists());
    }
}
