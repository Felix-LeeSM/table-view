//! 작성 2026-05-16 (Phase 1 sprint-356)
//!
//! AC-356-02 / AC-356-03 / AC-356-04 / AC-356-07 / AC-356-08 — Path B
//! (디스크 `.key` → keyring 이주). 본 파일은 migration path 의 happy
//! case + idempotency + 실패 fallback + envelope decrypt 검증 + readback
//! byte equality 를 모두 한 binary 로 단언한다 (cargo 의 test binary
//! cold-start 비용 절감).
//!
//! 핵심 invariants:
//!   - 이주 후 디스크 `.key` 가 사라진다 (secure delete: zero overwrite +
//!     0o000 mode + unlink).
//!   - keyring 에 같은 32-byte key 가 들어있다.
//!   - 같은 user-data dir 에서 두 번째 boot 는 keyring 만 read (디스크
//!     touch 0).
//!   - keyring write 가 실패하면 sentinel `.key.migration-failed` 가
//!     생기고 디스크 .key 는 그대로 살아남는다 (decrypt 는 disk fallback).
//!   - 이주 후 `connections.json` 의 모든 `password_enc` 가 새 key 로
//!     decrypt 된다 (envelope 호환).
//!
//! 2026-08-01 (#1814) 추가 — 디스크 `.key` 를 거친 키는 keyring 이 돌아왔을 때
//! 그대로 살리지 않고 새 키로 갈아탄다 (재키잉). 파일 아래쪽 「#1814」 절이
//! 재키잉 자체와 중단 지점 3곳의 다음 부팅 복구를 단언한다.
//!
//! 2026-08-02 (#1815) 추가 — 위 invariant 목록 중 실제로 단언되지 않던 셋을
//! 파일 아래쪽 「#1815」 절이 메운다: ciphertext probe 실패의 fail-closed,
//! sentinel 이 다음 부팅에서 회수되는 재시도 계약, 그리고 secure delete 가
//! unlink 전에 실제로 바이트를 덮어썼는지. 셋 다 `KeyOutcome` 이 아니라
//! 파일시스템에 남은 상태로만 판별된다.

use std::fs;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tempfile::TempDir;

use table_view_lib::models::StorageData;
use table_view_lib::storage::crypto::{
    decrypt, encrypt, InMemoryKeyringBackend, KeyringBackend, KEYRING_ENTRY_NAME,
};
use table_view_lib::storage::key_migration::{
    disk_key_path, fallback_dismissed_sentinel_path, migrate_or_initialize,
    migration_failed_sentinel_path, KeySource,
};

/// Helper: seed `.key` with a fixed 32-byte key (base64).
fn seed_disk_key(data_dir: &Path, key: &[u8]) {
    let path = disk_key_path(data_dir);
    fs::write(&path, BASE64.encode(key)).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    }
}

/// Helper: seed `connections.json` with N password_enc entries encrypted
/// under `key`. Empty input passwords are stored as empty ciphertext (the
/// "no password set" sentinel that `storage::save_connection` writes). Used
/// by AC-356-08.
fn seed_connections_json(data_dir: &Path, key: &[u8], passwords: &[&str]) {
    let mut connections = Vec::new();
    for (idx, pw) in passwords.iter().enumerate() {
        let pw_enc = if pw.is_empty() {
            String::new()
        } else {
            encrypt(pw, key).unwrap()
        };
        connections.push(serde_json::json!({
            "id": format!("c{idx}"),
            "name": format!("DB-{idx}"),
            "dbType": "Postgresql",
            "host": "localhost",
            "port": 5432,
            "user": "u",
            "password": pw_enc,
            "database": "d",
        }));
    }
    let doc = serde_json::json!({
        "connections": connections,
        "groups": [],
    });
    fs::write(
        data_dir.join("connections.json"),
        serde_json::to_string_pretty(&doc).unwrap(),
    )
    .unwrap();
}

// --------------------- AC-356-02 ---------------------------------------

