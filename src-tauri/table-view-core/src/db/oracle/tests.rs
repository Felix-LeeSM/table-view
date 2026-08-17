use super::*;
use crate::models::{ColumnChange, ColumnDefinition, ConstraintDefinition, SslMode};
use oracle_rs::config::ServiceMethod;
use tokio_util::sync::CancellationToken;

fn oracle_config() -> ConnectionConfig {
    ConnectionConfig {
        id: "oracle-1".into(),
        name: "Oracle".into(),
        db_type: DatabaseType::Oracle,
        host: " localhost ".into(),
        port: 1521,
        user: " testuser ".into(),
        password: "testpass".into(),
        database: " XEPDB1 ".into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(120),
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

/// #2154 — a self-signed CA certificate, valid to 2126, used only as a
/// `verify-ca` trust anchor in these tests. `rustls::RootCertStore::add`
/// parses the DER, so the `verify-ca` dial path cannot be asserted with a
/// placeholder string; embedding one certificate is cheaper than a
/// certificate-generating dev-dependency. It signs nothing and no test
/// completes a handshake with it.
///
/// Regenerate with:
/// `openssl req -x509 -newkey rsa:2048 -keyout /dev/null -nodes -days 36500
///  -subj "/CN=table-view oracle test CA" -addext "basicConstraints=critical,CA:TRUE"`
const TEST_CA_PEM: &str = "\
-----BEGIN CERTIFICATE-----
MIIDKzCCAhOgAwIBAgIUV3CjVueyDIz/FkfqVKnavjmMyoAwDQYJKoZIhvcNAQEL
BQAwJDEiMCAGA1UEAwwZdGFibGUtdmlldyBvcmFjbGUgdGVzdCBDQTAgFw0yNjA4
MTIwMTUwMzlaGA8yMTI2MDcxOTAxNTAzOVowJDEiMCAGA1UEAwwZdGFibGUtdmll
dyBvcmFjbGUgdGVzdCBDQTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB
AKc3vnI3JdLxtb98L+auN467fpr9EBFpA/U8K+VJ0xbsFnvmj9xQEO/XP72yypn1
sI0bC6G01hTa5iWtbJTPjVkRY0kDxcFH6G2JIk0wLqueobgoHXcL/4wjDjI6b08a
nbo+uObJB/lYUpUxGoD20UeaCZxv7MCMv5pGLv/ujvsC6FNEqQNINBg+hrEboe+S
hZ35QncS207GD4xvMnDgC3pF6njl1BmcaTrs/AZB1/OtXeTbZzuUACewsn5zlpXE
YdBBSxNrdMs6xs5mwkSdKEGfwBrwItS/BMmk5F5729alKQEG6ryOBoxcIhdR1cr0
iOSIYimWXxnbbRiyDspA1Q0CAwEAAaNTMFEwHQYDVR0OBBYEFKdcvohAMZmroqb2
OiW37BoyDvD8MB8GA1UdIwQYMBaAFKdcvohAMZmroqb2OiW37BoyDvD8MA8GA1Ud
EwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBABO+co9aK47MW1sEam99wzl7
8RmJ0y0CTFJJy/ikJKQ1MZwpcoLoCfu64NCE5c/mR2ieZn6ECBzCDsgOwltI3/jw
LSEqMES0UIcUIuOZCkLY4jCaMZ1kVYxh0oHEWUJ1ISqIsO2/+GdxPhgx3ZOzHrhR
5L74cdJGFDRzuIG4J4s4Qpc5F/jx+gq463NoSgae6yZwQ0b4uBUvGFCiP09GFTqB
aMzD3dojUMUurTaSYwW+uIXlHdiuW3qNbm9wPIm1wTTqW87AA7N4tL87HzgKVhYv
+dwPbHEC7XRX3cN7BVOeSwX6g35LmsIJQwvdknAjOTyELNgt8FW7ntHa8Hh3bm8=
-----END CERTIFICATE-----
";

/// A single-address TCP descriptor for `svc`, the shape a `tnsnames.ora` entry
/// carries. `dial_host.example.com` never resolves — nothing here connects.
const TCP_DESCRIPTOR: &str = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)))";
/// The same descriptor over TCPS, the ADB / on-prem TLS listener shape.
const TCPS_DESCRIPTOR: &str = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=dial-host.example.com)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=svc)))";

fn assert_oracle_not_open<T>(result: Result<T, AppError>) {
    assert!(matches!(
        result,
        Err(AppError::Connection(message)) if message.contains("not open")
    ));
}

#[test]
fn connect_config_uses_service_name_without_sid_wallet_or_tls() {
    let config = OracleAdapter::connect_config(&oracle_config(), 30).unwrap();

    assert_eq!(config.host, "localhost");
    assert_eq!(config.port, 1521);
    assert_eq!(config.username, "testuser");
    assert_eq!(config.connect_timeout, Duration::from_secs(30));
    assert!(!config.is_tls_enabled());
    assert!(config.tls_config.is_none());
    assert!(matches!(
        config.service,
        ServiceMethod::ServiceName(ref service) if service == "XEPDB1"
    ));

    // Reason: #1649 — `SslMode::Disable` is where the old explicitly-off pair
    // (`tls_enabled = Some(false)`, `trust_server_certificate = Some(false)`)
    // lands after the migration fold. Together with the default `Prefer` config
    // above it pins the accepted half of the Oracle posture boundary: neither
    // plaintext posture may trip the sslmode rejection. (2026-08-02)
    let mut disabled = oracle_config();
    disabled.ssl_mode = SslMode::Disable;
    OracleAdapter::connect_config(&disabled, 30)
        .expect("an explicitly disabled TLS posture must not trip the Oracle sslmode rejection");
}

