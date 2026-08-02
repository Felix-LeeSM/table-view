//! Issue #1821 — resolve the connected MongoDB server's runtime capability
//! (deployment topology + server version) once, at connect time.
//!
//! Before this, both facts were reachable but nothing held them:
//! `server_info_impl` (schema.rs) re-ran `buildInfo` + `serverStatus` on every
//! Operations-panel open and threw the version away afterwards, and topology
//! was never asked about at all — `mongos` was only ever recognised
//! incidentally, while parsing a sharded opid string.
//!
//! Shape follows the MySQL precedent (`db/mysql/connection.rs`
//! `detect_server_version`): probe after the connection is live, cache the
//! parsed result on the adapter, and **degrade instead of failing the
//! connect** when the probe is refused. A user whose account cannot run
//! `hello` must still get a usable connection; they just do not get the
//! version-gated features.
//!
//! The pure `_from` constructors take already-fetched documents so the three
//! topology cases and the version-parse cases are unit-testable with no live
//! server.

use ::mongodb::Client;
use bson::{doc, Document};
use tracing::debug;

use crate::db::version::parse_version_triplet;
use crate::models::{MongoRuntimeCapabilities, MongoServerVersion, MongoTopology};

/// `hello.msg` value a `mongos` router reports. Stable across every server
/// version that has ever shipped sharding — the driver spec's own sharded
/// discriminator.
const MONGOS_MSG: &str = "isdbgrid";

/// Classify the deployment from a `hello` (or legacy `isMaster`) response.
///
/// Order matters: a `mongos` sitting in front of replica-set shards answers
/// with `msg: "isdbgrid"` and, on some builds, other replica-ish fields — the
/// client is talking to a sharded cluster, so `msg` is checked first.
///
/// A handshake missing both discriminators is a standalone `mongod`: that is
/// the *server's* answer, not a failure to get one, so it is a positive
/// classification. Absence of a handshake entirely is handled by
/// [`runtime_capabilities_from`], which never calls this.
pub(super) fn classify_topology(hello: &Document) -> MongoTopology {
    if hello.get_str("msg").map(|msg| msg == MONGOS_MSG) == Ok(true) {
        return MongoTopology::Sharded;
    }
    if hello.get_str("setName").is_ok() {
        return MongoTopology::ReplicaSet;
    }
    MongoTopology::Standalone
}

/// Parse `buildInfo.version` into a comparable triplet.
///
/// `None` when the field is absent or carries no leading number — an
/// unparsable version must not be rounded to `0.0.0`, which would read as
/// "ancient server" and could just as easily read as "meets nothing" by
/// accident rather than by decision.
pub(super) fn parse_server_version(build_info: &Document) -> Option<MongoServerVersion> {
    let raw = build_info.get_str("version").ok()?;
    let (major, minor, patch) = parse_version_triplet(raw)?;
    Some(MongoServerVersion {
        major,
        minor,
        patch,
        raw: raw.to_string(),
    })
}

/// Assemble the capability from whatever the two probes returned.
///
/// Each `None` argument is an independently failed probe: a missing handshake
/// leaves `topology: Unknown`, a missing `buildInfo` leaves `version: None`.
/// The two do not contaminate each other — a server that answers `hello` but
/// refuses `buildInfo` still reports its topology.
pub(super) fn runtime_capabilities_from(
    hello: Option<&Document>,
    build_info: Option<&Document>,
) -> MongoRuntimeCapabilities {
    MongoRuntimeCapabilities {
        topology: hello.map_or(MongoTopology::Unknown, classify_topology),
        version: build_info.and_then(parse_server_version),
    }
}