#[test]
fn ac_356_02_path_b_migrates_disk_key_into_keyring_and_secure_deletes() {
    let dir = TempDir::new().unwrap();
    let original_key: Vec<u8> = (0..32u8).collect();
    seed_disk_key(dir.path(), &original_key);
    let backend = InMemoryKeyringBackend::new_available();

    // Precondition.
    let disk_path = disk_key_path(dir.path());
    assert!(disk_path.exists(), "precondition: disk .key seeded");
    assert!(
        backend.get(KEYRING_ENTRY_NAME).unwrap().is_none(),
        "precondition: empty keyring"
    );

    // Action: first boot.
    let outcome = migrate_or_initialize(&backend, dir.path()).expect("Path B must succeed");

    // Postcondition: same key in keyring, disk .key gone.
    assert_eq!(outcome.key, original_key);
    assert_eq!(outcome.source, KeySource::MigratedFromDisk);
    assert!(!outcome.fallback_to_disk);
    assert!(
        !disk_path.exists(),
        "Path B success: disk .key must be secure-deleted (unlinked)"
    );
    let stored = backend
        .get(KEYRING_ENTRY_NAME)
        .unwrap()
        .expect("keyring set");
    assert_eq!(
        stored, original_key,
        "AC-356-07 byte equality after migration"
    );

    // No failure sentinel.
    assert!(
        !migration_failed_sentinel_path(dir.path()).exists(),
        "success path must NOT leave .key.migration-failed sentinel"
    );
}

// --------------------- AC-356-03 ---------------------------------------

#[test]
fn ac_356_03_path_b_idempotent_second_boot_reads_keyring_only() {
    let dir = TempDir::new().unwrap();
    let original_key: Vec<u8> = (0..32u8).collect();
    seed_disk_key(dir.path(), &original_key);
    let backend = InMemoryKeyringBackend::new_available();

    // First boot: migrates.
    let first = migrate_or_initialize(&backend, dir.path()).unwrap();
    assert_eq!(first.source, KeySource::MigratedFromDisk);
    assert!(!disk_key_path(dir.path()).exists());

    // Second boot: keyring hit, disk untouched (it's already absent).
    let second = migrate_or_initialize(&backend, dir.path()).unwrap();
    assert_eq!(second.source, KeySource::FromKeyring);
    assert_eq!(second.key, original_key);
    assert!(!second.fallback_to_disk);
}

// --------------------- AC-356-04 ---------------------------------------

#[test]
fn ac_356_04_path_b_write_failure_leaves_sentinel_and_preserves_disk() {
    let dir = TempDir::new().unwrap();
    let original_key: Vec<u8> = (0..32u8).collect();
    seed_disk_key(dir.path(), &original_key);
    let backend = InMemoryKeyringBackend::new_available();
    // Simulate keyring write failure (write-protected backend / NoEntry race).
    backend.set_set_should_fail(true);

    let outcome = migrate_or_initialize(&backend, dir.path()).expect("failure must not panic");

    // Sentinel created.
    assert!(
        migration_failed_sentinel_path(dir.path()).exists(),
        "AC-356-04: .key.migration-failed sentinel must exist after write failure"
    );
    // Disk .key preserved (decrypt fallback).
    assert!(
        disk_key_path(dir.path()).exists(),
        "AC-356-04: disk .key must be preserved after migration failure"
    );
    // Outcome reflects disk fallback so decrypt still works this boot.
    assert_eq!(outcome.source, KeySource::DiskFallback);
    assert!(outcome.fallback_to_disk);
    assert_eq!(outcome.key, original_key);
    // Keyring is empty (write failed).
    assert!(backend.get(KEYRING_ENTRY_NAME).unwrap().is_none());
}

// --------------------- AC-356-08 ---------------------------------------

