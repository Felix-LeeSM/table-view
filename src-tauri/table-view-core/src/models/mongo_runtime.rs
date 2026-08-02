//! Issue #1821 — MongoDB runtime capability: what the *connected server*
//! turned out to be, as opposed to what the `mongodb` profile statically
//! declares.
//!
//! `DataSourceProfile.capabilities` (see `models/data_source.rs`) is a
//! compile-time claim keyed by `DatabaseType` — it is identical for every
//! MongoDB connection. The values here are per-connection facts resolved once
//! during `MongoAdapter::connect` from the server's `hello` + `buildInfo`
//! handshake, so two MongoDB connections in the same app can legitimately
//! carry different ones (a 4.4 standalone and a 7.0 sharded cluster).
//!
//! **Fail-closed is the contract.** Every "we could not tell" outcome — probe
//! refused by an unprivileged user, handshake without the discriminating
//! fields, unparsable version string — lands on [`MongoTopology::Unknown`] /
//! `version: None`, never on a plausible-looking guess. Callers gate features
//! on a *positive* match, so unknown closes the feature instead of opening it.
//!
//! Gating itself lives in the frontend (`src/types/dataSource.ts`), per the
//! single-layer capability-gate decision recorded in
//! `memory/engineering/architecture/data-source/memory.md` (#1618 threat
//! model): the command layer enforces paradigm + safety, not capability. This
//! module therefore carries facts only — no `supports_*` predicate that would
//! have to stay in lockstep with the TypeScript one.
//!
//! The same paragraph carries a second clause the first draft of this comment
//! dropped: "mutation entry points do not trust button hide alone — they keep
//! one layer of defense-in-depth local guard". It does not bind the consumers
//! shipped so far (reading topology/version and rendering it is read-only),
//! but any later axis that gates a *write* on these values — transactions,
//! `runCommand` — owes that local guard on top of the UI gate.

use serde::{Deserialize, Serialize};

/// MongoDB deployment shape, decided from the `hello` handshake.
///
/// Discrimination follows the driver-spec order used by mongosh itself:
/// `msg == "isdbgrid"` marks a `mongos` router (sharded), otherwise the
/// presence of `setName` marks a replica-set member, otherwise standalone.
/// The `msg` check comes first because a `mongos` in front of replica-set
/// shards is still, to the client, a sharded cluster.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MongoTopology {
    Standalone,
    ReplicaSet,
    Sharded,
    /// Handshake missing, refused, or lacking the discriminating fields.
    /// The fail-closed default — never inferred from a successful connect.
    #[default]
    Unknown,
}

/// `major.minor.patch` from `buildInfo.version`, with the raw string kept for
/// display and for the frontend's `raw` passthrough.
///
/// Pre-release / build suffixes are dropped by the parser
/// (`"4.9.0-rc0"` → `4.9.0`) so a release candidate is not treated as an
/// unknown version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MongoServerVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    /// Verbatim `buildInfo.version`, e.g. `"4.9.0-rc0"`.
    pub raw: String,
}

/// Per-connection MongoDB runtime capability, resolved at connect time.
///
/// Serializes as `{"topology":"replicaSet","version":{"major":7,…}}`;
/// `version` is omitted when unknown rather than sent as `null`, matching the
/// `ConnectionStatus` wire convention in `models/connection.rs`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MongoRuntimeCapabilities {
    pub topology: MongoTopology,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<MongoServerVersion>,
}

impl MongoRuntimeCapabilities {
    /// The fail-closed value: nothing known about the server.
    ///
    /// Returned by adapters that never probe (every non-Mongo document
    /// adapter) and by the Mongo probe itself whenever a step fails.
    pub fn unknown() -> Self {
        Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reason: issue #1821 — the frontend discriminates on these exact literals
    // (`src/types/dataSource.ts` `MongoTopology`). A Rust rename that silently
    // changed the wire spelling would make every gate read "unknown" and close
    // features on healthy servers.
    #[test]
    fn topology_serializes_as_camel_case_literals() {
        let cases = [
            (MongoTopology::Standalone, r#""standalone""#),
            (MongoTopology::ReplicaSet, r#""replicaSet""#),
            (MongoTopology::Sharded, r#""sharded""#),
            (MongoTopology::Unknown, r#""unknown""#),
        ];
        for (topology, expected) in cases {
            assert_eq!(serde_json::to_string(&topology).unwrap(), expected);
        }
    }

    // Reason: issue #1821 — `unknown()` is the value every failure path lands
    // on. If it ever drifted to a concrete topology the gate would open on a
    // server nobody managed to identify.
    #[test]
    fn unknown_is_the_fail_closed_default() {
        let caps = MongoRuntimeCapabilities::unknown();
        assert_eq!(caps.topology, MongoTopology::Unknown);
        assert_eq!(caps.version, None);
        assert_eq!(caps, MongoRuntimeCapabilities::default());
    }

    #[test]
    fn unknown_version_is_omitted_from_the_wire() {
        let json = serde_json::to_string(&MongoRuntimeCapabilities::unknown()).unwrap();
        assert_eq!(json, r#"{"topology":"unknown"}"#);
    }

    #[test]
    fn known_capabilities_serialize_camel_case_fields() {
        let caps = MongoRuntimeCapabilities {
            topology: MongoTopology::Sharded,
            version: Some(MongoServerVersion {
                major: 4,
                minor: 9,
                patch: 0,
                raw: "4.9.0-rc0".into(),
            }),
        };
        assert_eq!(
            serde_json::to_string(&caps).unwrap(),
            r#"{"topology":"sharded","version":{"major":4,"minor":9,"patch":0,"raw":"4.9.0-rc0"}}"#
        );
    }
}
