//! SSH tunnel support (issue #1064, ADR 0052).
//!
//! - [`host_key`] — server host-key fingerprints (OpenSSH `SHA256:` single
//!   notation) and the TOFU verdict against the stored pin.
//! - [`tunnel`] — the connection-scoped tunnel itself: dial + authenticate to
//!   the jump host, then forward `127.0.0.1:<ephemeral>` through SSH
//!   `direct-tcpip` channels to the target the connection names.
//!
//! The host-key pins live in `storage::ssh_pins` (state.db), not here — this
//! module takes the pin as a parameter and never persists.

pub mod host_key;
pub mod tunnel;

/// In-process russh SSH server used by the tunnel tests: proves establishment
/// over the real protocol stack (handshake + host key + auth + direct-tcpip)
/// without an external network.
#[cfg(test)]
pub(crate) mod test_server;