#[test]
fn ac_356_08_envelope_decrypts_after_migration_for_all_passwords() {
    let dir = TempDir::new().unwrap();
    let original_key: Vec<u8> = (10..42u8).collect(); // 32 bytes, distinct values
    seed_disk_key(dir.path(), &original_key);
    let long_pw = "very-long-".repeat(8);
    let passwords = ["alpha", "βeta-2", "γ密码🔐", long_pw.as_str(), ""];
    seed_connections_json(dir.path(), &original_key, &passwords);

    let backend = InMemoryKeyringBackend::new_available();
    let outcome = migrate_or_initialize(&backend, dir.path()).expect("migration must succeed");
    assert_eq!(outcome.source, KeySource::MigratedFromDisk);

    // Re-read connections.json and decrypt every non-empty password under
    // the migrated key.
    let raw = fs::read_to_string(dir.path().join("connections.json")).unwrap();
    let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let conns = doc["connections"].as_array().unwrap();
    assert_eq!(conns.len(), passwords.len());

    for (idx, expected) in passwords.iter().enumerate() {
        let pw_enc = conns[idx]["password"].as_str().unwrap();
        if expected.is_empty() {
            assert_eq!(pw_enc, "", "empty password must stay empty after migration");
            continue;
        }
        let plain =
            table_view_lib::storage::crypto::decrypt(pw_enc, &outcome.key).unwrap_or_else(|e| {
                panic!("decrypt failed for password #{idx} ('{expected}') after migration: {e}")
            });
        assert_eq!(&plain, expected, "decrypt round-trip mismatch at idx {idx}");
    }

    // Sanity: no fallback sentinels written.
    assert!(!fallback_dismissed_sentinel_path(dir.path()).exists());
    assert!(!migration_failed_sentinel_path(dir.path()).exists());
}

// --------------------- AC-356-07 (extra explicit) ---------------------

#[test]
fn ac_356_07_keyring_write_readback_byte_equality_in_path_a() {
    // Path A (Generated) covers AC-356-07 too: set then immediate get must
    // round-trip the bytes. We run a dedicated check so a regression that
    // only breaks idempotency in Path A (without affecting Path B) is
    // still caught.
    let dir = TempDir::new().unwrap();
    let backend = InMemoryKeyringBackend::new_available();
    let outcome = migrate_or_initialize(&backend, dir.path()).expect("Path A must succeed");
    assert_eq!(outcome.source, KeySource::Generated);
    let stored = backend
        .get(KEYRING_ENTRY_NAME)
        .unwrap()
        .expect("keyring set");
    assert_eq!(stored, outcome.key, "AC-356-07 byte equality after Path A");
    assert_eq!(stored.len(), 32);
}

// --------------------- #1814 재키잉 ------------------------------------
//
// Path C 는 file-key 를 디스크 `.key` 평문으로 떨어뜨린다. keyring 이 돌아온
// 부팅에서 그 키를 그대로 살리면 디스크 사본을 가진 쪽이 계속 모든 password 를
// 푼다. 그래서 「keyring hit + 디스크 `.key` 존재」 부팅은 새 키로 갈아탄다:
//   ① 새 키 생성 → keyring 덮어쓰기
//   ② `connections.json` 재암호화 → 임시 파일 → atomic rename
//   ③ 디스크 `.key` secure delete
// 디스크 `.key` 가 복구 앵커다 — ①/②/③ 어디서 죽어도 다음 부팅이 이어받는다.

/// `connections.json` 을 실제 on-disk 모양으로 seed 한다. `ConnectionConfig`
/// 에는 `rename_all` 이 없어 저장 key 가 snake_case 이고, master key 로 감싸이는
/// 필드는 `password` 와 `wallet_password` 둘이다 (`storage::mod.rs` 의 `resolve`
/// 가 유일한 `crypto::encrypt` 호출자다). 재키잉은 둘 다 갈아입혀야 한다.
fn conn_json(id: &str, password: &str, wallet_password: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": format!("DB-{id}"),
        "db_type": "postgresql",
        "host": "localhost",
        "port": 5432,
        "user": "u",
        "password": password,
        "database": "d",
        "group_id": null,
        "color": null,
        "wallet_password": wallet_password,
    })
}

