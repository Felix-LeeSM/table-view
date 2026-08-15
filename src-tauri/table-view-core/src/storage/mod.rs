pub mod corrupt_recovery;
pub mod crypto;
pub mod key_migration;
pub mod legacy_cleanup;
pub mod local;
pub mod local_files;
pub mod meta;
pub mod mismatch_metric;
pub mod reconcile;
pub mod sql_redact;

use crate::error::AppError;
use crate::models::{ConnectionConfig, ConnectionGroup, StorageData};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex, OnceLock};
use tracing::{debug, error, info, warn};
use zeroize::Zeroizing;

/// In-process lock to prevent TOCTOU race conditions between concurrent Tauri commands.
/// Storage operations are all synchronous (blocking file I/O), so std::sync::Mutex is correct.
static STORAGE_LOCK: LazyLock<std::sync::Mutex<()>> = LazyLock::new(|| std::sync::Mutex::new(()));

/// #1103 / Sprint 356 — process master key resolved once at boot by
/// [`boot_wire_master_key`] (which runs the keyring migration) and read by
/// every storage secret path. `None` until boot seeds it; the sole in-process
/// writer is boot, so the seeded key is effectively immutable at runtime.
/// P3-3 (#1455) — the raw AES key lives in a [`Zeroizing`] buffer so the
/// static and every per-decrypt clone are wiped on drop, matching the envelope
/// key path (`crypto::derive_envelope_key`). The derived `Vec<u8>` used to
/// linger in freed heap until overwritten.
static MASTER_KEY: Mutex<Option<Zeroizing<Vec<u8>>>> = Mutex::new(None);

/// #1103 — seed the process master key from the boot-time keyring migration
/// ([`key_migration::migrate_or_initialize`]). Called once from `lib.rs::run()`
/// before any IPC handler can fire.
pub fn seed_master_key(key: Vec<u8>) -> Result<(), AppError> {
    *MASTER_KEY
        .lock()
        .map_err(|e| AppError::Storage(format!("Master key lock error: {}", e)))? =
        Some(Zeroizing::new(key));
    Ok(())
}

/// Resolve the AES master key for encrypt/decrypt. Returns the boot-seeded
/// keyring key when present; otherwise (unit tests, or any call before boot
/// wiring runs) falls back to the on-disk `.key` via
/// [`crypto::get_or_create_key`], preserving the pre-#1103 behavior and its
/// #1093 orphan guard.
fn master_key() -> Result<Zeroizing<Vec<u8>>, AppError> {
    if let Some(key) = MASTER_KEY
        .lock()
        .map_err(|e| AppError::Storage(format!("Master key lock error: {}", e)))?
        .as_ref()
    {
        return Ok(key.clone());
    }
    Ok(Zeroizing::new(crypto::get_or_create_key()?))
}

/// #1103 — boot-time master-key resolution. Runs the Sprint 356 keyring
/// migration once (new install → key born in the keyring; existing plaintext
/// `.key` → migrated into the keyring then retired; headless Linux / locked
/// keychain → explicit disk fallback) and seeds the process master key. On
/// `KeySource::Fatal` (key lost but ciphertext still present) it logs and does
/// NOT seed — the decrypt path then refuses via the #1093 orphan guard, which
/// is the effective safe-mode entry. Returns the outcome so the caller can log
/// / surface the Linux-fallback state.
pub fn boot_wire_master_key() -> Result<key_migration::KeyOutcome, AppError> {
    let dir = key_migration::app_data_dir_for_keyring()?;
    let backend = crypto::OsKeyringBackend::new();
    let outcome = key_migration::migrate_or_initialize(&backend, &dir)?;
    if outcome.is_fatal() {
        error!(
            target: "boot",
            "key_migration: FATAL — master key lost but encrypted passwords present; \
             entering safe mode (decrypt disabled until the key is restored)"
        );
    } else {
        seed_master_key(outcome.key.clone())?;
    }
    Ok(outcome)
}

/// Test-only: clear the seeded master key so a subsequent storage call falls
/// back to the on-disk `.key` path. Keeps the global isolated between tests.
#[cfg(test)]
pub(crate) fn reset_master_key_for_test() {
    *MASTER_KEY.lock().expect("master key mutex poisoned") = None;
}

/// #1454 (P2-6) — test-only data-directory override. Compiled out (`None`) in a
/// shipped binary, so an attacker cannot redirect it to a directory of their
/// choosing via `TABLE_VIEW_TEST_DATA_DIR` (bypassing app-data confinement, the
/// master `.key`, and connections.json). Every data-dir resolver
/// (`storage::app_data_dir`, `storage::local::app_data_dir`,
/// `key_migration::app_data_dir_for_keyring`) routes through this one gate.
///
/// #2184 widened the gate from `debug_assertions` alone to "debug build OR test
/// build". `debug_assertions` is a *profile* signal, not a test one, so it left
/// release test builds with no isolation mechanism at all — `cargo test --release`
/// ignored the variable and every storage test then took the real user store.
/// The two added arms are compile-time and cannot be reached by a shipped app:
///
/// - `test` — this crate compiled as its own test harness, i.e. `cargo test
///   -p table-view-core`, at any profile.
/// - `feature = "testing"` — the `table-view` crate's test builds, where this
///   crate is a plain dependency and `cfg(test)` is false. `src-tauri/Cargo.toml`
///   enables that feature from `[dev-dependencies]` only, and resolver v2 keeps
///   dev-dependency features out of the normal graph, so `cargo build --release`
///   / `cargo tauri build` never turn it on. Same gate `db::testing` already
///   rides (`db/mod.rs`).
///
/// Neither arm is an environment variable or a runtime flag: a shipped binary has
/// no way to switch them on, which is the #1454 property this must not lose.
///
/// The `feature` arm moved that property from "unconditional at compile time" to
/// "true of the build graph", so it is measured rather than asserted in prose.
/// The `Test-only data-dir override stays out of the release graph` step in
/// `.github/workflows/ci.yml` asks cargo one question:
///
/// > `cargo tree -i table-view-core --edges normal --format '{f}'` must not
/// > list `testing`.
///
/// `--edges normal` picks the graph `cargo build --release` resolves from, and
/// `{f}` prints the features cargo actually resolved for the package there. Both
/// halves carry weight:
///
/// - Reading the *resolved set* rather than the manifest text covers every way
///   of naming the feature for a normal dependency — core's own
///   `[features] default`, an inline table, a `[dependencies.table-view-core]`
///   table, a `default = ["table-view-core/testing"]` forward, a renamed
///   `package = ...` entry, a TOML literal string — without knowing any of the
///   spellings in advance.
/// - Reading the resolved set rather than the *edge labels* is what makes it
///   see feature resolver 1, under which a dev-dependency's features unify into
///   a plain `cargo build`. #2184 shipped this as `-e features ... | grep
///   'feature "testing"'`, an edge-label read, and #2161 re-measured it blind:
///   on a throwaway probe with a resolver-1 virtual workspace the release binary
///   compiled with the feature ON while the edge view still printed only
///   `feature "default"` — the `{f}` view printed `default,testing`.
///
/// `src-tauri/Cargo.toml` is the workspace root and pins `resolver = "2"`. A
/// virtual manifest added above it without that key is the live form of the
/// hazard, and the step above sees it.
#[cfg(any(debug_assertions, test, feature = "testing"))]
pub(crate) fn data_dir_override() -> Option<PathBuf> {
    std::env::var_os("TABLE_VIEW_TEST_DATA_DIR").map(PathBuf::from)
}

#[cfg(not(any(debug_assertions, test, feature = "testing")))]
pub(crate) fn data_dir_override() -> Option<PathBuf> {
    None
}

/// #2184 — the app's real data directory, and the ONLY value in this crate that
/// may name it. Empty until [`init_production_data_dir`] injects it at boot.
///
/// Before this, `app_data_dir()` *defaulted* to `dirs::data_local_dir()/table-view`
/// and a caller had to opt **out** — via `TABLE_VIEW_TEST_DATA_DIR` — to stay off
/// the developer's real store. Forgetting the opt-out was silent, and storage is
/// not read-only there: it quarantines `connections.json` on a parse error and
/// rewrites it empty, quarantines `state.db`, and creates or replaces the master
/// `.key`. #2183 lost a real machine's saved connections that way on 2026-08-06.
///
/// So the default is flipped: the real store is unreachable to any process that
/// did not explicitly ask for it. Every test binary, every `[[bin]]` target and
/// every entry point added later is isolated by construction rather than by the
/// convention of remembering to set an env var.
///
/// This is the half that cannot be a `cfg` — gating a panic on `cfg(test)` would
/// have missed everything under `src-tauri/tests/`, which links this crate as a
/// plain dependency where `cfg(test)` is false. The `cfg` on
/// [`data_dir_override`] above solves a different problem: it decides who is
/// *allowed* to name a directory, not what happens when nobody did.
static PROD_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// #2184 — hand storage the real user data directory. The Tauri `setup` hook
/// calls this once at boot, before `boot_wire_master_key` and before any IPC can
/// fire; a process that never calls it cannot resolve the real store at all
/// ([`app_data_dir`] returns `Err`).
///
/// Creates the directory so the boot fails here, loudly, rather than at the first
/// write. Idempotent: a second call is a no-op, so a re-entrant boot is not an
/// error.
///
/// Do NOT call this from a test. It is process-global and permanent — one call
/// re-arms the real-store default for every later test in the same binary, which
/// is the exact failure this guard exists to remove.
pub fn init_production_data_dir() -> Result<(), AppError> {
    let dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| AppError::Storage("Cannot determine app data directory".into()))?
        .join("table-view");
    fs::create_dir_all(&dir)?;
    let _ = PROD_DATA_DIR.set(dir);
    Ok(())
}

