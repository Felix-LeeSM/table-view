//! Sprint 356 (Phase 1, Q22) — file-key 이주: 디스크 평문 → OS keyring.
//!
//! 본 모듈은 SQLite migration **전** 에 1회 호출된다. 따라서 sentinel /
//! migration-failed 마커는 SQLite `meta` table 에 두지 않고 file sidecar
//! 로만 둔다 (codex 5차 #5 fix — strategy 873–905 line).
//!
//! 3 path (state-management-strategy 2026-05-15, Q22 + line 873–905):
//!   - **Path A (신규)**: 디스크 `.key` 없음 + keyring 없음 → 새 key 생성,
//!     keyring 저장, 디스크 file 폐기. AC-356-01.
//!   - **Path B (migration)**: 디스크 `.key` 있음 + keyring 없음 → 디스크
//!     read → keyring write → readback 검증 → 디스크 secure delete
//!     (overwrite + 0o000 + unlink). 실패 시 디스크 유지 + sidecar
//!     `.key.migration-failed`. AC-356-02..04.
//!   - **Path B 후속 boot**: 디스크 `.key` 없음 + keyring 있음 → keyring
//!     read. AC-356-03.
//!   - **Path C (Linux fallback)**: keyring `is_available()` 가 false →
//!     디스크 `.key` mode 유지 (현재 0o600), frontend 에 toast event
//!     emit. AC-356-05..06.
//!   - **Fatal**: 디스크 `.key` 없음 + keyring 없음 + ciphertext 존재 →
//!     `KeySource::Fatal` 반환, 호출자가 safe mode 진입. AC-356-09.

use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::aead::KeyInit;
use aes_gcm::Aes256Gcm;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tracing::{info, warn};

use crate::error::AppError;
use crate::storage::crypto::{KeyringBackend, KEYRING_ENTRY_NAME};

/// Sprint 356 — 사용자 데이터 디렉토리 안의 file-key 경로.
pub fn disk_key_path(data_dir: &Path) -> PathBuf {
    data_dir.join(".key")
}

/// Sprint 356 — production 시점의 user-data dir 해상도. `TABLE_VIEW_TEST_DATA_DIR`
/// env 가 set 돼 있으면 그 값을 우선 사용 (테스트 격리). storage::local 의
/// 정책과 동일.
pub fn app_data_dir_for_keyring() -> Result<PathBuf, AppError> {
    // #1454 (P2-6) — override honored in debug only; release ignores env.
    if let Some(dir) = crate::storage::data_dir_override() {
        fs::create_dir_all(&dir)?;
        return Ok(dir);
    }
    let dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| AppError::Storage("Cannot determine app data directory".into()))?;
    let dir = dir.join("table-view");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Sprint 356 — Path B 실패 시 생성되는 sentinel. 다음 boot 가 migration
/// 재시도. SQLite meta 미존재 시점이라 file sidecar 만 사용.
pub fn migration_failed_sentinel_path(data_dir: &Path) -> PathBuf {
    data_dir.join(".key.migration-failed")
}

/// Sprint 356 — Linux fallback toast 가 한 번 표시된 후 set 되는 file
/// sidecar. 다음 boot 가 같은 환경이면 toast 안 띄움 (AC-356-06).
pub fn fallback_dismissed_sentinel_path(data_dir: &Path) -> PathBuf {
    data_dir.join(".keyring-fallback-dismissed")
}

/// 어디서 key 가 왔는지의 진실 (호출자의 분기용 / 테스트 단언용).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeySource {
    /// Path A — 새로 생성. 디스크 file 0.
    Generated,
    /// Path A/B 후 boot — keyring 에서 그대로 read.
    FromKeyring,
    /// Path B — 디스크 → keyring 이주 후 디스크 secure-deleted.
    MigratedFromDisk,
    /// Path C — keyring 미가용, 디스크 file 그대로.
    DiskFallback,
    /// AC-356-09 — keyring + 디스크 둘 다 없는데 ciphertext 있음.
    /// 호출자는 safe mode 진입, decrypt 시도 금지.
    Fatal,
}

/// `migrate_or_initialize()` 의 반환. 호출자 (`storage::mod.rs` /
/// `lib.rs::run()`) 는 `outcome.key` 를 envelope crypto 의 source 로 쓰고
/// `outcome.fallback_to_disk` 가 true 일 때만 frontend 에 1회 toast 를
/// emit 한다.
#[derive(Debug, Clone)]
pub struct KeyOutcome {
    /// 32-byte AES-256-GCM key. `KeySource::Fatal` 의 경우 빈 `Vec`.
    pub key: Vec<u8>,
    /// 어디서 왔는지.
    pub source: KeySource,
    /// `true` = Path C (Linux fallback). `false` = 그 외.
    pub fallback_to_disk: bool,
}