const SECRET_PW: &str = "db-secret-0";
const SECRET_WALLET: &str = "wallet-secret-0";

/// secret 이 있는 연결 1개 + secret 이 없는 연결 1개를 `key` 로 암호화해 seed.
fn seed_secret_connections(data_dir: &Path, key: &[u8]) {
    let doc = serde_json::json!({
        "connections": [
            conn_json(
                "c0",
                &encrypt(SECRET_PW, key).unwrap(),
                &encrypt(SECRET_WALLET, key).unwrap(),
            ),
            conn_json("c1", "", ""),
        ],
        "groups": [],
    });
    fs::write(
        data_dir.join("connections.json"),
        serde_json::to_string_pretty(&doc).unwrap(),
    )
    .unwrap();
}

fn read_doc(data_dir: &Path) -> serde_json::Value {
    let raw = fs::read_to_string(data_dir.join("connections.json")).unwrap();
    serde_json::from_str(&raw).expect("connections.json must stay valid JSON")
}

/// 두 secret 이 `key` 로 풀리고 평문이 보존됐는지, 빈 secret 은 빈 채인지,
/// 그리고 파일이 여전히 `StorageData` 로 역직렬화되는지 단언한다.
fn assert_secrets_readable_under(data_dir: &Path, key: &[u8]) {
    let raw = fs::read_to_string(data_dir.join("connections.json")).unwrap();
    serde_json::from_str::<StorageData>(&raw)
        .expect("rekey must preserve the connections.json schema");
    let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let conns = doc["connections"].as_array().unwrap();
    assert_eq!(conns.len(), 2, "connection count must survive the rekey");
    assert_eq!(
        decrypt(conns[0]["password"].as_str().unwrap(), key).unwrap(),
        SECRET_PW
    );
    assert_eq!(
        decrypt(conns[0]["wallet_password"].as_str().unwrap(), key).unwrap(),
        SECRET_WALLET,
        "the Oracle wallet password rides the same envelope and must be rekeyed too"
    );
    assert_eq!(conns[1]["password"], "", "empty secret must stay empty");
    assert_eq!(conns[1]["wallet_password"], "");
}

/// 은퇴한 키로는 더 이상 아무것도 못 푼다 — 이 단언이 재키잉의 보안 목적이다.
fn assert_secrets_unreadable_under(data_dir: &Path, retired: &[u8]) {
    let doc = read_doc(data_dir);
    let conns = doc["connections"].as_array().unwrap();
    for field in ["password", "wallet_password"] {
        let enc = conns[0][field].as_str().unwrap();
        assert!(
            decrypt(enc, retired).is_err(),
            "{field}: the disk-exposed key must not decrypt anything after the rekey"
        );
    }
}

/// 디스크 노출을 거친 키는 keyring 이 돌아온 부팅에서 폐기된다. 이 상태는
/// Path B 가 keyring write 까지 성공하고 secure delete 전에 죽었을 때 남는다
/// (keyring 과 디스크에 같은 키).
#[test]
fn issue_1814_rekeys_when_keyring_returns_with_disk_key_present() {
    let dir = TempDir::new().unwrap();
    let exposed_key: Vec<u8> = (0..32u8).collect();
    seed_disk_key(dir.path(), &exposed_key);
    seed_secret_connections(dir.path(), &exposed_key);
    let backend = InMemoryKeyringBackend::new_available();
    backend.set(KEYRING_ENTRY_NAME, &exposed_key).unwrap();

    let outcome =
        migrate_or_initialize(&backend, dir.path()).expect("rekey must not fail the boot");

    assert!(
        outcome.rekeyed_after_disk_exposure,
        "the outcome must report that this boot rekeyed"
    );
    assert_ne!(
        outcome.key, exposed_key,
        "the disk-exposed key must be retired, not reused"
    );
    assert_eq!(outcome.key.len(), 32);
    assert_eq!(outcome.source, KeySource::FromKeyring);
    assert!(!outcome.fallback_to_disk);
    assert_eq!(
        backend.get(KEYRING_ENTRY_NAME).unwrap().unwrap(),
        outcome.key,
        "keyring must hold the new key"
    );
    assert!(
        !disk_key_path(dir.path()).exists(),
        "the plaintext .key must be secure-deleted once the rekey lands"
    );
    assert_secrets_readable_under(dir.path(), &outcome.key);
    assert_secrets_unreadable_under(dir.path(), &exposed_key);
}

