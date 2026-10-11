//! SSH local port-forward tunnel (issue #1064, ADR 0052 Q2).
//!
//! [`SshTunnel::open`] dials the jump host over TCP, verifies the server
//! host key against the caller-supplied pin (TOFU: unknown → hard-fail
//! carrying the fingerprint, mismatch → hard-fail; blind accept is banned),
//! authenticates (password, or key file + passphrase), then listens on
//! `127.0.0.1:<ephemeral>` — the uniform listener for every engine, no MSSQL
//! stream exception (grill decision, 2026-07-17) — and forwards each
//! accepted connection through an SSH `direct-tcpip` channel to the
//! `(target_host, target_port)` fixed at open time. The DB adapters dial the
//! local listener; they never see the SSH layer.
//!
//! Deliberate ceilings, each a locked grill decision:
//! - The listener lives exactly as long as the tunnel struct; `close()` sends
//!   the SSH disconnect and joins the accept loop (bounded wait, then abort).
//! - Concurrent forwards are capped ([`MAX_CONCURRENT_FORWARDS`], the "pool
//!   max accept cap" decision). Saturation backpressures the accept loop —
//!   the DB driver's own acquire timeout surfaces the overload, no silent
//!   drops.
//! - No SSH-level retry: a dead tunnel fails the next dial, and the existing
//!   keep-alive / reconnect machinery owns recovery.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, Handle, Msg};
use russh::keys::{Algorithm, PrivateKeyWithHashAlg};
use russh::{ChannelStream, Disconnect, Error as RusshError};
use tokio::io::copy_bidirectional;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Semaphore};
use tokio::task::JoinHandle;

use super::host_key;

/// Grill decision "pool max accept cap": concurrent `direct-tcpip` forwards a
/// single tunnel may carry. Drivers open at most a handful of connections per
/// pool; 64 leaves headroom without letting a runaway loop farm channels.
const MAX_CONCURRENT_FORWARDS: usize = 64;

/// How the tunnel authenticates to the jump host. Built by the command layer
/// from the stored config plus the *decrypted* secrets — this module never
/// touches storage or keyring.
#[derive(Debug, Clone)]
pub enum SshAuth {
    Password(String),
    KeyFile {
        path: std::path::PathBuf,
        passphrase: Option<String>,
    },
}

/// Everything [`SshTunnel::open`] needs. `host`/`port` are the jump host;
/// `target_*` is what the far side connects to (the DB host/port as the user
/// typed them).
pub struct SshTunnelParams {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
    pub target_host: String,
    pub target_port: u16,
    /// Dial + handshake + auth + channel-open budget. The command layer
    /// derives it from `ConnectionConfig::connect_timeout` so the SSH hop
    /// honours the same clamp as the DB hop (grill decision).
    pub timeout: Duration,
    /// Stored host-key pin for this jump host, if any (`storage::ssh_pins`).
    pub pinned_fingerprint: Option<String>,
}

