//! SSH server host-key fingerprints and the TOFU verdict (issue #1064,
//! ADR 0052 Q4).
//!
//! The fingerprint notation is fixed: OpenSSH's single SHA-256 form
//! (`SHA256:<unpadded base64>`), produced by [`russh::keys::ssh_key`]'s own
//! `Fingerprint` Display for plain keys and mirrored byte-for-byte here for
//! host certificates (ssh-key 0.7-rc exposes no certificate fingerprint
//! method, so the SHA-256 is taken over the certificate's wire encoding —
//! the same bytes OpenSSH hashes).

use base64::Engine as _;
use russh::keys::{HashAlg, PublicKeyOrCertificate};
use sha2::{Digest, Sha256};

use crate::error::AppError;

/// Prefix every fingerprint this module produces or compares carries. The
/// pin store normalizes on this constant, so a comparison is a plain string
/// equality.
pub const SHA256_PREFIX: &str = "SHA256:";

/// Fingerprint the server host key or certificate presents during key
/// exchange, in the `SHA256:<unpadded base64>` notation.
pub fn fingerprint_of(host_key: &PublicKeyOrCertificate) -> Result<String, AppError> {
    match host_key {
        PublicKeyOrCertificate::PublicKey { key, .. } => {
            Ok(key.fingerprint(HashAlg::Sha256).to_string())
        }
        PublicKeyOrCertificate::Certificate(cert) => {
            let der = cert.to_bytes().map_err(|e| AppError::SshTunnel {
                code: "sshConnectFailed".into(),
                message: format!("could not encode the server's host certificate: {e}"),
                fingerprint: None,
            })?;
            let digest = Sha256::digest(&der);
            Ok(format!(
                "{SHA256_PREFIX}{}",
                base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest)
            ))
        }
    }
}

/// TOFU verdict for a presented fingerprint against the stored pin.
/// `None` pin is *unknown*, never trusted: blind accept is banned (ADR 0052
/// Q4), the caller records the fingerprint and hard-fails instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyVerdict {
    /// Presented fingerprint equals the stored pin.
    Match,
    /// A pin exists and differs — the caller must hard-fail and only recover
    /// through an explicit "delete the pin, re-confirm" step.
    Mismatch { pinned: String },
    /// No pin stored — first contact. The caller records the presented
    /// fingerprint and fails once so the user can verify it.
    Unknown,
}

pub fn verdict(pinned: Option<&str>, presented: &str) -> HostKeyVerdict {
    match pinned {
        None => HostKeyVerdict::Unknown,
        Some(pin) if pin == presented => HostKeyVerdict::Match,
        Some(pin) => HostKeyVerdict::Mismatch {
            pinned: pin.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The plain-key branch of `fingerprint_of` runs over a real generated
    // key; the certificate branch is structural (ssh-key 0.7-rc offers no
    // certificate constructor we could feed it), so its notation property is
    // pinned by the digest shape instead.

    #[test]
    fn fingerprint_of_public_key_uses_openssh_sha256_notation() {
        let private = russh::keys::PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap();
        let host_key = PublicKeyOrCertificate::PublicKey {
            key: private.public_key().clone(),
            hash_alg: None,
        };
        let fp = fingerprint_of(&host_key).unwrap();
        assert!(fp.starts_with("SHA256:"), "{fp}");
        assert!(!fp.contains('='), "padding must be stripped: {fp}");
        // 32 raw bytes → 43 unpadded base64 chars after the prefix.
        assert_eq!(fp["SHA256:".len()..].len(), 43, "{fp}");
    }

    #[test]
    fn digest_shape_matches_notation_property() {
        let digest = Sha256::digest(b"wire-bytes");
        let fp = format!(
            "{SHA256_PREFIX}{}",
            base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest)
        );
        assert!(fp.starts_with("SHA256:"));
        assert!(!fp.contains('='), "padding must be stripped: {fp}");
        assert_eq!(fp["SHA256:".len()..].len(), 43);
    }

    #[test]
    fn verdict_table() {
        assert_eq!(verdict(None, "SHA256:a"), HostKeyVerdict::Unknown);
        assert_eq!(verdict(Some("SHA256:a"), "SHA256:a"), HostKeyVerdict::Match);
        assert_eq!(
            verdict(Some("SHA256:a"), "SHA256:b"),
            HostKeyVerdict::Mismatch {
                pinned: "SHA256:a".into()
            }
        );
    }
}