/// 중단 지점 ① — 새 키가 keyring 에 들어간 직후 죽었다. 파일은 아직 구 키
/// 암호문이고 디스크 `.key` 가 구 키를 들고 있다. 다음 부팅은 앵커로 복구해
/// 재키잉을 끝내야 한다 (keyring 키로 복호화 실패 → 디스크 `.key` 재시도).
#[test]
fn issue_1814_crash_after_keyring_overwrite_recovers_on_next_boot() {
    let dir = TempDir::new().unwrap();
    let exposed_key: Vec<u8> = (0..32u8).collect();
    let half_written_key: Vec<u8> = (100..132u8).collect();
    seed_disk_key(dir.path(), &exposed_key);
    seed_secret_connections(dir.path(), &exposed_key);
    let backend = InMemoryKeyringBackend::new_available();
    backend.set(KEYRING_ENTRY_NAME, &half_written_key).unwrap();

    let outcome = migrate_or_initialize(&backend, dir.path()).expect("recovery must not fail boot");

    assert!(outcome.rekeyed_after_disk_exposure);
    assert_secrets_readable_under(dir.path(), &outcome.key);
    assert_ne!(outcome.key, exposed_key, "exposed key must stay retired");
    assert_eq!(
        backend.get(KEYRING_ENTRY_NAME).unwrap().unwrap(),
        outcome.key,
        "keyring and connections.json must agree after recovery"
    );
    assert!(
        !disk_key_path(dir.path()).exists(),
        "recovery must finish the rekey and drop the anchor"
    );
}

/// 중단 지점 ② — 재암호화 rename 까지 끝나고 죽었다. 파일도 keyring 도 새 키라
/// 정상이고, 남은 디스크 `.key` 는 아무것도 못 여는 잔재다. 다음 부팅은 데이터를
/// 그대로 읽을 수 있어야 한다.
#[test]
fn issue_1814_crash_after_reencrypt_rename_keeps_data_readable() {
    let dir = TempDir::new().unwrap();
    let retired_key: Vec<u8> = (0..32u8).collect();
    let live_key: Vec<u8> = (100..132u8).collect();
    seed_disk_key(dir.path(), &retired_key);
    seed_secret_connections(dir.path(), &live_key);
    let backend = InMemoryKeyringBackend::new_available();
    backend.set(KEYRING_ENTRY_NAME, &live_key).unwrap();

    let outcome = migrate_or_initialize(&backend, dir.path()).expect("boot must not fail");

    assert_secrets_readable_under(dir.path(), &outcome.key);
    assert_eq!(
        backend.get(KEYRING_ENTRY_NAME).unwrap().unwrap(),
        outcome.key
    );
    assert!(
        !outcome.rekeyed_after_disk_exposure,
        "the file is already under the keyring key; there is nothing left to rekey"
    );
}

/// 중단 지점 ③ — secure delete 직전에 죽었다 (②와 같은 on-disk 상태). 다음
/// 부팅이 남은 평문 `.key` 를 반드시 치운다. 이미 새 키로 재암호화된 파일을
/// 또 갈아입힐 이유는 없으므로 keyring 키는 그대로다.
#[test]
fn issue_1814_crash_before_secure_delete_removes_leftover_key_file() {
    let dir = TempDir::new().unwrap();
    let retired_key: Vec<u8> = (0..32u8).collect();
    let live_key: Vec<u8> = (100..132u8).collect();
    seed_disk_key(dir.path(), &retired_key);
    seed_secret_connections(dir.path(), &live_key);
    let backend = InMemoryKeyringBackend::new_available();
    backend.set(KEYRING_ENTRY_NAME, &live_key).unwrap();

    let outcome = migrate_or_initialize(&backend, dir.path()).expect("boot must not fail");

    assert!(
        !disk_key_path(dir.path()).exists(),
        "a leftover plaintext .key must never survive a healthy keyring boot"
    );
    assert_eq!(
        outcome.key, live_key,
        "the leftover .key opens nothing, so there is nothing to rekey away from"
    );
    assert!(!outcome.rekeyed_after_disk_exposure);
}

