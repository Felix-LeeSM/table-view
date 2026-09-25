//! Q22 — file-key migration: plaintext on disk → OS keyring.
//!
//! This module runs once **before** the SQLite migration. That is why the
//! sentinel / migration-failed markers live only in the file sidecar, never
//! in the SQLite `meta` table.
//!
//! Three paths (state-management-strategy 2026-05-15, Q22):
//!   - **Path A (new)**: no disk `.key` + no keyring → generate a new key,
//!     store it in the keyring, discard the disk file. AC-356-01.
//!   - **Path B (migration)**: disk `.key` present + keyring absent → read
//!     from disk → (c) ciphertext probe → (a) keyring write → (b) readback
//!     verification → (d) disk secure delete (overwrite + 0o000 + unlink).
//!     On failure the disk file is kept + sidecar `.key.migration-failed`.
//!     The step names (a)~(d) come from the design doc and the execution
//!     order is the one above — [`path_b_migrate_from_disk`] holds the
//!     reason (c) runs before (a) (#2138). AC-356-02..04.
//!   - **Path B follow-up boot**: no disk `.key` + keyring present → read
//!     from the keyring. AC-356-03.
//!   - **Rekeying (#1814)**: disk `.key` present + keyring present → a key
//!     that lived on disk is an exposed key. Generate a new key → overwrite
//!     the keyring → re-encrypt `connections.json` (temp file + atomic
//!     rename) → secure-delete the disk `.key`. The disk `.key` is the
//!     recovery anchor, so no matter where the boot dies the next boot picks
//!     up from there. `KeyOutcome::rekeyed_after_disk_exposure` records
//!     whether it ran.
//!   - **Path C (Linux fallback)**: keyring `is_available()` is false →
//!     keep disk `.key` mode (currently 0o600) and emit a toast event to
//!     the frontend. AC-356-05..06.
//!   - **Fatal**: no disk `.key` + no keyring + ciphertext present →
//!     return `KeySource::Fatal`; the caller enters safe mode. AC-356-09.

use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::aead::KeyInit;
use aes_gcm::Aes256Gcm;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tracing::{info, warn};
use zeroize::Zeroizing;

use crate::error::AppError;
use crate::storage::crypto::{create_key_file, KeyringBackend, KEYRING_ENTRY_NAME};

/// Path to the file-key inside the user data directory.
pub fn disk_key_path(data_dir: &Path) -> PathBuf {
    data_dir.join(".key")
}

/// Resolves the user-data dir for production. Only the name remains, for
/// keyring-side callers; the decision lives in one place,
/// [`crate::storage::app_data_dir`] (#2184). Before that this function
/// carried its own duplicate override → fallback body.
pub fn app_data_dir_for_keyring() -> Result<PathBuf, AppError> {
    crate::storage::app_data_dir()
}

/// Sentinel created when Path B fails. The next boot retries the migration.
/// This runs before SQLite meta exists, so only the file sidecar is used.
pub fn migration_failed_sentinel_path(data_dir: &Path) -> PathBuf {
    data_dir.join(".key.migration-failed")
}

/// File sidecar set after the Linux fallback toast has been shown once.
/// On the next boot the same environment shows no toast (AC-356-06).
pub fn fallback_dismissed_sentinel_path(data_dir: &Path) -> PathBuf {
    data_dir.join(".keyring-fallback-dismissed")
}

/// The truth about where the key came from (for caller branching / test
/// assertions).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeySource {
    /// Path A — newly generated. Zero disk files.
    Generated,
    /// Boot after Path A/B — read as-is from the keyring.
    FromKeyring,
    /// Path B — after the disk → keyring migration the disk file is
    /// secure-deleted.
    MigratedFromDisk,
    /// Path C — keyring unavailable, disk file kept as-is.
    DiskFallback,
    /// AC-356-09 — no keyring and no disk file, but ciphertext exists.
    /// The caller enters safe mode; decrypt attempts are forbidden.
    Fatal,
}

