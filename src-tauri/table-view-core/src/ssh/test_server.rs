//! In-process russh SSH server the tunnel tests dial: the handshake, host-key
//! presentation, authentication, and `direct-tcpip` forwarding all run over
//! the real protocol stack on `127.0.0.1` — no external network involved.

use std::net::SocketAddr;
use std::sync::Arc;

use russh::keys::{ssh_key, HashAlg, PrivateKey};
use russh::server::{self, Auth, ChannelOpenHandle, Msg, Session};
use russh::Channel;
use tokio::io::copy_bidirectional;
use tokio::net::TcpStream;

pub(super) enum TestAuth {
    Password { user: String, password: String },
    PublicKey(ssh_key::PublicKey),
}

impl TestAuth {
    pub(super) fn password(user: &str, password: &str) -> Self {
        TestAuth::Password {
            user: user.into(),
            password: password.into(),
        }
    }

    pub(super) fn public_key(key: ssh_key::PublicKey) -> Self {
        TestAuth::PublicKey(key)
    }
}

struct ServerHandler {
    auth: Arc<TestAuth>,
    target: SocketAddr,
}

impl server::Handler for ServerHandler {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        match self.auth.as_ref() {
            TestAuth::Password {
                user: u,
                password: p,
            } if u == user && p == password => Ok(Auth::Accept),
            _ => Ok(Auth::reject()),
        }
    }

    async fn auth_publickey(
        &mut self,
        _user: &str,
        public_key: &ssh_key::PublicKey,
    ) -> Result<Auth, Self::Error> {
        match self.auth.as_ref() {
            TestAuth::PublicKey(k) if k == public_key => Ok(Auth::Accept),
            _ => Ok(Auth::reject()),
        }
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        _host_to_connect: &str,
        _port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        // Forward to the echo target the server was spawned with; the
        // requested host/port is deliberately ignored so a test cannot
        // accidentally dial the network.
        let upstream = TcpStream::connect(self.target)
            .await
            .map_err(|_| russh::Error::Disconnect)?;
        reply.accept().await;
        // The russh session loop awaits this handler inline, and `accept()`
        // only queues the confirmation for that loop to send: a copy awaited
        // here would starve it and the client's `channel_open` would time out
        // waiting for a confirmation that never flushes. The pump runs detached.
        tokio::spawn(async move {
            let mut downstream = channel.into_stream();
            let mut upstream = upstream;
            let _ = copy_bidirectional(&mut downstream, &mut upstream).await;
        });
        Ok(())
    }
}

pub(super) struct TestSshServer {
    pub addr: SocketAddr,
    /// Fingerprint of the server's host key, in the same `SHA256:` notation
    /// the client's TOFU check produces.
    pub fingerprint: String,
}

pub(super) async fn spawn_ssh_server(auth: TestAuth, target: SocketAddr) -> TestSshServer {
    let host_key = PrivateKey::random(
        &mut russh::keys::key::safe_rng(),
        russh::keys::Algorithm::Ed25519,
    )
    .unwrap();
    let fingerprint = host_key
        .public_key()
        .fingerprint(HashAlg::Sha256)
        .to_string();

    let mut config = server::Config::default();
    config.keys.push(host_key);
    // The default 1s rejection delay exists to thwart online guessing; the
    // wrong-password test wants it gone.
    config.auth_rejection_time = std::time::Duration::from_millis(10);
    let config = Arc::new(config);
    let auth = Arc::new(auth);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let config = Arc::clone(&config);
            let auth = Arc::clone(&auth);
            tokio::spawn(async move {
                let handler = ServerHandler { auth, target };
                let _ = server::run_stream(config, socket, handler).await;
            });
        }
    });

    TestSshServer { addr, fingerprint }
}
