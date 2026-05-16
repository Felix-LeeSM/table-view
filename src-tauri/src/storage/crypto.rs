use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bip39::{Language, Mnemonic};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use zeroize::Zeroizing;

use crate::error::AppError;

const NONCE_SIZE: usize = 12;

/// Sprint 356 (Q22) — keyring entry name. Fixed across all OS backends so the
/// same install can read its key after an upgrade.
pub const KEYRING_ENTRY_NAME: &str = "com.tableview.app.file-key";

/// Sprint 356 (Q22) — abstract OS keyring. We split the trait off the
/// `keyring` crate so tests can inject an in-memory backend without (a)
/// touching a developer's real OS keyring, (b) popping a UI prompt on
/// macOS, (c) requiring D-Bus on Linux CI. Production wires
/// [`OsKeyringBackend`] which delegates to the real `keyring::Entry`.
pub trait KeyringBackend {
    /// True when the OS keyring is reachable (Secret Service alive on Linux,
    /// Keychain on macOS, Credential Manager on Windows). On a Linux box
    /// without Secret Service / `kwallet` this returns false and triggers
    /// the disk-fallback path (AC-356-05).
    fn is_available(&self) -> bool;

    /// Read the entry; `Ok(Some(bytes))` if present, `Ok(None)` if missing,
    /// `Err` only on a real backend failure (which the caller treats as
    /// fatal — see `key_migration::migrate_or_initialize`).
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, AppError>;

    /// Write the entry (overwrite-on-set semantics). Caller verifies
    /// readback equality (AC-356-07).
    fn set(&self, name: &str, value: &[u8]) -> Result<(), AppError>;

    /// Best-effort delete of an entry. Errors are bubbled so the migration
    /// path can leave a sentinel rather than silently mismatching state.
    #[allow(dead_code)] // reserved for future revoke path; AC-356-04 only writes
    fn delete(&self, name: &str) -> Result<(), AppError>;
}

/// Sprint 356 (Q22) — production keyring backend. Delegates to the
/// `keyring` crate's per-OS native backend (macOS Keychain / Windows
/// Credential Manager / Linux Secret Service via D-Bus).
pub struct OsKeyringBackend {
    service: String,
}

impl OsKeyringBackend {
    pub fn new() -> Self {
        Self {
            service: KEYRING_ENTRY_NAME.to_string(),
        }
    }

    fn entry(&self, name: &str) -> Result<keyring::Entry, AppError> {
        // We use `service = our_constant`, `username = name`. The `keyring`
        // crate composes them into the OS-specific identifier. Same install
        // → same pair → idempotent lookup.
        keyring::Entry::new(&self.service, name)
            .map_err(|e| AppError::Encryption(format!("Keyring entry init failed: {e}")))
    }
}

impl Default for OsKeyringBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyringBackend for OsKeyringBackend {
    fn is_available(&self) -> bool {
        // Cheap probe: ask the backend to construct an Entry for a
        // sentinel name. If `Entry::new` itself errors (no Secret Service
        // on Linux, missing Keychain on hardened sandbox) we treat the
        // backend as unavailable and the migration path falls back to disk.
        self.entry("__availability_probe__").is_ok()
    }

    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, AppError> {
        let entry = self.entry(name)?;
        match entry.get_secret() {
            Ok(bytes) => Ok(Some(bytes)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Encryption(format!("Keyring read failed: {e}"))),
        }
    }

    fn set(&self, name: &str, value: &[u8]) -> Result<(), AppError> {
        let entry = self.entry(name)?;
        entry
            .set_secret(value)
            .map_err(|e| AppError::Encryption(format!("Keyring write failed: {e}")))
    }

    fn delete(&self, name: &str) -> Result<(), AppError> {
        let entry = self.entry(name)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Encryption(format!("Keyring delete failed: {e}"))),
        }
    }
}

