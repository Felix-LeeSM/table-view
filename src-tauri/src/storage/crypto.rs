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
    let dir = dir.join("view-table");
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