/// secure delete 도중 죽으면 `.key` 가 zero-overwrite 된 채 남는다 (base64 로
/// 디코드되지 않는다). 다음 부팅은 그 잔재에 걸려 넘어지지 않고 치워야 한다.
#[test]
fn issue_1814_unreadable_leftover_key_file_does_not_break_boot() {
    let dir = TempDir::new().unwrap();
    let live_key: Vec<u8> = (100..132u8).collect();
    seed_secret_connections(dir.path(), &live_key);
    fs::write(disk_key_path(dir.path()), vec![0u8; 44]).unwrap();
    let backend = InMemoryKeyringBackend::new_available();
    backend.set(KEYRING_ENTRY_NAME, &live_key).unwrap();

    let outcome =
        migrate_or_initialize(&backend, dir.path()).expect("a corrupt .key must not fail the boot");

    assert_secrets_readable_under(dir.path(), &outcome.key);
    assert!(!outcome.rekeyed_after_disk_exposure);
    assert!(
        !disk_key_path(dir.path()).exists(),
        "the zeroed .key residue must be removed"
    );
}

// --------------------- #1815 잔여 공백 -----------------------------------
//
// Path B 는 네 단계다 — (c) ciphertext probe, (a) keyring write, (b) readback,
// (d) secure delete (단계 이름은 설계 문서 것이고 위가 실행 순서다, #2138).
// (a) 의 실패만 `ac_356_04_*` 가 덮고 있었고, (c) 의 실패와 (d) 의 실제
// 덮어쓰기, 그리고 (a) 가 남긴 sentinel 을 다음 부팅이 회수하는 계약은
// 어디에서도 단언되지 않았다. 셋 다 반환값이 아니라 디스크에 남은 상태가
// 진실이라 통합 테스트에서만 판별된다.

/// (c) ciphertext probe 실패는 fail-closed 다 — 디스크 `.key` 로 열리지 않는
/// 암호문 앞에서 migration 을 완주하면 (d) 가 그 `.key` 를 지우고, 그 순간
/// 저장된 password 전량이 영구 복호화 불가가 된다. probe 는 그 파괴를 막는
/// 유일한 관문이므로 「디스크 `.key` 가 읽을 수 있는 채로 남았는가」까지 본다.
/// 이 케이스가 넣는 암호문은 `password` 지만 관문 자체는 `SECRET_FIELDS` 전체에
/// 열려 있다 — `validate_ciphertexts_decrypt` 가 `wallet_password` 도 읽게 한 것과
/// wallet 뿐인 프로필이 같은 보존 경로로 빠지는 회귀는 #2124 가
/// `src-tauri/table-view-core/src/storage/key_migration.rs` 인라인 테스트로 잠갔다.
/// 같은 유형의 다른 절반인 orphan 가드 `data_has_password_ciphertext` 는 #2111 이
/// 먼저 같은 집합으로 넓혔다.
#[test]
fn path_b_ciphertext_probe_failure_preserves_the_key_and_leaves_a_sentinel() {
    let dir = TempDir::new().unwrap();
    let disk_key: Vec<u8> = (0..32u8).collect();
    // 이 프로필의 암호문은 이 머신 어디에도 없는 키로 감싸여 있다 — 디스크
    // `.key` 를 그대로 이주시켜도 데이터는 안 열린다.
    let lost_key: Vec<u8> = (200..232u8).collect();
    seed_disk_key(dir.path(), &disk_key);
    seed_connections_json(dir.path(), &lost_key, &["alpha"]);
    let backend = InMemoryKeyringBackend::new_available();

    let outcome =
        migrate_or_initialize(&backend, dir.path()).expect("a failed probe must not fail the boot");

    assert_eq!(outcome.source, KeySource::DiskFallback);
    assert!(outcome.fallback_to_disk);
    assert_eq!(outcome.key, disk_key);

    let disk_path = disk_key_path(dir.path());
    assert!(
        disk_path.exists(),
        "probe failure must not reach the secure delete"
    );
    assert_eq!(
        BASE64
            .decode(fs::read_to_string(&disk_path).unwrap().trim())
            .expect("the preserved .key must still decode"),
        disk_key,
        "the preserved .key must be intact, not zero-overwritten"
    );
    assert!(
        migration_failed_sentinel_path(dir.path()).exists(),
        "the next boot needs the retry marker"
    );
}