#[test]
fn connect_config_rejects_empty_service_name() {
    let mut config = oracle_config();
    config.database = " ".into();

    assert!(matches!(
        OracleAdapter::connect_config(&config, 5),
        Err(AppError::Validation(message)) if message.contains("service name")
    ));
}

#[test]
fn connect_config_rejects_empty_required_fields() {
    let mut config = oracle_config();
    config.host = " ".into();
    assert!(matches!(
        OracleAdapter::connect_config(&config, 5),
        Err(AppError::Validation(message)) if message.contains("host")
    ));

    config = oracle_config();
    config.port = 0;
    assert!(matches!(
        OracleAdapter::connect_config(&config, 5),
        Err(AppError::Validation(message)) if message.contains("port")
    ));

    config = oracle_config();
    config.user = " ".into();
    assert!(matches!(
        OracleAdapter::connect_config(&config, 5),
        Err(AppError::Validation(message)) if message.contains("user")
    ));
}

#[test]
fn connect_config_still_rejects_advanced_auth_and_unexpressible_tls_postures() {
    // Reason: #1065 opens SID + wallet but keeps rejecting password-less
    // external auth and the routing fields Oracle never reads. It also rejected
    // every TLS-enabling posture, which #2154 undoes — the postures that survive
    // that reversal are pinned in the second half of this test. (2026-07-17,
    // rewritten 2026-08-12)
    let mut advanced = oracle_config();
    advanced.password.clear();
    assert!(matches!(
        OracleAdapter::connect_config(&advanced, 5),
        Err(AppError::Validation(message))
            if message.contains("password authentication") && message.contains("advanced")
    ));

    let mut auth_field = oracle_config();
    auth_field.auth_source = Some("kerberos".into());
    assert!(matches!(
        OracleAdapter::connect_config(&auth_field, 5),
        Err(AppError::Validation(message)) if message.contains("advanced auth")
    ));

    let mut replica_field = oracle_config();
    replica_field.replica_set = Some("tnsnames-alias".into());
    assert!(matches!(
        OracleAdapter::connect_config(&replica_field, 5),
        Err(AppError::Validation(_))
    ));

    // Reason: #2154 — the posture boundary moved again. `verify-ca`/`verify-full`
    // now dial TCPS (`connect_config_dials_wallet_less_tcps_for_verifying_postures`),
    // so `require` is the only posture still rejected: "encrypt without
    // verifying" is not expressible on this driver — `TlsConfig`'s
    // `danger_accept_invalid_certs` sets a `verify_server` flag that
    // `build_client_config` never reads (oracle-rs 0.1.7, threat model
    // §0.1/D1) — and accepting it would silently relabel the user's posture as
    // a verifying one. `verify-ca` with no CA file keeps failing closed on the
    // shared `db::tls` message. `disable`/`prefer` stay accepted (asserted in
    // `connect_config_uses_service_name_without_sid_wallet_or_tls`).
    // (2026-08-12)
    let mut skip_verify = oracle_config();
    skip_verify.ssl_mode = SslMode::Require;
    // `.err()` drops the Ok config: the crate's derived `Debug` prints
    // `password` verbatim (threat model §0.1/§2.5), so it must never reach a
    // panic message.
    match OracleAdapter::connect_config(&skip_verify, 5).err() {
        Some(AppError::Validation(message)) => assert!(
            message.contains("cannot skip certificate verification"),
            "require rejected with the wrong guidance: {message}"
        ),
        other => panic!("require must be rejected, got {other:?}"),
    }

    let mut unanchored = oracle_config();
    unanchored.ssl_mode = SslMode::VerifyCa;
    match OracleAdapter::connect_config(&unanchored, 5).err() {
        Some(AppError::Validation(message)) => assert!(
            message.contains("requires a CA certificate file"),
            "verify-ca without a CA file rejected with the wrong guidance: {message}"
        ),
        other => panic!("verify-ca without a CA file must be rejected, got {other:?}"),
    }
}