impl KeyOutcome {
    /// 호출자 편의 — fatal path 인가 (decrypt 금지 사인).
    pub fn is_fatal(&self) -> bool {
        matches!(self.source, KeySource::Fatal)
    }
}

/// Sprint 356 (Q22) — file-key 의 3 path 분기. SQLite migration 전에 1회
/// 호출. `data_dir` 는 user-data dir (테스트에서는 tempdir, 프로덕션에서는
/// `dirs::data_local_dir().join("table-view")`).
pub fn migrate_or_initialize<B: KeyringBackend>(
    backend: &B,
    data_dir: &Path,
) -> Result<KeyOutcome, AppError> {
    fs::create_dir_all(data_dir)?;

    // ---------------- Path C 진단 (가장 먼저) ----------------
    if !backend.is_available() {
        // P2-5 (#1455) — the disk fallback is a security downgrade (0600 file,
        // no OS ACL/keyring protection). `is_available()` already retried, so a
        // false here means the keyring is genuinely unreachable; log it at WARN
        // so the downgrade is observable in boot logs (the caller also raises a
        // one-time frontend toast via `fallback_to_disk`).
        warn!(
            target: "boot",
            "key_migration: keyring unavailable after retries — falling back to 0600 disk key (no OS ACL protection)"
        );
        return path_c_disk_fallback(data_dir);
    }

    // ---------------- Path B 후속 boot — keyring hit ----------------
    if let Some(bytes) = backend.get(KEYRING_ENTRY_NAME)? {
        validate_key_len(&bytes)?;
        // 디스크 `.key` 가 (예: Path B 의 secure-delete 가 부분 실패해)
        // 남아있을 가능성이 있으므로 best-effort cleanup. 이미 keyring 에
        // 정합한 key 가 있으므로 디스크 잔재는 leakage surface 일 뿐.
        let disk_path = disk_key_path(data_dir);
        if disk_path.exists() {
            let _ = secure_delete(&disk_path);
        }
        return Ok(KeyOutcome {
            key: bytes,
            source: KeySource::FromKeyring,
            fallback_to_disk: false,
        });
    }

    // ---------------- Path B (migration) or Path A (new user) ---------
    let disk_path = disk_key_path(data_dir);
    if disk_path.exists() {
        return path_b_migrate_from_disk(backend, data_dir, &disk_path);
    }

    // ---------------- Path A 또는 Fatal ----------------
    // 디스크 .key 없음, keyring 없음. 만약 ciphertext (connections.json
    // 안의 password_enc) 가 비어있지 않다면 새 key 를 만들면 orphan ——
    // fatal 로 표시한다 (AC-356-09).
    if data_has_password_ciphertext(data_dir)? {
        return Ok(KeyOutcome {
            key: Vec::new(),
            source: KeySource::Fatal,
            fallback_to_disk: false,
        });
    }

    // Path A — fresh install. 새 key 생성 + keyring write.
    let key = Aes256Gcm::generate_key(aes_gcm::aead::OsRng);
    let key_bytes = key.as_slice().to_vec();
    backend.set(KEYRING_ENTRY_NAME, &key_bytes)?;

    // Readback 검증 — AC-356-07. set 직후 get 으로 byte equality.
    let stored = backend.get(KEYRING_ENTRY_NAME)?.ok_or_else(|| {
        AppError::Encryption("Keyring set succeeded but get returned None".into())
    })?;
    if stored != key_bytes {
        return Err(AppError::Encryption(
            "Keyring readback mismatch — refusing to boot with mismatched key".into(),
        ));
    }

    info!(
        target: "boot",
        "key_migration: Path A (new user) — generated 32-byte key + keyring entry created"
    );

    Ok(KeyOutcome {
        key: key_bytes,
        source: KeySource::Generated,
        fallback_to_disk: false,
    })
}