/// #2184 — the single data-directory decision for the whole crate.
/// [`local::app_data_dir`] and [`key_migration::app_data_dir_for_keyring`] are
/// one-line delegations to it. Each of the three used to carry its own copy of
/// the resolve-or-fall-back body, so the #2183 hole was open in three places at
/// once and a fix to one copy left the other two on the real store.
/// `only_one_place_in_this_crate_names_the_real_data_dir` in this module's tests
/// is what keeps a fourth copy from being written.
pub(crate) fn app_data_dir() -> Result<PathBuf, AppError> {
    let dir = app_data_dir_path().ok_or_else(|| {
        AppError::Storage(
            "app data directory not resolved: no TABLE_VIEW_TEST_DATA_DIR override and \
             storage::init_production_data_dir() was never called (#2184). In the app, \
             the Tauri setup hook must call it before any storage path runs. In a test, \
             do NOT call it — it would point storage at the real user store; instead set \
             TABLE_VIEW_TEST_DATA_DIR to a temp dir, keep that dir alive for the whole \
             test, and mark the test #[serial] because the variable is process-global."
                .into(),
        )
    })?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// #2184 — where the app's data directory *would* be, without creating it and
/// without failing when this process has none.
///
/// [`local::reject_internal_app_data_path`] is the only caller: it asks the
/// read-only question "does this path fall inside the app's own directory?", and
/// answering it should neither create that directory nor turn every export /
/// import / connect into an error in a process that has no directory to protect.
/// `None` means exactly that — no injection and no override, so this process has
/// no `connections.json`, no `.key` and no `state.db`, and the confined set is
/// empty. The app never sees `None`: `lib.rs::setup` injects before the first IPC
/// handler can fire and exits the process if that injection fails.
pub(crate) fn app_data_dir_path() -> Option<PathBuf> {
    data_dir_override().or_else(|| PROD_DATA_DIR.get().cloned())
}

/// #2183 — `true` once this process found `connections.json` gone and put back a
/// backup that held something ([`is_worth_protecting`]). A backup that parses to
/// an empty document is still written back, and leaves this `false`: it returned
/// nothing, so there is nothing to claim. `get_initial_app_state` swaps it into
/// `InitialAppState.connections_restored_from_backup`, which the frontend turns
/// into a toast — the same boot-flag-to-toast wiring
/// [`corrupt_recovery::DID_RECOVER`] uses for a quarantined `state.db`.
///
/// It is deliberately a second flag rather than that one, because the two events
/// need opposite sentences and name different files: `DID_RECOVER` says the app
/// state was reset and the old copy sits in `state.db.bak`, this one says the
/// stored connections and groups came back from `connections.json.bak` and
/// nothing was reset. Either half of that store raises it on its own, so the
/// sentence it drives has to name both — a groups-only backup raises this over a
/// connection list that is still empty afterwards.
/// Reusing `DID_RECOVER` would have shown the user the reset message on a
/// restore and pointed them at a file that has none of their connections.
pub static CONNECTIONS_RESTORED_FROM_BACKUP: AtomicBool = AtomicBool::new(false);

fn storage_file_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("connections.json"))
}

/// #2183 — the backup that sits beside a `connections.json`, **inside** the app
/// data directory (owner decision 2026-08-06: a backup outside that directory
/// was proposed and not adopted).
///
/// Takes the file rather than resolving it, so the one other writer that
/// replaces `connections.json` without going through [`save_storage_raw`] —
/// `key_migration::publish_connections_atomically`, which already holds the
/// directory — names the same file without a second copy of the suffix.
pub(crate) fn backup_path_for(path: &std::path::Path) -> PathBuf {
    let mut name = path.to_path_buf().into_os_string();
    name.push(".bak");
    PathBuf::from(name)
}

/// The backup for this process's own `connections.json`.
fn storage_backup_path() -> Result<PathBuf, AppError> {
    Ok(backup_path_for(&storage_file_path()?))
}

/// #2187 — the one question every backup decision asks: does this document hold
/// anything a backup could put back?
///
/// There is a single backup slot, so writing a document with no connections and
/// no groups into it is not a cheap no-op — it destroys the generation that was
/// there, which was the last copy that parses. And restoring such a document puts
/// nothing back, so announcing it as a recovery hands the user a sentence their
/// empty connection list contradicts.
///
/// Three callers ask it and they have to agree, because the same empty document
/// reaches all three: [`seed_backup_if_absent`] before copying one into the slot,
/// [`save_storage_raw`] before renaming one into it, and
/// [`restore_from_backup_or_start_empty`] before reporting a restore. #2186
/// shipped the question inline in the first of those, where it guarded only the
/// seed; the other two paths kept producing and then announcing the empty backup
/// it was written to prevent.
fn is_worth_protecting(data: &StorageData) -> bool {
    !data.connections.is_empty() || !data.groups.is_empty()
}

/// Load storage from disk WITHOUT decrypting passwords. Each connection's
/// `password` field still holds the on-disk ciphertext (or "" when no
/// password is set). Use this when a function will not return password data
/// to its caller — passing through ciphertext is safer than decrypting and
/// re-encrypting (and avoids changing nonces unnecessarily).
fn load_storage_raw() -> Result<StorageData, AppError> {
    let path = storage_file_path()?;
    if !path.exists() {
        return restore_from_backup_or_start_empty();
    }

    let content = fs::read_to_string(&path)?;
    let data: StorageData = match serde_json::from_str(&content) {
        Ok(data) => {
            seed_backup_if_absent(&path, &data);
            data
        }
        Err(parse_err) => {
            // Corrupt JSON: a Serde error here would force the user to lose
            // all stored connections. Quarantine the file and start clean
            // so the user keeps a recoverable backup on disk and the app
            // remains usable.
            let backup = quarantine_corrupt_storage(&path)?;
            warn!(
                "connections.json failed to parse ({}); quarantined to {} and starting with empty storage",
                parse_err,
                backup.display()
            );
            let default = StorageData {
                connections: vec![],
                groups: vec![],
            };
            save_storage_raw(&default)?;
            default
        }
    };
    debug!("Loaded {} connections (raw)", data.connections.len());
    Ok(data)
}

/// #2183 — make sure a `connections.json` that just loaded has a backup, even
/// if it has not been saved since this build shipped.
///
/// Without this, [`save_storage_raw`] is the only thing that ever creates one,
/// and the read paths never save. Every install that predates this build would
/// therefore carry no backup until the user's next add / edit / delete, and a
/// file lost inside that window would be read as a first run and silently
/// replaced with an empty one — the exact #2183 behavior. The user this issue
/// came from is in that window right now. Seeding here moves the protection from
/// "next mutation" to "next launch".
///
/// Two conditions, both load-bearing:
///
/// - only when the parse succeeded, so the empty document written after a
///   corrupt-file quarantine can never become the backup;
/// - only when there is something to protect ([`is_worth_protecting`]). An
///   install with no connections and no groups has nothing to lose, and seeding
///   it would spend the one backup slot on a document that puts nothing back.
///   The restore path refuses to announce such a document, so what an empty seed
///   costs is not a false claim to the user — it is the slot a real generation
///   would have taken.
///
/// A copy, not the rename [`save_storage_raw`] uses: there the old file is being
/// replaced anyway, here it has to stay. A copy interrupted midway leaves a
/// truncated backup, which the restore path reports and sets aside instead of
/// trusting — never worse than the no-backup state it replaces, which is why
/// this is not worth a second temp-file dance.
///
/// Failures are logged and swallowed on purpose. This is a read path: a data
/// directory that cannot take the copy must not turn every connection list in
/// the app into an error. `save_storage_raw` propagates the same class of
/// failure because a save can be retried with the file still intact.
fn seed_backup_if_absent(path: &std::path::Path, data: &StorageData) {
    if !is_worth_protecting(data) {
        return;
    }
    let backup = backup_path_for(path);
    if backup.exists() {
        return;
    }
    match fs::copy(path, &backup) {
        Ok(_) => info!(
            "seeded {} from the connections file that had none (#2183)",
            backup.display()
        ),
        Err(e) => warn!(
            "could not seed {} ({}); the connections file stays unprotected until the next save",
            backup.display(),
            e
        ),
    }
}

/// #2183 — `connections.json` is not there. Until this, that answer was one
/// `info!` line followed by a write of an empty file, which turned an absence
/// into a permanent loss: after the write there was nothing left on disk to
/// recover from. On 2026-08-06 a user's machine lost every saved connection
/// through exactly that path, and the app was what made it final.
///
/// A missing file is two different events, and the backup is what tells them
/// apart. Both writers of that backup — [`save_storage_raw`] on a save and
/// [`seed_backup_if_absent`] on a successful load — only ever run with a
/// `connections.json` in hand, so its presence means this install has held one:
///
/// - a backup is there → connections or groups were here and the file they lived
///   in is gone. Put them back, `warn!`, and — when what came back holds
///   something ([`is_worth_protecting`]) — raise
///   [`CONNECTIONS_RESTORED_FROM_BACKUP`] so the boot snapshot can tell the user.
///   A backup that parses to an empty document takes the same write and none of
///   the announcement: it put nothing back, and a recovery notice over an empty
///   list is a sentence the user's own screen contradicts.
/// - no backup → **there is nothing to put back**, so start empty and stay
///   quiet (acceptance ③ — a warning on every first launch would be a new
///   defect). Note what this arm does *not* claim: it cannot tell a genuine
///   first run from a loss that happened before any backup existed. It said so
///   until seeding closed the gap, and the reason for silence is the absence of
///   a recovery source, never a conclusion that nothing was lost.
///
/// A backup that cannot be read or parsed restores nothing and is moved aside
/// with a timestamp instead of being left in place. With `connections.json` gone
/// it is the user's only remaining copy, and leaving it under its own name would
/// hand it to a later save's rename. Not to the empty file this function just
/// wrote — [`is_worth_protecting`] keeps that one out of the slot — but to the
/// first save that replaces a document holding something, which is where the last
/// copy would actually go. Moving it is what makes "kept for manual recovery"
/// survive that save and not merely this boot.
fn restore_from_backup_or_start_empty() -> Result<StorageData, AppError> {
    let empty = StorageData {
        connections: vec![],
        groups: vec![],
    };
    let backup = storage_backup_path()?;

    let content = match fs::read_to_string(&backup) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            info!("Storage file not found, creating default");
            save_storage_raw(&empty)?;
            return Ok(empty);
        }
        Err(e) => {
            warn!(
                "connections.json is missing and its backup {} could not be read ({}); \
                 starting empty",
                backup.display(),
                e
            );
            set_aside_unusable_backup(&backup);
            save_storage_raw(&empty)?;
            return Ok(empty);
        }
    };

    let data: StorageData = match serde_json::from_str(&content) {
        Ok(data) => data,
        Err(parse_err) => {
            warn!(
                "connections.json is missing and its backup {} failed to parse ({}); \
                 starting empty",
                backup.display(),
                parse_err
            );
            set_aside_unusable_backup(&backup);
            save_storage_raw(&empty)?;
            return Ok(empty);
        }
    };

    warn!(
        "connections.json was missing; restored connections={} groups={} from {}",
        data.connections.len(),
        data.groups.len(),
        backup.display()
    );
    save_storage_raw(&data)?;
    // #2187 ② — the flag is a claim that something came back, so it is raised only
    // when something did. A backup that parses to an empty document reaches this
    // point on the success branch, and raising it there showed the user a sticky
    // recovery toast over a list that was still empty underneath it.
    if is_worth_protecting(&data) {
        CONNECTIONS_RESTORED_FROM_BACKUP.store(true, Ordering::SeqCst);
    }
    Ok(data)
}