#[test]
fn connect_config_dials_wallet_less_tcps_for_verifying_postures() {
    // Reason: #2154 (#1650) — the wallet-less 1-way TLS dial path. `verify-full`
    // anchors on the driver's webpki bundle and `verify-ca` on the user's CA
    // file; both must reach the driver as TCPS with no client identity, which
    // is what separates 1-way TLS from the #1065 wallet mTLS path. (2026-08-12)
    let mut verify_full = oracle_config();
    verify_full.ssl_mode = SslMode::VerifyFull;
    let config = OracleAdapter::connect_config(&verify_full, 5).unwrap();
    assert!(config.is_tls_enabled());
    let tls = config
        .tls_config
        .expect("verify-full must attach a TLS config");
    assert_eq!(
        tls.ca_cert_path, None,
        "verify-full anchors on public roots"
    );
    assert_eq!(tls.wallet_path, None);
    assert_eq!(
        tls.client_cert_path, None,
        "1-way TLS must send no client certificate"
    );

    let dir = tempfile::tempdir().unwrap();
    let ca_path = dir.path().join("test-ca.pem");
    std::fs::write(&ca_path, TEST_CA_PEM).unwrap();
    let ca_path = ca_path.to_string_lossy().into_owned();
    let mut verify_ca = oracle_config();
    verify_ca.ssl_mode = SslMode::VerifyCa;
    verify_ca.ca_cert_path = Some(ca_path.clone());
    let config = OracleAdapter::connect_config(&verify_ca, 5).unwrap();
    assert!(config.is_tls_enabled());
    let tls = config
        .tls_config
        .expect("verify-ca must attach a TLS config");
    assert_eq!(
        tls.ca_cert_path.as_deref(),
        Some(ca_path.as_str()),
        "the user's CA must reach the driver as the trust anchor"
    );
    assert_eq!(
        tls.client_cert_path, None,
        "1-way TLS must send no client certificate"
    );
    // The anchor has to load: building eagerly in `connect_config` is what
    // turns an unusable CA into a config-time refusal instead of a handshake
    // failure minutes later.
    tls.build_client_config()
        .expect("the test CA must be a usable trust anchor");
}

#[test]
fn connect_config_unusable_ca_file_fails_closed_without_leaking_path() {
    // Reason: #2154 — same contract the wallet path has had since #1065: a
    // trust anchor that cannot be loaded must fail closed, and the error must
    // not echo the filesystem path (leaks the home-directory username /
    // internal topology; redact contract §2.5 / #1453). (2026-08-12)
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("no-such-ca.pem");
    let junk = dir.path().join("not-a-ca.pem");
    std::fs::write(&junk, "this file is not a certificate\n").unwrap();

    for ca_path in [missing, junk] {
        let ca_path = ca_path.to_string_lossy().into_owned();
        let mut verify_ca = oracle_config();
        verify_ca.ssl_mode = SslMode::VerifyCa;
        verify_ca.ca_cert_path = Some(ca_path.clone());
        match OracleAdapter::connect_config(&verify_ca, 5).err() {
            Some(AppError::Connection(message)) => assert!(
                !message.contains(&ca_path),
                "CA path leaked into error: {message}"
            ),
            other => panic!("expected a redacted Connection error, got {other:?}"),
        }
    }
}

#[test]
fn connect_config_wallet_mtls_reaches_a_built_tls_config() {
    // Reason: #2154 — a wallet that actually loads reaches
    // `rustls::ClientConfig::builder()`, which resolves the process-level
    // `CryptoProvider`. This workspace compiles rustls with both provider
    // features on, so before #2154 installed one that call **panicked** rather
    // than erroring: the #1065 wallet mTLS dial could not complete at all. No
    // pre-#2154 test reached it because none supplied a loadable wallet — the
    // wallet tests all stop at a missing/blank path. This one loads.
    // (2026-08-12)
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("ewallet.pem"), TEST_CA_PEM).unwrap();
    let wallet_path = dir.path().to_string_lossy().into_owned();
    let mut wallet = oracle_config();
    wallet.wallet_path = Some(wallet_path.clone());

    let config = OracleAdapter::connect_config(&wallet, 5).unwrap();
    assert!(config.is_tls_enabled());
    let tls = config
        .tls_config
        .expect("a loadable wallet must attach a TLS config");
    assert_eq!(tls.wallet_path.as_deref(), Some(wallet_path.as_str()));
    assert_eq!(
        tls.ca_cert_path, None,
        "the wallet is its own trust store; no sslmode CA is mixed in"
    );
    tls.build_client_config()
        .expect("the wallet trust store must build");
}

#[test]
fn connect_config_refuses_a_wallet_and_an_sslmode_posture_together() {
    // Reason: #2154 — the wallet is its own trust store *and* client identity
    // (#1065), so a wallet plus a verifying sslmode posture names two anchors
    // for one handshake. That is an ambiguous instruction, not a stronger one:
    // resolving it silently in either direction would connect in a posture the
    // user did not pick. (2026-08-12)
    let dir = tempfile::tempdir().unwrap();
    let mut both = oracle_config();
    both.wallet_path = Some(dir.path().to_string_lossy().into_owned());
    both.ssl_mode = SslMode::VerifyFull;
    match OracleAdapter::connect_config(&both, 5).err() {
        Some(AppError::Validation(message)) => assert!(
            message.contains("separate TLS paths"),
            "wallet + posture rejected with the wrong guidance: {message}"
        ),
        other => panic!("a wallet plus a TLS posture must be rejected, got {other:?}"),
    }
}