/// Tunnel establishment failure. Converts into the typed
/// `AppError::SshTunnel` envelope; no variant carries secret material.
#[derive(Debug)]
pub enum SshTunnelError {
    /// No pin stored and the server key was therefore not trusted (TOFU
    /// first contact). Carries the fingerprint for the confirm surface.
    UnknownHostKey { fingerprint: String },
    /// A pin exists and the server now presents a different key. Carries both
    /// sides; recovery is an explicit "delete the pin, re-confirm" step.
    HostKeyMismatch { pinned: String, presented: String },
    /// The jump host rejected the credentials.
    AuthFailed,
    /// The private key file could not be read or decrypted (bad path, bad
    /// passphrase, unsupported format — PuTTY PPK is out of scope, ADR 0052).
    KeyFileUnreadable,
    /// The TCP dial to the jump host failed.
    Dial(std::io::Error),
    /// The dial/handshake/auth/channel-open budget elapsed.
    Timeout,
    /// Anything else in the SSH stack, as a fixed English string — russh
    /// error text is not echoed blindly (redaction posture, ADR 0052 Q6).
    Protocol(&'static str),
}

impl From<SshTunnelError> for crate::error::AppError {
    fn from(e: SshTunnelError) -> Self {
        let (code, message, fingerprint) = match &e {
            SshTunnelError::UnknownHostKey { fingerprint } => (
                "sshHostKeyUnknown",
                "First connection to this SSH host. Verify the host key fingerprint, then \
                 reconnect to trust it."
                    .to_string(),
                Some(fingerprint.clone()),
            ),
            SshTunnelError::HostKeyMismatch { pinned, presented } => (
                "sshHostKeyMismatch",
                format!(
                    "SSH host key changed: the server now presents {presented}, but {pinned} \
                     is pinned. Delete the pinned key to re-confirm."
                ),
                Some(presented.clone()),
            ),
            SshTunnelError::AuthFailed => (
                "sshAuthFailed",
                "SSH authentication failed — check the username and credentials.".to_string(),
                None,
            ),
            SshTunnelError::KeyFileUnreadable => (
                "sshKeyFileUnreadable",
                "Could not read or decrypt the SSH private key file — check the path and \
                 passphrase."
                    .to_string(),
                None,
            ),
            SshTunnelError::Dial(err) => (
                "sshConnectFailed",
                format!("Could not connect to the SSH host: {err}"),
                None,
            ),
            SshTunnelError::Timeout => (
                "sshTimeout",
                "Connecting to the SSH host timed out.".to_string(),
                None,
            ),
            SshTunnelError::Protocol(what) => (
                "sshConnectFailed",
                format!("SSH tunnel failed: {what}"),
                None,
            ),
        };
        crate::error::AppError::SshTunnel {
            code: code.to_string(),
            message,
            fingerprint,
        }
    }
}

/// What [`client::Handler::check_server_key`] saw, smuggled out of the
/// handshake for the caller to turn into a typed TOFU error (russh only
/// surfaces a bare `UnknownKey` on rejection).
#[derive(Debug, Clone)]
struct HostKeyObservation {
    fingerprint: String,
    trusted: bool,
}

struct TofuHandler {
    pinned: Option<String>,
    observation: Arc<tokio::sync::Mutex<Option<HostKeyObservation>>>,
}

impl client::Handler for TofuHandler {
    type Error = RusshError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fingerprint =
            host_key::fingerprint_of(server_public_key).map_err(|_| RusshError::UnknownKey)?;
        let trusted = match &self.pinned {
            // No pin → never trusted here. `open()` reads the observation and
            // reports UnknownHostKey with the fingerprint (TOFU record +
            // fail-once); blind accept is banned.
            None => false,
            Some(pin) => *pin == fingerprint,
        };
        *self.observation.lock().await = Some(HostKeyObservation {
            fingerprint,
            trusted,
        });
        Ok(trusted)
    }
}

/// A live, connection-scoped tunnel. Kept in `AppState` for the lifetime of
/// the connection; dropped (or `close()`d) when it disconnects. `Debug` is
/// derived: the struct carries no secret material (the SSH session lives in
/// the accept task, not here).
#[derive(Debug)]
pub struct SshTunnel {
    local_addr: SocketAddr,
    close_tx: mpsc::UnboundedSender<()>,
    accept_task: JoinHandle<()>,
}