/// Return value of `migrate_or_initialize()`. Callers (`storage::mod.rs` /
/// `lib.rs::run()`) use `outcome.key` as the envelope crypto source and
/// emit a one-time toast to the frontend only when
/// `outcome.fallback_to_disk` is true.
#[derive(Debug, Clone)]
pub struct KeyOutcome {
    /// 32-byte AES-256-GCM key. An empty `Vec` for `KeySource::Fatal`.
    pub key: Vec<u8>,
    /// Where it came from.
    pub source: KeySource,
    /// `true` = Path C (Linux fallback). `false` = otherwise.
    pub fallback_to_disk: bool,
    /// #1814 — whether this boot discarded a key that had been exposed on
    /// disk and switched to a new one. When `true`, `key` is the fresh key
    /// minted this boot and `connections.json` has been re-encrypted with
    /// it. A boot that attempted the rekey and failed is `false`; then
    /// `key` (even when `source` is `FromKeyring`) is the key that opens
    /// the current ciphertext — it may be the value of the disk `.key`
    /// anchor. The next boot meets the same conditions and retries.
    pub rekeyed_after_disk_exposure: bool,
}

impl KeyOutcome {
    /// Caller convenience — is this the fatal path (the sign that decryption
    /// is forbidden).
    pub fn is_fatal(&self) -> bool {
        matches!(self.source, KeySource::Fatal)
    }
}

