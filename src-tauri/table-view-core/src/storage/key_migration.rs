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
//!   - **재키잉 (#1814)**: 디스크 `.key` 있음 + keyring 있음 → 디스크를 거친
//!     키는 노출된 키다. 새 키 생성 → keyring 덮어쓰기 → `connections.json`
//!     재암호화 (임시 파일 + atomic rename) → 디스크 `.key` secure delete.
//!     디스크 `.key` 가 복구 앵커라 어느 단계에서 죽어도 다음 부팅이 이어받는다.
//!     `KeyOutcome::rekeyed_after_disk_exposure` 로 수행 여부가 드러난다.
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
use zeroize::Zeroizing;

use crate::error::AppError;
use crate::storage::crypto::{create_key_file, KeyringBackend, KEYRING_ENTRY_NAME};

/// Sprint 356 — 사용자 데이터 디렉토리 안의 file-key 경로.
pub fn disk_key_path(data_dir: &Path) -> PathBuf {
    data_dir.join(".key")
}

/// Sprint 356 — production 시점의 user-data dir 해상도. 이름만 keyring 쪽 호출자를
/// 위해 남아 있고 판정은 [`crate::storage::app_data_dir`] 한 곳이다 (#2184).
/// 그 전에는 override → fallback 본문을 여기서 한 벌 더 갖고 있었다.
pub fn app_data_dir_for_keyring() -> Result<PathBuf, AppError> {
    crate::storage::app_data_dir()
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
    /// #1814 — 이번 부팅이 디스크 노출을 거친 키를 폐기하고 새 키로 갈아탔는가.
    /// `true` 면 `key` 는 이번 부팅에 새로 만든 키이고 `connections.json` 은 그
    /// 키로 재암호화됐다. 재키잉을 시도했다가 실패한 부팅은 `false` 이고, 그때
    /// `key` 는 (`source` 가 `FromKeyring` 이어도) 현재 암호문을 여는 키 —
    /// 디스크 `.key` 앵커의 값일 수 있다. 다음 부팅이 같은 조건을 다시 만나
    /// 재시도한다.
    pub rekeyed_after_disk_exposure: bool,
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
        // 디스크 `.key` 가 남아 있다 = 이 프로필이 Path C 디스크 fallback 을
        // 거쳤거나 Path B 의 secure delete 가 부분 실패했다. 둘 다 master key
        // 평문이 디스크에 앉아 있던 상태다. 잔재만 지우고 같은 키를 계속 쓰면
        // 그 파일을 백업·rsync·스냅샷으로 가져간 쪽이 여전히 모든 password 를
        // 푼다 — 새 키로 갈아탄다 (#1814).
        let disk_path = disk_key_path(data_dir);
        if disk_path.exists() {
            return rekey_after_disk_exposure(backend, data_dir, &disk_path, bytes);
        }
        return Ok(KeyOutcome {
            key: bytes,
            source: KeySource::FromKeyring,
            fallback_to_disk: false,
            rekeyed_after_disk_exposure: false,
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
            rekeyed_after_disk_exposure: false,
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
        rekeyed_after_disk_exposure: false,
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
            rekeyed_after_disk_exposure: false,
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
                rekeyed_after_disk_exposure: false,
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
            rekeyed_after_disk_exposure: false,
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
        rekeyed_after_disk_exposure: false,
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
            rekeyed_after_disk_exposure: false,
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
                rekeyed_after_disk_exposure: false,
            });
        }
        // 신규 사용자 + Linux fallback — 디스크에 새 key. write_disk_key 가
        // atomic publish 후 실제 on-disk key 를 돌려주므로 (동시 boot race 시
        // winner 의 key), 그 반환값을 사용해 ciphertext orphan 을 방지한다.
        let generated = Aes256Gcm::generate_key(aes_gcm::aead::OsRng);
        let key_bytes = write_disk_key(&disk_path, generated.as_slice())?;
        info!(
            target: "boot",
            "key_migration: Path C (Linux fallback) — keyring unavailable, generated disk .key"
        );
        Ok(KeyOutcome {
            key: key_bytes,
            source: KeySource::DiskFallback,
            fallback_to_disk: true,
            rekeyed_after_disk_exposure: false,
        })
    }
}