#[test]
fn connect_config_dials_a_tns_descriptor_through_the_same_axis() {
    // Reason: #2154 (#2102) — a descriptor pasted into the service field
    // supplies host, port, service and connect method, so it overrides the form
    // fields rather than sitting beside them. The descriptor itself never
    // reaches the driver (oracle-rs rejects descriptors outright): it is parsed
    // here and the driver rebuilds its own connect string from the parts.
    // (2026-08-12)
    let mut tns = oracle_config();
    tns.host = "form-host-is-unused.example.com".into();
    tns.port = 1;
    tns.database = format!("  {TCP_DESCRIPTOR}  ");
    let config = OracleAdapter::connect_config(&tns, 5).unwrap();
    assert_eq!(config.host, "dial-host.example.com");
    assert_eq!(config.port, 1521);
    assert!(matches!(
        config.service,
        ServiceMethod::ServiceName(ref service) if service == "svc"
    ));
    assert!(!config.is_tls_enabled(), "PROTOCOL=TCP is a plaintext dial");

    // CONNECT_DATA picks the connect method — the form's service/SID toggle
    // does not get a second vote.
    let mut sid = oracle_config();
    sid.oracle_use_sid = Some(false);
    sid.database = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=1521))(CONNECT_DATA=(SID=ORCL)))".into();
    let config = OracleAdapter::connect_config(&sid, 5).unwrap();
    assert!(matches!(
        config.service,
        ServiceMethod::Sid(ref sid) if sid == "ORCL"
    ));

    // The #1065 character whitelist still guards the parsed coordinates, so a
    // descriptor is not a way around it.
    let mut injected = oracle_config();
    injected.database = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=evil host)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)))".into();
    assert!(matches!(
        OracleAdapter::connect_config(&injected, 5).err(),
        Some(AppError::Validation(message)) if message.contains("host contains unsupported characters")
    ));
}

#[test]
fn connect_config_accepts_a_descriptor_in_tnsnames_ora_layout() {
    // Reason: #2154 — the malformed-descriptor error and both form hints tell
    // the user to paste "the whole `(DESCRIPTION=...)` entry from tnsnames.ora",
    // and that file is written with newlines, indentation and spaces around
    // `=`. Rejecting exactly the layout the instruction asks for left the user
    // with no way out of the error. Clause keys are matched case-insensitively,
    // so a lowercase entry parses to the same dial. (2026-08-12)
    let laid_out = "\
(description =
    (address = (protocol = tcp)(host = dial-host.example.com)(port = 1521))
    (connect_data =
      (service_name = svc)
    )
  )";
    let mut config = oracle_config();
    config.database = laid_out.into();
    let built = OracleAdapter::connect_config(&config, 5).unwrap();
    assert_eq!(built.host, "dial-host.example.com");
    assert_eq!(built.port, 1521);
    assert!(matches!(
        built.service,
        ServiceMethod::ServiceName(ref service) if service == "svc"
    ));
    assert!(!built.is_tls_enabled(), "PROTOCOL=tcp is a plaintext dial");

    // A single space after a `)` is the smallest form of the same rejection.
    let mut spaced = oracle_config();
    spaced.database = TCP_DESCRIPTOR.replace(")(CONNECT_DATA", ") (CONNECT_DATA");
    assert_ne!(
        spaced.database, TCP_DESCRIPTOR,
        "the spacing rewrite matched nothing"
    );
    let built = OracleAdapter::connect_config(&spaced, 5).unwrap();
    assert_eq!(built.host, "dial-host.example.com");

    // Whitespace between clauses is layout, not a licence for anything else:
    // junk there is still malformed.
    let mut junk = oracle_config();
    junk.database = TCP_DESCRIPTOR.replace(")(CONNECT_DATA", ") junk (CONNECT_DATA");
    assert!(
        matches!(
            OracleAdapter::connect_config(&junk, 5).err(),
            Some(AppError::Validation(message)) if message.contains("malformed")
        ),
        "text between clauses must stay malformed"
    );
}

#[test]
fn connect_config_keeps_descriptor_protocol_and_tls_posture_in_step() {
    // Reason: #2154 — the driver rebuilds the connect string from its own
    // `tls_mode`, so a descriptor's PROTOCOL and the connection's TLS posture
    // must agree or the dial contradicts the descriptor. Dialing plaintext
    // where the user pasted TCPS is exactly the silent downgrade the #1065
    // threat model rejected free-form descriptors over (§2.1). (2026-08-12)
    let mut matched = oracle_config();
    matched.database = TCPS_DESCRIPTOR.into();
    matched.ssl_mode = SslMode::VerifyFull;
    let config = OracleAdapter::connect_config(&matched, 5).unwrap();
    assert!(config.is_tls_enabled());
    assert_eq!(config.host, "dial-host.example.com");
    assert_eq!(config.port, 1522);

    for posture in [SslMode::Prefer, SslMode::Disable] {
        let mut downgraded = oracle_config();
        downgraded.database = TCPS_DESCRIPTOR.into();
        downgraded.ssl_mode = posture;
        match OracleAdapter::connect_config(&downgraded, 5).err() {
            Some(AppError::Validation(message)) => assert!(
                message.contains("PROTOCOL=TCPS"),
                "{posture:?} rejected with the wrong guidance: {message}"
            ),
            other => {
                panic!("a TCPS descriptor must not dial plaintext under {posture:?}, got {other:?}")
            }
        }
    }

    let mut upgraded = oracle_config();
    upgraded.database = TCP_DESCRIPTOR.into();
    upgraded.ssl_mode = SslMode::VerifyFull;
    assert!(
        matches!(
            OracleAdapter::connect_config(&upgraded, 5).err(),
            Some(AppError::Validation(message)) if message.contains("enables TLS")
        ),
        "a TCP descriptor must not be silently upgraded to a TCPS dial"
    );
}