/// Path B — 디스크 .key 를 keyring 으로 이주. 모든 step 성공해야만 디스크
/// secure-delete. 한 step 이라도 실패 시 sentinel sidecar + 디스크 보존
/// (다음 boot 재시도). decrypt 는 디스크 path 로 fallback (caller
/// 책임).
fn path_b_migrate_from_disk<B: KeyringBackend>(
    backend: &B,
    data_dir: &Path,
    disk_path: &Path,
) -> Result<KeyOutcome, AppError> {
    let disk_key = read_disk_key(disk_path)?;

    // (a) keyring write.
    if let Err(e) = backend.set(KEYRING_ENTRY_NAME, &disk_key) {
        warn!(
            target: "boot",
            "key_migration: Path B step (a) keyring write failed ({e}); leaving sentinel"
        );
        write_sentinel(&migration_failed_sentinel_path(data_dir))?;
        // 디스크 key 로 그대로 decrypt 가능 — DiskFallback 으로 반환.
        return Ok(KeyOutcome {
            key: disk_key,
            source: KeySource::DiskFallback,
            fallback_to_disk: true,
        });
    }

    // (b) readback 검증.
    let stored = backend.get(KEYRING_ENTRY_NAME)?;
    match stored {
        Some(bytes) if bytes == disk_key => {
            // OK — continue.
        }
        _ => {
            warn!(
                target: "boot",
                "key_migration: Path B step (b) keyring readback mismatch; leaving sentinel"
            );
            write_sentinel(&migration_failed_sentinel_path(data_dir))?;
            return Ok(KeyOutcome {
                key: disk_key,
                source: KeySource::DiskFallback,
                fallback_to_disk: true,
            });
        }
    }

    // (c) ciphertext decrypt sanity check (strategy line 886–887). Best
    // effort — if there are no ciphertexts to validate (fresh dual-write
    // user) we still proceed.
    if let Err(e) = validate_ciphertexts_decrypt(data_dir, &disk_key) {
        warn!(
            target: "boot",
            "key_migration: Path B step (c) ciphertext probe failed ({e}); leaving sentinel"
        );
        write_sentinel(&migration_failed_sentinel_path(data_dir))?;
        return Ok(KeyOutcome {
            key: disk_key,
            source: KeySource::DiskFallback,
            fallback_to_disk: true,
        });
    }

    // (d) secure delete + clear sentinel (in case a previous boot left one).
    secure_delete(disk_path)?;
    let sentinel = migration_failed_sentinel_path(data_dir);
    if sentinel.exists() {
        let _ = fs::remove_file(&sentinel);
    }

    info!(
        target: "boot",
        "key_migration: Path B (migration) — disk .key imported into keyring + secure-deleted"
    );

    Ok(KeyOutcome {
        key: disk_key,
        source: KeySource::MigratedFromDisk,
        fallback_to_disk: false,
    })
}

/// Path C — Linux fallback. keyring 미가용. 디스크 file mode 유지 (현재
/// 0o600). 디스크 file 없으면 새로 생성. Frontend 에는 caller 가 file
/// sidecar `.keyring-fallback-dismissed` 가 부재일 때만 toast 한 번 띄움.
fn path_c_disk_fallback(data_dir: &Path) -> Result<KeyOutcome, AppError> {
    let disk_path = disk_key_path(data_dir);
    if disk_path.exists() {
        let key = read_disk_key(&disk_path)?;
        Ok(KeyOutcome {
            key,
            source: KeySource::DiskFallback,
            fallback_to_disk: true,
        })
    } else {
        // #1555 — keyring-only 프로필이 keyring 없는 환경으로 이전/소실되면
        // 디스크 `.key` 도, keyring 도 없다. 여기서 새 key 를 생성하면 기존
        // ciphertext 가 orphan 이 되어 저장 password 전량 복호화 불가.
        // Path A(l.154-160) 및 crypto #1093 가드와 동형으로 Fatal 진입
        // (호출자가 safe mode). AC-356-09.
        if data_has_password_ciphertext(data_dir)? {
            warn!(
                target: "boot",
                "key_migration: Path C — keyring unavailable and disk .key missing but ciphertext present; entering safe mode instead of minting an orphan key"
            );
            return Ok(KeyOutcome {
                key: Vec::new(),
                source: KeySource::Fatal,
                fallback_to_disk: false,
            });
        }
        // 신규 사용자 + Linux fallback — 디스크에 새 key.
        let key = Aes256Gcm::generate_key(aes_gcm::aead::OsRng);
        let key_bytes = key.as_slice().to_vec();
        write_disk_key(&disk_path, &key_bytes)?;
        info!(
            target: "boot",
            "key_migration: Path C (Linux fallback) — keyring unavailable, generated disk .key"
        );
        Ok(KeyOutcome {
            key: key_bytes,
            source: KeySource::DiskFallback,
            fallback_to_disk: true,
        })
    }
}

/// Validate that every non-empty `password_enc` in `connections.json`
/// decrypts under `key`. Returns Ok if (a) file absent, (b) file present
/// but no non-empty passwords, or (c) all passwords decrypt cleanly.
/// Returns Err on the first failure.
fn validate_ciphertexts_decrypt(data_dir: &Path, key: &[u8]) -> Result<(), AppError> {
    let conn_path = data_dir.join("connections.json");
    if !conn_path.exists() {
        return Ok(());
    }
    let raw = fs::read_to_string(&conn_path)?;
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            // Corrupt JSON — `load_storage_raw()` will quarantine on the
            // next call. From this step's perspective there is no
            // ciphertext to validate against. We do not block migration.
            return Ok(());
        }
    };
    let Some(connections) = parsed.get("connections").and_then(|v| v.as_array()) else {
        return Ok(());
    };
    for conn in connections {
        let Some(pw_enc) = conn.get("password").and_then(|v| v.as_str()) else {
            continue;
        };
        if pw_enc.is_empty() {
            continue;
        }
        crate::storage::crypto::decrypt(pw_enc, key)
            .map_err(|e| AppError::Encryption(format!("Ciphertext probe decrypt failed: {e}")))?;
    }
    Ok(())
}

