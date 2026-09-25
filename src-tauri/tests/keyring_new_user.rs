//! Written 2026-05-16.
//!
//! AC-356-01 Path A (new user) — calling `migrate_or_initialize()` with no disk
//! `.key` and an empty keyring:
//!   - creates one keyring entry (named `com.tableview.app.file-key`).
//!   - does not create a disk `.key` (the plaintext file is discarded).
//!   - returns a `KeyOutcome.key` that is a 32 byte AES key.
//!   - returns `KeyOutcome.source` as `Generated`.
//!   - returns `KeyOutcome.fallback_to_disk` as false.
//!
//! This integration test uses the in-memory `InMemoryKeyringBackend` so it does
//! not touch the OS keyring. Compatibility with the real macOS Keychain /
//! Windows Credential Manager / Linux Secret Service is covered separately (in
//! the CI matrix) by the unit tests of the production `OsKeyringBackend`.

use std::ffi::{OsStr, OsString};
use std::fs;
use tempfile::TempDir;

use table_view_lib::storage::crypto::{InMemoryKeyringBackend, KeyringBackend, KEYRING_ENTRY_NAME};
use table_view_lib::storage::key_migration::{migrate_or_initialize, KeySource};

/// RAII env-var guard — restores the prior value (or removes it) on drop so an
/// assertion panic below can't leak `TABLE_VIEW_TEST_DATA_DIR` into sibling
/// tests. Mirrors the guard in `key_migration.rs`'s `#[cfg(test)]` module,
/// which this integration-test binary cannot reach. (#1367)
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

#[test]
fn ac_356_01_path_a_new_user_creates_keyring_entry_only() {
    // Isolated user-data dir — the TABLE_VIEW_TEST_DATA_DIR env var overrides
    // the directory storage sees. Guard restores the prior value on scope exit
    // (including panic) so the env var never leaks to sibling tests.
    let dir = TempDir::new().unwrap();
    let _env = EnvVarGuard::set("TABLE_VIEW_TEST_DATA_DIR", dir.path());

    let backend = InMemoryKeyringBackend::new_available();

    // Precondition: no disk .key, no keyring entry.
    let disk_key_path = dir.path().join(".key");
    assert!(!disk_key_path.exists(), "precondition: no disk .key file");
    assert!(
        backend.dump().is_empty(),
        "precondition: empty in-memory keyring"
    );

    // Action: first boot.
    let outcome = migrate_or_initialize(&backend, dir.path())
        .expect("migrate_or_initialize must succeed on fresh user-data dir");

    // Postcondition: keyring entry exists, disk .key absent.
    assert_eq!(outcome.key.len(), 32, "AES-256 key must be 32 bytes");
    assert!(
        matches!(outcome.source, KeySource::Generated),
        "new user: source must be Generated, got {:?}",
        outcome.source
    );
    assert!(
        !outcome.fallback_to_disk,
        "new user: fallback_to_disk must be false"
    );

    let stored = backend
        .get(KEYRING_ENTRY_NAME)
        .expect("keyring read must not error")
        .expect("keyring entry must exist after Path A");
    assert_eq!(
        stored, outcome.key,
        "keyring entry bytes must equal the returned key"
    );
    assert!(
        !disk_key_path.exists(),
        "new user: disk .key must NOT be created — keyring is the only home"
    );

    // No fallback sidecar / migration-failed sidecar.
    assert!(
        !dir.path().join(".keyring-fallback-dismissed").exists(),
        "no fallback sidecar on Path A"
    );
    assert!(
        !dir.path().join(".key.migration-failed").exists(),
        "no migration-failed sidecar on Path A"
    );

    // Cleanup — env var is restored by `_env`'s Drop; TempDir removes the
    // directory on its own Drop, but do it eagerly so a leftover on failure
    // is unambiguous.
    let _ = fs::remove_dir_all(dir.path());
}