#[test]
fn connect_config_refuses_tns_clauses_it_cannot_honor() {
    // Reason: #2154 implements option A2 of the #1065 threat model (§5-A):
    // extract host/port/service/protocol and hard-fail on every other clause.
    // §2.1 rejected the free-form option (A3) because a parser that drops
    // clauses leaves the user believing the descriptor pinned a posture the
    // dial never applied — DN matching is the sharpest case, since oracle-rs
    // 0.1.7 stores `ssl_server_dn_match` and never reads it. (2026-08-12)
    let unhonored = [
        // DN pinning the driver cannot enforce.
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=dial-host.example.com)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=svc))(SECURITY=(SSL_SERVER_DN_MATCH=yes)))",
        // Failover / load-balancing list — this client dials one address.
        "(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=1521)))(CONNECT_DATA=(SERVICE_NAME=svc)))",
        // Server-mode request.
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)(SERVER=DEDICATED)))",
        // Retry/timeout knobs the driver does not take.
        "(DESCRIPTION=(RETRY_COUNT=3)(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)))",
        // Two addresses: refused as a repeat, never resolved to the first one.
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=1521))(ADDRESS=(PROTOCOL=TCP)(HOST=other.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)))",
        // Neither coordinate set is optional.
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com))(CONNECT_DATA=(SERVICE_NAME=svc)))",
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)(SID=ORCL)))",
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=IPC)(HOST=dial-host.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)))",
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=not-a-port))(CONNECT_DATA=(SERVICE_NAME=svc)))",
    ];
    for descriptor in unhonored {
        let mut config = oracle_config();
        config.database = descriptor.into();
        assert!(
            matches!(
                OracleAdapter::connect_config(&config, 5).err(),
                Some(AppError::Validation(_))
            ),
            "descriptor accepted despite a clause this client cannot honor: {descriptor}"
        );
    }
}

#[test]
fn connect_config_rejects_malformed_descriptors_without_echoing_their_contents() {
    // Reason: #2154 — the descriptor field is where a user can paste a whole
    // `user/password@host` connect string (threat model §4-4), and descriptor
    // values carry internal topology besides. Parse errors may name a clause
    // key; they may never repeat a value. (2026-08-12)
    let secret = "hunter2-must-not-be-echoed";
    let malformed = [
        "(DESCRIPTION=".to_string(),
        format!("{TCP_DESCRIPTOR}trailing-junk"),
        format!("{TCP_DESCRIPTOR}{TCP_DESCRIPTOR}"),
        "(DESCRIPTION=(ADDRESS))".to_string(),
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)".to_string(),
        format!("(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)(PASSWORD={secret})))"),
    ];
    for descriptor in &malformed {
        let mut config = oracle_config();
        config.database = descriptor.clone();
        match OracleAdapter::connect_config(&config, 5).err() {
            Some(AppError::Validation(message)) => assert!(
                !message.contains(secret) && !message.contains("dial-host.example.com"),
                "descriptor contents leaked into the error: {message}"
            ),
            other => panic!("malformed descriptor was not rejected: {other:?}"),
        }
    }
}

#[test]
fn connect_config_rejects_descriptor_injection_in_identifiers() {
    // Reason: #1065 — the driver's `build_connect_string` interpolates
    // host/service/SID into a TNS descriptor with zero escaping, so a `)(`
    // value could inject descriptor clauses (real trigger: an imported export
    // envelope, threat model §2.1). The character whitelist at this trust
    // boundary is the mitigation; injection strings must be rejected, never
    // passed to the driver. (2026-07-17)
    let injections = [
        "X)(SERVER=DEDICATED))(ADDRESS=(HOST=evil",
        "svc/../other",
        "svc name",
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)))",
        "svc);DROP",
    ];
    for bad in injections {
        let mut svc = oracle_config();
        svc.database = bad.into();
        assert!(
            matches!(
                OracleAdapter::connect_config(&svc, 5),
                Err(AppError::Validation(_))
            ),
            "service name injection not rejected: {bad}"
        );

        let mut host = oracle_config();
        host.host = bad.into();
        assert!(
            matches!(
                OracleAdapter::connect_config(&host, 5),
                Err(AppError::Validation(_))
            ),
            "host injection not rejected: {bad}"
        );
    }

    // A legitimate ADB-style dotted/underscored service name survives.
    let mut adb = oracle_config();
    adb.database = "g1a2b3_myadb_high.adb.oraclecloud.com".into();
    OracleAdapter::connect_config(&adb, 5)
        .expect("ADB service name with dots/underscores must be accepted");
}