/// Sprint 356 (Q22) — test-only in-memory keyring. Backed by a `Mutex<...>`
/// so the same instance can be passed by `&` to multiple call sites in one
/// test (mirrors `OsKeyringBackend` which is also `&self` everywhere).
///
/// `available` is a constructor flag — `new_available()` simulates a
/// healthy Linux desktop / macOS / Windows machine, `new_unavailable()`
/// simulates the Linux server / minimal-desktop case from AC-356-05 where
/// `is_available()` returns false and the migration path must fall back
/// to disk.
pub struct InMemoryKeyringBackend {
    inner: Mutex<std::collections::HashMap<String, Vec<u8>>>,
    available: bool,
    // Sprint 356 — escape hatch for AC-356-04 simulation: force `set` to
    // error so the migration path can be exercised through the
    // sentinel-write branch without needing a write-protected real
    // keyring backend.
    set_should_fail: Mutex<bool>,
}

impl InMemoryKeyringBackend {
    pub fn new_available() -> Self {
        Self {
            inner: Mutex::new(std::collections::HashMap::new()),
            available: true,
            set_should_fail: Mutex::new(false),
        }
    }

    pub fn new_unavailable() -> Self {
        Self {
            inner: Mutex::new(std::collections::HashMap::new()),
            available: false,
            set_should_fail: Mutex::new(false),
        }
    }

    /// Test helper: force every subsequent `set` to fail. Used by
    /// AC-356-04 (migration failure → sentinel).
    pub fn set_set_should_fail(&self, fail: bool) {
        *self.set_should_fail.lock().expect("mutex poisoned") = fail;
    }

    /// Test helper: dump current state. Useful for precondition assertions.
    pub fn dump(&self) -> std::collections::HashMap<String, Vec<u8>> {
        self.inner.lock().expect("mutex poisoned").clone()
    }
}

impl KeyringBackend for InMemoryKeyringBackend {
    fn is_available(&self) -> bool {
        self.available
    }

    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, AppError> {
        if !self.available {
            return Err(AppError::Encryption(
                "Keyring backend unavailable".to_string(),
            ));
        }
        Ok(self
            .inner
            .lock()
            .expect("mutex poisoned")
            .get(name)
            .cloned())
    }

    fn set(&self, name: &str, value: &[u8]) -> Result<(), AppError> {
        if !self.available {
            return Err(AppError::Encryption(
                "Keyring backend unavailable".to_string(),
            ));
        }
        if *self.set_should_fail.lock().expect("mutex poisoned") {
            return Err(AppError::Encryption(
                "simulated keyring write failure".into(),
            ));
        }
        self.inner
            .lock()
            .expect("mutex poisoned")
            .insert(name.to_string(), value.to_vec());
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), AppError> {
        if !self.available {
            return Err(AppError::Encryption(
                "Keyring backend unavailable".to_string(),
            ));
        }
        self.inner.lock().expect("mutex poisoned").remove(name);
        Ok(())
    }
}

// 2026-05-05 — OWASP "first profile" Argon2id params (m=64MiB, t=3, p=4).
// 이전 spec(m=19MiB/t=2/p=1, OWASP minimum)에서 상향. 사용자 1회 derive만
// 필요한 export/import 흐름이라 ~1초 비용 무해. brute-force 비용은 메모리
// hardness 기준 30~50배 증가. 옛 envelope은 envelope에 KDF 파라미터를 함께
// 저장하므로 그대로 복호화 가능 — backward compat 마이그 없음.
const ENVELOPE_ARGON2_M_COST: u32 = 65_536; // 64 MiB
const ENVELOPE_ARGON2_T_COST: u32 = 3;
const ENVELOPE_ARGON2_P_COST: u32 = 4;
const ENVELOPE_SALT_SIZE: usize = 16;
const ENVELOPE_KEY_SIZE: usize = 32;
const ENVELOPE_VERSION: u8 = 1;
/// Constant error message for any wrong-password decrypt failure. The
/// message is deliberately identical across (a) AES-GCM tag failure,
/// (b) corrupted ciphertext, (c) corrupted nonce, and (d) corrupted salt
/// so the UI surface cannot leak which field was tampered with.
pub const INCORRECT_MASTER_PASSWORD_MESSAGE: &str =
    "Incorrect master password — the file could not be decrypted";