/// `connections.json` 안에서 master key 봉투로 감싸이는 필드. `storage::mod.rs`
/// 의 `save_connection_with_wallet` 이 유일한 `crypto::encrypt` 호출자이고 거기서
/// 봉투를 타는 값은 이 둘뿐이다. `ConnectionConfig` 에 `rename_all` 이 없어 저장
/// key 는 필드 이름 그대로다. **새 secret 필드를 추가하면 여기에도 넣어야 한다** —
/// 빠진 필드는 재키잉 뒤 복호화 불가로 남는다.
const SECRET_FIELDS: [&str; 2] = ["password", "wallet_password"];

fn connections_path(data_dir: &Path) -> PathBuf {
    data_dir.join("connections.json")
}

/// 재키잉이 새 암호문을 먼저 떨어뜨리는 임시 파일. 이름을 고정한 이유는 boot 에
/// 1회만 도는 경로라 경합이 없고, 앞선 부팅이 남긴 잔재를 매번 회수하기 위해서다.
fn rekey_tmp_path(data_dir: &Path) -> PathBuf {
    data_dir.join("connections.json.rekey.tmp")
}

/// `connections.json` 의 상태. `Corrupt` 는 파싱 실패 — `load_storage_raw()` 가
/// 다음 호출에서 격리한다.
enum ConnectionsDoc {
    Absent,
    Corrupt,
    Parsed(serde_json::Value),
}

fn read_connections_doc(data_dir: &Path) -> Result<ConnectionsDoc, AppError> {
    let path = connections_path(data_dir);
    if !path.exists() {
        return Ok(ConnectionsDoc::Absent);
    }
    let raw = fs::read_to_string(&path)?;
    Ok(match serde_json::from_str(&raw) {
        Ok(value) => ConnectionsDoc::Parsed(value),
        Err(_) => ConnectionsDoc::Corrupt,
    })
}

/// 문서 안의 비어있지 않은 secret 암호문들.
fn secret_values(doc: &serde_json::Value) -> impl Iterator<Item = &str> {
    doc.get("connections")
        .and_then(|v| v.as_array())
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .flat_map(|conn| {
            SECRET_FIELDS
                .iter()
                .filter_map(move |field| conn.get(*field).and_then(|v| v.as_str()))
        })
        .filter(|enc| !enc.is_empty())
}

/// 지켜야 할 암호문이 하나라도 있는가. 없으면 재키잉이 잃을 것도 없다.
fn has_secrets(doc: &serde_json::Value) -> bool {
    secret_values(doc).next().is_some()
}

/// 문서의 모든 secret 이 `key` 로 풀리는가. 하나라도 실패하면 false — 부분 성공을
/// 성공으로 강등하지 않는다.
fn secrets_decrypt_under(doc: &serde_json::Value, key: &[u8]) -> bool {
    secret_values(doc).all(|enc| crate::storage::crypto::decrypt(enc, key).is_ok())
}

/// 모든 secret 을 `old` 로 풀어 `new` 로 다시 감싼다. 하나라도 실패하면 `Err` 이고
/// 호출자는 원본 파일을 건드리지 않은 채 다음 부팅으로 넘긴다. 평문은 `Zeroizing`
/// 안에서만 살아 재암호화 직후 지워진다 (ADR 0040 이 재암호화의 비용으로 지목한
/// "plaintext 메모리 노출 윈도우" 를 최소화).
fn reencrypt_secrets(doc: &mut serde_json::Value, old: &[u8], new: &[u8]) -> Result<(), AppError> {
    let Some(connections) = doc.get_mut("connections").and_then(|v| v.as_array_mut()) else {
        return Ok(());
    };
    for conn in connections {
        for field in SECRET_FIELDS {
            let Some(enc) = conn.get(field).and_then(|v| v.as_str()) else {
                continue;
            };
            if enc.is_empty() {
                continue;
            }
            let plaintext = Zeroizing::new(crate::storage::crypto::decrypt(enc, old)?);
            let rewrapped = crate::storage::crypto::encrypt(plaintext.as_str(), new)?;
            conn[field] = serde_json::Value::String(rewrapped);
        }
    }
    Ok(())
}