/// #2183 — a backup that could not be used is still the user's last copy, so it
/// is moved to a timestamped name rather than deleted or left where it is.
///
/// Leaving it in place would not preserve it: `connections.json` is missing and
/// the caller is about to write an empty one. That empty document cannot take the
/// slot — [`is_worth_protecting`] refuses it — but the user's next real change
/// can, because the save that follows it renames a document holding something
/// straight over this file. Moving it out of the slot is what makes it outlive
/// that save, and it lands under the same `.corrupt-<ts>` convention the
/// corrupt-`connections.json` path already uses.
///
/// Best-effort by design: this is a recovery that already failed, so a rename
/// that also fails must not turn into a boot error on top of it. The `warn!`
/// above has already named the file either way.
fn set_aside_unusable_backup(backup: &std::path::Path) {
    match quarantine_corrupt_storage(backup) {
        Ok(kept) => warn!(
            "kept the unusable backup at {} for manual recovery",
            kept.display()
        ),
        Err(e) => warn!(
            "could not move the unusable backup {} aside ({}); a later save will replace it",
            backup.display(),
            e
        ),
    }
}

/// Move a corrupt storage file aside with a timestamped suffix so the user
/// can inspect / recover it manually and the app can boot clean. Returns the
/// quarantine path on success.
///
/// Issue #2302 — the name is taken through
/// [`corrupt_recovery::claim_quarantine_path`] rather than handed straight to
/// `fs::rename`, which replaces an existing destination on Unix with no error
/// and no log. The timestamp below is second-resolution, so two quarantines
/// inside one second built the same name and the second one ate the file the
/// first had just set aside — the user's only remaining copy of a document that
/// no longer parses. `corrupt_recovery::quarantine` takes its name the same way;
/// the base names differ (`.corrupt-<ts>` here, `.bak` there) because they are
/// different files with conventions their own callers and tests already read,
/// but the rule that keeps two quarantines off one name is shared.
fn quarantine_corrupt_storage(path: &std::path::Path) -> Result<PathBuf, AppError> {
    let ts = corrupt_recovery::quarantine_timestamp();
    let mut preferred = path.to_path_buf();
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("connections.json");
    preferred.set_file_name(format!("{file_name}.corrupt-{ts}"));
    let backup = corrupt_recovery::claim_quarantine_path(&preferred)?;
    fs::rename(path, &backup)?;
    Ok(backup)
}

/// Save storage to disk WITHOUT re-encrypting passwords. Each connection's
/// `password` field MUST already contain ciphertext (or be empty).
///
/// Atomic write: write into a sibling tempfile, fsync, then rename. A crash
/// mid-write therefore never leaves a half-written connections.json.
/// On Unix the 0600 mode is applied at create time so the data never lives
/// in a world-readable file even momentarily.
fn save_storage_raw(data: &StorageData) -> Result<(), AppError> {
    let path = storage_file_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Storage("Storage path has no parent directory".into()))?;
    let json = serde_json::to_string_pretty(data)?;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp_path = parent.join(format!(
        "connections.json.tmp.{}.{}",
        std::process::id(),
        nanos
    ));

    {
        let mut opts = fs::OpenOptions::new();
        opts.create(true).truncate(true).write(true);
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

    // #2183 — keep the generation this write replaces, so a `connections.json`
    // that later goes missing can be put back (`restore_from_backup_or_start_empty`).
    //
    // `rename` rather than a copy: it moves a directory entry, so the backup is
    // whole or absent and can never be a half-written last copy. The window it
    // opens — `connections.json` missing between the two renames — is the very
    // state the load path now recovers from, so a crash inside it heals on the
    // next boot.
    //
    // It runs after the tmp file is complete so a save that fails while writing
    // tmp leaves both files alone, instead of spending the single backup slot on
    // a write that never landed.
    //
    // #2187 — and only when the file being replaced holds something
    // (`is_worth_protecting`). Presence used to be the whole test, which made the
    // corrupt-boot path destroy the recovery one step later than anyone looked:
    // `load_storage_raw` quarantines the unparseable file and saves an empty
    // document in its place, so the *next* save found a present `connections.json`
    // and renamed that empty document over a good backup. What was left on disk
    // was the quarantine file, which by definition does not parse.
    //
    // A file that does not parse answers `false` as well. It cannot feed
    // `restore_from_backup_or_start_empty` — that path sets an unparseable backup
    // aside instead of trusting it — so moving it into the slot would spend the
    // last parseable copy on bytes the restore refuses. Reaching here with one is
    // not possible in-process anyway: every save runs under `STORAGE_LOCK` after a
    // `load_storage_raw` that has already quarantined an unparseable file.
    let replaced_is_worth_keeping = fs::read_to_string(&path)
        .inspect_err(|e| {
            // A missing file is the ordinary answer on a first save and stays
            // quiet. Any other read error means the question could not be asked,
            // and the answer is still `false` — this save replaces whatever is on
            // disk without keeping a copy of it, which is the shape of the loss
            // #2183 was reported for. Every other best-effort failure in this
            // module logs (`seed_backup_if_absent`, `set_aside_unusable_backup`);
            // so does this one, so the day a caller reaches it the generation does
            // not go silently.
            if e.kind() != std::io::ErrorKind::NotFound {
                warn!(
                    "could not read {} before replacing it ({}); saving without keeping a backup of it",
                    path.display(),
                    e
                );
            }
        })
        .ok()
        .and_then(|existing| serde_json::from_str::<StorageData>(&existing).ok())
        .is_some_and(|existing| is_worth_protecting(&existing));
    if replaced_is_worth_keeping {
        let backup = storage_backup_path()?;
        if let Err(e) = fs::rename(&path, &backup) {
            let _ = fs::remove_file(&tmp_path); // best-effort: leave no orphan
            return Err(e.into());
        }
    }

    if let Err(e) = fs::rename(&tmp_path, &path) {
        let _ = fs::remove_file(&tmp_path); // best-effort: leave no orphan
        return Err(e.into());
    }

    debug!("Saved {} connections (raw)", data.connections.len());
    Ok(())
}

/// Acquire the storage lock and load data. The caller must hold the lock
/// for the entire load-modify-save cycle.
fn with_lock<F, T>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError>,
{
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|e| AppError::Storage(format!("Storage lock error: {}", e)))?;
    f()
}

// --- Public API (each acquires STORAGE_LOCK to prevent TOCTOU) ---

/// Load storage with passwords cleared. Each `ConnectionConfig.password` is
/// returned as an empty string regardless of whether one is stored on disk.
/// Use this for any path that ends in IPC/HTTP/file output.
pub fn load_storage_redacted() -> Result<StorageData, AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;
        for conn in &mut data.connections {
            conn.password.clear();
            // #1065 — the Oracle wallet password is a secret with the same
            // IPC contract as `password`; never let its ciphertext reach a
            // frontend-bound payload.
            conn.wallet_password.clear();
        }
        Ok(data)
    })
}

/// Load storage with passwords decrypted. Use ONLY when a real database
/// connection is about to be made; never expose the result to the frontend.
pub fn load_storage_with_secrets() -> Result<StorageData, AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;
        let key = master_key()?;
        for conn in &mut data.connections {
            if !conn.password.is_empty() {
                conn.password = crypto::decrypt(&conn.password, &key)?;
            }
            // #1065 — decrypt the Oracle wallet password on the same connect
            // path so the adapter can hand it to the driver.
            if !conn.wallet_password.is_empty() {
                conn.wallet_password = crypto::decrypt(&conn.wallet_password, &key)?;
            }
        }
        Ok(data)
    })
}

/// Returns whether each connection currently has a stored password,
/// indexed by connection id. Cheap (no decryption performed).
pub fn password_presence_map() -> Result<std::collections::HashMap<String, bool>, AppError> {
    with_lock(|| {
        let data = load_storage_raw()?;
        Ok(data
            .connections
            .into_iter()
            .map(|c| (c.id, !c.password.is_empty()))
            .collect())
    })
}

/// Decrypt the password for a single connection. Returns:
/// - `Ok(None)` when the connection does not exist
/// - `Ok(Some(""))` when the connection exists with no password
/// - `Ok(Some(plaintext))` when the connection has a stored password
pub fn get_decrypted_password(id: &str) -> Result<Option<String>, AppError> {
    with_lock(|| {
        let data = load_storage_raw()?;
        let conn = data.connections.iter().find(|c| c.id == id);
        match conn {
            None => Ok(None),
            Some(c) if c.password.is_empty() => Ok(Some(String::new())),
            Some(c) => {
                let key = master_key()?;
                Ok(Some(crypto::decrypt(&c.password, &key)?))
            }
        }
    })
}

/// #1065 — decrypt the Oracle wallet password for a single connection, same
/// 3-value contract as [`get_decrypted_password`]. Used by `test_connection`
/// to substitute the stored wallet password when the dialog omits it.
pub fn get_decrypted_wallet_password(id: &str) -> Result<Option<String>, AppError> {
    with_lock(|| {
        let data = load_storage_raw()?;
        let conn = data.connections.iter().find(|c| c.id == id);
        match conn {
            None => Ok(None),
            Some(c) if c.wallet_password.is_empty() => Ok(Some(String::new())),
            Some(c) => {
                let key = master_key()?;
                Ok(Some(crypto::decrypt(&c.wallet_password, &key)?))
            }
        }
    })
}

/// #1065 — whether each connection currently has a stored wallet password,
/// indexed by id. Cheap (no decryption). Mirrors [`password_presence_map`].
pub fn wallet_password_presence_map() -> Result<std::collections::HashMap<String, bool>, AppError> {
    with_lock(|| {
        let data = load_storage_raw()?;
        Ok(data
            .connections
            .into_iter()
            .map(|c| (c.id, !c.wallet_password.is_empty()))
            .collect())
    })
}

