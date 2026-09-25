//! Written 2026-05-16
//!
//! AC-356-05 / AC-356-06 / AC-356-09 — Path C (fallback for environments where
//! Linux Secret Service / kwallet is unavailable) + Fatal (key gone while
//! ciphertext is present).
//!
//! Independently of the OS, this file simulates in memory a keyring backend
//! whose `is_available()` is false and asserts:
//!   - The disk `.key` is preserved (created when absent, mode 0o600 kept).
//!   - The returned `KeyOutcome.fallback_to_disk == true`.
//!   - Absence (first boot) / presence (the next boot) of the sentinel is
//!     reported correctly, so the caller can raise the toast once and only
//!     while `fallback_dismissed_sentinel_path` is absent.
//!   - Fatal case: keyring unavailable + disk `.key` absent + ciphertext
//!     present → no new key is generated, `KeySource::Fatal` is returned.

use std::fs;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tempfile::TempDir;

use table_view_lib::storage::crypto::{encrypt, InMemoryKeyringBackend};
use table_view_lib::storage::key_migration::{
    disk_key_path, fallback_dismissed_sentinel_path, migrate_or_initialize, KeySource,
};

fn seed_disk_key(data_dir: &Path, key: &[u8]) {
    let path = disk_key_path(data_dir);
    fs::write(&path, BASE64.encode(key)).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    }
}

fn seed_connections_with_ciphertext(data_dir: &Path, key: &[u8]) {
    let pw_enc = encrypt("secret-pw", key).unwrap();
    let doc = serde_json::json!({
        "connections": [{
            "id": "c0",
            "name": "DB-0",
            "dbType": "Postgresql",
            "host": "localhost",
            "port": 5432,
            "user": "u",
            "password": pw_enc,
            "database": "d",
        }],
        "groups": [],
    });
    fs::write(
        data_dir.join("connections.json"),
        serde_json::to_string_pretty(&doc).unwrap(),
    )
    .unwrap();
}

// --------------------- AC-356-05 ---------------------------------------

/// Existing user, Linux Secret Service unavailable. The disk `.key` must
/// stay put and the outcome must flip the `fallback_to_disk` flag so the
/// caller emits the Linux-fallback toast.
#[test]
fn ac_356_05_existing_disk_key_with_unavailable_keyring_falls_back_to_disk() {
    let dir = TempDir::new().unwrap();
    let key: Vec<u8> = (0..32u8).collect();
    seed_disk_key(dir.path(), &key);
    let backend = InMemoryKeyringBackend::new_unavailable();

    let outcome = migrate_or_initialize(&backend, dir.path()).expect("Path C must succeed");
    assert_eq!(outcome.key, key);
    assert_eq!(outcome.source, KeySource::DiskFallback);
    assert!(outcome.fallback_to_disk, "AC-356-05 toast trigger");
    assert!(
        disk_key_path(dir.path()).exists(),
        "AC-356-05: disk .key must remain when keyring is unavailable"
    );
}

/// Fresh install on a Linux box without Secret Service. The migration must
/// generate a new key but write it to disk (with 0o600 mode preserved),
/// not into the unavailable keyring.
#[test]
fn ac_356_05_new_user_with_unavailable_keyring_creates_disk_key() {
    let dir = TempDir::new().unwrap();
    let backend = InMemoryKeyringBackend::new_unavailable();
    assert!(!disk_key_path(dir.path()).exists());

    let outcome = migrate_or_initialize(&backend, dir.path()).expect("Path C must succeed");
    assert_eq!(outcome.source, KeySource::DiskFallback);
    assert!(outcome.fallback_to_disk);
    assert_eq!(outcome.key.len(), 32);

    let disk_path = disk_key_path(dir.path());
    assert!(
        disk_path.exists(),
        "AC-356-05: new user on Linux fallback must get a disk .key"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = fs::metadata(&disk_path).unwrap();
        let mode = meta.permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "AC-356-05: disk .key mode must be 0o600");
    }
}

// --------------------- AC-356-06 ---------------------------------------

/// Sentinel `.keyring-fallback-dismissed` does not exist before the first
/// boot, but the migration call itself does NOT create it (the caller —
/// `KeyringFallbackToast` dismiss — owns the write). Confirms the
/// migration code only reports state; the toast UI controls the sentinel.
#[test]
fn ac_356_06_first_boot_does_not_create_dismissed_sentinel() {
    let dir = TempDir::new().unwrap();
    let backend = InMemoryKeyringBackend::new_unavailable();

    assert!(!fallback_dismissed_sentinel_path(dir.path()).exists());
    let _ = migrate_or_initialize(&backend, dir.path()).unwrap();
    assert!(
        !fallback_dismissed_sentinel_path(dir.path()).exists(),
        "AC-356-06: migrate_or_initialize must not auto-create the dismissed sentinel"
    );
}

/// When the sentinel pre-exists (user dismissed it on a previous boot),
/// the migration still reports `fallback_to_disk = true` so the caller can
/// suppress the toast based on its own sentinel probe. We don't make the
/// migration itself read the sentinel — separation of concerns: the
/// migration owns the key, the toast owns the dismiss state.
#[test]
fn ac_356_06_dismissed_sentinel_does_not_change_migration_outcome() {
    let dir = TempDir::new().unwrap();
    let key: Vec<u8> = (5..37u8).collect();
    seed_disk_key(dir.path(), &key);
    fs::write(fallback_dismissed_sentinel_path(dir.path()), b"").unwrap();
    let backend = InMemoryKeyringBackend::new_unavailable();

    let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();
    assert!(outcome.fallback_to_disk);
    assert_eq!(outcome.key, key);
    // Sentinel is untouched (caller-owned).
    assert!(fallback_dismissed_sentinel_path(dir.path()).exists());
}

// --------------------- AC-356-09 ---------------------------------------

/// Both the keyring and the disk `.key` are missing, but `connections.json`
/// has a non-empty `password_enc`. Generating a new key would orphan the
/// ciphertext. Migration must NOT create a new key — instead return
/// `KeySource::Fatal` so the caller enters safe mode + emits the
/// "Decryption key lost — restore from backup" toast.
#[test]
fn ac_356_09_fatal_when_key_missing_but_ciphertext_present() {
    let dir = TempDir::new().unwrap();
    // Seed ciphertext under a key that we DO NOT persist anywhere.
    let lost_key: Vec<u8> = (0..32u8).rev().collect();
    seed_connections_with_ciphertext(dir.path(), &lost_key);
    let backend = InMemoryKeyringBackend::new_available();

    // Precondition.
    assert!(!disk_key_path(dir.path()).exists());

    let outcome = migrate_or_initialize(&backend, dir.path()).expect("must not panic");
    assert!(outcome.is_fatal(), "AC-356-09 must return KeySource::Fatal");
    assert_eq!(outcome.source, KeySource::Fatal);
    assert!(
        outcome.key.is_empty(),
        "AC-356-09: fatal outcome must NOT carry a key (caller must not decrypt)"
    );
    // No new key was written to either home.
    assert!(!disk_key_path(dir.path()).exists());
    assert!(backend.dump().is_empty());
}

/// When there is no ciphertext to worry about (fresh install: no
/// `connections.json`), Path A still applies even with the same global
/// preconditions (empty keyring + no disk key). This guards against the
/// fatal check over-firing.
#[test]
fn ac_356_09_no_ciphertext_still_path_a() {
    let dir = TempDir::new().unwrap();
    let backend = InMemoryKeyringBackend::new_available();
    let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();
    assert_eq!(outcome.source, KeySource::Generated);
    assert!(!outcome.is_fatal());
}