// --------------------- #2138 probe 가 먼저다 -----------------------------

/// (c) ciphertext probe 가 실패한 부팅은 keyring 에 아무것도 남기면 안 된다.
/// 남기면 다음 부팅이 「keyring hit」 분기로 빠져 Path B 에 다시 못 들어오고,
/// sentinel 을 회수하는 자리가 Path B 의 (d) 블록 안이라 마커가 그대로 남는다.
/// `KeyringBackend` 에는 `delete` 가 없어 (a) 를 되돌릴 수단이 없으므로 방어는
/// 안 쓰는 쪽이다 (#2138). 이 순서가 치르는 값 — 재진입한 Path B 가 디스크에
/// 평문으로 앉아 있던 그 키를 그대로 이주시키는 것 — 은 아래
/// `assert_eq!(retried.key, disk_key)` 가 잠그고, 사유는
/// `path_b_migrate_from_disk` 의 doc comment 가 갖는다.
///
/// 두 부팅을 연달아 돌려 그 전이를 통째로 잠근다 — 「keyring 이 비었다」만
/// 보면 재진입까지는 증명되지 않는다.
#[test]
fn path_b_probe_failure_writes_no_keyring_entry_so_the_next_boot_re_enters_path_b() {
    let dir = TempDir::new().unwrap();
    let disk_key: Vec<u8> = (0..32u8).collect();
    // 이 프로필의 암호문은 이 머신 어디에도 없는 키로 감싸여 있다 — probe 가 막는다.
    let lost_key: Vec<u8> = (200..232u8).collect();
    seed_disk_key(dir.path(), &disk_key);
    seed_connections_json(dir.path(), &lost_key, &["alpha"]);
    let backend = InMemoryKeyringBackend::new_available();

    // 부팅 1 — probe 실패.
    let failed =
        migrate_or_initialize(&backend, dir.path()).expect("a failed probe must not fail the boot");
    assert_eq!(failed.source, KeySource::DiskFallback);
    assert!(
        backend.get(KEYRING_ENTRY_NAME).unwrap().is_none(),
        "a boot that never finished the migration must leave the keyring untouched"
    );

    // 부팅 2 — 사용자가 백업에서 되살려 암호문이 디스크 `.key` 로 열리게 됐다.
    seed_connections_json(dir.path(), &disk_key, &["alpha"]);
    let retried = migrate_or_initialize(&backend, dir.path()).expect("the retry must not fail");

    assert_eq!(
        retried.source,
        KeySource::MigratedFromDisk,
        "the next boot must re-enter Path B, not fall into the keyring-hit branch"
    );
    assert_eq!(retried.key, disk_key);
    assert!(
        !disk_key_path(dir.path()).exists(),
        "the retry finishes the migration the failed probe deferred"
    );
    assert!(
        !migration_failed_sentinel_path(dir.path()).exists(),
        "a successful retry reclaims the marker the failed boot left"
    );
}