#[test]
fn connect_config_uses_sid_method_when_flagged() {
    // Reason: #1065 — `oracle_use_sid = Some(true)` selects the driver's
    // native `Config::with_sid`; without it the identifier is a service name.
    // (2026-07-17)
    let mut sid = oracle_config();
    sid.oracle_use_sid = Some(true);
    sid.database = " ORCL ".into();
    let config = OracleAdapter::connect_config(&sid, 5).unwrap();
    assert!(matches!(
        config.service,
        ServiceMethod::Sid(ref s) if s == "ORCL"
    ));
    assert!(!config.is_tls_enabled());

    let mut empty_sid = oracle_config();
    empty_sid.oracle_use_sid = Some(true);
    empty_sid.database = "  ".into();
    assert!(matches!(
        OracleAdapter::connect_config(&empty_sid, 5),
        Err(AppError::Validation(message)) if message.contains("SID")
    ));
}

#[test]
fn connect_config_wallet_missing_dir_errors_without_leaking_path() {
    // Reason: #1065 — a wallet path that can't be loaded (no ewallet.pem) must
    // fail closed, and the error must NOT echo the wallet path (leaks the home
    // dir username / topology; redact contract §2.5 / #1453). (2026-07-17)
    let dir = tempfile::tempdir().unwrap();
    let wallet_path = dir.path().join("nope-oracle-wallet");
    let mut wallet = oracle_config();
    wallet.wallet_path = Some(wallet_path.to_string_lossy().into_owned());

    match OracleAdapter::connect_config(&wallet, 5) {
        Err(AppError::Connection(message)) => {
            assert!(
                !message.contains(&*wallet_path.to_string_lossy()),
                "wallet path leaked into error: {message}"
            );
        }
        other => panic!("expected redacted Connection error, got {other:?}"),
    }
}

#[test]
fn connect_config_wallet_password_without_path_fails_closed() {
    // Reason: #1669 review — a non-empty wallet_password with no wallet_path
    // skipped the mTLS block entirely and connected over plaintext TCP,
    // silently dropping the user's wallet intent. Must fail closed with a
    // Validation error, and the error must never echo the secret. (2026-07-17)
    let wallet_pw = "wallet-secret-9x";

    let mut missing = oracle_config();
    missing.wallet_password = wallet_pw.into();
    missing.wallet_path = None;
    match OracleAdapter::connect_config(&missing, 5) {
        Err(AppError::Validation(message)) => {
            assert!(
                message.contains("wallet path"),
                "expected wallet-path guidance, got: {message}"
            );
            assert!(
                !message.contains(wallet_pw),
                "wallet password leaked into error: {message}"
            );
        }
        other => panic!("expected fail-closed Validation error, got {other:?}"),
    }

    // A blank/whitespace wallet_path is treated the same as absent.
    let mut blank = oracle_config();
    blank.wallet_password = wallet_pw.into();
    blank.wallet_path = Some("   ".into());
    assert!(matches!(
        OracleAdapter::connect_config(&blank, 5),
        Err(AppError::Validation(message)) if message.contains("wallet path")
    ));

    // An empty wallet_password with no wallet_path stays a valid plaintext
    // connection — the guard only trips when a wallet secret is present.
    let no_wallet = oracle_config();
    OracleAdapter::connect_config(&no_wallet, 5)
        .expect("no wallet password and no wallet path is a valid plaintext config");
}

#[test]
fn connect_config_without_wallet_leaves_tls_disabled() {
    // Reason: #1065 — no wallet path means plain TCP. #2154 adds the sslmode
    // posture as a second TLS trigger, so this now pins the default: neither
    // trigger present (`prefer`, no wallet) still dials plaintext.
    // (2026-07-17, restated 2026-08-12)
    let config = OracleAdapter::connect_config(&oracle_config(), 5).unwrap();
    assert!(!config.is_tls_enabled());
    assert!(config.tls_config.is_none());
}

#[test]
fn configured_timeout_is_clamped_for_runtime_connect() {
    assert_eq!(connection_timeout_secs(&oracle_config()), 30);

    let mut config = oracle_config();
    config.connection_timeout = Some(2);
    assert_eq!(connection_timeout_secs(&config), 2);

    config.connection_timeout = Some(120);
    assert_eq!(connection_timeout_secs(&config), 30);

    // #2429 — an unset timeout no longer saturates the 30s ceiling; the shared
    // default in `ConnectionConfig::connect_timeout` decides it. The
    // driver-facing value for every adapter is pinned in
    // `db::connect_timeout_tests`.
    config.connection_timeout = None;
    assert_eq!(connection_timeout_secs(&config), 10);
}

#[test]
fn oracle_connection_helpers_keep_error_and_empty_string_contracts() {
    assert_eq!(non_empty("  XEPDB1  ".into()).as_deref(), Some("XEPDB1"));
    assert_eq!(non_empty("   ".into()), None);

    let error = map_oracle_connection_error(oracle_rs::Error::oracle(12514, "listener failed"));
    assert!(matches!(
        error,
        AppError::Connection(message)
            if message.contains("ORA-12514") && message.contains("listener failed")
    ));
}

