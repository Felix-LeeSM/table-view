//! Written 2026-05-16.
//!
//! AC-356-02 / AC-356-03 / AC-356-04 / AC-356-07 / AC-356-08 — Path B
//! (migrating the disk `.key` into the keyring). This file asserts the happy
//! case, idempotency, failure fallback, envelope decrypt and readback byte
//! equality of the migration path in a single binary (cutting cargo's test
//! binary cold-start cost).
//!
//! Core invariants:
//!   - After the migration the disk `.key` is gone (secure delete: zero
//!     overwrite + 0o000 mode + unlink).
//!   - The keyring holds the same 32-byte key.
//!   - In the same user-data dir the second boot reads the keyring only (it
//!     never touches the disk).
//!   - When the keyring write fails, the sentinel `.key.migration-failed` is
//!     created and the disk .key survives untouched (decrypt falls back to
//!     disk).
//!   - After the migration every `password_enc` in `connections.json`
//!     decrypts under the new key (envelope compatibility).
//!
//! 2026-08-01 (#1814) added — a key that has been through the disk `.key` is
//! not kept alive when the keyring comes back; it is swapped for a new one
//! (rekeying). The #1814 section further down asserts the rekeying itself and
//! the next-boot recovery from all three interruption points.
//!
//! 2026-08-02 (#1815) added — the #1815 section further down fills the three
//! invariants above that were not actually asserted: the fail-closed behaviour
//! of a failed ciphertext probe, the retry contract in which the next boot
//! reclaims the sentinel, and whether secure delete really overwrote the bytes
//! before the unlink. All three are decided by the state left on the
//! filesystem, not by `KeyOutcome`.

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

// --------------------- #1814 rekeying ----------------------------------
//
// Path C drops the file key onto disk as a plaintext `.key`. If a boot where
// the keyring came back kept that key alive, whoever holds the disk copy could
// go on decrypting every password. So a boot with "keyring hit + disk `.key`
// present" swaps in a new key:
//   1. generate a new key → overwrite the keyring
//   2. re-encrypt `connections.json` → temp file → atomic rename
//   3. secure-delete the disk `.key`
// The disk `.key` is the recovery anchor — whichever of 1/2/3 it dies on, the
// next boot picks up from there.

/// Seeds `connections.json` in its real on-disk shape. `ConnectionConfig` has
/// no `rename_all`, so the stored keys are snake_case, and the two fields
/// wrapped by the master key are `password` and `wallet_password` (`resolve`
/// in `storage::mod.rs` is the only caller of `crypto::encrypt`). A rekey has
/// to re-dress both.
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

/// Seeds one connection that has secrets plus one that has none, both
/// encrypted with `key`.
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

/// Asserts that both secrets decrypt under `key` with the plaintext
/// preserved, that an empty secret stays empty, and that the file still
/// deserializes as `StorageData`.
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

/// The retired key can no longer open anything — this assertion is the whole
/// security purpose of the rekey.
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

/// A key that has been exposed on disk is discarded on the boot where the
/// keyring comes back. This state is what remains when Path B got as far as
/// the keyring write and died before the secure delete (the same key in the
/// keyring and on disk).
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

/// Interruption point 1 — died right after the new key entered the keyring.
/// The file still holds old-key ciphertext and the disk `.key` still holds the
/// old key. The next boot must recover through the anchor and finish the rekey
/// (decryption with the keyring key fails → retry with the disk `.key`).
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

/// Interruption point 2 — died after the re-encrypt rename had finished. Both
/// the file and the keyring are on the new key, so they are healthy, and the
/// leftover disk `.key` is residue that opens nothing. The next boot must be
/// able to read the data as it stands.
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

/// Interruption point 3 — died just before the secure delete (the same on-disk
/// state as point 2). The next boot must clear the leftover plaintext `.key`.
/// There is no reason to re-dress a file already re-encrypted under the new
/// key, so the keyring key stays put.
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

/// Dying during the secure delete leaves the `.key` zero-overwritten (it no
/// longer decodes as base64). The next boot must clear that residue instead of
/// tripping over it.
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

// --------------------- #1815 remaining gaps ----------------------------
//
// Path B has four stages — (c) ciphertext probe, (a) keyring write, (b)
// readback, (d) secure delete (the stage names come from the design doc, and
// the order above is the execution order, #2138). Only the failure of (a) was
// covered, by `ac_356_04_*`; the failure of (c), the actual overwrite in (d),
// and the contract in which the next boot reclaims the sentinel left by (a)
// were asserted nowhere. For all three the truth is the state left on disk
// rather than the return value, so only an integration test can decide them.