/// sentinel 의 존재 이유는 「다음 부팅이 재시도한다」이고, 재시도가 성공하면
/// 회수돼야 한다. 회수가 빠지면 이주가 끝난 프로필이 영구히 실패로 보인다.
/// 실패 부팅과 성공 부팅을 연달아 돌려 그 전이를 통째로 잠근다.
#[test]
fn path_b_successful_retry_clears_the_sentinel_left_by_a_failed_boot() {
    let dir = TempDir::new().unwrap();
    let original_key: Vec<u8> = (0..32u8).collect();
    seed_disk_key(dir.path(), &original_key);
    let backend = InMemoryKeyringBackend::new_available();
    let sentinel = migration_failed_sentinel_path(dir.path());

    // 부팅 1 — keyring write 실패.
    backend.set_set_should_fail(true);
    let failed = migrate_or_initialize(&backend, dir.path()).expect("failure must not panic");
    assert_eq!(failed.source, KeySource::DiskFallback);
    assert!(sentinel.exists(), "precondition: the failed boot marked it");

    // 부팅 2 — keyring 이 다시 쓰기 가능해졌다.
    backend.set_set_should_fail(false);
    let retried = migrate_or_initialize(&backend, dir.path()).expect("retry must succeed");

    assert_eq!(retried.source, KeySource::MigratedFromDisk);
    assert_eq!(retried.key, original_key);
    assert!(
        !sentinel.exists(),
        "a successful retry must reclaim the marker, or the profile looks broken forever"
    );
    assert!(
        !disk_key_path(dir.path()).exists(),
        "the retry completes the migration it deferred"
    );
    assert_eq!(
        backend.get(KEYRING_ENTRY_NAME).unwrap().unwrap(),
        original_key
    );
}

/// AC-356-02 의 secure delete 는 unlink 하나가 아니라 세 동작이다 — zero
/// overwrite, 0o000 mode, 그리고 unlink. 기존 테스트는 전부 `!path.exists()`
/// 만 봐서 앞의 둘이 통째로 빠져도 green 이었다 — unlink 는 블록을 지우지
/// 않으므로 그 차이가 곧 디스크에 남는 master key 평문이다.
///
/// 같은 inode 를 가리키는 두 번째 이름을 미리 걸어두면 unlink 뒤에도 그 inode
/// 가 살아남아, secure delete 가 남긴 바이트와 mode 를 그대로 읽을 수 있다.
#[cfg(unix)]
#[test]
fn path_b_secure_delete_zeroes_the_key_bytes_and_marks_the_inode() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TempDir::new().unwrap();
    let original_key: Vec<u8> = (0..32u8).collect();
    seed_disk_key(dir.path(), &original_key);
    let disk_path = disk_key_path(dir.path());
    let witness = dir.path().join("key-inode-witness");
    fs::hard_link(&disk_path, &witness).expect("a second name for the same inode");
    let seeded_len = fs::metadata(&disk_path).unwrap().len();
    assert!(seeded_len > 0, "precondition: the seeded .key has content");

    let backend = InMemoryKeyringBackend::new_available();
    let outcome = migrate_or_initialize(&backend, dir.path()).expect("Path B must succeed");
    assert_eq!(outcome.source, KeySource::MigratedFromDisk);
    assert!(!disk_path.exists(), "precondition: the .key name is gone");

    // 0o000 마커 — unlink 를 앞지른 프로세스가 handle 을 들고 있어도 쓸모없게 만든다.
    assert_eq!(
        fs::metadata(&witness).unwrap().permissions().mode() & 0o777,
        0o000,
        "secure_delete must leave the 0o000 marker on the inode"
    );

    // 0o000 이면 소유자도 못 읽는다 — 마커를 확인한 뒤 되돌려 잔재를 본다.
    fs::set_permissions(&witness, fs::Permissions::from_mode(0o600)).unwrap();
    let residue = fs::read(&witness).unwrap();
    assert_eq!(
        residue.len() as u64,
        seeded_len,
        "the overwrite is length-matched, so an empty read would be a false pass"
    );
    assert!(
        residue.iter().all(|byte| *byte == 0),
        "the key bytes must be overwritten before the unlink, not merely unlinked"
    );
}