#[tokio::test]
async fn test_and_connect_reject_invalid_config_before_network_open() {
    let mut config = oracle_config();
    config.host = " ".into();
    assert!(matches!(
        OracleAdapter::test(&config).await,
        Err(AppError::Validation(message)) if message.contains("host")
    ));

    config = oracle_config();
    config.user = " ".into();
    let adapter = OracleAdapter::new();
    assert!(matches!(
        <OracleAdapter as DbAdapter>::connect(&adapter, &config).await,
        Err(AppError::Validation(message)) if message.contains("user")
    ));
}

#[tokio::test]
async fn current_database_returns_service_name_identity_when_connected() {
    let adapter = OracleAdapter::new();
    {
        let mut guard = adapter.state.lock().await;
        guard.connected_config = Some(oracle_config());
    }

    assert_eq!(
        adapter.current_database().await.unwrap(),
        Some("XEPDB1".into())
    );
}

#[tokio::test]
async fn current_database_without_connection_returns_none_for_fail_closed_guard() {
    let adapter = OracleAdapter::new();

    assert_eq!(adapter.current_database().await.unwrap(), None);
}

#[tokio::test]
async fn db_adapter_lifecycle_fails_closed_without_connection() {
    let adapter = OracleAdapter::new();

    assert!(matches!(adapter.kind(), DatabaseType::Oracle));
    assert_eq!(
        <OracleAdapter as RdbAdapter>::current_database(&adapter)
            .await
            .unwrap(),
        None
    );
    assert_oracle_not_open(<OracleAdapter as DbAdapter>::ping(&adapter).await);
    assert!(<OracleAdapter as DbAdapter>::disconnect(&adapter)
        .await
        .is_ok());
}

#[tokio::test]
async fn cancellable_metadata_obeys_cancel_token_before_work_completes() {
    let token = CancellationToken::new();
    token.cancel();

    let result =
        cancellable_metadata(std::future::pending::<Result<(), AppError>>(), Some(&token)).await;
    assert!(matches!(
        result,
        Err(AppError::Database(message)) if message.contains("cancelled")
    ));
}

#[tokio::test]
async fn raw_ddl_admin_execution_fails_closed_without_connection() {
    let adapter = OracleAdapter::new();
    let err = adapter
        .execute_query(
            "ALTER SESSION SET CURRENT_SCHEMA = HR",
            None,
            crate::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        AppError::Unsupported(message)
            if message.contains("raw DDL/admin") && message.contains("issue #905")
    ));
}

#[tokio::test]
async fn catalog_surfaces_require_open_connection() {
    let adapter = OracleAdapter::new();
    assert!(matches!(adapter.namespace_label(), NamespaceLabel::Schema));

    assert_oracle_not_open(adapter.list_namespaces().await);
    assert_oracle_not_open(adapter.list_databases().await);
    assert_oracle_not_open(adapter.list_tables("SYSTEM").await);
    assert_oracle_not_open(adapter.get_columns("SYSTEM", "T", None).await);
    assert_oracle_not_open(RdbAdapter::get_table_indexes(&adapter, "SYSTEM", "T", None).await);
    assert_oracle_not_open(RdbAdapter::get_table_constraints(&adapter, "SYSTEM", "T", None).await);
    assert_oracle_not_open(adapter.list_views("SYSTEM").await);
    assert_oracle_not_open(adapter.list_functions("SYSTEM").await);
    assert_oracle_not_open(adapter.get_view_definition("SYSTEM", "V").await);
    assert_oracle_not_open(adapter.get_view_columns("SYSTEM", "V").await);
    assert_oracle_not_open(adapter.list_schema_columns("SYSTEM").await);
    assert_oracle_not_open(adapter.get_function_source("SYSTEM", "F").await);
    // #1072 (2차) — list_triggers now runs a live ALL_TRIGGERS catalog query,
    // so it fails closed like the sibling catalog surfaces instead of returning
    // a misleading empty vec on a disconnected adapter. (2026-07-25)
    assert_oracle_not_open(adapter.list_triggers("SYSTEM", "T").await);
}