/// Q22 — the three-path branch for the file-key. Called once before the
/// SQLite migration. `data_dir` is the user-data dir the caller passes in —
/// a tempdir in tests, and in production the value returned by
/// [`app_data_dir_for_keyring`], i.e. the path injected at boot by
/// [`crate::storage::init_production_data_dir`] (#2184).
pub fn migrate_or_initialize<B: KeyringBackend>(
    backend: &B,
    data_dir: &Path,
) -> Result<KeyOutcome, AppError> {
    fs::create_dir_all(data_dir)?;

    // ---------------- Path C diagnosis (comes first) ----------------
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

    // ---------------- Path B follow-up boot — keyring hit ----------------
    if let Some(bytes) = backend.get(KEYRING_ENTRY_NAME)? {
        validate_key_len(&bytes)?;
        // A remaining disk `.key` means this profile went through the Path C
        // disk fallback, or Path B's secure delete partially failed. Either
        // way the master key plaintext sat on disk. Deleting only the
        // remnant and keeping the same key leaves whoever took that file via
        // backup, rsync, or a snapshot still able to open every password —
        // switch to a new key (#1814).
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

    // ---------------- Path A or Fatal ----------------
    // No disk .key and no keyring. If the ciphertext (password_enc inside
    // connections.json) is non-empty, minting a new key would orphan it —
    // mark this fatal (AC-356-09).
    if data_has_password_ciphertext(data_dir)? {
        return Ok(KeyOutcome {
            key: Vec::new(),
            source: KeySource::Fatal,
            fallback_to_disk: false,
            rekeyed_after_disk_exposure: false,
        });
    }

    // Path A — fresh install. Generate a new key + write it to the keyring.
    let key = Aes256Gcm::generate_key(aes_gcm::aead::OsRng);
    let key_bytes = key.as_slice().to_vec();
    backend.set(KEYRING_ENTRY_NAME, &key_bytes)?;

    // Readback verification — AC-356-07. get right after set for byte equality.
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

/// Path B — migrates the disk `.key` into the keyring. The disk file is
/// secure-deleted only after every step succeeds. If any step fails, a
/// sentinel sidecar is written and the disk file is kept (the next boot
/// retries). Decryption falls back to the disk path (the caller's
/// responsibility).
///
/// The execution order is (c) → (a) → (b) → (d). The design constraint the
/// reorder has to keep — "(d) only after (a)(b)(c) all succeed" — stands as
/// written. The snapshot's own step description reads a → b → c (its (b)
/// re-reads what (a) wrote, and its (c) covers both `.key` and the keyring),
/// but (c) can be moved to the front because the implementation's
/// [`validate_ciphertexts_decrypt`] never looks at the keyring and reads
/// only `disk_key`.
///
/// The reason (c) goes first is the state left behind when (a) fails after
/// it (#2138). If that boot leaves a keyring entry behind, the next boot
/// takes the keyring-hit branch of [`migrate_or_initialize`] and can never
/// re-enter Path B. The sentinel is only reclaimed inside the (d) block
/// below, so the marker stays where it is. The plaintext disk `.key` is
/// different — once the ciphertext becomes openable again, the anchor arm
/// of [`rekey_after_disk_exposure`] fires and switches to a new key, and
/// that function's step 3 deletes the file. Only while neither key opens
/// anything is the same function stuck in its "keep both" arm.
///
/// What this order pays is the exposed key. With (c) first, the profile
/// re-enters Path B on the next boot and moves **the very key that sat in
/// plaintext on disk** into the keyring. With (a) first, the same profile
/// would have gone to [`rekey_after_disk_exposure`], minted a new key, and
/// re-encrypted `connections.json`. Migrating that same key is the
/// AC-356-02 contract, and the "Credential/privacy boundary" row of
/// `docs/roadmap/h7.md` already records that recovering the exposure on
/// this path is still an open gap. Also standing: [`KeyringBackend`] has no
/// `delete`, so there is no way to undo (a).
fn path_b_migrate_from_disk<B: KeyringBackend>(
    backend: &B,
    data_dir: &Path,
    disk_path: &Path,
) -> Result<KeyOutcome, AppError> {
    let disk_key = read_disk_key(disk_path)?;

    // (c) ciphertext decrypt sanity check. Best effort — if there are no
    // ciphertexts to validate (fresh dual-write user) we still proceed.
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

    // (a) keyring write.
    if let Err(e) = backend.set(KEYRING_ENTRY_NAME, &disk_key) {
        warn!(
            target: "boot",
            "key_migration: Path B step (a) keyring write failed ({e}); leaving sentinel"
        );
        write_sentinel(&migration_failed_sentinel_path(data_dir))?;
        // Decryption still works with the disk key — return DiskFallback.
        return Ok(KeyOutcome {
            key: disk_key,
            source: KeySource::DiskFallback,
            fallback_to_disk: true,
            rekeyed_after_disk_exposure: false,
        });
    }

    // (b) readback verification.
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

/// Path C — Linux fallback. The keyring is unavailable. The disk file keeps
/// its file mode (currently 0o600); if it is missing, a new one is created.
/// The caller shows the frontend a toast only once, and only while the file
/// sidecar `.keyring-fallback-dismissed` is absent.
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
        // #1555 — if a keyring-only profile is moved to, or lost in, an
        // environment without the keyring, neither the disk `.key` nor the
        // keyring exists. Minting a new key here would orphan the existing
        // ciphertext and leave every stored password undecryptable. Enter
        // Fatal, shaped like the Path A and crypto #1093 guards (the caller
        // enters safe mode). AC-356-09.
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
        // New user + Linux fallback — a new key on disk. write_disk_key
        // returns the key actually on disk after the atomic publish (the
        // winner's key in a concurrent-boot race); use that return value to
        // prevent a ciphertext orphan.
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

/// Fields inside `connections.json` wrapped under the master key envelope.
/// `storage::mod.rs`'s `save_connection_with_wallet` is the only
/// `crypto::encrypt` caller, and these two are the only values it wraps.
/// `ConnectionConfig` has no `rename_all`, so the stored keys are the field
/// names as-is. **Any new secret field must be added here too** — a missing
/// field stays undecryptable after rekeying.
const SECRET_FIELDS: [&str; 2] = ["password", "wallet_password"];

fn connections_path(data_dir: &Path) -> PathBuf {
    data_dir.join("connections.json")
}

/// Temp file where rekeying drops the new ciphertext first. The name is
/// fixed because this path runs once per boot — no contention — and so each
/// boot reclaims whatever a previous boot left behind.
fn rekey_tmp_path(data_dir: &Path) -> PathBuf {
    data_dir.join("connections.json.rekey.tmp")
}

/// State of `connections.json`. `Corrupt` means parsing failed —
/// `load_storage_raw()` quarantines it on the next call.
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

/// Non-empty secret ciphertexts inside the document.
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

/// Is there at least one ciphertext to protect? With none, rekeying has
/// nothing to lose.
fn has_secrets(doc: &serde_json::Value) -> bool {
    secret_values(doc).next().is_some()
}

/// Does every secret in the document decrypt under `key`? Any failure makes
/// it false — a partial success is never downgraded to a success.
fn secrets_decrypt_under(doc: &serde_json::Value, key: &[u8]) -> bool {
    secret_values(doc).all(|enc| crate::storage::crypto::decrypt(enc, key).is_ok())
}

/// Decrypts every secret with `old` and rewraps it under `new`. Any failure
/// returns `Err`, and the caller moves on to the next boot without having
/// touched the original file. The plaintext lives only inside `Zeroizing`
/// and is wiped right after re-encryption (minimizing the "plaintext memory
/// exposure window" that ADR 0040 named as the cost of re-encryption).
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

/// Publishes the re-encrypted document atomically — write to a create-time
/// 0600 temp file, `fsync`, then rename. Same procedure as
/// `storage::mod.rs`'s `save_storage_raw()`. Until the rename succeeds, not
/// one byte of the original changes.
///
/// #2183 — deletes `connections.json.bak` only **after** the rename
/// succeeds. This function bypasses `save_storage_raw`, so the backup is
/// not refreshed; if the next rekey step then discards the old key, that
/// backup becomes **ciphertext encrypted under a key that exists nowhere**.
/// It still parses as valid JSON, so the loss-recovery path takes the
/// success branch, reports "restored", and the user then hits a decrypt
/// failure on every connection. Deleting it lets
/// `storage::seed_backup_if_absent` recreate it under the new key on the
/// same boot's first load. The order matters: deleting it before the rename
/// would also lose a healthy backup that the old key still opens if the
/// publish fails.
fn publish_connections_atomically(
    data_dir: &Path,
    doc: &serde_json::Value,
) -> Result<(), AppError> {
    let path = connections_path(data_dir);
    let tmp_path = rekey_tmp_path(data_dir);
    let json = serde_json::to_string_pretty(doc)?;

    // Reclaim leftovers from a previous boot first. The open must use
    // `create_new` for mode(0600) to actually stick — opening an existing
    // file keeps that file's permissions.
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
    let _ = fs::remove_file(crate::storage::backup_path_for(&path));
    Ok(())
}

/// #1814 — discards a file-key that has been exposed on disk and switches
/// to a new one.
///
/// The entry condition is exactly one: a key exists in the keyring and a
/// disk `.key` also exists. No separate marker is used because the mere
/// existence of the disk `.key` is itself the evidence of exposure. It runs
/// automatically, without user confirmation (owner decision 2026-07-25).
///
/// Three steps: ① generate a new key → overwrite the keyring ② re-encrypt
/// `connections.json` → temp file → atomic rename ③ secure-delete the disk
/// `.key`.
///
/// **Recovery anchor** — ① overwrites the old keyring key, so if that old
/// key is the only copy, a crash between ① and ② makes every password
/// unrecoverable. That is why, before ①, the code verifies that "the key
/// opening the current ciphertext is in the disk `.key`" (or that there is
/// no ciphertext to protect at all), and skips rekeying otherwise. While
/// that condition holds, a crash at any of ①②③ leaves the next boot
/// decrypting with the disk `.key` and picking up from there.
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

    // An unreadable `.key` — a leftover from a boot that died mid secure
    // delete with only the zero-overwrite done — cannot serve as the anchor.
    let disk_key = read_disk_key(disk_path).ok();

    let mut doc = match read_connections_doc(data_dir)? {
        ConnectionsDoc::Corrupt => {
            // Before quarantine there is no way to tell which key is right.
            // Delete nothing and hand off to the next boot (it retries after
            // `load_storage_raw()` quarantines the file).
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

    // The key opening the current ciphertext. The disk `.key` is asked
    // first because it is the anchor — in the exposure scenario it usually
    // holds the same value as the keyring key.
    let current = match doc.as_ref() {
        None => keyring_key.clone(),
        Some(parsed) => match disk_key
            .as_ref()
            .filter(|k| secrets_decrypt_under(parsed, k))
        {
            Some(anchor) => anchor.clone(),
            None if secrets_decrypt_under(parsed, &keyring_key) => {
                // The disk `.key` is a leftover unrelated to the current
                // ciphertext (e.g. an old key left by a boot that finished
                // the rekey through the rename and died before the secure
                // delete). Nothing to switch to, so just clear the leftover.
                if let Err(e) = secure_delete(disk_path) {
                    warn!(target: "boot", "key_migration: stale disk .key cleanup failed: {e}");
                }
                return Ok(from_keyring(keyring_key, false));
            }
            None => {
                // Neither key opens anything. Deleting anything here only
                // shrinks what can still be recovered — preserve both and do
                // nothing.
                warn!(
                    target: "boot",
                    "key_migration: rekey skipped — neither the keyring key nor the disk .key decrypts connections.json; preserving both"
                );
                return Ok(from_keyring(keyring_key, false));
            }
        },
    };
    // Invariant at this point: if there is ciphertext to protect, `current`
    // still lives intact inside the disk `.key`. That is why recovery stays
    // possible even after ① below overwrites the keyring.

    // ① Generate a new key → overwrite the keyring + readback verification.
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

    // ② Re-encrypt connections.json → temp file → atomic rename.
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

    // ③ Secure-delete the disk `.key`. If it fails, the leftover file no
    // longer opens any ciphertext, and the next boot clears it through this
    // same path again.
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

/// Path B (c) probe — does every secret ciphertext in `connections.json`
/// decrypt under `key`? There are three Ok cases: the file is absent, the
/// file exists but holds no non-empty secrets, or everything decrypts. Err
/// on the first failure.
///
/// The check covers all of `SECRET_FIELDS` — it must be the same set the
/// rekey and orphan guards protect. While only `password` was scanned, a
/// profile whose only secret was `wallet_password` sailed through the probe
/// and reached the (d) secure delete (#2124). Iterating the set here instead
/// of reusing `secrets_decrypt_under` preserves the failure reason — the
/// caller puts that string into the boot WARN.
fn validate_ciphertexts_decrypt(data_dir: &Path, key: &[u8]) -> Result<(), AppError> {
    let ConnectionsDoc::Parsed(doc) = read_connections_doc(data_dir)? else {
        // File absent, or Corrupt — the latter is quarantined by
        // `load_storage_raw()` on the next call. This step has no ciphertext
        // to validate, so it does not block the migration.
        return Ok(());
    };
    for enc in secret_values(&doc) {
        crate::storage::crypto::decrypt(enc, key)
            .map_err(|e| AppError::Encryption(format!("Ciphertext probe decrypt failed: {e}")))?;
    }
    Ok(())
}

/// Decides the fatal case where ciphertext exists on disk and the key is
/// gone. AC-356-09. `crypto::get_or_create_key` (#1093 orphan guard) reuses
/// the same signal.
///
/// The check covers all of `SECRET_FIELDS` — it must be the same set the
/// rekey protects. While only `password` was scanned, an Oracle profile
/// whose only secret was `wallet_password` was judged to have "no ciphertext
/// to protect", Path A minted a new key, and at that moment the wallet
/// ciphertext became permanently undecryptable (#2111).
pub(crate) fn data_has_password_ciphertext(data_dir: &Path) -> Result<bool, AppError> {
    Ok(match read_connections_doc(data_dir)? {
        // Corrupt gives nothing to judge on — `load_storage_raw()` quarantines
        // it on the next call. Returning true here would trap the boot in
        // safe mode.
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
    //! Written 2026-05-17 — baseline cleanup.
    //!
    //! The `tests/keyring_*.rs` integration binary exists separately but is
    //! not part of this baseline's coverage measurement set
    //! (`--lib --test storage_integration ...`), so key_migration.rs showed
    //! 0%. These tests moved into an inline `#[cfg(test)]` module to secure
    //! coverage on the `--lib` path. The scenarios partly duplicate the
    //! integration binary but are more fine-grained: secure_delete, sentinel,
    //! validate_key_len, and the 5 Path branches (A, B happy, B fail, B
    //! follow-up boot keyring hit, C unavail) locked at small-function
    //! granularity.
    //!
    //! Test scenarios 8 principles:
    //!   - Happy: Path A (fresh user), Path B (disk → keyring), Path C (Linux).
    //!   - Empty input: empty connections.json (data_has_password_ciphertext = false).
    //!   - Error recovery: keyring set failure → disk preserved + sentinel.
    //!   - Concurrency: idempotent — the second boot hits the keyring only.
    //!   - State transitions: Generated → FromKeyring → MigratedFromDisk → DiskFallback → Fatal.
    //!   - try-await reject: read_disk_key with corrupt base64 / wrong length.
    //!   - No empty catches — Path B failure branches assert up to the sentinel write.
    //!
    //! `InMemoryKeyringBackend` is the same in-memory simulation as
    //! `tests/keyring_*`, so the OS keyring is never touched.
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

    // Reason (2026-07-24, issue #1625): the 3 path helper tests are repeats
    // differing only in `(fn, expected filename)` (testing-scenarios P9) —
    // recovered as table-driven. Asserts, with the values preserved, the
    // contract that every helper keeps data_dir as the parent and appends a
    // fixed filename.
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

    // Reason (2026-07-24, issue #1625): accept-32 / reject-16 / reject-empty
    // are repeats differing only in input (testing-scenarios P9) —
    // table-driven. The Err cases assert the full contract: the `Encryption`
    // variant plus the expected(32)/actual length carried in the message
    // (strengthened from a bare is_err). Boundary values 32/16/0 preserved.
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

    /// #2124 — while Path B's (c) probe read only `conn.get("password")`, a
    /// profile whose only secret was `wallet_password` sailed through the
    /// probe as "no ciphertext to validate" and reached the (d) secure
    /// delete. If even one ciphertext does not open under the disk `.key`,
    /// the probe must fail closed — preserve the disk `.key` + sentinel.
    #[test]
    fn migrate_path_b_wallet_only_ciphertext_failing_probe_preserves_disk_key() {
        let dir = TempDir::new().unwrap();
        let disk_key: Vec<u8> = (0..32u8).collect();
        // This profile's wallet ciphertext is wrapped under a key that
        // exists nowhere on this machine — migrating the disk `.key` as-is
        // still never opens the data.
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

    /// Path B follow-up boot — keyring hit only, disk key absent.
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

    /// #2111 — the same AC-356-09, but for an Oracle profile whose only
    /// secret is `wallet_password`. While the guard scanned only the
    /// `password` field, this profile was judged to have "no ciphertext to
    /// protect", Path A minted a new key, and at that moment the wallet
    /// ciphertext became permanently undecryptable. Only looking at all of
    /// `SECRET_FIELDS` takes the preserve path (Fatal).
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

    // ---------------- #1814 rekey — original preserved on failure ----------------

    /// If re-encryption fails, the original `connections.json` stays
    /// byte-identical and the disk `.key` also survives (the recovery
    /// anchor). This boot keeps working under the old key, and the next boot
    /// sees the anchor and retries the rekey.
    ///
    /// Failure injection: the temp file the re-encryption writes to is
    /// blocked with a directory.
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

    /// A successful rekey sets the flag and leaves no temp file.
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

    /// #2183 — a rekey replaces `connections.json` without going through
    /// `save_storage_raw`, so the backup beside it keeps ciphertext under the key
    /// this very boot destroys. It still parses as JSON, so a later loss would
    /// take the success branch, tell the user their connections came back, and
    /// hand them entries that no key opens. Publishing therefore drops it, and
    /// `storage::seed_backup_if_absent` makes a correct one on the next load.
    #[test]
    fn rekey_drops_a_backup_that_the_retired_key_encrypted() {
        let dir = TempDir::new().unwrap();
        let exposed_key: Vec<u8> = (0..32u8).collect();
        seed_disk_key(dir.path(), &exposed_key);
        let doc = serde_json::json!({
            "connections": [{
                "id": "c1",
                "password": encrypt("db-pw", &exposed_key).unwrap(),
                "wallet_password": "",
            }],
            "groups": [],
        });
        let connections = dir.path().join("connections.json");
        fs::write(&connections, doc.to_string()).unwrap();
        let stale_backup = crate::storage::backup_path_for(&connections);
        fs::write(&stale_backup, doc.to_string()).unwrap();

        let backend = InMemoryKeyringBackend::new_available();
        backend.set(KEYRING_ENTRY_NAME, &exposed_key).unwrap();
        let outcome = migrate_or_initialize(&backend, dir.path()).unwrap();

        assert!(outcome.rekeyed_after_disk_exposure);
        assert!(
            !stale_backup.exists(),
            "a backup encrypted under the retired key must not stay behind claiming to be a recovery"
        );
    }

    /// A boot that does not rekey does not set the flag — an ordinary
    /// keyring hit with no disk `.key`.
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

    /// Faced with a ciphertext no key opens, nothing is destroyed. Deleting
    /// only shrinks what can still be recovered (fail-closed).
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

    /// If `connections.json` does not parse, there is no telling which key
    /// is right. Defer to the next boot, after quarantine
    /// (`load_storage_raw()`).
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
