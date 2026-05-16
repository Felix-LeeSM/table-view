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
    if let Ok(dir) = std::env::var("TABLE_VIEW_TEST_DATA_DIR") {
        let dir = PathBuf::from(dir);
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
fn data_has_password_ciphertext(data_dir: &Path) -> Result<bool, AppError> {
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

fn write_disk_key(path: &Path, key: &[u8]) -> Result<(), AppError> {
    let key_base64 = BASE64.encode(key);
    fs::write(path, key_base64)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
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
        // Best effort — if write fails we still try the rest of the cleanup.
        let _ = fs::write(path, &zeros);
        // Sync the overwrite to disk so the unlink doesn't race a delayed
        // page flush.
        if let Ok(f) = std::fs::OpenOptions::new().write(true).open(path) {
            let _ = f.sync_all();
        }
    }

    // 2. chmod 0o000 (Unix only). Marker for AC-356-02.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o000));
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