/// Sprint 140 — JSON-serializable envelope for password-encrypted exports.
///
/// The shape is locked: `v`, `kdf`, `salt`, `nonce`, `alg`, `ciphertext`,
/// `tag_attached` are required for backward compatibility. Argon2 cost
/// parameters (`m_cost`, `t_cost`, `p_cost`) are additional fields so a
/// future envelope produced with different parameters still round-trips.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    pub v: u8,
    pub kdf: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
    /// Base64-encoded random salt used to derive the AEAD key.
    pub salt: String,
    /// Base64-encoded random AES-GCM nonce.
    pub nonce: String,
    pub alg: String,
    /// Base64-encoded AES-GCM ciphertext (auth tag appended by AES-GCM).
    pub ciphertext: String,
    /// Always `true` — the AES-GCM auth tag is appended to `ciphertext`.
    pub tag_attached: bool,
}

fn key_file_path() -> Result<PathBuf, AppError> {
    let dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| AppError::Storage("Cannot determine app data directory".into()))?;
    let dir = dir.join("table-view");
    fs::create_dir_all(&dir)?;
    Ok(dir.join(".key"))
}

pub fn get_or_create_key() -> Result<Vec<u8>, AppError> {
    let path = key_file_path()?;

    if path.exists() {
        let key_base64 = fs::read_to_string(&path)?;
        let key = BASE64
            .decode(key_base64.trim())
            .map_err(|e| AppError::Encryption(format!("Failed to decode key: {}", e)))?;
        if key.len() != 32 {
            return Err(AppError::Encryption(
                "Invalid key length, expected 32 bytes".into(),
            ));
        }
        return Ok(key);
    }

    // Generate new key
    let key = Aes256Gcm::generate_key(OsRng);
    let key_bytes = key.as_slice().to_vec();

    let key_base64 = BASE64.encode(&key_bytes);
    fs::write(&path, key_base64)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }

    Ok(key_bytes)
}

pub fn encrypt(plaintext: &str, key: &[u8]) -> Result<String, AppError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Encryption(e.to_string()))?;

    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Encryption(e.to_string()))?;

    // Prepend nonce to ciphertext and base64 encode
    let mut combined = nonce.as_slice().to_vec();
    combined.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(&combined))
}

pub fn decrypt(encrypted: &str, key: &[u8]) -> Result<String, AppError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Encryption(e.to_string()))?;

    let combined = BASE64
        .decode(encrypted)
        .map_err(|e| AppError::Encryption(format!("Failed to decode: {}", e)))?;

    if combined.len() < NONCE_SIZE {
        return Err(AppError::Encryption("Ciphertext too short".into()));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::Encryption(e.to_string()))?;

    String::from_utf8(plaintext).map_err(|e| AppError::Encryption(e.to_string()))
}

// ---------------------------------------------------------------------------
// Sprint 140 — password-derived envelope crypto.
//
// Distinct from the file-key based `encrypt` / `decrypt` above (which guard
// on-disk passwords with a key stored next to `connections.json`): the
// envelope path takes a user-supplied master password, derives an AEAD key
// with Argon2id, and wraps the resulting AES-256-GCM ciphertext along with
// the KDF parameters in a single JSON document so a different machine can
// reverse the process knowing only the password.
// ---------------------------------------------------------------------------