impl SshTunnel {
    /// Establish the tunnel: dial, verify the host key, authenticate, and
    /// start the local forward listener.
    pub async fn open(params: SshTunnelParams) -> Result<SshTunnel, SshTunnelError> {
        let SshTunnelParams {
            host,
            port,
            user,
            auth,
            target_host,
            target_port,
            timeout,
            pinned_fingerprint,
        } = params;

        // 1. TCP dial with the app's clamped budget. russh's own connect has
        //    no dial timeout, so the stream is connected here and handed to
        //    `connect_stream`.
        let stream =
            match tokio::time::timeout(timeout, TcpStream::connect((host.as_str(), port))).await {
                Err(_) => return Err(SshTunnelError::Timeout),
                Ok(Err(e)) => return Err(SshTunnelError::Dial(e)),
                Ok(Ok(s)) => s,
            };

        // 2. Handshake + host-key verification (TOFU) inside russh.
        let observation: Arc<tokio::sync::Mutex<Option<HostKeyObservation>>> =
            Arc::new(tokio::sync::Mutex::new(None));
        let handler = TofuHandler {
            pinned: pinned_fingerprint.clone(),
            observation: Arc::clone(&observation),
        };
        let mut handle = match tokio::time::timeout(
            timeout,
            client::connect_stream(Arc::new(client::Config::default()), stream, handler),
        )
        .await
        {
            Err(_) => return Err(SshTunnelError::Timeout),
            Ok(Err(err)) => {
                // A host-key rejection surfaces as russh's bare UnknownKey;
                // the observation slot says whether that is what happened and
                // carries the presented fingerprint either way.
                let seen = observation.lock().await.clone();
                if let Some(obs) = seen.filter(|o| !o.trusted) {
                    return Err(match pinned_fingerprint {
                        Some(pin) => SshTunnelError::HostKeyMismatch {
                            pinned: pin,
                            presented: obs.fingerprint,
                        },
                        None => SshTunnelError::UnknownHostKey {
                            fingerprint: obs.fingerprint,
                        },
                    });
                }
                tracing::warn!(error = %err, "SSH handshake failed");
                return Err(SshTunnelError::Protocol("handshake failed"));
            }
            Ok(Ok(h)) => h,
        };

        // 3. Authenticate — inside the same budget (the param doc promises
        // dial + handshake + auth): a server that stalls after its banner must
        // not hold `connect()` past the app's clamp.
        let auth_result = match tokio::time::timeout(timeout, async {
            match auth {
                SshAuth::Password(password) => {
                    Ok(handle.authenticate_password(&user, password).await)
                }
                SshAuth::KeyFile { path, passphrase } => {
                    let key = russh::keys::load_secret_key(&path, passphrase.as_deref())
                        .map_err(|_| SshTunnelError::KeyFileUnreadable)?;
                    // RSA keys must pick a signature hash the server
                    // supports; every other algorithm takes None. The
                    // double-Option flatten is russh's API shape (None =
                    // server sent no sig-algs).
                    let hash_alg = if matches!(key.algorithm(), Algorithm::Rsa { .. }) {
                        match handle.best_supported_rsa_hash().await {
                            Ok(h) => h.flatten(),
                            Err(err) => {
                                tracing::warn!(error = %err, "RSA hash negotiation failed");
                                return Err(SshTunnelError::Protocol("handshake failed"));
                            }
                        }
                    } else {
                        None
                    };
                    Ok(handle
                        .authenticate_publickey(
                            &user,
                            PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                        )
                        .await)
                }
            }
        })
        .await
        {
            Err(_) => return Err(SshTunnelError::Timeout),
            Ok(Err(e)) => return Err(e),
            Ok(Ok(result)) => result,
        };
        let authenticated = match auth_result {
            Ok(result) => result.success(),
            Err(err) => {
                tracing::warn!(error = %err, "SSH authentication transport failed");
                return Err(SshTunnelError::Protocol("authentication failed"));
            }
        };
        if !authenticated {
            return Err(SshTunnelError::AuthFailed);
        }

        // 4. Local listener — uniform 127.0.0.1 ephemeral for every engine.
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(SshTunnelError::Dial)?;
        let local_addr = listener.local_addr().map_err(SshTunnelError::Dial)?;

        // 5. Accept loop owns the handle (it is not Clone); shutdown arrives
        //    through the channel below.
        let (close_tx, close_rx) = mpsc::unbounded_channel();
        let target = Arc::new((target_host, target_port));
        let permits = Arc::new(Semaphore::new(MAX_CONCURRENT_FORWARDS));
        let accept_task = tokio::spawn(accept_loop(
            listener, handle, close_rx, target, permits, timeout,
        ));

        Ok(SshTunnel {
            local_addr,
            close_tx,
            accept_task,
        })
    }

    /// `127.0.0.1:<ephemeral>` the DB adapter dials.
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    /// The ephemeral port of [`SshTunnel::local_addr`].
    pub fn port(&self) -> u16 {
        self.local_addr.port()
    }

    /// Send the SSH disconnect and wait (bounded) for the accept loop to
    /// finish, so the listener port is released once this returns.
    pub async fn close(mut self) {
        let _ = self.close_tx.send(());
        if tokio::time::timeout(Duration::from_secs(2), &mut self.accept_task)
            .await
            .is_err()
        {
            self.accept_task.abort();
        }
    }
}

