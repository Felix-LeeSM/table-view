use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::fs;
use std::path::PathBuf;

use crate::error::AppError;

const NONCE_SIZE: usize = 12;

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
}