#[tokio::test]
async fn rdb_trait_catalog_surfaces_require_open_connection() {
    let adapter = OracleAdapter::new();
    let statements = vec!["SELECT 1 FROM DUAL".to_string()];

    fn assert_trait_not_open<T>(label: &str, result: Result<T, AppError>) {
        assert!(
            matches!(
                result,
                Err(AppError::Connection(message)) if message.contains("not open")
            ),
            "{label} did not fail closed as Oracle connection not open"
        );
    }

    assert_trait_not_open("list_databases", RdbAdapter::list_databases(&adapter).await);
    assert_trait_not_open(
        "list_tables",
        RdbAdapter::list_tables(&adapter, "SYSTEM").await,
    );
    assert_trait_not_open(
        "execute_sql",
        RdbAdapter::execute_sql(&adapter, "SELECT 1 FROM DUAL", None).await,
    );
    assert!(RdbAdapter::execute_sql_batch(&adapter, &statements, None)
        .await
        .is_err());
    assert!(RdbAdapter::dry_run_sql_batch(&adapter, &statements, None)
        .await
        .is_err());
    assert_trait_not_open(
        "query_table_data",
        RdbAdapter::query_table_data(&adapter, "SYSTEM", "T", 1, 10, None, None, None, None).await,
    );
    assert_trait_not_open(
        "list_views",
        RdbAdapter::list_views(&adapter, "SYSTEM").await,
    );
    assert_trait_not_open(
        "list_functions",
        RdbAdapter::list_functions(&adapter, "SYSTEM").await,
    );
    assert_trait_not_open(
        "get_view_definition",
        RdbAdapter::get_view_definition(&adapter, "SYSTEM", "V").await,
    );
    assert_trait_not_open(
        "get_view_columns",
        RdbAdapter::get_view_columns(&adapter, "SYSTEM", "V").await,
    );
    assert_trait_not_open(
        "list_schema_columns",
        RdbAdapter::list_schema_columns(&adapter, "SYSTEM").await,
    );
    assert_trait_not_open(
        "get_function_source",
        RdbAdapter::get_function_source(&adapter, "SYSTEM", "F").await,
    );

    // #1072 (2차) — Oracle list_triggers is a live ALL_TRIGGERS query now, so
    // the RdbAdapter override fails closed when the connection is not open.
    // (2026-07-25)
    assert_trait_not_open(
        "list_triggers",
        RdbAdapter::list_triggers(&adapter, "SYSTEM", "T").await,
    );
}

#[tokio::test]
async fn table_data_and_structured_ddl_execute_paths_require_open_connection() {
    let adapter = OracleAdapter::new();
    let drop_table = DropTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        cascade: false,
        preview_only: false,
        expected_database: None,
    };
    let rename_table = RenameTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        new_name: "T2".into(),
        preview_only: false,
        expected_database: None,
    };
    let alter_table = AlterTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        changes: vec![ColumnChange::Drop { name: "C".into() }],
        preview_only: false,
        expected_database: None,
    };
    let column = ColumnDefinition {
        name: "C".into(),
        data_type: "NUMBER".into(),
        nullable: true,
        default_value: None,
        comment: None,
        is_identity: false,
    };
    let drop_column = DropColumnRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        column_name: "C".into(),
        cascade: false,
        preview_only: false,
        expected_database: None,
    };
    let add_column_req = AddColumnRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        column: column.clone(),
        check_expression: None,
        preview_only: false,
        expected_database: None,
    };
    let create_table = CreateTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        name: "T".into(),
        columns: vec![column],
        primary_key: None,
        preview_only: false,
        table_comment: None,
        expected_database: None,
    };
    let create_index = CreateIndexRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        index_name: "T_C_IDX".into(),
        columns: vec!["C".into()],
        index_type: "btree".into(),
        is_unique: false,
        preview_only: false,
        expected_database: None,
    };
    let drop_index = DropIndexRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        index_name: "T_C_IDX".into(),
        table: "T".into(),
        if_exists: false,
        preview_only: false,
        expected_database: None,
    };
    let add_constraint = AddConstraintRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        constraint_name: "T_C_UNIQ".into(),
        definition: ConstraintDefinition::Unique {
            columns: vec!["C".into()],
        },
        preview_only: false,
        expected_database: None,
    };
    let drop_constraint = DropConstraintRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        constraint_name: "T_C_UNIQ".into(),
        preview_only: false,
        expected_database: None,
    };

    assert_oracle_not_open(
        adapter
            .query_table_data("SYSTEM", "T", 1, 100, None, None, None, None)
            .await,
    );
    assert_oracle_not_open(adapter.drop_table(&drop_table).await);
    assert_oracle_not_open(adapter.rename_table(&rename_table).await);
    assert_oracle_not_open(adapter.alter_table(&alter_table).await);
    assert_oracle_not_open(adapter.add_column(&add_column_req).await);
    assert_oracle_not_open(adapter.drop_column(&drop_column).await);
    assert_oracle_not_open(adapter.create_table(&create_table).await);
    assert_oracle_not_open(adapter.create_index(&create_index).await);
    assert_oracle_not_open(adapter.drop_index(&drop_index).await);
    assert_oracle_not_open(adapter.add_constraint(&add_constraint).await);
    assert_oracle_not_open(adapter.drop_constraint(&drop_constraint).await);
}

// Reason: issue #1453 — Oracle connect errors can echo a URL / DSN with
// credentials; `map_oracle_connection_error` must mask the secret while
// preserving the ORA code and host (2026-07-10).
#[test]
fn oracle_connection_error_masks_credential_echo() {
    let error = map_oracle_connection_error(oracle_rs::Error::oracle(
        12154,
        "cannot resolve oracle://app:S3cretPw1@dbhost:1521/XEPDB1 password=S3cretPw1",
    ));
    match error {
        AppError::Connection(message) => {
            assert!(
                !message.contains("S3cretPw1"),
                "leaked plaintext credential: {message}"
            );
            assert!(message.contains("ORA-12154"));
            assert!(message.contains("dbhost:1521"));
        }
        other => panic!("expected Connection error, got {other:?}"),
    }
}