fn derive_envelope_key(
    password: &str,
    salt: &[u8],
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<Zeroizing<[u8; ENVELOPE_KEY_SIZE]>, AppError> {
    let params = Params::new(m_cost, t_cost, p_cost, Some(ENVELOPE_KEY_SIZE))
        .map_err(|e| AppError::Encryption(format!("Invalid Argon2 params: {}", e)))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = Zeroizing::new([0u8; ENVELOPE_KEY_SIZE]);
    argon
        .hash_password_into(password.as_bytes(), salt, out.as_mut())
        .map_err(|e| AppError::Encryption(format!("Key derivation failed: {}", e)))?;
    Ok(out)
}

/// 2026-05-05 — Generate a high-entropy export password as a BIP39 12-word
/// mnemonic (~128 bits of entropy). Auto-generation replaces user-input
/// passwords entirely so weak/short master passwords are no longer a floor on
/// envelope strength. Returns the mnemonic phrase as a single
/// space-separated string for direct rendering / clipboard copy.
pub fn generate_export_password() -> Result<String, AppError> {
    let mut entropy = [0u8; 16]; // 128 bits → 12-word mnemonic
    OsRng.fill_bytes(&mut entropy);
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|e| AppError::Encryption(format!("Mnemonic generation failed: {}", e)))?;
    Ok(mnemonic.to_string())
}

/// AES-256-GCM encrypt `plaintext` under a key derived from `master_password`
/// via Argon2id. Returns a JSON-serializable envelope containing the random
/// salt, random nonce, ciphertext, and KDF parameters required to reverse
/// the operation.
pub fn aead_encrypt_with_password(
    plaintext: &str,
    master_password: &str,
) -> Result<EncryptedEnvelope, AppError> {
    let mut salt_bytes = [0u8; ENVELOPE_SALT_SIZE];
    OsRng.fill_bytes(&mut salt_bytes);

    let key_bytes = derive_envelope_key(
        master_password,
        &salt_bytes,
        ENVELOPE_ARGON2_M_COST,
        ENVELOPE_ARGON2_T_COST,
        ENVELOPE_ARGON2_P_COST,
    )?;

    let cipher = Aes256Gcm::new_from_slice(key_bytes.as_ref())
        .map_err(|e| AppError::Encryption(e.to_string()))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Encryption(e.to_string()))?;

    Ok(EncryptedEnvelope {
        v: ENVELOPE_VERSION,
        kdf: "argon2id".to_string(),
        m_cost: ENVELOPE_ARGON2_M_COST,
        t_cost: ENVELOPE_ARGON2_T_COST,
        p_cost: ENVELOPE_ARGON2_P_COST,
        salt: BASE64.encode(salt_bytes),
        nonce: BASE64.encode(nonce.as_slice()),
        alg: "aes-256-gcm".to_string(),
        ciphertext: BASE64.encode(&ciphertext),
        tag_attached: true,
    })
}

