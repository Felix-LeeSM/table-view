use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::error::AppError;

const NONCE_SIZE: usize = 12;

// Sprint 140 — Argon2id parameters for the password-derived envelope KDF.
// The defaults are sized so a single derive completes well under a second on
// the user's desktop while still pushing enough memory pressure to deter a
// GPU brute-force attempt against an exported file. The exact tuple is
// embedded in the envelope so future params can roll forward (or down on
// constrained hardware) without breaking backward decrypt.
const ENVELOPE_ARGON2_M_COST: u32 = 19_456; // ~19 MiB
const ENVELOPE_ARGON2_T_COST: u32 = 2;
const ENVELOPE_ARGON2_P_COST: u32 = 1;
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
) -> Result<[u8; ENVELOPE_KEY_SIZE], AppError> {
    let params = Params::new(m_cost, t_cost, p_cost, Some(ENVELOPE_KEY_SIZE))
        .map_err(|e| AppError::Encryption(format!("Invalid Argon2 params: {}", e)))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; ENVELOPE_KEY_SIZE];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| AppError::Encryption(format!("Key derivation failed: {}", e)))?;
    Ok(out)
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

    let cipher =
        Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| AppError::Encryption(e.to_string()))?;
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
    if envelope.v != ENVELOPE_VERSION {
        return Err(AppError::Encryption(format!(
            "Unsupported envelope version {}",
            envelope.v
        )));
    }
    if envelope.kdf != "argon2id" {
        return Err(AppError::Encryption(format!(
            "Unsupported KDF: {}",
            envelope.kdf
        )));
    }
    if envelope.alg != "aes-256-gcm" {
        return Err(AppError::Encryption(format!(
            "Unsupported algorithm: {}",
            envelope.alg
        )));
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

    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
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
}