/// Run both admin probes against a live client and fold the results.
///
/// Never returns an error: every failure degrades to the fail-closed value for
/// that axis and is logged at `debug` (not `warn` — a locked-down account
/// refusing `hello` is an expected deployment, not an anomaly, and this runs on
/// every connect).
///
/// `hello` is the modern handshake (server 4.4+); servers older than that only
/// answer the legacy `isMaster` spelling, so a failed `hello` retries once
/// before giving up. Both carry the same `msg` / `setName` fields.
///
/// Cost, stated exactly because PR #2099's body rounded it down: **two round
/// trips on the happy path, three when `hello` is refused** (`hello` →
/// `isMaster` → `buildInfo`). Paid once per `connect()`; every later read is a
/// cache hit on `MongoAdapter::runtime_capabilities`.
pub(super) async fn detect_runtime_capabilities(client: &Client) -> MongoRuntimeCapabilities {
    let admin = client.database("admin");

    let hello = match admin.run_command(doc! { "hello": 1 }).await {
        Ok(document) => Some(document),
        Err(hello_err) => match admin.run_command(doc! { "isMaster": 1 }).await {
            Ok(document) => Some(document),
            Err(legacy_err) => {
                debug!(
                    "MongoDB topology probe unavailable; capability stays unknown \
                     (hello: {hello_err}; isMaster: {legacy_err})"
                );
                None
            }
        },
    };

    let build_info = match admin.run_command(doc! { "buildInfo": 1 }).await {
        Ok(document) => Some(document),
        Err(err) => {
            debug!("MongoDB buildInfo probe unavailable; version stays unknown ({err})");
            None
        }
    };

    runtime_capabilities_from(hello.as_ref(), build_info.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- topology, the three cases the issue enumerates ---------------------

    // Reason: issue #1821 — a stock `mongod` answers `hello` with neither
    // `msg` nor `setName`. That is a positive standalone classification, not a
    // fallback, so the gate can distinguish "standalone" (change streams are
    // genuinely impossible) from "unknown" (we never got an answer).
    #[test]
    fn standalone_when_handshake_has_neither_discriminator() {
        let hello = doc! { "ok": 1.0, "maxWireVersion": 21 };
        assert_eq!(classify_topology(&hello), MongoTopology::Standalone);
    }

    // Reason: issue #1821 — a replica-set member reports its set name.
    #[test]
    fn replica_set_when_set_name_present() {
        let hello = doc! { "ok": 1.0, "setName": "rs0", "hosts": ["a:27017"] };
        assert_eq!(classify_topology(&hello), MongoTopology::ReplicaSet);
    }

    // Reason: issue #1821 — a `mongos` router reports `msg: "isdbgrid"`.
    #[test]
    fn sharded_when_msg_is_isdbgrid() {
        let hello = doc! { "ok": 1.0, "msg": "isdbgrid" };
        assert_eq!(classify_topology(&hello), MongoTopology::Sharded);
    }

    // Reason: issue #1821 — `mongos` in front of replica-set shards can echo
    // both discriminators. The client is talking to a sharded cluster, so
    // `msg` must win; reading it as a replica set would open replica-only
    // features against a router that does not support them the same way.
    #[test]
    fn sharded_wins_when_both_discriminators_present() {
        let hello = doc! { "ok": 1.0, "msg": "isdbgrid", "setName": "rs0" };
        assert_eq!(classify_topology(&hello), MongoTopology::Sharded);
    }

    // Reason: issue #1821 — only the exact `isdbgrid` sentinel marks a router.
    // Any other `msg` string is not a sharded signal.
    #[test]
    fn other_msg_values_are_not_sharded() {
        let hello = doc! { "ok": 1.0, "msg": "something else" };
        assert_eq!(classify_topology(&hello), MongoTopology::Standalone);
    }

    // Reason: issue #1821 — `msg`/`setName` of a non-string BSON type must not
    // be coerced into a match. `get_str` on a wrong type is an Err, which the
    // `== Ok(true)` comparison rejects.
    #[test]
    fn non_string_discriminators_do_not_match() {
        let hello = doc! { "msg": 1, "setName": 42 };
        assert_eq!(classify_topology(&hello), MongoTopology::Standalone);
    }

    // -- version parsing ----------------------------------------------------

    #[test]
    fn parses_release_version() {
        let build = doc! { "version": "7.0.5" };
        let version = parse_server_version(&build).expect("7.0.5 must parse");
        assert_eq!((version.major, version.minor, version.patch), (7, 0, 5));
        assert_eq!(version.raw, "7.0.5");
    }

    // Reason: issue #1821 — release candidates ship `4.9.0-rc0`. The triplet
    // must survive the pre-release tag while `raw` keeps the full string for
    // display, otherwise every RC server loses its version-gated features.
    #[test]
    fn parses_pre_release_tag_and_keeps_raw() {
        let build = doc! { "version": "4.9.0-rc0" };
        let version = parse_server_version(&build).expect("4.9.0-rc0 must parse");
        assert_eq!((version.major, version.minor, version.patch), (4, 9, 0));
        assert_eq!(version.raw, "4.9.0-rc0");
    }

    // Reason: issue #1821 — component counts differ across builds; the absent
    // ones read as 0 rather than aborting the parse.
    #[test]
    fn parses_versions_with_differing_component_counts() {
        let two = parse_server_version(&doc! { "version": "5.2" }).expect("5.2 must parse");
        assert_eq!((two.major, two.minor, two.patch), (5, 2, 0));
        let one = parse_server_version(&doc! { "version": "6" }).expect("6 must parse");
        assert_eq!((one.major, one.minor, one.patch), (6, 0, 0));
    }

    // Reason: issue #1821 — an unparsable or missing version must stay
    // unknown. Rounding it to 0.0.0 would be a silent "ancient server" claim.
    #[test]
    fn unparsable_or_missing_version_is_none() {
        assert!(parse_server_version(&doc! { "version": "not-a-version" }).is_none());
        assert!(parse_server_version(&doc! { "ok": 1.0 }).is_none());
        assert!(parse_server_version(&doc! { "version": 7 }).is_none());
    }

    // -- fail-closed folding ------------------------------------------------

    // Reason: issue #1821 completion condition — when the probe fails the
    // capability must fall to the side that CLOSES features. Both axes land on
    // their unknown value, and the result equals the documented fail-closed
    // constant rather than any plausible-looking default.
    #[test]
    fn both_probes_failing_yields_the_fail_closed_value() {
        assert_eq!(
            runtime_capabilities_from(None, None),
            MongoRuntimeCapabilities::unknown()
        );
        assert_eq!(
            runtime_capabilities_from(None, None).topology,
            MongoTopology::Unknown
        );
    }

    // Reason: issue #1821 — the two probes are independent. A restricted
    // account that can run `hello` but not `buildInfo` keeps its topology; the
    // reverse keeps its version. Folding them into one all-or-nothing failure
    // would close more features than the server actually lacks.
    #[test]
    fn probes_degrade_independently() {
        let hello = doc! { "setName": "rs0" };
        let build = doc! { "version": "6.0.11" };

        let no_build = runtime_capabilities_from(Some(&hello), None);
        assert_eq!(no_build.topology, MongoTopology::ReplicaSet);
        assert_eq!(no_build.version, None);

        let no_hello = runtime_capabilities_from(None, Some(&build));
        assert_eq!(no_hello.topology, MongoTopology::Unknown);
        assert_eq!(no_hello.version.map(|v| v.major), Some(6));
    }

    // Reason: issue #1821 — an answered handshake whose version string is
    // garbage must not poison the topology it did establish.
    #[test]
    fn unparsable_version_does_not_close_the_topology() {
        let caps = runtime_capabilities_from(
            Some(&doc! { "msg": "isdbgrid" }),
            Some(&doc! { "version": "" }),
        );
        assert_eq!(caps.topology, MongoTopology::Sharded);
        assert_eq!(caps.version, None);
    }
}