/// 디스크에 ciphertext 가 있고 key 가 사라진 fatal 케이스 판정. AC-356-09.
/// `crypto::get_or_create_key` (#1093 orphan guard) 도 같은 신호를 재사용한다.
pub(crate) fn data_has_password_ciphertext(data_dir: &Path) -> Result<bool, AppError> {
    let conn_path = data_dir.join("connections.json");
    if !conn_path.exists() {
        return Ok(false);
    }
    let raw = fs::read_to_string(&conn_path)?;
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    let Some(connections) = parsed.get("connections").and_then(|v| v.as_array()) else {
        return Ok(false);
    };
    for conn in connections {
        if let Some(pw_enc) = conn.get("password").and_then(|v| v.as_str()) {
            if !pw_enc.is_empty() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn validate_key_len(bytes: &[u8]) -> Result<(), AppError> {
    if bytes.len() == 32 {
        Ok(())
    } else {
        Err(AppError::Encryption(format!(
            "Invalid key length, expected 32 bytes, got {}",
            bytes.len()
        )))
    }
}

fn read_disk_key(path: &Path) -> Result<Vec<u8>, AppError> {
    let key_base64 = fs::read_to_string(path)?;
    let key = BASE64
        .decode(key_base64.trim())
        .map_err(|e| AppError::Encryption(format!("Failed to decode key: {e}")))?;
    validate_key_len(&key)?;
    Ok(key)
}

/// Write the base64 master key to `path`, creating it with 0600 in a single
/// syscall on Unix (#1554). Mirrors `crypto::create_key_file`'s create-time
/// `mode(0o600)`: the old `fs::write` + `set_permissions` pair left the key
/// group/world-readable (0644 under a default 022 umask) in the window between
/// the two syscalls. Setting the mode at `open(2)` time closes that window.
/// Non-Unix keeps the plain-create default (no POSIX mode).
fn write_disk_key(path: &Path, key: &[u8]) -> Result<(), AppError> {
    use std::io::Write;
    let key_base64 = BASE64.encode(key);
    let mut opts = fs::OpenOptions::new();
    opts.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(key_base64.as_bytes())?;
    Ok(())
}

/// Secure delete — overwrite content with zeros, fsync, set 0o000 mode
/// marker, then unlink. The 0o000 chmod is a belt-and-braces marker so a
/// process that races the unlink and somehow still has a file handle
/// can't usefully read residual bytes. AC-356-02 invariants.
fn secure_delete(path: &Path) -> Result<(), AppError> {
    // 1. overwrite with zeros (length-matched).
    if let Ok(meta) = fs::metadata(path) {
        let len = meta.len() as usize;
        let zeros = vec![0u8; len];
        // Best effort — if write fails we still try the rest of the cleanup,
        // but a residual-plaintext window is worth a log line.
        if let Err(e) = fs::write(path, &zeros) {
            warn!(target: "keyring", "secure_delete: zero-overwrite failed for {}: {e}", path.display());
        }
        // Sync the overwrite to disk so the unlink doesn't race a delayed
        // page flush.
        match std::fs::OpenOptions::new().write(true).open(path) {
            Ok(f) => {
                if let Err(e) = f.sync_all() {
                    warn!(target: "keyring", "secure_delete: fsync after overwrite failed for {}: {e}", path.display());
                }
            }
            Err(e) => {
                warn!(target: "keyring", "secure_delete: reopen for fsync failed for {}: {e}", path.display());
            }
        }
    }

    // 2. chmod 0o000 (Unix only). Marker for AC-356-02.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = fs::set_permissions(path, fs::Permissions::from_mode(0o000)) {
            warn!(target: "keyring", "secure_delete: chmod 0o000 marker failed for {}: {e}", path.display());
        }
    }

    // 3. unlink.
    fs::remove_file(path)?;
    Ok(())
}

fn write_sentinel(path: &Path) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, b"")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-17 — sprint-376 직후 baseline cleanup.
    //!
    //! `tests/keyring_*.rs` 통합 binary 가 별도로 존재하지만 본 baseline 의
    //! coverage 측정 (`--lib --test storage_integration ...`) set 에는 포함되지
    //! 않아 key_migration.rs 가 0% 로 나옴. inline `#[cfg(test)]` 로 옮겨와
    //! `--lib` 경로의 cover 를 확보. 시나리오는 통합 binary 와 일부 중복되나
    //! 더 fine-grained: secure_delete, sentinel, validate_key_len, 그리고 5
    //! Path 분기 (A, B happy, B fail, B 후속 boot keyring hit, C unavail) 를
    //! 작은 함수 단위로 lock.
    //!
    //! Test scenarios 8 원칙:
    //!   - Happy: Path A (fresh user), Path B (disk → keyring), Path C (Linux).
    //!   - 빈 입력: 빈 connections.json (data_has_password_ciphertext = false).
    //!   - 에러 복구: keyring set 실패 → 디스크 보존 + sentinel.
    //!   - 동시성: idempotent — 두 번째 boot 가 keyring hit only.
    //!   - 상태 전이: Generated → FromKeyring → MigratedFromDisk → DiskFallback → Fatal.
    //!   - try-await reject: read_disk_key with corrupt base64 / wrong length.
    //!   - 빈 catch 없음 — Path B 실패 분기는 sentinel write 까지 단언.
    //!
    //! `InMemoryKeyringBackend` 가 `tests/keyring_*` 와 같은 in-memory 시뮬레이션
    //! 이라 OS keyring 미접촉.
    use super::*;
    use crate::storage::crypto::{encrypt, InMemoryKeyringBackend, KeyringBackend};
    use serial_test::serial;
    use std::ffi::{OsStr, OsString};
    use tempfile::TempDir;

    struct EnvVarGuard {
        key: &'static str,
        prior: Option<OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: impl AsRef<OsStr>) -> Self {
            let prior = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, prior }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.prior {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    fn seed_disk_key(data_dir: &Path, key: &[u8]) {
        let path = disk_key_path(data_dir);
        fs::write(&path, BASE64.encode(key)).expect("seed disk key");
    }

    // ---------------- helper: disk_key_path / sentinel paths ----------------

    #[test]
    fn disk_key_path_joins_dot_key_filename() {
        let dir = TempDir::new().unwrap();
        let path = disk_key_path(dir.path());
        assert_eq!(path.file_name().and_then(|s| s.to_str()), Some(".key"));
        assert_eq!(path.parent(), Some(dir.path()));
    }

    #[test]
    fn migration_failed_sentinel_path_has_expected_filename() {
        let dir = TempDir::new().unwrap();
        let path = migration_failed_sentinel_path(dir.path());
        assert_eq!(
            path.file_name().and_then(|s| s.to_str()),
            Some(".key.migration-failed")
        );
    }

    #[test]
    fn fallback_dismissed_sentinel_path_has_expected_filename() {
        let dir = TempDir::new().unwrap();
        let path = fallback_dismissed_sentinel_path(dir.path());
        assert_eq!(
            path.file_name().and_then(|s| s.to_str()),
            Some(".keyring-fallback-dismissed")
        );
    }

    // ---------------- helper: validate_key_len ----------------

    #[test]
    fn validate_key_len_accepts_exactly_32_bytes() {
        validate_key_len(&[0u8; 32]).expect("32 bytes is valid");
    }

    #[test]
    fn validate_key_len_rejects_short_key() {
        let err = validate_key_len(&[0u8; 16]).unwrap_err();
        match err {
            AppError::Encryption(msg) => {
                assert!(
                    msg.contains("32"),
                    "msg should mention expected length: {msg}"
                );
                assert!(msg.contains("16"));
            }
            other => panic!("Expected Encryption error, got {other:?}"),
        }
    }

    #[test]
    fn validate_key_len_rejects_empty() {
        assert!(validate_key_len(&[]).is_err());
    }

    // ---------------- helper: read_disk_key (try-await reject) ----------------

    #[test]
    fn read_disk_key_round_trip_with_valid_base64() {
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (0..32u8).collect();
        seed_disk_key(dir.path(), &key);
        let got = read_disk_key(&disk_key_path(dir.path())).unwrap();
        assert_eq!(got, key);
    }

    #[test]
    fn read_disk_key_with_invalid_base64_fails_encryption_error() {
        let dir = TempDir::new().unwrap();
        let path = disk_key_path(dir.path());
        fs::write(&path, "not-valid-base64!!!").unwrap();
        let err = read_disk_key(&path).unwrap_err();
        match err {
            AppError::Encryption(msg) => assert!(msg.contains("decode")),
            other => panic!("Expected Encryption, got {other:?}"),
        }
    }

    #[test]
    fn read_disk_key_with_wrong_length_fails_validation() {
        let dir = TempDir::new().unwrap();
        let path = disk_key_path(dir.path());
        // base64 of 16 bytes — decodes ok but length check rejects.
        fs::write(&path, BASE64.encode([0u8; 16])).unwrap();
        let err = read_disk_key(&path).unwrap_err();
        assert!(matches!(err, AppError::Encryption(_)));
    }

    #[test]
    fn read_disk_key_missing_file_returns_io_error() {
        let dir = TempDir::new().unwrap();
        let err = read_disk_key(&disk_key_path(dir.path())).unwrap_err();
        match err {
            AppError::Io(_) => {}
            other => panic!("Expected Io error, got {other:?}"),
        }
    }

    // ---------------- helper: write_disk_key ----------------

    #[test]
    fn write_disk_key_creates_file_and_round_trips() {
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (5..37u8).collect();
        let path = disk_key_path(dir.path());
        write_disk_key(&path, &key).unwrap();
        assert!(path.exists());
        let got = read_disk_key(&path).unwrap();
        assert_eq!(got, key);
    }

    /// #1554 — the disk key must be 0600. The fix creates the file with
    /// `mode(0o600)` at `open(2)` time (no `fs::write` + `set_permissions`
    /// two-step), so it is never group/world-readable (0644) in between.
    #[cfg(unix)]
    #[test]
    fn write_disk_key_sets_mode_0o600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (0..32u8).collect();
        let path = disk_key_path(dir.path());
        write_disk_key(&path, &key).unwrap();
        let meta = fs::metadata(&path).unwrap();
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
    }

    // ---------------- helper: secure_delete ----------------

    #[test]
    fn secure_delete_removes_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("to_delete");
        fs::write(&path, b"sensitive content").unwrap();
        assert!(path.exists());
        secure_delete(&path).unwrap();
        assert!(!path.exists(), "secure_delete must unlink the file");
    }

    #[test]
    fn secure_delete_on_missing_file_returns_io_error() {
        let dir = TempDir::new().unwrap();
        let err = secure_delete(&dir.path().join("nonexistent")).unwrap_err();
        match err {
            AppError::Io(_) => {}
            other => panic!("Expected Io error for missing path, got {other:?}"),
        }
    }

    // ---------------- helper: write_sentinel ----------------

    #[test]
    fn write_sentinel_creates_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".sentinel");
        write_sentinel(&path).unwrap();
        assert!(path.exists());
        let body = fs::read(&path).unwrap();
        assert!(body.is_empty(), "sentinel body is intentionally empty");
    }

    #[test]
    fn write_sentinel_creates_parent_directory() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nested/deeper/.sentinel");
        write_sentinel(&path).unwrap();
        assert!(path.exists());
        assert!(path.parent().unwrap().is_dir());
    }

    // ---------------- helper: data_has_password_ciphertext ----------------

    #[test]
    fn data_has_password_ciphertext_returns_false_when_file_missing() {
        let dir = TempDir::new().unwrap();
        assert!(!data_has_password_ciphertext(dir.path()).unwrap());
    }

    #[test]
    fn data_has_password_ciphertext_returns_false_when_json_corrupt() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("connections.json"), "{ not valid json").unwrap();
        assert!(!data_has_password_ciphertext(dir.path()).unwrap());
    }

    #[test]
    fn data_has_password_ciphertext_returns_false_when_connections_array_missing() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("connections.json"), r#"{"groups":[]}"#).unwrap();
        assert!(!data_has_password_ciphertext(dir.path()).unwrap());
    }

    #[test]
    fn data_has_password_ciphertext_returns_false_when_all_passwords_empty() {
        let dir = TempDir::new().unwrap();
        let doc = serde_json::json!({
            "connections": [
                { "id": "c1", "password": "" },
                { "id": "c2", "password": "" },
            ],
            "groups": [],
        });
        fs::write(dir.path().join("connections.json"), doc.to_string()).unwrap();
        assert!(!data_has_password_ciphertext(dir.path()).unwrap());
    }

    #[test]
    fn data_has_password_ciphertext_returns_true_when_any_password_nonempty() {
        let dir = TempDir::new().unwrap();
        let doc = serde_json::json!({
            "connections": [
                { "id": "c1", "password": "" },
                { "id": "c2", "password": "ciphertext-blob" },
            ],
        });
        fs::write(dir.path().join("connections.json"), doc.to_string()).unwrap();
        assert!(data_has_password_ciphertext(dir.path()).unwrap());
    }

    // ---------------- helper: validate_ciphertexts_decrypt ----------------

    #[test]
    fn validate_ciphertexts_decrypt_ok_when_file_missing() {
        let dir = TempDir::new().unwrap();
        validate_ciphertexts_decrypt(dir.path(), &[0u8; 32]).unwrap();
    }

    #[test]
    fn validate_ciphertexts_decrypt_ok_when_passwords_empty() {
        let dir = TempDir::new().unwrap();
        let doc = serde_json::json!({
            "connections": [
                { "id": "c1", "password": "" },
            ],
        });
        fs::write(dir.path().join("connections.json"), doc.to_string()).unwrap();
        validate_ciphertexts_decrypt(dir.path(), &[0u8; 32]).unwrap();
    }

    #[test]
    fn validate_ciphertexts_decrypt_succeeds_with_correct_key() {
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (0..32u8).collect();
        let enc = encrypt("secret-pw", &key).unwrap();
        let doc = serde_json::json!({
            "connections": [
                { "id": "c1", "password": enc },
            ],
        });
        fs::write(dir.path().join("connections.json"), doc.to_string()).unwrap();
        validate_ciphertexts_decrypt(dir.path(), &key)
            .expect("decrypt must succeed under correct key");
    }

    #[test]
    fn validate_ciphertexts_decrypt_fails_with_wrong_key() {
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (0..32u8).collect();
        let wrong: Vec<u8> = (10..42u8).collect();
        let enc = encrypt("secret-pw", &key).unwrap();
        let doc = serde_json::json!({
            "connections": [
                { "id": "c1", "password": enc },
            ],
        });
        fs::write(dir.path().join("connections.json"), doc.to_string()).unwrap();
        let err = validate_ciphertexts_decrypt(dir.path(), &wrong).unwrap_err();
        assert!(matches!(err, AppError::Encryption(_)));
    }

    #[test]
    fn validate_ciphertexts_decrypt_ok_with_corrupt_json() {
        // Corrupt JSON is handled gracefully (load_storage_raw will quarantine
        // on the next call). The probe must not block migration.
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("connections.json"), "{ corrupt").unwrap();
        validate_ciphertexts_decrypt(dir.path(), &[0u8; 32]).unwrap();
    }

    #[test]
    fn validate_ciphertexts_decrypt_ok_when_connections_array_missing() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("connections.json"), r#"{"groups":[]}"#).unwrap();
        validate_ciphertexts_decrypt(dir.path(), &[0u8; 32]).unwrap();
    }

    // ---------------- main: migrate_or_initialize — 5 path branches ----------------

    /// Path A — fresh user, healthy keyring, no disk key, no ciphertext.
    #[test]
    fn migrate_path_a_generates_new_key_and_writes_to_keyring() {
        let dir = TempDir::new().unwrap();
        let backend = InMemoryKeyringBackend::new_available();
        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();
        assert_eq!(outcome.source, KeySource::Generated);
        assert_eq!(outcome.key.len(), 32);
        assert!(!outcome.fallback_to_disk);
        assert!(!outcome.is_fatal());
        // Keyring should have the same key bytes.
        let stored = backend.get(KEYRING_ENTRY_NAME).unwrap().unwrap();
        assert_eq!(stored, outcome.key);
        // No disk key created on Path A.
        assert!(!disk_key_path(dir.path()).exists());
    }

    /// Path B happy — disk key migrates into keyring + secure-deleted.
    #[test]
    fn migrate_path_b_happy_migrates_and_unlinks_disk_key() {
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (0..32u8).collect();
        seed_disk_key(dir.path(), &key);
        let backend = InMemoryKeyringBackend::new_available();

        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();
        assert_eq!(outcome.source, KeySource::MigratedFromDisk);
        assert_eq!(outcome.key, key);
        assert!(!disk_key_path(dir.path()).exists());
        assert!(!migration_failed_sentinel_path(dir.path()).exists());
        // Sentinel from a previous failed migration would be cleaned up on success.
    }

    /// Path B fail — keyring write throws → sentinel + disk preserved.
    #[test]
    fn migrate_path_b_keyring_write_fail_preserves_disk_and_writes_sentinel() {
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (0..32u8).collect();
        seed_disk_key(dir.path(), &key);
        let backend = InMemoryKeyringBackend::new_available();
        backend.set_set_should_fail(true);

        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();
        assert_eq!(outcome.source, KeySource::DiskFallback);
        assert!(outcome.fallback_to_disk);
        assert!(disk_key_path(dir.path()).exists(), "disk key preserved");
        assert!(
            migration_failed_sentinel_path(dir.path()).exists(),
            "failure sentinel set"
        );
    }

    /// Path B 후속 boot — keyring hit only, disk key absent.
    #[test]
    fn migrate_second_boot_after_b_reads_keyring_only() {
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (0..32u8).collect();
        seed_disk_key(dir.path(), &key);
        let backend = InMemoryKeyringBackend::new_available();

        let first = migrate_or_initialize(&backend, dir.path()).unwrap();
        assert_eq!(first.source, KeySource::MigratedFromDisk);

        let second = migrate_or_initialize(&backend, dir.path()).unwrap();
        assert_eq!(second.source, KeySource::FromKeyring);
        assert_eq!(second.key, key);
    }

    /// Keyring hit cleans up stray disk file (Path B partial-failure mop-up).
    #[test]
    fn migrate_keyring_hit_cleans_up_stale_disk_file() {
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (0..32u8).collect();
        let backend = InMemoryKeyringBackend::new_available();
        backend.set(KEYRING_ENTRY_NAME, &key).unwrap();
        // Simulate stray disk file (Path B secure-delete failed partway in
        // a previous boot).
        seed_disk_key(dir.path(), &key);
        assert!(disk_key_path(dir.path()).exists());

        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();
        assert_eq!(outcome.source, KeySource::FromKeyring);
        assert!(
            !disk_key_path(dir.path()).exists(),
            "stale disk .key should be best-effort cleaned"
        );
    }

    /// Keyring hit with wrong-length payload fails (invariant guard).
    #[test]
    fn migrate_keyring_hit_with_wrong_length_fails() {
        let dir = TempDir::new().unwrap();
        let backend = InMemoryKeyringBackend::new_available();
        backend.set(KEYRING_ENTRY_NAME, &[0u8; 16]).unwrap();
        let err = migrate_or_initialize(&backend, dir.path()).unwrap_err();
        assert!(matches!(err, AppError::Encryption(_)));
    }

    /// Path C — keyring unavailable + existing disk → DiskFallback.
    #[test]
    fn migrate_path_c_unavailable_keyring_with_disk_falls_back() {
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (0..32u8).collect();
        seed_disk_key(dir.path(), &key);
        let backend = InMemoryKeyringBackend::new_unavailable();
        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();
        assert_eq!(outcome.source, KeySource::DiskFallback);
        assert!(outcome.fallback_to_disk);
        assert_eq!(outcome.key, key);
        assert!(disk_key_path(dir.path()).exists());
    }

    /// Path C — keyring unavailable + no disk → new disk key generated.
    #[test]
    fn migrate_path_c_unavailable_keyring_no_disk_generates_disk_key() {
        let dir = TempDir::new().unwrap();
        let backend = InMemoryKeyringBackend::new_unavailable();
        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();
        assert_eq!(outcome.source, KeySource::DiskFallback);
        assert!(outcome.fallback_to_disk);
        assert_eq!(outcome.key.len(), 32);
        assert!(disk_key_path(dir.path()).exists());
    }

    /// #1555 — Path C (keyring unavailable) + no disk key + ciphertext present
    /// must be Fatal, never mint an orphan key. Regression: a keyring-only
    /// profile carried to a keyring-less host has ciphertext but no `.key` and
    /// no keyring; generating a fresh key here would strand every stored
    /// password permanently.
    #[test]
    fn migrate_path_c_no_disk_but_ciphertext_present_is_fatal() {
        let dir = TempDir::new().unwrap();
        let lost_key: Vec<u8> = (0..32u8).rev().collect();
        let enc = encrypt("secret", &lost_key).unwrap();
        fs::write(
            dir.path().join("connections.json"),
            serde_json::json!({"connections":[{"id":"c1","password":enc}]}).to_string(),
        )
        .unwrap();
        let backend = InMemoryKeyringBackend::new_unavailable();

        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();
        assert!(
            outcome.is_fatal(),
            "must refuse to orphan existing ciphertext"
        );
        assert_eq!(outcome.source, KeySource::Fatal);
        assert!(outcome.key.is_empty(), "fatal must not carry a key");
        assert!(!outcome.fallback_to_disk);
        assert!(
            !disk_key_path(dir.path()).exists(),
            "must not write an orphan disk key"
        );
    }

    /// Fatal — keyring + disk both missing, but ciphertext present.
    #[test]
    fn migrate_fatal_when_key_lost_but_ciphertext_present() {
        let dir = TempDir::new().unwrap();
        // Seed a non-empty ciphertext (we never persist the key anywhere).
        let lost_key: Vec<u8> = (0..32u8).rev().collect();
        let enc = encrypt("secret", &lost_key).unwrap();
        fs::write(
            dir.path().join("connections.json"),
            serde_json::json!({"connections":[{"id":"c1","password":enc}]}).to_string(),
        )
        .unwrap();
        let backend = InMemoryKeyringBackend::new_available();

        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();
        assert!(outcome.is_fatal());
        assert_eq!(outcome.source, KeySource::Fatal);
        assert!(outcome.key.is_empty(), "fatal must not carry a key");
        // No new key written to disk or keyring (would orphan ciphertext).
        assert!(!disk_key_path(dir.path()).exists());
        assert!(backend.dump().is_empty());
    }

    // ---------------- KeyOutcome helper ----------------

    #[test]
    fn key_outcome_is_fatal_matches_fatal_source_only() {
        let fatal = KeyOutcome {
            key: Vec::new(),
            source: KeySource::Fatal,
            fallback_to_disk: false,
        };
        assert!(fatal.is_fatal());

        for src in [
            KeySource::Generated,
            KeySource::FromKeyring,
            KeySource::MigratedFromDisk,
            KeySource::DiskFallback,
        ] {
            let outcome = KeyOutcome {
                key: vec![0u8; 32],
                source: src.clone(),
                fallback_to_disk: false,
            };
            assert!(!outcome.is_fatal(), "{:?} should not be fatal", src);
        }
    }

    // ---------------- app_data_dir_for_keyring — test env override ----------------

    #[test]
    #[serial]
    fn app_data_dir_for_keyring_honors_test_env() {
        let dir = TempDir::new().unwrap();
        let _guard = EnvVarGuard::set("TABLE_VIEW_TEST_DATA_DIR", dir.path());

        let resolved = app_data_dir_for_keyring().unwrap();

        assert_eq!(resolved, dir.path());
    }
}