/// AES-256-GCM decrypt the supplied envelope using `master_password`. Any
/// failure path (wrong password, tampered ciphertext, tampered nonce,
/// tampered salt) collapses into a single, constant-message
/// `AppError::Encryption` so a caller can't distinguish them via the
/// returned string.
pub fn aead_decrypt_with_password(
    envelope: &EncryptedEnvelope,
    master_password: &str,
) -> Result<String, AppError> {
    // Metadata mismatches (version / kdf / alg) collapse into the same
    // constant wrong-password message as decrypt failure: an attacker who
    // tampered with one of those fields would otherwise learn which one
    // they hit via the distinct error string. Treat unknown envelopes as
    // indistinguishable from "wrong password".
    if envelope.v != ENVELOPE_VERSION || envelope.kdf != "argon2id" || envelope.alg != "aes-256-gcm"
    {
        return Err(AppError::Encryption(
            INCORRECT_MASTER_PASSWORD_MESSAGE.into(),
        ));
    }

    // Any base64 / length anomaly is folded into the constant
    // wrong-password error so a caller cannot distinguish "tampered"
    // from "wrong password" via the surface message.
    let salt_bytes = BASE64
        .decode(&envelope.salt)
        .map_err(|_| AppError::Encryption(INCORRECT_MASTER_PASSWORD_MESSAGE.into()))?;
    let nonce_bytes = BASE64
        .decode(&envelope.nonce)
        .map_err(|_| AppError::Encryption(INCORRECT_MASTER_PASSWORD_MESSAGE.into()))?;
    let ciphertext = BASE64
        .decode(&envelope.ciphertext)
        .map_err(|_| AppError::Encryption(INCORRECT_MASTER_PASSWORD_MESSAGE.into()))?;
    if nonce_bytes.len() != NONCE_SIZE {
        return Err(AppError::Encryption(
            INCORRECT_MASTER_PASSWORD_MESSAGE.into(),
        ));
    }

    let key_bytes = derive_envelope_key(
        master_password,
        &salt_bytes,
        envelope.m_cost,
        envelope.t_cost,
        envelope.p_cost,
    )
    .map_err(|_| AppError::Encryption(INCORRECT_MASTER_PASSWORD_MESSAGE.into()))?;

    let cipher = Aes256Gcm::new_from_slice(key_bytes.as_ref())
        .map_err(|_| AppError::Encryption(INCORRECT_MASTER_PASSWORD_MESSAGE.into()))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| AppError::Encryption(INCORRECT_MASTER_PASSWORD_MESSAGE.into()))?;

    String::from_utf8(plaintext)
        .map_err(|_| AppError::Encryption(INCORRECT_MASTER_PASSWORD_MESSAGE.into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Generate a deterministic 32-byte key for testing.
    fn test_key() -> Vec<u8> {
        vec![42u8; 32]
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = test_key();
        let plaintext = "my-secret-password";
        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();
        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn encrypt_produces_different_ciphertexts() {
        let key = test_key();
        let plaintext = "same-input";
        let encrypted1 = encrypt(plaintext, &key).unwrap();
        let encrypted2 = encrypt(plaintext, &key).unwrap();
        // Different nonces should produce different ciphertexts
        assert_ne!(encrypted1, encrypted2);
        // But both decrypt to the same plaintext
        assert_eq!(decrypt(&encrypted1, &key).unwrap(), plaintext);
        assert_eq!(decrypt(&encrypted2, &key).unwrap(), plaintext);
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let key1 = test_key();
        let key2 = vec![99u8; 32];
        let encrypted = encrypt("secret", &key1).unwrap();
        let result = decrypt(&encrypted, &key2);
        assert!(result.is_err());
    }

    #[test]
    fn decrypt_with_invalid_base64_fails() {
        let key = test_key();
        let result = decrypt("not-valid-base64!!!", &key);
        assert!(result.is_err());
    }

    #[test]
    fn decrypt_with_too_short_ciphertext_fails() {
        let key = test_key();
        // base64 of 8 bytes (< 12 byte nonce)
        let short = BASE64.encode([0u8; 8]);
        let result = decrypt(&short, &key);
        assert!(result.is_err());
        match result {
            Err(AppError::Encryption(msg)) => assert!(msg.contains("too short")),
            _ => panic!("Expected Encryption error"),
        }
    }

    #[test]
    fn encrypt_empty_string() {
        let key = test_key();
        let encrypted = encrypt("", &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();
        assert_eq!("", decrypted);
    }

    #[test]
    fn encrypt_unicode_string() {
        let key = test_key();
        let plaintext = "비밀번호🔐pwd";
        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();
        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn encrypt_invalid_key_length_fails() {
        let short_key = vec![0u8; 16];
        let result = encrypt("test", &short_key);
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------
    // Sprint 140 — password-derived envelope crypto
    // -----------------------------------------------------------------

    /// Lower the cost params during tests so the suite stays fast. We do
    /// this by encrypting at production cost (called via the public API)
    /// and asserting round-trip — the decrypt path reads cost from the
    /// envelope itself, so changing constants is unnecessary.
    #[test]
    fn aead_envelope_password_round_trip() {
        let plaintext = "my secret payload";
        let envelope = aead_encrypt_with_password(plaintext, "open-sesame!").unwrap();

        // Locked envelope shape sanity
        assert_eq!(envelope.v, 1);
        assert_eq!(envelope.kdf, "argon2id");
        assert_eq!(envelope.alg, "aes-256-gcm");
        assert!(envelope.tag_attached);
        assert!(!envelope.salt.is_empty());
        assert!(!envelope.nonce.is_empty());
        assert!(!envelope.ciphertext.is_empty());

        let decrypted = aead_decrypt_with_password(&envelope, "open-sesame!").unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn aead_envelope_decrypt_with_same_password_is_deterministic() {
        let envelope = aead_encrypt_with_password("zzz", "pw1234567").unwrap();
        let a = aead_decrypt_with_password(&envelope, "pw1234567").unwrap();
        let b = aead_decrypt_with_password(&envelope, "pw1234567").unwrap();
        assert_eq!(a, b);
        assert_eq!(a, "zzz");
    }

    #[test]
    fn aead_envelope_wrong_password_rejected() {
        let envelope = aead_encrypt_with_password("payload", "correct-pw").unwrap();
        let result = aead_decrypt_with_password(&envelope, "wrong-pw-xx");
        match result {
            Err(AppError::Encryption(msg)) => {
                assert_eq!(msg, INCORRECT_MASTER_PASSWORD_MESSAGE);
            }
            other => panic!("Expected Encryption error, got: {:?}", other),
        }
    }

    #[test]
    fn aead_envelope_tampered_ciphertext_rejected() {
        let mut envelope = aead_encrypt_with_password("payload", "correct-pw").unwrap();
        // Flip a byte by appending an unrelated char then re-encoding the
        // bytes — guarantees a tag mismatch.
        let mut bytes = BASE64.decode(&envelope.ciphertext).unwrap();
        bytes[0] ^= 0xFF;
        envelope.ciphertext = BASE64.encode(&bytes);

        let result = aead_decrypt_with_password(&envelope, "correct-pw");
        match result {
            Err(AppError::Encryption(msg)) => {
                assert_eq!(msg, INCORRECT_MASTER_PASSWORD_MESSAGE);
            }
            other => panic!("Expected Encryption error, got: {:?}", other),
        }
    }

    #[test]
    fn aead_envelope_tampered_nonce_rejected() {
        let mut envelope = aead_encrypt_with_password("payload", "correct-pw").unwrap();
        let mut bytes = BASE64.decode(&envelope.nonce).unwrap();
        bytes[0] ^= 0xFF;
        envelope.nonce = BASE64.encode(&bytes);

        let result = aead_decrypt_with_password(&envelope, "correct-pw");
        match result {
            Err(AppError::Encryption(msg)) => {
                assert_eq!(msg, INCORRECT_MASTER_PASSWORD_MESSAGE);
            }
            other => panic!("Expected Encryption error, got: {:?}", other),
        }
    }

    // C3 (audit 2026-05-05): envelope metadata tamper must collapse to the
    // same wrong-password message as a decrypt failure, so a disk-access
    // attacker cannot tell which field they hit by error-string diff.
    #[test]
    fn aead_envelope_tampered_metadata_rejected_with_constant_message() {
        let make = || aead_encrypt_with_password("payload", "correct-pw").unwrap();

        let mut bad_version = make();
        bad_version.v = 99;
        let mut bad_kdf = make();
        bad_kdf.kdf = "scrypt".to_string();
        let mut bad_alg = make();
        bad_alg.alg = "chacha20-poly1305".to_string();

        for envelope in [bad_version, bad_kdf, bad_alg] {
            match aead_decrypt_with_password(&envelope, "correct-pw") {
                Err(AppError::Encryption(msg)) => {
                    assert_eq!(msg, INCORRECT_MASTER_PASSWORD_MESSAGE);
                }
                other => panic!("Expected Encryption error, got: {:?}", other),
            }
        }
    }

    #[test]
    fn aead_envelope_tampered_salt_rejected() {
        let mut envelope = aead_encrypt_with_password("payload", "correct-pw").unwrap();
        let mut bytes = BASE64.decode(&envelope.salt).unwrap();
        bytes[0] ^= 0xFF;
        envelope.salt = BASE64.encode(&bytes);

        // Tampered salt → derived key changes → AEAD tag fails.
        let result = aead_decrypt_with_password(&envelope, "correct-pw");
        match result {
            Err(AppError::Encryption(msg)) => {
                assert_eq!(msg, INCORRECT_MASTER_PASSWORD_MESSAGE);
            }
            other => panic!("Expected Encryption error, got: {:?}", other),
        }
    }

    #[test]
    fn aead_envelope_serializes_to_locked_schema() {
        let envelope = aead_encrypt_with_password("payload", "passw0rd").unwrap();
        let json = serde_json::to_string(&envelope).unwrap();
        // Required locked fields
        assert!(json.contains("\"v\":1"));
        assert!(json.contains("\"kdf\":\"argon2id\""));
        assert!(json.contains("\"alg\":\"aes-256-gcm\""));
        assert!(json.contains("\"tag_attached\":true"));
        assert!(json.contains("\"salt\":"));
        assert!(json.contains("\"nonce\":"));
        assert!(json.contains("\"ciphertext\":"));

        // Round-trip via JSON
        let parsed: EncryptedEnvelope = serde_json::from_str(&json).unwrap();
        let plaintext = aead_decrypt_with_password(&parsed, "passw0rd").unwrap();
        assert_eq!(plaintext, "payload");
    }

    #[test]
    fn aead_envelope_unicode_payload_round_trip() {
        let plaintext = "비밀번호🔐 multi-line\npayload with 한글";
        let envelope = aead_encrypt_with_password(plaintext, "유니코드pw1!").unwrap();
        let decrypted = aead_decrypt_with_password(&envelope, "유니코드pw1!").unwrap();
        assert_eq!(decrypted, plaintext);
    }

    // -----------------------------------------------------------------
    // 2026-05-05 — auto-generated export password (BIP39 mnemonic)
    // -----------------------------------------------------------------

    #[test]
    fn generated_export_password_is_12_english_words() {
        let pw = generate_export_password().unwrap();
        let words: Vec<&str> = pw.split_whitespace().collect();
        assert_eq!(words.len(), 12, "expected 12-word mnemonic, got {pw:?}");
        // Every token must round-trip through the BIP39 English wordlist.
        let parsed = Mnemonic::parse_in(Language::English, &pw)
            .expect("generated phrase must parse against BIP39 English wordlist");
        assert_eq!(parsed.to_string(), pw);
    }

    #[test]
    fn generated_export_password_changes_each_call() {
        // 128-bit entropy → collision probability negligible across two calls.
        let a = generate_export_password().unwrap();
        let b = generate_export_password().unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn generated_export_password_round_trips_through_envelope() {
        let pw = generate_export_password().unwrap();
        let envelope = aead_encrypt_with_password("payload", &pw).unwrap();
        // Same generated mnemonic decrypts; an unrelated mnemonic does not.
        let decrypted = aead_decrypt_with_password(&envelope, &pw).unwrap();
        assert_eq!(decrypted, "payload");
        let other = generate_export_password().unwrap();
        assert!(aead_decrypt_with_password(&envelope, &other).is_err());
    }

    #[test]
    fn current_envelope_uses_owasp_first_profile_params() {
        // The cost tuple is part of the shipped security baseline; bumping it
        // requires conscious revision of this assertion.
        let envelope = aead_encrypt_with_password("p", "pw1234567").unwrap();
        assert_eq!(envelope.m_cost, 65_536);
        assert_eq!(envelope.t_cost, 3);
        assert_eq!(envelope.p_cost, 4);
    }
}