impl Drop for SshTunnel {
    /// Defensive path only — `close()` is the orderly teardown. Aborting the
    /// accept task drops the listener, releasing the port.
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

async fn accept_loop(
    listener: TcpListener,
    handle: Handle<TofuHandler>,
    mut close_rx: mpsc::UnboundedReceiver<()>,
    target: Arc<(String, u16)>,
    permits: Arc<Semaphore>,
    timeout: Duration,
) {
    loop {
        let accepted = tokio::select! {
            _ = close_rx.recv() => break,
            accepted = listener.accept() => match accepted {
                Ok(pair) => pair,
                Err(e) => {
                    tracing::warn!(error = %e, "SSH tunnel listener failed");
                    break;
                }
            },
        };
        let (downstream, _peer) = accepted;

        // Pool accept cap: saturation backpressures here instead of silently
        // dropping sockets; the driver's acquire timeout surfaces overload.
        let Ok(permit) = permits.clone().acquire_owned().await else {
            break; // semaphore closed — never happens, it is never closed
        };

        let (target_host, target_port) = target.as_ref();
        let opened = tokio::time::timeout(
            timeout,
            handle.channel_open_direct_tcpip(
                target_host.as_str(),
                u32::from(*target_port),
                "127.0.0.1",
                0,
            ),
        )
        .await;
        let channel = match opened {
            Ok(Ok(channel)) => channel,
            Ok(Err(e)) => {
                tracing::warn!(error = %e, "SSH tunnel channel open failed");
                continue; // permit drops → slot freed
            }
            Err(_) => {
                tracing::warn!("SSH tunnel channel open timed out");
                continue;
            }
        };
        tokio::spawn(forward(downstream, channel.into_stream(), permit));
    }
    // Orderly SSH bye. Best effort — the session may already be gone.
    let _ = handle.disconnect(Disconnect::ByApplication, "", "").await;
}

async fn forward(
    mut downstream: TcpStream,
    mut upstream: ChannelStream<Msg>,
    _permit: tokio::sync::OwnedSemaphorePermit,
) {
    let _ = copy_bidirectional(&mut downstream, &mut upstream).await;
}

#[cfg(test)]
mod tests {
    use super::super::test_server::{spawn_ssh_server, TestAuth};
    use super::*;
    use std::time::Duration;

    const TIMEOUT: Duration = Duration::from_secs(10);

    fn params(
        addr: SocketAddr,
        fingerprint: Option<String>,
        auth: SshAuth,
        target: SocketAddr,
    ) -> SshTunnelParams {
        SshTunnelParams {
            host: addr.ip().to_string(),
            port: addr.port(),
            user: "tester".into(),
            auth,
            target_host: target.ip().to_string(),
            target_port: target.port(),
            timeout: TIMEOUT,
            pinned_fingerprint: fingerprint,
        }
    }