/// Save a connection. `new_password` semantics:
/// - `None`     → preserve the existing ciphertext (or empty for new ids)
/// - `Some("")` → explicitly clear the password
/// - `Some(s)`  → encrypt `s` and store
///
/// The Oracle wallet password is preserved unchanged (`None`); use
/// [`save_connection_with_wallet`] to update it.
pub fn save_connection(
    conn: ConnectionConfig,
    new_password: Option<String>,
) -> Result<(), AppError> {
    save_connection_with_wallet(conn, new_password, None)
}

/// #1065 — save a connection resolving both the DB password and the Oracle
/// wallet password with identical 3-state semantics (`None` preserve /
/// `Some("")` clear / `Some(s)` encrypt+store). Split from [`save_connection`]
/// so the ~20 non-Oracle callers keep the 2-arg signature.
pub fn save_connection_with_wallet(
    mut conn: ConnectionConfig,
    new_password: Option<String>,
    new_wallet_password: Option<String>,
) -> Result<(), AppError> {
    // #1649 (ADR 0058) — the single chokepoint every file-SOT writer passes
    // through (the `save_connection` IPC, the dual-write `persist_connection`
    // IPC, and import). Guarding here rather than in each caller is what keeps
    // `verify-ca` from ever being stored without the CA file it names.
    crate::db::tls::validate_tls_posture(&conn)?;
    with_lock(|| {
        let mut data = load_storage_raw()?;

        // Check for duplicate name
        if data
            .connections
            .iter()
            .any(|c| c.id != conn.id && c.name == conn.name)
        {
            return Err(AppError::Validation(format!(
                "Connection with name '{}' already exists",
                conn.name
            )));
        }

        let existing = data.connections.iter().find(|c| c.id == conn.id);
        let resolve = |new: Option<String>, current: Option<&String>| -> Result<String, AppError> {
            match new {
                Some(s) if !s.is_empty() => {
                    let key = master_key()?;
                    crypto::encrypt(&s, &key)
                }
                Some(_) => Ok(String::new()),
                None => Ok(current.cloned().unwrap_or_default()),
            }
        };
        conn.password = resolve(new_password, existing.map(|c| &c.password))?;
        conn.wallet_password = resolve(new_wallet_password, existing.map(|c| &c.wallet_password))?;

        if let Some(existing) = data.connections.iter_mut().find(|c| c.id == conn.id) {
            *existing = conn;
        } else {
            data.connections.push(conn);
        }

        save_storage_raw(&data)
    })
}

pub fn delete_connection(id: &str) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;
        let initial_len = data.connections.len();
        data.connections.retain(|c| c.id != id);

        if data.connections.len() == initial_len {
            return Err(AppError::NotFound(format!("Connection '{}' not found", id)));
        }

        save_storage_raw(&data)
    })
}

pub fn save_group(group: ConnectionGroup) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

        if let Some(existing) = data.groups.iter_mut().find(|g| g.id == group.id) {
            *existing = group;
        } else {
            data.groups.push(group);
        }

        save_storage_raw(&data)
    })
}

pub fn delete_group(id: &str) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

        let initial_len = data.groups.len();
        data.groups.retain(|g| g.id != id);
        if data.groups.len() == initial_len {
            return Err(AppError::NotFound(format!("Group '{}' not found", id)));
        }

        // Move connections from deleted group to root
        for conn in &mut data.connections {
            if conn.group_id.as_deref() == Some(id) {
                conn.group_id = None;
            }
        }

        save_storage_raw(&data)
    })
}

