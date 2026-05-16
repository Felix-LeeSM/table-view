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

use std::fs;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tempfile::TempDir;

use table_view_lib::storage::crypto::{
    encrypt, InMemoryKeyringBackend, KeyringBackend, KEYRING_ENTRY_NAME,
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