/// 재암호화된 문서를 원자적으로 발행한다 — create-time 0600 임시 파일에 쓰고
/// `fsync` 한 뒤 rename. `storage::mod.rs` 의 `save_storage_raw()` 와 같은 절차다.
/// rename 이 성공하기 전에는 원본이 한 바이트도 안 바뀐다.
fn publish_connections_atomically(
    data_dir: &Path,
    doc: &serde_json::Value,
) -> Result<(), AppError> {
    let path = connections_path(data_dir);
    let tmp_path = rekey_tmp_path(data_dir);
    let json = serde_json::to_string_pretty(doc)?;

    // 앞선 부팅의 잔재를 먼저 회수한다. `create_new` 로 열어야 mode(0600) 이 실제로
    // 걸린다 — 이미 있는 파일을 열면 그 파일의 permission 이 그대로 쓰인다.
    let _ = fs::remove_file(&tmp_path);
    {
        let mut opts = fs::OpenOptions::new();
        opts.create_new(true).write(true);
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

    if let Err(e) = fs::rename(&tmp_path, &path) {
        let _ = fs::remove_file(&tmp_path); // best-effort: leave no orphan
        return Err(e.into());
    }
    Ok(())
}

/// #1814 — 디스크 노출을 거친 file-key 를 폐기하고 새 키로 갈아탄다.
///
/// 진입 조건은 「keyring 에 키가 있는데 디스크 `.key` 도 있다」 하나다. 별도 마커를
/// 두지 않는 이유는 디스크 `.key` 의 존재 자체가 노출의 증거이기 때문이다. 사용자
/// confirm 없이 자동으로 수행한다 (2026-07-25 오너 결정).
///
/// 3단계: ① 새 키 생성 → keyring 덮어쓰기 ② `connections.json` 재암호화 → 임시
/// 파일 → atomic rename ③ 디스크 `.key` secure delete.
///
/// **복구 앵커** — ① 이 keyring 의 구 키를 덮어쓰므로, 그 구 키가 유일본이면 ①과
/// ② 사이의 crash 가 모든 password 를 복구 불가로 만든다. 그래서 ① 앞에서 「현재
/// 암호문을 여는 키가 디스크 `.key` 에 있다」(또는 지킬 암호문이 아예 없다) 를
/// 확인하고, 아니면 재키잉을 시작하지 않는다. 그 조건이 서면 ①②③ 어디서 죽어도
/// 다음 부팅이 디스크 `.key` 로 복호화해 이어받는다.
fn rekey_after_disk_exposure<B: KeyringBackend>(
    backend: &B,
    data_dir: &Path,
    disk_path: &Path,
    keyring_key: Vec<u8>,
) -> Result<KeyOutcome, AppError> {
    let from_keyring = |key: Vec<u8>, rekeyed: bool| KeyOutcome {
        key,
        source: KeySource::FromKeyring,
        fallback_to_disk: false,
        rekeyed_after_disk_exposure: rekeyed,
    };

    // 읽히지 않는 `.key` — secure delete 도중 죽어 zero-overwrite 만 된 잔재 —
    // 는 앵커가 못 된다.
    let disk_key = read_disk_key(disk_path).ok();

    let mut doc = match read_connections_doc(data_dir)? {
        ConnectionsDoc::Corrupt => {
            // 격리 전이라 어느 키가 맞는지 판정할 수 없다. 아무것도 지우지 않고
            // 다음 부팅으로 넘긴다 (`load_storage_raw()` 가 격리한 뒤 재시도된다).
            warn!(
                target: "boot",
                "key_migration: rekey deferred — connections.json does not parse; leaving the disk .key in place"
            );
            return Ok(from_keyring(keyring_key, false));
        }
        ConnectionsDoc::Absent => None,
        ConnectionsDoc::Parsed(value) if !has_secrets(&value) => None,
        ConnectionsDoc::Parsed(value) => Some(value),
    };

    // 현재 암호문을 여는 키. 디스크 `.key` 를 먼저 물어보는 이유는 그게 앵커이기
    // 때문이다 — 노출 시나리오에서는 keyring 키와 같은 값인 경우가 대부분이다.
    let current = match doc.as_ref() {
        None => keyring_key.clone(),
        Some(parsed) => match disk_key
            .as_ref()
            .filter(|k| secrets_decrypt_under(parsed, k))
        {
            Some(anchor) => anchor.clone(),
            None if secrets_decrypt_under(parsed, &keyring_key) => {
                // 디스크 `.key` 는 현재 암호문과 무관한 잔재다 (예: 재키잉이
                // rename 까지 끝내고 secure delete 전에 죽은 부팅이 남긴 구 키).
                // 갈아탈 대상이 없으니 잔재만 치운다.
                if let Err(e) = secure_delete(disk_path) {
                    warn!(target: "boot", "key_migration: stale disk .key cleanup failed: {e}");
                }
                return Ok(from_keyring(keyring_key, false));
            }
            None => {
                // 어느 키로도 안 열린다. 여기서 무엇이든 지우면 복구 가능성만
                // 줄어든다 — 둘 다 보존하고 아무것도 하지 않는다.
                warn!(
                    target: "boot",
                    "key_migration: rekey skipped — neither the keyring key nor the disk .key decrypts connections.json; preserving both"
                );
                return Ok(from_keyring(keyring_key, false));
            }
        },
    };
    // 이 지점의 불변식: 지킬 암호문이 있다면 `current` 는 디스크 `.key` 안에 그대로
    // 남아 있다. 아래 ①이 keyring 을 덮어써도 복구가 가능한 근거다.

    // ① 새 키 생성 → keyring 덮어쓰기 + readback 검증.
    let new_key = Aes256Gcm::generate_key(aes_gcm::aead::OsRng)
        .as_slice()
        .to_vec();
    if let Err(e) = backend.set(KEYRING_ENTRY_NAME, &new_key) {
        warn!(
            target: "boot",
            "key_migration: rekey step 1 keyring write failed ({e}); disk .key preserved, retrying next boot"
        );
        return Ok(from_keyring(current, false));
    }
    match backend.get(KEYRING_ENTRY_NAME)? {
        Some(stored) if stored == new_key => {}
        _ => {
            warn!(
                target: "boot",
                "key_migration: rekey step 1 keyring readback mismatch; disk .key preserved, retrying next boot"
            );
            return Ok(from_keyring(current, false));
        }
    }

    // ② connections.json 재암호화 → 임시 파일 → atomic rename.
    if let Some(parsed) = doc.as_mut() {
        if let Err(e) = reencrypt_secrets(parsed, &current, &new_key)
            .and_then(|()| publish_connections_atomically(data_dir, parsed))
        {
            warn!(
                target: "boot",
                "key_migration: rekey step 2 re-encrypt failed ({e}); connections.json untouched and disk .key preserved, retrying next boot"
            );
            return Ok(from_keyring(current, false));
        }
    }

    // ③ 디스크 `.key` secure delete. 실패해도 남은 파일은 이제 아무 암호문도 못
    // 여는 잔재이고, 다음 부팅이 같은 경로에서 다시 치운다.
    if let Err(e) = secure_delete(disk_path) {
        warn!(
            target: "boot",
            "key_migration: rekey step 3 secure delete failed ({e}); the leftover .key no longer opens anything, retrying next boot"
        );
    }

    info!(
        target: "boot",
        "key_migration: rekeyed after disk exposure — new key published to the keyring, connections.json re-encrypted, disk .key retired"
    );
    Ok(from_keyring(new_key, true))
}

/// Path B (c) probe — `connections.json` 의 모든 secret 암호문이 `key` 로 풀리는가.
/// Ok 인 경우는 셋이다: 파일 부재, 파일은 있지만 비어있지 않은 secret 이 없음,
/// 전부 복호화 성공. 첫 실패에서 Err.
///
/// 판정 대상은 `SECRET_FIELDS` 전체다 — 재키잉·orphan 가드가 지키는 집합과 같아야
/// 한다. `password` 만 훑던 동안 secret 이 `wallet_password` 뿐인 프로필은 probe 를
/// 헛통과해 (d) secure delete 까지 갔다 (#2124). 같은 집합을 도는
/// `secrets_decrypt_under` 대신 여기서 직접 도는 이유는 실패 사유를 보존하기
/// 위해서다 — 호출자가 그 문자열을 boot WARN 에 싣는다.
fn validate_ciphertexts_decrypt(data_dir: &Path, key: &[u8]) -> Result<(), AppError> {
    let ConnectionsDoc::Parsed(doc) = read_connections_doc(data_dir)? else {
        // 파일 부재, 또는 Corrupt — 후자는 `load_storage_raw()` 가 다음 호출에서
        // 격리한다. 이 step 이 검증할 암호문이 없으니 migration 을 막지 않는다.
        return Ok(());
    };
    for enc in secret_values(&doc) {
        crate::storage::crypto::decrypt(enc, key)
            .map_err(|e| AppError::Encryption(format!("Ciphertext probe decrypt failed: {e}")))?;
    }
    Ok(())
}

/// 디스크에 ciphertext 가 있고 key 가 사라진 fatal 케이스 판정. AC-356-09.
/// `crypto::get_or_create_key` (#1093 orphan guard) 도 같은 신호를 재사용한다.
///
/// 판정 대상은 `SECRET_FIELDS` 전체다 — 재키잉이 지키는 집합과 같아야 한다.
/// `password` 만 훑던 동안 secret 이 `wallet_password` 뿐인 Oracle 프로필은
/// 「지킬 암호문 없음」으로 판정돼 Path A 가 새 키를 찍었고, 그 순간 wallet
/// 암호문이 영구 복호화 불가가 됐다 (#2111).
pub(crate) fn data_has_password_ciphertext(data_dir: &Path) -> Result<bool, AppError> {
    Ok(match read_connections_doc(data_dir)? {
        // Corrupt 는 판정 근거가 없다 — `load_storage_raw()` 가 다음 호출에서
        // 격리한다. 여기서 true 를 내면 부팅이 safe mode 에 갇힌다.
        ConnectionsDoc::Absent | ConnectionsDoc::Corrupt => false,
        ConnectionsDoc::Parsed(doc) => has_secrets(&doc),
    })
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

/// Publish the master key to `path` and return the key that actually landed on
/// disk (#1620 F3). Delegates to `crypto::create_key_file`, which writes to a
/// temp file with create-time 0600, `fsync`s, then publishes via an exclusive
/// `hard_link` — so a crash never leaves a truncated key and two concurrent
/// Linux-fallback boots can't clobber each other. On such a race the loser's
/// `create_key_file` is a no-op (the path already exists), so we re-read and
/// return the winning on-disk key; the caller must encrypt under *that* key,
/// never its own generated bytes, or it would orphan its ciphertext. Mirrors
/// `crypto::get_or_create_key`'s post-create re-read. Supersedes the earlier
/// single-syscall 0600 create (#1554), which lacked fsync + atomic publish.
fn write_disk_key(path: &Path, key: &[u8]) -> Result<Vec<u8>, AppError> {
    create_key_file(path, key)?;
    read_disk_key(path)
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

    // Reason (2026-07-24, 이슈 #1625): 3 path helper 테스트는 `(fn, 기대
    // 파일명)` 만 다른 반복 (testing-scenarios P9) — table-driven 으로 회수.
    // 모든 helper 가 data_dir 를 parent 로 유지하고 고정 파일명을 붙이는
    // 계약을 값 보존하며 단언한다.
    #[test]
    fn path_helpers_join_expected_filename_under_data_dir() {
        type PathBuilder = fn(&Path) -> PathBuf;
        let dir = TempDir::new().unwrap();
        let cases: [(PathBuilder, &str); 3] = [
            (disk_key_path, ".key"),
            (migration_failed_sentinel_path, ".key.migration-failed"),
            (
                fallback_dismissed_sentinel_path,
                ".keyring-fallback-dismissed",
            ),
        ];
        for (build, expected) in cases {
            let path = build(dir.path());
            assert_eq!(
                path.file_name().and_then(|s| s.to_str()),
                Some(expected),
                "unexpected filename"
            );
            assert_eq!(path.parent(), Some(dir.path()));
        }
    }

    // ---------------- helper: validate_key_len ----------------

    // Reason (2026-07-24, 이슈 #1625): accept-32 / reject-16 / reject-empty 3개는
    // 입력만 다른 반복 (testing-scenarios P9) — table-driven. Err 케이스는
    // `Encryption` variant + 기대(32)/실제 길이가 메시지에 실리는 계약까지
    // 단언(단순 is_err 강화). 경계값 32/16/0 보존.
    #[test]
    fn validate_key_len_enforces_32_byte_contract() {
        // key → None = expect Ok; Some(parts) = expect Err(Encryption) whose
        // message contains every substring in `parts`.
        let cases: [(Vec<u8>, Option<Vec<&str>>); 3] = [
            (vec![0u8; 32], None),
            (vec![0u8; 16], Some(vec!["32", "16"])),
            (vec![], Some(vec!["32", "0"])),
        ];
        for (key, expected) in &cases {
            match (validate_key_len(key), expected) {
                (Ok(()), None) => {}
                (Err(AppError::Encryption(msg)), Some(parts)) => {
                    for p in parts {
                        assert!(
                            msg.contains(p),
                            "len {}: msg {msg:?} missing {p:?}",
                            key.len()
                        );
                    }
                }
                (got, _) => panic!("len {}: unexpected result {got:?}", key.len()),
            }
        }
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
        let returned = write_disk_key(&path, &key).unwrap();
        assert!(path.exists());
        assert_eq!(returned, key, "returns the key it published");
        let got = read_disk_key(&path).unwrap();
        assert_eq!(got, key);
    }

    // Reason (#1620 F3) — write_disk_key now publishes via
    // crypto::create_key_file's exclusive hard_link instead of a plain
    // create+truncate+write, so a second write on an existing path must NOT
    // clobber the first key and must return the winning on-disk key. The old
    // implementation truncated and overwrote, which would let a concurrent
    // Linux-fallback boot orphan ciphertext encrypted under the loser's key
    // (2026-07-17).
    #[test]
    fn write_disk_key_second_write_preserves_first_key() {
        let dir = TempDir::new().unwrap();
        let path = disk_key_path(dir.path());
        let key_a: Vec<u8> = (0..32u8).collect();
        let key_b: Vec<u8> = (100..132u8).collect();

        let returned_a = write_disk_key(&path, &key_a).unwrap();
        assert_eq!(returned_a, key_a);

        // Second publish loses the race: disk + return value stay key_a.
        let returned_b = write_disk_key(&path, &key_b).unwrap();
        assert_eq!(returned_b, key_a, "second write must not clobber the first");
        assert_eq!(read_disk_key(&path).unwrap(), key_a);
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

    /// #2124 — Path B 의 (c) probe 가 `conn.get("password")` 만 읽던 동안, secret 이
    /// `wallet_password` 뿐인 프로필은 「검증할 암호문 없음」으로 probe 를 헛통과해
    /// (d) secure delete 까지 갔다. 디스크 `.key` 로 안 열리는 암호문이 하나라도
    /// 있으면 probe 는 fail-closed 여야 한다 — 디스크 `.key` 보존 + sentinel.
    #[test]
    fn migrate_path_b_wallet_only_ciphertext_failing_probe_preserves_disk_key() {
        let dir = TempDir::new().unwrap();
        let disk_key: Vec<u8> = (0..32u8).collect();
        // 이 프로필의 wallet 암호문은 이 머신 어디에도 없는 키로 감싸여 있다 —
        // 디스크 `.key` 를 그대로 이주시켜도 데이터는 안 열린다.
        let lost_key: Vec<u8> = (200..232u8).collect();
        seed_disk_key(dir.path(), &disk_key);
        let doc = serde_json::json!({
            "connections": [{
                "id": "c1",
                "password": "",
                "wallet_password": encrypt("wallet-pw", &lost_key).unwrap(),
            }],
            "groups": [],
        });
        fs::write(dir.path().join("connections.json"), doc.to_string()).unwrap();
        let backend = InMemoryKeyringBackend::new_available();

        let outcome =
            migrate_or_initialize(&backend, dir.path()).expect("a failed probe must not fail boot");

        assert_eq!(outcome.source, KeySource::DiskFallback);
        assert!(outcome.fallback_to_disk);
        let disk_path = disk_key_path(dir.path());
        assert!(
            disk_path.exists(),
            "a wallet-password-only profile must not walk the probe into the secure delete"
        );
        assert_eq!(
            read_disk_key(&disk_path).unwrap(),
            disk_key,
            "the preserved .key must be intact, not zero-overwritten"
        );
        assert!(
            migration_failed_sentinel_path(dir.path()).exists(),
            "the next boot needs the retry marker"
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

    /// #2111 — 같은 AC-356-09 인데 secret 이 `wallet_password` 뿐인 Oracle 프로필.
    /// 가드가 `password` 필드만 훑던 동안 이 프로필은 「지킬 암호문 없음」으로
    /// 판정돼 Path A 가 새 키를 찍었고, 그 순간 wallet 암호문은 영구 복호화
    /// 불가가 됐다. `SECRET_FIELDS` 전체를 봐야 보존 경로(Fatal)로 간다.
    #[test]
    fn migrate_fatal_when_only_wallet_password_ciphertext_survives_key_loss() {
        let dir = TempDir::new().unwrap();
        let lost_key: Vec<u8> = (0..32u8).rev().collect();
        let enc = encrypt("wallet-secret", &lost_key).unwrap();
        fs::write(
            dir.path().join("connections.json"),
            serde_json::json!({
                "connections": [{ "id": "c1", "password": "", "wallet_password": enc }],
            })
            .to_string(),
        )
        .unwrap();
        let backend = InMemoryKeyringBackend::new_available();

        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();

        assert!(
            outcome.is_fatal(),
            "a wallet-password-only profile must not be treated as having nothing to protect"
        );
        assert_eq!(outcome.source, KeySource::Fatal);
        assert!(outcome.key.is_empty(), "fatal must not carry a key");
        assert!(
            backend.dump().is_empty(),
            "Path A must not mint a key that orphans the wallet ciphertext"
        );
        assert!(!disk_key_path(dir.path()).exists());
    }

    // ---------------- #1814 재키잉 — 실패 시 원본 보존 ----------------

    /// 재암호화가 실패하면 원본 `connections.json` 은 한 바이트도 안 바뀌고
    /// 디스크 `.key` 도 남는다 (복구 앵커). 이번 부팅은 구 키로 계속 동작하고
    /// 다음 부팅이 앵커를 보고 재키잉을 다시 시도한다.
    ///
    /// 실패 주입: 재암호화가 쓰는 임시 파일 자리를 디렉토리로 막는다.
    #[test]
    fn rekey_reencrypt_failure_preserves_connections_json_and_anchor() {
        let dir = TempDir::new().unwrap();
        let exposed_key: Vec<u8> = (0..32u8).collect();
        seed_disk_key(dir.path(), &exposed_key);
        let enc = encrypt("secret-pw", &exposed_key).unwrap();
        let doc = serde_json::json!({
            "connections": [{ "id": "c1", "password": enc, "wallet_password": "" }],
            "groups": [],
        });
        let conn_path = dir.path().join("connections.json");
        fs::write(&conn_path, serde_json::to_string_pretty(&doc).unwrap()).unwrap();
        let before = fs::read(&conn_path).unwrap();

        fs::create_dir(rekey_tmp_path(dir.path())).unwrap();

        let backend = InMemoryKeyringBackend::new_available();
        backend.set(KEYRING_ENTRY_NAME, &exposed_key).unwrap();

        let outcome = migrate_or_initialize(&backend, dir.path())
            .expect("a failed rekey must not fail the boot");

        assert!(!outcome.rekeyed_after_disk_exposure);
        assert_eq!(
            fs::read(&conn_path).unwrap(),
            before,
            "a failed re-encrypt must leave connections.json byte-identical"
        );
        assert_eq!(
            outcome.key, exposed_key,
            "this boot keeps working under the key the ciphertext is already under"
        );
        assert!(
            disk_key_path(dir.path()).exists(),
            "the recovery anchor must survive a failed rekey"
        );
        assert_ne!(
            backend.get(KEYRING_ENTRY_NAME).unwrap().unwrap(),
            exposed_key,
            "step ① already published the new key; the anchor is what makes that recoverable"
        );
    }

    /// 성공한 재키잉은 flag 를 세우고 임시 파일을 남기지 않는다.
    #[test]
    fn rekey_reports_the_flag_and_leaves_no_temp_file() {
        let dir = TempDir::new().unwrap();
        let exposed_key: Vec<u8> = (0..32u8).collect();
        seed_disk_key(dir.path(), &exposed_key);
        let doc = serde_json::json!({
            "connections": [{
                "id": "c1",
                "password": encrypt("db-pw", &exposed_key).unwrap(),
                "wallet_password": encrypt("wallet-pw", &exposed_key).unwrap(),
            }],
            "groups": [],
        });
        fs::write(dir.path().join("connections.json"), doc.to_string()).unwrap();
        let backend = InMemoryKeyringBackend::new_available();
        backend.set(KEYRING_ENTRY_NAME, &exposed_key).unwrap();

        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();

        assert!(outcome.rekeyed_after_disk_exposure);
        assert_ne!(outcome.key, exposed_key);
        assert!(
            !rekey_tmp_path(dir.path()).exists(),
            "the rekey temp file must not survive the boot"
        );
        assert!(!disk_key_path(dir.path()).exists());
    }

    /// 재키잉하지 않은 부팅은 flag 를 세우지 않는다 — 디스크 `.key` 가 없는
    /// 평범한 keyring hit.
    #[test]
    fn keyring_hit_without_disk_key_does_not_report_a_rekey() {
        let dir = TempDir::new().unwrap();
        let key: Vec<u8> = (0..32u8).collect();
        let backend = InMemoryKeyringBackend::new_available();
        backend.set(KEYRING_ENTRY_NAME, &key).unwrap();

        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();

        assert_eq!(outcome.key, key);
        assert!(!outcome.rekeyed_after_disk_exposure);
    }

    /// 어느 키로도 안 열리는 암호문 앞에서는 아무것도 파괴하지 않는다. 지우면
    /// 복구 가능성만 줄어든다 (fail-closed).
    #[test]
    fn rekey_preserves_everything_when_no_key_decrypts() {
        let dir = TempDir::new().unwrap();
        let disk_only: Vec<u8> = (0..32u8).collect();
        let keyring_only: Vec<u8> = (50..82u8).collect();
        let lost_key: Vec<u8> = (100..132u8).collect();
        seed_disk_key(dir.path(), &disk_only);
        let doc = serde_json::json!({
            "connections": [{ "id": "c1", "password": encrypt("pw", &lost_key).unwrap() }],
            "groups": [],
        });
        fs::write(dir.path().join("connections.json"), doc.to_string()).unwrap();
        let before = fs::read(dir.path().join("connections.json")).unwrap();
        let backend = InMemoryKeyringBackend::new_available();
        backend.set(KEYRING_ENTRY_NAME, &keyring_only).unwrap();

        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();

        assert!(!outcome.rekeyed_after_disk_exposure);
        assert_eq!(outcome.key, keyring_only);
        assert!(
            disk_key_path(dir.path()).exists(),
            "an unreadable ciphertext is no reason to destroy a key"
        );
        assert_eq!(
            backend.get(KEYRING_ENTRY_NAME).unwrap().unwrap(),
            keyring_only,
            "the keyring entry must not be overwritten when the rekey cannot start"
        );
        assert_eq!(
            fs::read(dir.path().join("connections.json")).unwrap(),
            before
        );
    }

    /// `connections.json` 이 파싱되지 않으면 어느 키가 맞는지 판정할 수 없다.
    /// 격리(`load_storage_raw()`) 뒤 다음 부팅으로 미룬다.
    #[test]
    fn rekey_defers_when_connections_json_is_corrupt() {
        let dir = TempDir::new().unwrap();
        let exposed_key: Vec<u8> = (0..32u8).collect();
        seed_disk_key(dir.path(), &exposed_key);
        fs::write(dir.path().join("connections.json"), "{ not json").unwrap();
        let backend = InMemoryKeyringBackend::new_available();
        backend.set(KEYRING_ENTRY_NAME, &exposed_key).unwrap();

        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();

        assert!(!outcome.rekeyed_after_disk_exposure);
        assert_eq!(outcome.key, exposed_key);
        assert!(
            disk_key_path(dir.path()).exists(),
            "the anchor must stay until the corrupt file is quarantined"
        );
        assert_eq!(
            backend.get(KEYRING_ENTRY_NAME).unwrap().unwrap(),
            exposed_key
        );
    }

    // ---------------- KeyOutcome helper ----------------

    #[test]
    fn key_outcome_is_fatal_matches_fatal_source_only() {
        let fatal = KeyOutcome {
            key: Vec::new(),
            source: KeySource::Fatal,
            fallback_to_disk: false,
            rekeyed_after_disk_exposure: false,
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
                rekeyed_after_disk_exposure: false,
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