pub fn move_connection_to_group(
    connection_id: &str,
    group_id: Option<&str>,
) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

        let conn = data
            .connections
            .iter_mut()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| {
                AppError::NotFound(format!("Connection '{}' not found", connection_id))
            })?;

        conn.group_id = group_id.map(String::from);
        save_storage_raw(&data)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SslMode;
    use crate::models::{ConnectionConfig, ConnectionGroup, DatabaseType};
    use serial_test::serial;
    use tempfile::TempDir;

    /// Helper: set up a temp directory as the test data dir.
    /// Returns the TempDir which must be kept alive for the duration of the test.
    fn setup_test_env() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        dir
    }

    fn cleanup_test_env() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    // Issue #1454 (P2-6) / #2184 — the `TABLE_VIEW_TEST_DATA_DIR` override is
    // honored in a debug build or a test build, and compiled out of a shipped
    // binary so it can never be redirected to an attacker-chosen data dir.
    //
    // No `cargo test` can observe the `None` branch: `cfg(test)` is one of the
    // arms that selects the honoring definition, so the branch this asserts is
    // the only one a test binary ever links. `cfg(not(any(debug_assertions, test,
    // feature = "testing")))` is what guarantees the other one, and the CI step
    // named in that function's docs is what proves the `feature` arm stays out of
    // the release graph.
    //
    // Deliberately NOT `#[cfg(debug_assertions)]` (#2184): gating the only test
    // that asserts the gate on the profile deleted it from `--release` and
    // `debug-assertions=off` runs — the exact builds this PR restored isolation
    // for. It compiles and passes in all three.
    #[test]
    #[serial]
    fn data_dir_override_honors_env_in_any_test_build() {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        assert_eq!(data_dir_override(), Some(dir.path().to_path_buf()));
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    // -------------------------------------------------------------------
    // #2184 — the real user data directory is injected, never defaulted.
    // -------------------------------------------------------------------

    /// The guard itself. With no `TABLE_VIEW_TEST_DATA_DIR` override and no
    /// `init_production_data_dir()` injection, every resolver must refuse rather
    /// than hand back the developer's real store — that store is what #2183 lost.
    ///
    /// All three resolvers are asserted here on purpose. `local::app_data_dir`
    /// and `key_migration::app_data_dir_for_keyring` each used to own a private
    /// copy of the resolution, so a test covering only this module's
    /// `app_data_dir` would stay green while the other two still resolved.
    ///
    /// It doubles as the caller guard on [`init_production_data_dir`]. That
    /// function is `pub` and a single call re-arms the real-store default for
    /// every later test in the same process — `PROD_DATA_DIR` is a `OnceLock`, so
    /// there is no undo. A test in this binary that called it would not slip past
    /// this assertion; it would break it loudly, at the `panic!` below naming the
    /// directory that got resolved. So the rule is enforced here for this binary
    /// rather than by the doc comment on that function.
    ///
    /// The `table-view` crate's test binaries have no equivalent assertion, and a
    /// call from one of them would only affect that one process (#2184, N5).
    #[test]
    #[serial]
    fn no_resolver_reaches_the_real_data_dir_without_injection() {
        cleanup_test_env();

        for (name, resolved) in [
            ("storage::app_data_dir", app_data_dir()),
            ("storage::local::app_data_dir", local::app_data_dir()),
            (
                "key_migration::app_data_dir_for_keyring",
                key_migration::app_data_dir_for_keyring(),
            ),
        ] {
            let err = match resolved {
                Err(e) => e,
                Ok(dir) => panic!(
                    "{name} resolved to {} with neither an override nor an injection — \
                     that is the user's real store",
                    dir.display()
                ),
            };
            assert!(
                matches!(&err, AppError::Storage(msg)
                    if msg.contains("init_production_data_dir")
                        && msg.contains("TABLE_VIEW_TEST_DATA_DIR")),
                "{name} must name both fixes (inject at boot / override in a test), got: {err:?}"
            );
        }
    }

    /// The positive half of "one decision, three callers": with the override set,
    /// all three resolvers return the *same* directory.
    ///
    /// It catches what the test above cannot. Measured on this branch by mutating
    /// `local::app_data_dir` to `Ok(crate::storage::app_data_dir()?.join("sqlite"))`
    /// — a copy that still honors the override, so
    /// `no_resolver_reaches_the_real_data_dir_without_injection` stays green while
    /// this one turns red.
    #[test]
    #[serial]
    fn all_resolvers_share_one_decision() {
        let dir = setup_test_env();
        let expected = dir.path();

        assert_eq!(app_data_dir().unwrap(), expected);
        assert_eq!(local::app_data_dir().unwrap(), expected);
        assert_eq!(key_migration::app_data_dir_for_keyring().unwrap(), expected);

        cleanup_test_env();
    }

    /// The two tests above pin today's three resolvers. This one keeps a fourth
    /// from being written: in this crate the OS user-data lookup may appear in
    /// exactly one place, `init_production_data_dir`. Any other function that
    /// performs it resolves the real store on its own and the injection guard
    /// never sees it — which is exactly how `local.rs` and `key_migration.rs` came
    /// to hold private copies. Scanning the source rather than listing the known
    /// call sites is what makes a *new* file fail on the day it lands.
    ///
    /// The needle is the `dirs::` crate, not one function in it. Counting the
    /// literal `data_local_dir` would have measured a spelling: a fourth resolver
    /// written with `dirs::data_dir()`, `dirs::home_dir()` or `dirs::config_dir()`
    /// reaches a user directory just as well and would have left the count at 1.
    /// `dirs::` is the whole surface through which this crate can learn where the
    /// user's files live, so it is the thing to hold at one site.
    ///
    /// Would this guard have caught what #2184 cleaned up? At the base commit the
    /// non-comment `dirs::` lines were 6, spread over 3 files: `mod.rs`,
    /// `local.rs` and `key_migration.rs`, two lines each. This PR removes the
    /// `local.rs` and `key_migration.rs` copies, so the guard covers 2 of the 2
    /// files it cleaned up. The assertion is on the file set rather than a line
    /// count because the surviving lookup is one expression split across two
    /// lines (`data_local_dir()` then `.or_else(dirs::data_dir)`), which a
    /// reformat would renumber.
    /// `git grep -n 'dirs::' 02d70e28 -- src-tauri/table-view-core/src | grep -v ':[0-9]*: *//'`
    #[test]
    fn only_one_place_in_this_crate_names_the_real_data_dir() {
        // Assembled at compile time so this scanner does not match its own line.
        let needle = concat!("dirs", "::");

        // Keyed by the path relative to `src`, never by the bare file name: this
        // crate has a `mod.rs` in eight directories, so `storage/mod.rs` and
        // `db/mod.rs` collapse to the same name and a copy written in the latter
        // would leave the set unchanged.
        fn scan(
            root: &std::path::Path,
            dir: &std::path::Path,
            needle: &str,
            hits: &mut Vec<String>,
        ) {
            for entry in fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    scan(root, &path, needle, hits);
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                    continue;
                }
                let rel = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                let body = fs::read_to_string(&path).unwrap();
                for (i, line) in body.lines().enumerate() {
                    // Prose may discuss the lookup; only code counts.
                    if !line.trim_start().starts_with("//") && line.contains(needle) {
                        hits.push(format!("{rel}:{}", i + 1));
                    }
                }
            }
        }

        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut hits = Vec::new();
        scan(&src, &src, needle, &mut hits);
        hits.sort();

        let files: std::collections::BTreeSet<&str> =
            hits.iter().map(|h| h.rsplit_once(':').unwrap().0).collect();
        assert_eq!(
            files,
            ["storage/mod.rs"].into_iter().collect(),
            "the OS user-data lookup must stay inside storage::init_production_data_dir. \
             Any other site resolves the real user store on its own and never passes the \
             #2184 injection guard — delegate to storage::app_data_dir() instead. Found: \
             {hits:?}"
        );
    }

    /// Test helper: previous-style save that treats the conn.password field
    /// as the source of truth for the new password. Equivalent to the old
    /// single-arg `save_connection`.
    fn save_conn(conn: ConnectionConfig) -> Result<(), AppError> {
        let pw = Some(conn.password.clone());
        save_connection(conn, pw)
    }

    fn load_storage() -> Result<StorageData, AppError> {
        load_storage_with_secrets()
    }

    fn sample_connection(id: &str, name: &str) -> ConnectionConfig {
        ConnectionConfig {
            id: id.to_string(),
            name: name.to_string(),
            db_type: DatabaseType::Postgresql,
            host: "localhost".to_string(),
            port: 5432,
            user: "postgres".to_string(),
            password: "testpass".to_string(),
            database: "testdb".to_string(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::Prefer,
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        }
    }

    fn sample_group(id: &str, name: &str) -> ConnectionGroup {
        ConnectionGroup {
            id: id.to_string(),
            name: name.to_string(),
            color: None,
            collapsed: false,
        }
    }

    #[test]
    #[serial]
    fn save_connection_rejects_verify_ca_without_a_ca_file() {
        // Reason: #1649 (ADR 0058) — this is the chokepoint half of the
        // fail-closed contract. `db::tls` owns the rule, but only a test here
        // proves the writer actually consults it: every file-SOT writer (the
        // `save_connection` IPC, the dual-write `persist_connection` IPC, and
        // import) routes through this function, so deleting the
        // `validate_tls_posture` call would leave the rule's own unit tests green
        // while unanchored `verify-ca` rows started landing on disk. The
        // "nothing was written" assertion is what separates a rejection from a
        // write-then-error. (2026-08-02)
        let _dir = setup_test_env();

        let mut conn = sample_connection("c-ca", "PG private CA");
        conn.ssl_mode = SslMode::VerifyCa;
        conn.ca_cert_path = None;
        let err = save_conn(conn.clone())
            .expect_err("verify-ca without a CA file must not reach the file SOT");
        assert!(
            matches!(err, AppError::Validation(ref msg) if msg.contains("verify-ca")
                && msg.contains("CA certificate")),
            "the rejection must name the missing CA file, got: {err:?}"
        );
        assert!(
            load_storage().unwrap().connections.is_empty(),
            "a rejected posture must leave the file SOT untouched"
        );

        // The same connection with a CA file stores, and the path survives the
        // round trip — the mirror has no column for it, so this file is its only
        // home.
        conn.ca_cert_path = Some("/opt/corp/private/corp-ca.pem".into());
        save_conn(conn).unwrap();
        let stored = load_storage().unwrap().connections;
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].ssl_mode, SslMode::VerifyCa);
        assert_eq!(
            stored[0].ca_cert_path.as_deref(),
            Some("/opt/corp/private/corp-ca.pem")
        );

        cleanup_test_env();
    }

    // AC-01: load_storage creates default empty storage when file doesn't exist
    #[test]
    #[serial]
    fn test_load_storage_creates_default_when_no_file() {
        let _dir = setup_test_env();

        let data = load_storage().unwrap();
        assert!(data.connections.is_empty());
        assert!(data.groups.is_empty());

        cleanup_test_env();
    }

    // AC-02: save_connection adds new connection and can load it back
    #[test]
    #[serial]
    fn test_save_connection_adds_new_and_loads_back() {
        let _dir = setup_test_env();

        let conn = sample_connection("c1", "MyDB");
        save_conn(conn.clone()).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, "c1");
        assert_eq!(loaded.connections[0].name, "MyDB");
        assert_eq!(loaded.connections[0].host, "localhost");
        assert_eq!(loaded.connections[0].port, 5432);

        cleanup_test_env();
    }

    // AC-03: save_connection updates existing connection by id
    #[test]
    #[serial]
    fn test_save_connection_updates_existing_by_id() {
        let _dir = setup_test_env();

        let conn = sample_connection("c1", "MyDB");
        save_conn(conn).unwrap();

        let mut updated = sample_connection("c1", "MyDB Updated");
        updated.port = 3306;
        updated.host = "newhost".to_string();
        save_conn(updated).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].name, "MyDB Updated");
        assert_eq!(loaded.connections[0].port, 3306);
        assert_eq!(loaded.connections[0].host, "newhost");

        cleanup_test_env();
    }

    // AC-04: save_connection rejects duplicate name (different id, same name)
    #[test]
    #[serial]
    fn test_save_connection_rejects_duplicate_name() {
        let _dir = setup_test_env();

        save_conn(sample_connection("c1", "MyDB")).unwrap();

        let result = save_conn(sample_connection("c2", "MyDB"));
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("already exists"));
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        // Verify original connection is still intact
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, "c1");

        cleanup_test_env();
    }

    // AC-05: delete_connection removes connection by id
    #[test]
    #[serial]
    fn test_delete_connection_removes_by_id() {
        let _dir = setup_test_env();

        save_conn(sample_connection("c1", "DB1")).unwrap();
        save_conn(sample_connection("c2", "DB2")).unwrap();

        delete_connection("c1").unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, "c2");
        assert_eq!(loaded.connections[0].name, "DB2");

        cleanup_test_env();
    }

    // AC-06: delete_connection returns NotFound for non-existent id
    #[test]
    #[serial]
    fn test_delete_connection_not_found_for_missing_id() {
        let _dir = setup_test_env();

        let result = delete_connection("nonexistent");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(msg) => {
                assert!(msg.contains("nonexistent"));
            }
            other => panic!("Expected NotFound error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    // AC-07: password encryption/decryption roundtrip
    #[test]
    #[serial]
    fn test_password_roundtrip_encrypted() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "MyDB");
        conn.password = "pwd_tst".to_string();
        save_conn(conn).unwrap();

        // Verify password is NOT stored in plaintext in the file
        let data_dir = std::env::var("TABLE_VIEW_TEST_DATA_DIR").unwrap();
        let raw = std::fs::read_to_string(std::path::Path::new(&data_dir).join("connections.json"))
            .unwrap();
        assert!(
            !raw.contains("pwd_tst"),
            "Password should not appear in plaintext in storage file"
        );

        // Verify loading decrypts the password correctly
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].password, "pwd_tst");

        cleanup_test_env();
    }

    // AC-08: save_group adds and updates groups
    #[test]
    #[serial]
    fn test_save_group_adds_and_updates() {
        let _dir = setup_test_env();

        // Add a group
        save_group(sample_group("g1", "Production")).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.groups.len(), 1);
        assert_eq!(loaded.groups[0].id, "g1");
        assert_eq!(loaded.groups[0].name, "Production");

        // Update the group
        let updated_group = ConnectionGroup {
            id: "g1".to_string(),
            name: "Production Updated".to_string(),
            color: Some("#ff0000".to_string()),
            collapsed: true,
        };
        save_group(updated_group).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.groups.len(), 1);
        assert_eq!(loaded.groups[0].name, "Production Updated");
        assert_eq!(loaded.groups[0].color, Some("#ff0000".to_string()));
        assert!(loaded.groups[0].collapsed);

        cleanup_test_env();
    }

    // AC-09: delete_group moves orphaned connections to root
    #[test]
    #[serial]
    fn test_delete_group_moves_orphaned_connections_to_root() {
        let _dir = setup_test_env();

        save_group(sample_group("g1", "Group1")).unwrap();

        let mut conn = sample_connection("c1", "DB1");
        conn.group_id = Some("g1".to_string());
        save_conn(conn).unwrap();

        delete_group("g1").unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.groups.len(), 0);
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].group_id, None);

        cleanup_test_env();
    }

    // AC-10: move_connection_to_group changes group_id
    #[test]
    #[serial]
    fn test_move_connection_to_group_changes_group() {
        let _dir = setup_test_env();

        save_group(sample_group("g1", "Group1")).unwrap();
        save_conn(sample_connection("c1", "DB1")).unwrap();

        // Move to group
        move_connection_to_group("c1", Some("g1")).unwrap();
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].group_id, Some("g1".to_string()));

        // Move back to root
        move_connection_to_group("c1", None).unwrap();
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].group_id, None);

        cleanup_test_env();
    }

    // Additional: move_connection_to_group returns NotFound for missing connection
    #[test]
    #[serial]
    fn test_move_connection_to_group_not_found() {
        let _dir = setup_test_env();

        let result = move_connection_to_group("nonexistent", Some("g1"));
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(msg) => {
                assert!(msg.contains("nonexistent"));
            }
            other => panic!("Expected NotFound error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    // Additional: delete_group returns NotFound for non-existent group
    #[test]
    #[serial]
    fn test_delete_group_not_found() {
        let _dir = setup_test_env();

        let result = delete_group("nonexistent");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(msg) => {
                assert!(msg.contains("nonexistent"));
            }
            other => panic!("Expected NotFound error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    // Additional: empty password is not encrypted
    #[test]
    #[serial]
    fn test_save_connection_empty_password_not_encrypted() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "MyDB");
        conn.password = String::new();
        save_conn(conn).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].password, "");

        cleanup_test_env();
    }

    // Additional: multiple connections can be saved and all loaded back
    #[test]
    #[serial]
    fn test_save_multiple_connections() {
        let _dir = setup_test_env();

        save_conn(sample_connection("c1", "DB1")).unwrap();
        save_conn(sample_connection("c2", "DB2")).unwrap();
        save_conn(sample_connection("c3", "DB3")).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 3);

        cleanup_test_env();
    }

    // -------------------------------------------------------------------
    // Phase B password security
    // -------------------------------------------------------------------

    /// load_storage_redacted must NEVER return decrypted plaintext.
    #[test]
    #[serial]
    fn test_load_storage_redacted_omits_plaintext() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "noleak".into();
        save_conn(conn).unwrap();

        let data = load_storage_redacted().unwrap();
        for c in &data.connections {
            assert!(
                !c.password.contains("noleak"),
                "Plaintext leaked from load_storage_redacted: {}",
                c.password
            );
            assert!(c.password.is_empty(), "Redacted password must be empty");
        }

        cleanup_test_env();
    }

    /// load_storage_with_secrets must round-trip plaintext correctly.
    #[test]
    #[serial]
    fn test_load_storage_with_secrets_decrypts() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "rtrip".into();
        save_conn(conn).unwrap();

        let data = load_storage_with_secrets().unwrap();
        assert_eq!(data.connections[0].password, "rtrip");

        cleanup_test_env();
    }

    /// save_connection with `None` preserves the existing ciphertext (and the
    /// decrypted plaintext when read back).
    #[test]
    #[serial]
    fn test_save_connection_with_none_preserves_existing() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "alpha".into();
        save_conn(conn).unwrap();

        // Save again with `None`: should keep the existing password
        let mut updated = sample_connection("c1", "DB1 renamed");
        updated.password = String::new(); // value is irrelevant when None
        save_connection(updated, None).unwrap();

        let data = load_storage_with_secrets().unwrap();
        assert_eq!(data.connections[0].password, "alpha");
        assert_eq!(data.connections[0].name, "DB1 renamed");

        cleanup_test_env();
    }

    /// password_presence_map reports has-password without decrypting.
    #[test]
    #[serial]
    fn test_password_presence_map_reports_correctly() {
        let _dir = setup_test_env();

        let mut with = sample_connection("c1", "DB1");
        with.password = "yes".into();
        save_conn(with).unwrap();

        let mut without = sample_connection("c2", "DB2");
        without.password = String::new();
        save_conn(without).unwrap();

        let map = password_presence_map().unwrap();
        assert_eq!(map.get("c1"), Some(&true));
        assert_eq!(map.get("c2"), Some(&false));

        cleanup_test_env();
    }

    /// get_decrypted_password returns the right plaintext for the right id.
    #[test]
    #[serial]
    fn test_get_decrypted_password_returns_plaintext() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "lkpw".into();
        save_conn(conn).unwrap();

        let pw = get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some("lkpw".to_string()));

        let missing = get_decrypted_password("nope").unwrap();
        assert_eq!(missing, None);

        cleanup_test_env();
    }

    // Additional: updating same-name same-id connection succeeds
    #[test]
    #[serial]
    fn test_save_connection_same_name_same_id_succeeds() {
        let _dir = setup_test_env();

        save_conn(sample_connection("c1", "MyDB")).unwrap();

        // Same id and same name should succeed (it's an update)
        let updated = sample_connection("c1", "MyDB");
        let result = save_conn(updated);
        assert!(result.is_ok());

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);

        cleanup_test_env();
    }

    // -------------------------------------------------------------------
    // #1103 — master-key wiring: storage secret paths read the boot-seeded
    // keyring key instead of the disk `.key`.
    // -------------------------------------------------------------------

    /// When a key is seeded (as boot does from the keyring outcome), saving a
    /// connection encrypts under that key and never touches the disk `.key`.
    #[test]
    #[serial]
    fn seeded_master_key_is_used_and_no_disk_key_written() {
        let dir = setup_test_env();
        seed_master_key((7..39u8).collect()).unwrap();
        // Use whatever is actually seeded (robust to global state ordering).
        let effective = master_key().unwrap();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "sekret".into();
        save_conn(conn).unwrap();

        // No disk `.key` — the master key came from the (mocked-at-boot) seed.
        assert!(
            !dir.path().join(".key").exists(),
            "seeded key path must not create a disk .key"
        );

        // The persisted ciphertext decrypts under the seeded key.
        let raw = fs::read_to_string(dir.path().join("connections.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let enc = parsed["connections"][0]["password"].as_str().unwrap();
        assert_eq!(crypto::decrypt(enc, &effective).unwrap(), "sekret");

        reset_master_key_for_test();
        cleanup_test_env();
    }

    /// P3-3 (#1455) — `master_key()` hands back a [`Zeroizing`] buffer (so the
    /// clone is wiped on drop) that still round-trips the seeded key value.
    #[test]
    #[serial]
    fn master_key_is_zeroizing_and_round_trips_seed() {
        let _dir = setup_test_env();
        let seed: Vec<u8> = (7..39u8).collect();
        seed_master_key(seed.clone()).unwrap();

        let key: Zeroizing<Vec<u8>> = master_key().unwrap();
        assert_eq!(
            &*key, &seed,
            "seeded key must survive the Zeroizing wrapper"
        );

        reset_master_key_for_test();
        cleanup_test_env();
    }

    /// With no seed (the pre-#1103 / unit path), storage falls back to the
    /// disk `.key`, which is created on first secret write.
    #[test]
    #[serial]
    fn unseeded_master_key_falls_back_to_disk_key() {
        let dir = setup_test_env();
        reset_master_key_for_test();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "ondisk".into();
        save_conn(conn).unwrap();

        assert!(
            dir.path().join(".key").exists(),
            "unseeded path must fall back to the disk .key"
        );
        let loaded = load_storage_with_secrets().unwrap();
        assert_eq!(loaded.connections[0].password, "ondisk");

        cleanup_test_env();
    }

    // C5 (audit 2026-05-05): corrupt JSON must not destroy user data.
    // Quarantine the bad file with a timestamped suffix and start clean,
    // so the user can recover manually instead of losing every saved
    // connection.
    #[test]
    #[serial]
    fn test_load_storage_quarantines_corrupt_file_and_returns_empty() {
        let dir = setup_test_env();
        let path = dir.path().join("connections.json");
        fs::write(&path, b"{ this is not valid json }").unwrap();

        let data = load_storage_redacted().unwrap();
        assert!(
            data.connections.is_empty(),
            "should boot empty after corruption"
        );
        assert!(data.groups.is_empty());

        // Quarantine artifact must exist with the expected prefix.
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            entries
                .iter()
                .any(|n| n.starts_with("connections.json.corrupt-")),
            "quarantined backup not found in {entries:?}"
        );

        cleanup_test_env();
    }

    /// #2302 — the quarantine name above carries a **second**-resolution
    /// timestamp and `fs::rename` replaces its destination on Unix with no error
    /// and no log. Two quarantines inside one second therefore built the same
    /// `connections.json.corrupt-<ts>` and the second renamed straight over the
    /// first. What that destroyed is the only copy left of a file that had
    /// already failed to parse — the quarantine is the recovery, so eating its
    /// own earlier generation is the whole loss.
    ///
    /// The loop is what makes this deterministic rather than a coin flip: only a
    /// pair that really landed inside one second says anything about the
    /// collision, so a run whose clock ticked between the two calls is retried
    /// instead of asserted on, and running out of tries fails loudly rather than
    /// passing on a pair that never collided.
    #[test]
    fn quarantining_twice_in_one_second_keeps_the_earlier_file() {
        let secs = || {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        };
        let dir = TempDir::new().unwrap();
        for attempt in 0..32 {
            let case = dir.path().join(format!("attempt-{attempt}"));
            fs::create_dir(&case).unwrap();
            let path = case.join("connections.json");

            fs::write(&path, b"{ generation 1").unwrap();
            let opened = secs();
            let first = quarantine_corrupt_storage(&path).unwrap();
            fs::write(&path, b"{ generation 2").unwrap();
            let second = quarantine_corrupt_storage(&path).unwrap();
            if secs() != opened {
                continue;
            }

            assert_ne!(
                first, second,
                "two quarantines inside one second must not choose the same name"
            );
            assert_eq!(
                fs::read(&first).unwrap(),
                b"{ generation 1",
                "the earlier quarantined file at {} must still hold its own bytes",
                first.display()
            );
            assert_eq!(fs::read(&second).unwrap(), b"{ generation 2");
            return;
        }
        panic!("could not land two quarantines inside one second in 32 tries");
    }

    // -------------------------------------------------------------------
    // #2183 — a missing connections.json is a data-loss event, not a first
    // run. On 2026-08-06 a real machine's app data directory lost its
    // contents; boot answered with one `info!` line and saved an empty file,
    // which is what made the loss permanent (there was nothing on disk left to
    // recover from). A save now leaves the file it replaces behind as a backup
    // whenever that file holds something (#2187), and a missing file is
    // restored from it.
    // -------------------------------------------------------------------

    /// Helper: the two paths these tests care about, beside each other in the
    /// data dir. Spelled out rather than taken from `storage_backup_path()` —
    /// the on-disk name is what a user recovering by hand has to find, so the
    /// test has to fail if it changes.
    fn storage_and_backup(dir: &TempDir) -> (PathBuf, PathBuf) {
        (
            dir.path().join("connections.json"),
            dir.path().join("connections.json.bak"),
        )
    }

    fn read_json(path: &std::path::Path) -> StorageData {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    fn ids(data: &StorageData) -> Vec<&str> {
        data.connections.iter().map(|c| c.id.as_str()).collect()
    }

    fn group_ids(data: &StorageData) -> Vec<&str> {
        data.groups.iter().map(|g| g.id.as_str()).collect()
    }

    /// Acceptance ① — a save keeps the generation it replaced whenever that
    /// generation holds something. The first save below replaces the empty
    /// document a first run writes and correctly keeps nothing; the second is
    /// the one the assertion is about.
    #[test]
    #[serial]
    fn a_save_leaves_the_generation_it_replaced_in_the_backup() {
        let dir = setup_test_env();
        let (path, backup) = storage_and_backup(&dir);

        save_conn(sample_connection("c1", "DB1")).unwrap();
        save_conn(sample_connection("c2", "DB2")).unwrap();

        assert_eq!(
            ids(&read_json(&backup)),
            ["c1"],
            "the backup must hold the generation before the last save, not the last save itself"
        );
        assert_eq!(ids(&read_json(&path)), ["c1", "c2"]);

        // The backup carries the same encrypted passwords as the file it copies,
        // so it inherits the 0600 the atomic write applies at create time. That
        // holds because the backup is a rename of that very file; a rewrite of
        // this step that opens a new file has to apply the mode itself.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&backup).unwrap().permissions().mode() & 0o777,
                0o600,
                "the backup holds ciphertext and must not be readable by other users"
            );
        }

        cleanup_test_env();
    }

    /// Acceptance ② — the incident, replayed: `connections.json` disappears
    /// while the backup survives. This is the assertion that says the PR
    /// undoes the accident rather than merely logging it: the connections come
    /// back, their stored secrets come back with them, the file is put back on
    /// disk, and the user is told.
    #[test]
    #[serial]
    fn a_missing_storage_file_is_restored_from_the_backup() {
        let dir = setup_test_env();
        let (path, backup) = storage_and_backup(&dir);
        CONNECTIONS_RESTORED_FROM_BACKUP.store(false, Ordering::SeqCst);

        save_conn(sample_connection("c1", "DB1")).unwrap();
        save_conn(sample_connection("c2", "DB2")).unwrap();
        save_group(sample_group("g1", "Production")).unwrap();
        save_conn(sample_connection("c3", "DB3")).unwrap();
        assert_eq!(ids(&read_json(&backup)), ["c1", "c2"]);

        // The 2026-08-06 shape: the file is gone, the directory is not.
        fs::remove_file(&path).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(
            ids(&loaded),
            ["c1", "c2"],
            "a missing connections.json with a backup beside it must not resolve to an empty \
             list. `c3` is absent on purpose: one generation is kept, so the write that \
             followed the backup is not recoverable — issue #2183 scopes N-generation \
             retention out"
        );
        assert_eq!(
            loaded.connections[0].password, "testpass",
            "the restored entries must still decrypt — a backup of unusable ciphertext is not a recovery"
        );
        assert_eq!(
            loaded.groups.len(),
            1,
            "groups are restored with connections"
        );
        assert!(
            CONNECTIONS_RESTORED_FROM_BACKUP.load(Ordering::SeqCst),
            "the restore must raise the flag the boot snapshot reports to the user"
        );
        assert_eq!(
            ids(&read_json(&path)),
            ["c1", "c2"],
            "the restored data must be written back, or the next boot restores all over again"
        );
        // A restore reads the backup, it does not spend it. Without this the
        // implementation could move the file instead of copying its contents out
        // and every assertion above would still hold, leaving a second loss with
        // nothing to fall back on.
        assert_eq!(
            ids(&read_json(&backup)),
            ["c1", "c2"],
            "the backup must survive the restore it served"
        );

        CONNECTIONS_RESTORED_FROM_BACKUP.store(false, Ordering::SeqCst);
        cleanup_test_env();
    }

    /// B② — an install that predates this build has no backup, because the read
    /// paths never save and `save_storage_raw` is otherwise the only writer.
    /// Until the user's next add / edit / delete, a loss in that window would be
    /// read as a first run and answered with a silent empty file — the #2183
    /// behavior, reproduced. A successful load seeds the backup so the window is
    /// one launch, not one mutation.
    ///
    /// The file is written directly here rather than through `save_conn`: going
    /// through the writer would create the backup as a side effect and there
    /// would be nothing left to prove.
    #[test]
    #[serial]
    fn a_load_seeds_the_backup_for_an_install_that_has_none() {
        let dir = setup_test_env();
        let (path, backup) = storage_and_backup(&dir);
        CONNECTIONS_RESTORED_FROM_BACKUP.store(false, Ordering::SeqCst);

        let existing = StorageData {
            connections: vec![sample_connection("c1", "DB1")],
            groups: vec![sample_group("g1", "Production")],
        };
        fs::write(&path, serde_json::to_string_pretty(&existing).unwrap()).unwrap();
        assert!(
            !backup.exists(),
            "the fixture starts the way a pre-#2183 install does"
        );

        load_storage_redacted().unwrap();
        assert_eq!(
            ids(&read_json(&backup)),
            ["c1"],
            "a successful load must leave a backup behind for an install that had none"
        );
        assert!(
            !CONNECTIONS_RESTORED_FROM_BACKUP.load(Ordering::SeqCst),
            "seeding is not a recovery and must not tell the user anything"
        );

        // And the protection is real: the loss that follows is now recoverable.
        fs::remove_file(&path).unwrap();
        assert_eq!(ids(&load_storage_redacted().unwrap()), ["c1"]);
        assert!(CONNECTIONS_RESTORED_FROM_BACKUP.load(Ordering::SeqCst));

        CONNECTIONS_RESTORED_FROM_BACKUP.store(false, Ordering::SeqCst);
        cleanup_test_env();
    }

    /// The seed must not manufacture an empty backup. A first run writes an
    /// empty `connections.json`; if the next launch seeded from it, the one
    /// backup slot would be spent on a document that puts nothing back, and the
    /// user's first real generation would find it taken. Since #2187 that lost
    /// slot is the whole cost — the restore path stays quiet over such a
    /// document (`an_empty_backup_restores_nothing_and_claims_nothing`), so no
    /// false claim reaches the user. Acceptance ③ also depends on this staying
    /// quiet across launches, not just on the very first one.
    #[test]
    #[serial]
    fn a_load_does_not_seed_a_backup_from_an_empty_store() {
        let dir = setup_test_env();
        let (_path, backup) = storage_and_backup(&dir);

        load_storage_redacted().unwrap(); // first run — writes the empty file
        load_storage_redacted().unwrap(); // second launch — would seed
        assert!(
            !backup.exists(),
            "an install with nothing in it has nothing to protect"
        );

        cleanup_test_env();
    }

    /// Acceptance ③ — an install that never saved anything has nothing to
    /// recover, so it stays as quiet as it was before this change. A warning on
    /// every first run would be a new defect, so the flag that drives the toast
    /// must stay down.
    #[test]
    #[serial]
    fn a_genuine_first_run_stays_silent() {
        let dir = setup_test_env();
        let (_path, backup) = storage_and_backup(&dir);
        CONNECTIONS_RESTORED_FROM_BACKUP.store(false, Ordering::SeqCst);

        let loaded = load_storage_redacted().unwrap();
        assert!(loaded.connections.is_empty());
        assert!(loaded.groups.is_empty());
        assert!(
            !CONNECTIONS_RESTORED_FROM_BACKUP.load(Ordering::SeqCst),
            "an empty data directory has no backup to put anything back from, so the silence \
             is the absence of a recovery source — not a finding that nothing was lost"
        );
        assert!(
            !backup.exists(),
            "writing the initial empty file must not manufacture a backup of it"
        );

        cleanup_test_env();
    }

    /// The backup is the user's last copy once `connections.json` is gone, so a
    /// backup that does not parse is reported and kept byte for byte — but out of
    /// the slot, under the same `.corrupt-<ts>` name the corrupt-`connections.json`
    /// path uses. Left in the slot it would sit in front of the first save that
    /// replaces a document holding something, and that rename is where the last
    /// copy would actually go.
    #[test]
    #[serial]
    fn an_unparseable_backup_is_kept_and_never_restored() {
        let dir = setup_test_env();
        let (_path, backup) = storage_and_backup(&dir);
        CONNECTIONS_RESTORED_FROM_BACKUP.store(false, Ordering::SeqCst);
        fs::write(&backup, b"{ half a file").unwrap();

        let loaded = load_storage_redacted().unwrap();
        assert!(
            loaded.connections.is_empty(),
            "an unreadable backup restores nothing"
        );
        assert!(
            !CONNECTIONS_RESTORED_FROM_BACKUP.load(Ordering::SeqCst),
            "nothing was restored, so the user must not be told that something was"
        );

        // Byte-for-byte, but out of the backup slot. Left under its own name it
        // would survive this load and then be renamed over by the first save that
        // replaces a document holding something, which is when the user's last
        // copy would actually disappear — so the assertion has to be about the
        // file that outlives the boot, not about surviving this load.
        let kept: Vec<PathBuf> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("connections.json.bak.corrupt-"))
            })
            .collect();
        assert_eq!(kept.len(), 1, "expected one set-aside backup, got {kept:?}");
        assert_eq!(fs::read_to_string(&kept[0]).unwrap(), "{ half a file");
        assert!(
            !backup.exists(),
            "the unusable copy must not stay in the slot a later save renames over"
        );

        // A save is what used to destroy it. This one does not reach the rename —
        // the document it replaces is the empty one the restore just wrote, and
        // that holds nothing — but the set-aside file has to survive it anyway.
        save_conn(sample_connection("c1", "DB1")).unwrap();
        assert_eq!(fs::read_to_string(&kept[0]).unwrap(), "{ half a file");

        // #2222 — and the rename itself, which is the step the set-aside was moved
        // out of the way of. Nothing above reaches it, so nothing above says the
        // move actually bought anything. Two more saves do: the first replaces a
        // `connections.json` holding `c1`, the second one holding `c1` and `c2`.
        //
        // The assertion is on the second because the first is ambiguous — with the
        // slot empty, `seed_backup_if_absent` copies the same document into it on
        // the way in, so a build that had lost the rename entirely would still
        // leave `["c1"]` there and this test would pass proving nothing. By the
        // second save the slot is occupied, the seed is skipped, and the rename in
        // `save_storage_raw` is the only writer left that can have put `["c1",
        // "c2"]` in it.
        save_conn(sample_connection("c2", "DB2")).unwrap();
        save_conn(sample_connection("c3", "DB3")).unwrap();
        assert_eq!(
            ids(&read_json(&backup)),
            ["c1", "c2"],
            "this save has to reach the rename or the assertion below is vacuous"
        );
        assert_eq!(
            fs::read_to_string(&kept[0]).unwrap(),
            "{ half a file",
            "a save that renames a generation into the backup slot must leave the set-aside \
             copy beside it untouched — those bytes are the user's last copy of a file that \
             never parsed, and nothing else on disk holds them"
        );

        cleanup_test_env();
    }

    /// The exact sequence that produced the incident: a corrupt
    /// `connections.json` is quarantined and an empty file is written in its
    /// place. That empty write must not become the backup — if it does, the
    /// quarantine path destroys the recovery.
    ///
    /// Two independent things hold it. `quarantine_corrupt_storage` renames the
    /// file away *before* the empty save runs, so `save_storage_raw` finds no file
    /// to back up; and `is_worth_protecting` refuses the rename for any document
    /// with no connections and no groups, so the empty write stays out of the slot
    /// even where that ordering does not. The assertion pins the outcome rather
    /// than either mechanism, which is what makes it the guard that still holds
    /// when a later change removes one of them.
    #[test]
    #[serial]
    fn quarantining_a_corrupt_file_does_not_overwrite_the_backup() {
        let dir = setup_test_env();
        let (path, backup) = storage_and_backup(&dir);

        save_conn(sample_connection("c1", "DB1")).unwrap();
        save_conn(sample_connection("c2", "DB2")).unwrap();
        let before = fs::read_to_string(&backup).unwrap();
        fs::write(&path, b"{ this is not valid json }").unwrap();

        assert!(load_storage_redacted().unwrap().connections.is_empty());
        assert_eq!(
            fs::read_to_string(&backup).unwrap(),
            before,
            "the empty file the quarantine path writes must not replace the backup"
        );
        assert!(
            !ids(&read_json(&backup)).is_empty(),
            "the preserved backup must still hold real connections, not an empty document"
        );

        cleanup_test_env();
    }

    /// #2187 ① — the save *after* that quarantine, which is where the recovery
    /// was actually spent.
    ///
    /// `quarantining_a_corrupt_file_does_not_overwrite_the_backup` stops at the
    /// empty write, and that write is safe for a reason that does not survive one
    /// more step: the quarantine renamed `connections.json` away, so there was no
    /// file to back up. What it leaves behind is a `connections.json` that parses
    /// to an empty document. The user's next add found it present, renamed it over
    /// the backup, and the last parseable copy of the connections was gone —
    /// leaving only the quarantine file, which by definition does not parse.
    #[test]
    #[serial]
    fn a_save_after_a_corrupt_boot_keeps_the_backup_it_would_have_replaced() {
        let dir = setup_test_env();
        let (path, backup) = storage_and_backup(&dir);

        save_conn(sample_connection("c1", "DB1")).unwrap();
        save_conn(sample_connection("c2", "DB2")).unwrap();
        let before = fs::read_to_string(&backup).unwrap();
        assert_eq!(ids(&read_json(&backup)), ["c1"]);

        // Boot on a corrupt file: quarantine, then save an empty document.
        fs::write(&path, b"{ this is not valid json }").unwrap();
        assert!(load_storage_redacted().unwrap().connections.is_empty());
        assert_eq!(fs::read_to_string(&backup).unwrap(), before);

        // The user adds a connection. The file this save replaces is the empty
        // document above, and it has nothing in it to keep.
        save_conn(sample_connection("c3", "DB3")).unwrap();

        assert_eq!(
            ids(&read_json(&backup)),
            ["c1"],
            "a save must not spend the single backup slot on the empty document a \
             corrupt boot wrote — that document is not the last parseable copy of the \
             user's connections, the backup is"
        );
        assert_eq!(fs::read_to_string(&backup).unwrap(), before);

        cleanup_test_env();
    }

    /// #2187 ② — a backup that parses but holds nothing puts nothing back, so the
    /// boot must not raise the flag the frontend turns into "your connections and
    /// groups came back". The user would read that sentence over an empty list.
    ///
    /// Both writers this module owns already refuse to put such a document in the
    /// slot — `seed_backup_if_absent` before copying one in, `save_storage_raw`
    /// before renaming one in. This assertion covers what they cannot: a file
    /// placed by hand, one left by a build that predates those guards, or one from
    /// a writer added later. The restore is the last point at which the claim can
    /// be withheld, so it reads the document it is about to announce instead of
    /// trusting where the document came from.
    #[test]
    #[serial]
    fn an_empty_backup_restores_nothing_and_claims_nothing() {
        let dir = setup_test_env();
        let (path, backup) = storage_and_backup(&dir);
        CONNECTIONS_RESTORED_FROM_BACKUP.store(false, Ordering::SeqCst);

        let nothing = StorageData {
            connections: vec![],
            groups: vec![],
        };
        fs::write(&backup, serde_json::to_string_pretty(&nothing).unwrap()).unwrap();
        assert!(
            !path.exists(),
            "the restore path needs the file to be missing"
        );

        let loaded = load_storage_redacted().unwrap();
        // Without this the fixture is not verified: delete the `fs::write` above and
        // the load takes the NotFound arm instead, which returns the same empty
        // document and leaves the flag alone — both assertions below would still
        // hold while nothing ever reached the success branch this test is about. It
        // also pins that a parseable-but-empty backup is *not* set aside, which is
        // the other way the user's last copy could quietly leave the slot.
        assert!(
            backup.exists(),
            "the empty backup must still be in the slot — otherwise this asserts the \
             no-backup path, not the restore-with-nothing-in-it path"
        );
        assert!(loaded.connections.is_empty() && loaded.groups.is_empty());
        assert!(
            !CONNECTIONS_RESTORED_FROM_BACKUP.load(Ordering::SeqCst),
            "a backup with no connections and no groups restores nothing, so the boot \
             must not tell the user that something came back"
        );

        CONNECTIONS_RESTORED_FROM_BACKUP.store(false, Ordering::SeqCst);
        cleanup_test_env();
    }

    /// #2187 — the other half of `is_worth_protecting`, which nothing else in this
    /// suite exercises. Every fixture that has groups has connections beside them,
    /// so `!data.connections.is_empty()` alone answered every question the suite
    /// ever asked and `|| !data.groups.is_empty()` could be deleted with the whole
    /// suite still green.
    ///
    /// The state is not hypothetical: a fresh install whose first action is *Add
    /// group* holds zero connections and one group, and that document is worth
    /// exactly what a connection-bearing one is — losing it loses the user's work.
    /// Both halves of the contract are asserted here because the deleted clause
    /// breaks both: the save stops rotating the backup, and the recovery stops
    /// being announced.
    #[test]
    #[serial]
    fn a_groups_only_install_is_backed_up_and_its_restore_is_announced() {
        let dir = setup_test_env();
        let (path, backup) = storage_and_backup(&dir);
        CONNECTIONS_RESTORED_FROM_BACKUP.store(false, Ordering::SeqCst);

        // Add a group, then a second one. The first save replaces the empty
        // document a first run writes and correctly leaves no backup; the second
        // has a groups-only file in front of it that is worth keeping.
        save_group(sample_group("g1", "Production")).unwrap();
        save_group(sample_group("g2", "Staging")).unwrap();

        let kept = read_json(&backup);
        assert!(
            kept.connections.is_empty(),
            "the fixture has to stay groups-only or it stops testing this half"
        );
        assert_eq!(
            group_ids(&kept),
            ["g1"],
            "a document with groups and no connections has something to lose, so the \
             save that replaced it had to leave it in the backup"
        );

        // And the loss it protects against, end to end: the file goes, the groups
        // come back, and the user is told — the contract connections already get.
        fs::remove_file(&path).unwrap();
        let loaded = load_storage_redacted().unwrap();
        assert_eq!(
            group_ids(&loaded),
            ["g1"],
            "a groups-only backup is a recovery source like any other"
        );
        assert!(
            CONNECTIONS_RESTORED_FROM_BACKUP.load(Ordering::SeqCst),
            "something did come back, so the boot has to say so"
        );

        CONNECTIONS_RESTORED_FROM_BACKUP.store(false, Ordering::SeqCst);
        cleanup_test_env();
    }

    // -------------------------------------------------------------------
    // #1065 — Oracle wallet password: same at-rest / redact / 3-state
    // contract as the DB password.
    // -------------------------------------------------------------------

    /// The wallet password is encrypted on disk (never plaintext), decrypts on
    /// the secrets path, and is cleared on the redacted path.
    #[test]
    #[serial]
    fn wallet_password_encrypted_at_rest_and_redacted() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "Oracle");
        conn.wallet_password = "wsecret".into();
        save_connection_with_wallet(conn, Some(String::new()), Some("wsecret".into())).unwrap();

        let data_dir = std::env::var("TABLE_VIEW_TEST_DATA_DIR").unwrap();
        let raw =
            fs::read_to_string(std::path::Path::new(&data_dir).join("connections.json")).unwrap();
        assert!(
            !raw.contains("wsecret"),
            "wallet password must not be stored in plaintext"
        );

        let secrets = load_storage_with_secrets().unwrap();
        assert_eq!(secrets.connections[0].wallet_password, "wsecret");

        let redacted = load_storage_redacted().unwrap();
        assert!(redacted.connections[0].wallet_password.is_empty());

        cleanup_test_env();
    }

    /// 3-state: `None` preserves, `Some(s)` replaces, `Some("")` clears —
    /// independently of the DB password.
    #[test]
    #[serial]
    fn wallet_password_three_state_update() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "Oracle");
        conn.password = "dbpw".into();
        conn.wallet_password = "w1".into();
        save_connection_with_wallet(conn, Some("dbpw".into()), Some("w1".into())).unwrap();

        // None wallet + None password → both preserved.
        let stub = sample_connection("c1", "Oracle");
        save_connection_with_wallet(stub, None, None).unwrap();
        assert_eq!(
            get_decrypted_wallet_password("c1").unwrap(),
            Some("w1".into())
        );
        assert_eq!(get_decrypted_password("c1").unwrap(), Some("dbpw".into()));

        // Replace wallet only.
        let stub = sample_connection("c1", "Oracle");
        save_connection_with_wallet(stub, None, Some("w2".into())).unwrap();
        assert_eq!(
            get_decrypted_wallet_password("c1").unwrap(),
            Some("w2".into())
        );
        assert_eq!(get_decrypted_password("c1").unwrap(), Some("dbpw".into()));
        assert_eq!(
            wallet_password_presence_map().unwrap().get("c1"),
            Some(&true)
        );

        // Clear wallet only.
        let stub = sample_connection("c1", "Oracle");
        save_connection_with_wallet(stub, None, Some(String::new())).unwrap();
        assert_eq!(
            get_decrypted_wallet_password("c1").unwrap(),
            Some(String::new())
        );
        assert_eq!(
            wallet_password_presence_map().unwrap().get("c1"),
            Some(&false)
        );
        // DB password untouched throughout.
        assert_eq!(get_decrypted_password("c1").unwrap(), Some("dbpw".into()));

        cleanup_test_env();
    }
}