    async fn spawn_echo() -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let (mut reader, mut writer) = socket.into_split();
                    let _ = tokio::io::copy(&mut reader, &mut writer).await;
                });
            }
        });
        addr
    }

    async fn roundtrip(tunnel: &SshTunnel) {
        let mut conn = TcpStream::connect(tunnel.local_addr()).await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        conn.write_all(b"ping-through-tunnel").await.unwrap();
        let mut buf = [0u8; 19];
        conn.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"ping-through-tunnel");
    }

    #[tokio::test]
    async fn password_auth_forwards_bytes_through_the_tunnel() {
        let auth = TestAuth::password("tester", "s3cret");
        let echo = spawn_echo().await;
        let server = spawn_ssh_server(auth, echo).await;

        let tunnel = SshTunnel::open(params(
            server.addr,
            Some(server.fingerprint.clone()),
            SshAuth::Password("s3cret".into()),
            echo,
        ))
        .await
        .unwrap();
        assert!(tunnel.local_addr().ip().is_loopback());

        roundtrip(&tunnel).await;
        tunnel.close().await;
    }

    #[tokio::test]
    async fn key_file_auth_forwards_bytes_through_the_tunnel() {
        let echo = spawn_echo().await;
        let client_key = russh::keys::PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap();
        let server =
            spawn_ssh_server(TestAuth::public_key(client_key.public_key().clone()), echo).await;

        let dir = tempfile::TempDir::new().unwrap();
        let key_path = dir.path().join("id_ed25519");
        std::fs::write(
            &key_path,
            client_key
                .to_openssh(russh::keys::ssh_key::LineEnding::LF)
                .unwrap(),
        )
        .unwrap();

        let tunnel = SshTunnel::open(params(
            server.addr,
            Some(server.fingerprint),
            SshAuth::KeyFile {
                path: key_path,
                passphrase: None,
            },
            echo,
        ))
        .await
        .unwrap();

        roundtrip(&tunnel).await;
        tunnel.close().await;
    }

    #[tokio::test]
    async fn key_file_with_wrong_passphrase_is_key_file_unreadable() {
        let echo = spawn_echo().await;
        let client_key = russh::keys::PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap();
        let server =
            spawn_ssh_server(TestAuth::public_key(client_key.public_key().clone()), echo).await;

        let dir = tempfile::TempDir::new().unwrap();
        let key_path = dir.path().join("id_ed25519");
        // The key on disk must actually be passphrase-encrypted — loading an
        // unencrypted key ignores the passphrase entirely, and this test would
        // silently test nothing. `encrypt` produces the encrypted form; the
        // passphrase handed to the tunnel below is deliberately wrong.
        let encrypted = client_key
            .encrypt(&mut russh::keys::key::safe_rng(), "right-passphrase")
            .unwrap();
        std::fs::write(
            &key_path,
            encrypted
                .to_openssh(russh::keys::ssh_key::LineEnding::LF)
                .unwrap(),
        )
        .unwrap();

        let err = SshTunnel::open(params(
            server.addr,
            Some(server.fingerprint),
            SshAuth::KeyFile {
                path: key_path,
                passphrase: Some("wrong".into()),
            },
            echo,
        ))
        .await
        .unwrap_err();
        assert!(matches!(err, SshTunnelError::KeyFileUnreadable), "{err:?}");
    }

    #[tokio::test]
    async fn unknown_host_key_fails_first_contact_and_carries_fingerprint() {
        let auth = TestAuth::password("tester", "s3cret");
        let echo = spawn_echo().await;
        let server = spawn_ssh_server(auth, echo).await;

        let err = SshTunnel::open(params(
            server.addr,
            None,
            SshAuth::Password("s3cret".into()),
            echo,
        ))
        .await
        .unwrap_err();
        match err {
            SshTunnelError::UnknownHostKey { fingerprint } => {
                assert_eq!(fingerprint, server.fingerprint);
            }
            other => panic!("expected UnknownHostKey, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn mismatched_pin_hard_fails_with_both_sides() {
        let auth = TestAuth::password("tester", "s3cret");
        let echo = spawn_echo().await;
        let server = spawn_ssh_server(auth, echo).await;

        let err = SshTunnel::open(params(
            server.addr,
            Some("SHA256:not-the-real-pin".into()),
            SshAuth::Password("s3cret".into()),
            echo,
        ))
        .await
        .unwrap_err();
        match err {
            SshTunnelError::HostKeyMismatch { pinned, presented } => {
                assert_eq!(pinned, "SHA256:not-the-real-pin");
                assert_eq!(presented, server.fingerprint);
            }
            other => panic!("expected HostKeyMismatch, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn wrong_password_is_auth_failed() {
        let auth = TestAuth::password("tester", "s3cret");
        let echo = spawn_echo().await;
        let server = spawn_ssh_server(auth, echo).await;

        let err = SshTunnel::open(params(
            server.addr,
            Some(server.fingerprint),
            SshAuth::Password("wrong".into()),
            echo,
        ))
        .await
        .unwrap_err();
        assert!(matches!(err, SshTunnelError::AuthFailed), "{err:?}");
    }

    #[tokio::test]
    async fn dialing_a_dead_host_times_out() {
        // 192.0.2.0/24 is TEST-NET-1: guaranteed unroutable, so the connect
        // hangs until the budget cuts it.
        let echo = spawn_echo().await;
        let server = spawn_ssh_server(TestAuth::password("t", "p"), echo).await;
        let mut p = params(
            server.addr,
            Some(server.fingerprint),
            SshAuth::Password("p".into()),
            echo,
        );
        p.host = "192.0.2.1".into();
        p.timeout = Duration::from_millis(300);
        let err = SshTunnel::open(p).await.unwrap_err();
        assert!(
            matches!(err, SshTunnelError::Timeout | SshTunnelError::Dial(_)),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn close_releases_the_local_port() {
        let auth = TestAuth::password("tester", "s3cret");
        let echo = spawn_echo().await;
        let server = spawn_ssh_server(auth, echo).await;

        let tunnel = SshTunnel::open(params(
            server.addr,
            Some(server.fingerprint),
            SshAuth::Password("s3cret".into()),
            echo,
        ))
        .await
        .unwrap();
        let port = tunnel.port();
        tunnel.close().await;

        // The listener is gone: rebinding the same port succeeds.
        tokio::time::timeout(
            Duration::from_secs(5),
            TcpListener::bind(("127.0.0.1", port)),
        )
        .await
        .expect("port released after close")
        .unwrap();
    }

    #[tokio::test]
    async fn tunnel_error_maps_to_typed_app_error_codes() {
        let err: crate::error::AppError = SshTunnelError::UnknownHostKey {
            fingerprint: "SHA256:x".into(),
        }
        .into();
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["payload"]["code"], "sshHostKeyUnknown");
        assert_eq!(json["payload"]["fingerprint"], "SHA256:x");

        let err: crate::error::AppError = SshTunnelError::AuthFailed.into();
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["payload"]["code"], "sshAuthFailed");
        assert_eq!(json["payload"]["fingerprint"], serde_json::Value::Null);
    }
}