/// (c) A failed ciphertext probe is fail-closed — running the migration to
/// completion in front of ciphertext the disk `.key` cannot open means (d)
/// erases that `.key`, and at that moment every stored password becomes
/// permanently undecryptable. The probe is the only gate that stops that
/// destruction, so this also checks whether the disk `.key` was left readable.
/// The ciphertext this case plants is a `password`, but the gate itself is open
/// to the whole of `SECRET_FIELDS` — #2124 locked, as an inline test in
/// `src-tauri/table-view-core/src/storage/key_migration.rs`, both making
/// `validate_ciphertexts_decrypt` read `wallet_password` too and the regression
/// where a wallet-only profile takes the same preservation path. The other half
/// of the same class, the orphan guard `data_has_password_ciphertext`, was
/// widened to that same set earlier by #2111.
#[test]
fn path_b_ciphertext_probe_failure_preserves_the_key_and_leaves_a_sentinel() {
    let dir = TempDir::new().unwrap();
    let disk_key: Vec<u8> = (0..32u8).collect();
    // The ciphertext of this profile is wrapped with a key that exists nowhere
    // on this machine — migrating the disk `.key` as-is still does not open the
    // data.
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

// --------------------- #2138 the probe comes first ---------------------

/// (c) A boot whose ciphertext probe failed must leave nothing in the keyring.
/// If it did, the next boot would fall into the "keyring hit" branch and could
/// not re-enter Path B, and because the place that reclaims the sentinel sits
/// inside Path B's (d) block, the marker would stay behind. `KeyringBackend`
/// has no `delete`, so there is no way to undo (a) — the defence is not to
/// write it (#2138). The price this ordering pays — a re-entered Path B
/// migrating the very key that was sitting in plaintext on disk — is locked by
/// `assert_eq!(retried.key, disk_key)` below, and the reasoning lives in the
/// doc comment of `path_b_migrate_from_disk`.
///
/// Two boots run back to back lock the whole transition — looking only at "the
/// keyring is empty" does not prove the re-entry.
#[test]
fn path_b_probe_failure_writes_no_keyring_entry_so_the_next_boot_re_enters_path_b() {
    let dir = TempDir::new().unwrap();
    let disk_key: Vec<u8> = (0..32u8).collect();
    // The ciphertext of this profile is wrapped with a key that exists nowhere
    // on this machine — the probe blocks it.
    let lost_key: Vec<u8> = (200..232u8).collect();
    seed_disk_key(dir.path(), &disk_key);
    seed_connections_json(dir.path(), &lost_key, &["alpha"]);
    let backend = InMemoryKeyringBackend::new_available();

    // Boot 1 — the probe fails.
    let failed =
        migrate_or_initialize(&backend, dir.path()).expect("a failed probe must not fail the boot");
    assert_eq!(failed.source, KeySource::DiskFallback);
    assert!(
        backend.get(KEYRING_ENTRY_NAME).unwrap().is_none(),
        "a boot that never finished the migration must leave the keyring untouched"
    );

    // Boot 2 — the user restored from a backup, so the ciphertext now opens
    // with the disk `.key`.
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

/// The sentinel exists so that "the next boot retries", and once the retry
/// succeeds it has to be reclaimed. Without the reclaim, a profile whose
/// migration is finished looks permanently failed. A failed boot and a
/// successful boot run back to back lock the whole transition.
#[test]
fn path_b_successful_retry_clears_the_sentinel_left_by_a_failed_boot() {
    let dir = TempDir::new().unwrap();
    let original_key: Vec<u8> = (0..32u8).collect();
    seed_disk_key(dir.path(), &original_key);
    let backend = InMemoryKeyringBackend::new_available();
    let sentinel = migration_failed_sentinel_path(dir.path());

    // Boot 1 — the keyring write fails.
    backend.set_set_should_fail(true);
    let failed = migrate_or_initialize(&backend, dir.path()).expect("failure must not panic");
    assert_eq!(failed.source, KeySource::DiskFallback);
    assert!(sentinel.exists(), "precondition: the failed boot marked it");

    // Boot 2 — the keyring has become writable again.
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

/// The secure delete of AC-356-02 is not a single unlink but three actions —
/// zero overwrite, 0o000 mode, and the unlink. The existing tests all looked
/// only at `!path.exists()`, so they stayed green even if the first two dropped
/// out entirely — an unlink does not erase the blocks, so that difference is
/// exactly the master key plaintext left on disk.
///
/// Hooking a second name onto the same inode beforehand keeps that inode alive
/// past the unlink, so the bytes and the mode secure delete left behind can be
/// read directly.
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

    // The 0o000 marker — it makes the handle useless even for a process that
    // got in ahead of the unlink and still holds one.
    assert_eq!(
        fs::metadata(&witness).unwrap().permissions().mode() & 0o777,
        0o000,
        "secure_delete must leave the 0o000 marker on the inode"
    );

    // At 0o000 not even the owner can read it — check the marker, then restore
    // the mode to look at the residue.
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
