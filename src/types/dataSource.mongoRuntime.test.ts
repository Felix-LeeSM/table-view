/**
 * Issue #1821 — the MongoDB runtime capability gate.
 *
 * These assertions pin the *fail-closed* half of the contract: a requirement
 * must close on each axis it names whenever that axis is unknown. A green
 * `meetsMongoRuntimeRequirement` that returned `true` on unknown input would
 * be worse than no gate at all — it would look like a check while letting
 * every unidentified server through. The axes are judged independently, so an
 * unidentified topology still clears a *version-only* requirement; that is
 * pinned below as intended behaviour, not treated as a leak.
 */
import { describe, expect, it } from "vitest";
import {
  DATA_SOURCE_PROFILES,
  type MongoRuntimeCapabilities,
  meetsMongoRuntimeRequirement,
  UNKNOWN_MONGO_RUNTIME_CAPABILITIES,
} from "./dataSource";

const REPLICA_SET_7_0: MongoRuntimeCapabilities = {
  topology: "replicaSet",
  version: { major: 7, minor: 0, patch: 5, raw: "7.0.5" },
};

const STANDALONE_4_4: MongoRuntimeCapabilities = {
  topology: "standalone",
  version: { major: 4, minor: 4, patch: 29, raw: "4.4.29" },
};

describe("MongoDB runtime capability — runtime vs static profile", () => {
  // The whole point of the issue: these values are per-connection, resolved
  // after connecting, and therefore must NOT have leaked into the static
  // profile registry, where one frozen value is shared by every connection to
  // the engine.
  it("keeps runtime capability out of the static mongodb profile", () => {
    const profile = DATA_SOURCE_PROFILES.mongodb;
    expect(profile.capabilities).not.toHaveProperty("topology");
    expect(profile.capabilities).not.toHaveProperty("version");
    expect(profile).not.toHaveProperty("runtime");
  });

  it("exposes a frozen fail-closed constant", () => {
    expect(UNKNOWN_MONGO_RUNTIME_CAPABILITIES.topology).toBe("unknown");
    expect(UNKNOWN_MONGO_RUNTIME_CAPABILITIES.version).toBeUndefined();
    expect(Object.isFrozen(UNKNOWN_MONGO_RUNTIME_CAPABILITIES)).toBe(true);
  });
});

describe("meetsMongoRuntimeRequirement — topology axis", () => {
  it("passes when the server's topology is in the allowed set", () => {
    expect(
      meetsMongoRuntimeRequirement(REPLICA_SET_7_0, {
        topologies: ["replicaSet", "sharded"],
      }),
    ).toBe(true);
  });

  it("closes when the server's topology is outside the allowed set", () => {
    // Change streams need a replica set or a sharded cluster; a standalone
    // genuinely cannot serve them, so this is a true negative, not a fallback.
    expect(
      meetsMongoRuntimeRequirement(STANDALONE_4_4, {
        topologies: ["replicaSet", "sharded"],
      }),
    ).toBe(false);
  });

  it("closes on an unknown topology even when the set is broad", () => {
    expect(
      meetsMongoRuntimeRequirement(
        { topology: "unknown", version: REPLICA_SET_7_0.version },
        { topologies: ["standalone", "replicaSet", "sharded"] },
      ),
    ).toBe(false);
  });
});

describe("meetsMongoRuntimeRequirement — version axis", () => {
  it("is inclusive at the exact minimum", () => {
    expect(
      meetsMongoRuntimeRequirement(STANDALONE_4_4, {
        minVersion: [4, 4, 29],
      }),
    ).toBe(true);
  });

  it("compares major before minor before patch", () => {
    expect(
      meetsMongoRuntimeRequirement(STANDALONE_4_4, { minVersion: [4, 4, 30] }),
    ).toBe(false);
    expect(
      meetsMongoRuntimeRequirement(STANDALONE_4_4, { minVersion: [4, 5, 0] }),
    ).toBe(false);
    expect(
      meetsMongoRuntimeRequirement(STANDALONE_4_4, { minVersion: [5, 0, 0] }),
    ).toBe(false);
    // A higher major clears a higher minor/patch minimum.
    expect(
      meetsMongoRuntimeRequirement(REPLICA_SET_7_0, {
        minVersion: [4, 99, 99],
      }),
    ).toBe(true);
  });

  it("accepts a parsed pre-release version by its triplet", () => {
    // The backend strips the `-rc0` tag but keeps it in `raw`; an RC of 4.9
    // must clear a 4.2 minimum instead of reading as "version unknown".
    const releaseCandidate: MongoRuntimeCapabilities = {
      topology: "replicaSet",
      version: { major: 4, minor: 9, patch: 0, raw: "4.9.0-rc0" },
    };
    expect(
      meetsMongoRuntimeRequirement(releaseCandidate, { minVersion: [4, 2, 0] }),
    ).toBe(true);
  });

  // PR #2105 review, non-blocking 11: this combination is not hypothetical —
  // the Rust probes degrade independently, so an account allowed to run
  // `buildInfo` but not `hello` reports a real version under an unidentified
  // topology. A version-only requirement asks nothing about the deployment, so
  // it opens. Pinned because the alternative reading (any `"unknown"` closes
  // everything) is the one a reader assumes.
  it("clears a version-only requirement even on an unidentified topology", () => {
    expect(
      meetsMongoRuntimeRequirement(
        { topology: "unknown", version: REPLICA_SET_7_0.version },
        { minVersion: [4, 0, 0] },
      ),
    ).toBe(true);
    // Naming the deployment is what closes it.
    expect(
      meetsMongoRuntimeRequirement(
        { topology: "unknown", version: REPLICA_SET_7_0.version },
        { minVersion: [4, 0, 0], topologies: ["replicaSet", "sharded"] },
      ),
    ).toBe(false);
  });

  it("closes when the server version could not be determined", () => {
    expect(
      meetsMongoRuntimeRequirement(
        { topology: "replicaSet" },
        { minVersion: [4, 0, 0] },
      ),
    ).toBe(false);
  });
});

describe("meetsMongoRuntimeRequirement — fail-closed on absent capability", () => {
  // Transactions want 4.0+ on a replica set: the two-axis case, checked
  // against every way of not knowing.
  const transactions = {
    minVersion: [4, 0, 0],
    topologies: ["replicaSet", "sharded"],
  } as const;

  it("closes for a connection that has not been probed yet", () => {
    expect(meetsMongoRuntimeRequirement(undefined, transactions)).toBe(false);
    expect(meetsMongoRuntimeRequirement(null, transactions)).toBe(false);
  });

  it("closes for the fail-closed constant itself", () => {
    expect(
      meetsMongoRuntimeRequirement(
        UNKNOWN_MONGO_RUNTIME_CAPABILITIES,
        transactions,
      ),
    ).toBe(false);
  });

  it("closes when either axis alone fails", () => {
    // Topology fine, version too old.
    expect(
      meetsMongoRuntimeRequirement(
        {
          topology: "replicaSet",
          version: { major: 3, minor: 6, patch: 0, raw: "3.6.0" },
        },
        transactions,
      ),
    ).toBe(false);
    // Version fine, topology cannot serve it.
    expect(meetsMongoRuntimeRequirement(STANDALONE_4_4, transactions)).toBe(
      false,
    );
    // Both fine.
    expect(meetsMongoRuntimeRequirement(REPLICA_SET_7_0, transactions)).toBe(
      true,
    );
  });

  it("closes on an empty allowed-topology set rather than waving it through", () => {
    expect(
      meetsMongoRuntimeRequirement(REPLICA_SET_7_0, { topologies: [] }),
    ).toBe(false);
  });

  it("closes on a requirement that constrains nothing", () => {
    // `{}` is what a misspelled key collapses to. A gate that answered "yes"
    // there would report support for a feature nobody checked.
    expect(meetsMongoRuntimeRequirement(REPLICA_SET_7_0, {})).toBe(false);
  });
});
