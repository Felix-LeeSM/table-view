/**
 * Issue #1821 — read the connected MongoDB server's runtime capability
 * (deployment topology + server version).
 *
 * Thin Tauri bridge for `mongo_runtime_capabilities(connection_id)`. The
 * backend probed `hello` + `buildInfo` once during `connect()` and cached the
 * result, so this is a cache read: safe to call whenever a gate needs it, no
 * admin round trip per call.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  type MongoRuntimeCapabilities,
  type MongoServerVersion,
  type MongoTopology,
  UNKNOWN_MONGO_RUNTIME_CAPABILITIES,
} from "@/types/dataSource";

const KNOWN_TOPOLOGIES: readonly MongoTopology[] = [
  "standalone",
  "replicaSet",
  "sharded",
  "unknown",
];

/**
 * Narrow the raw IPC payload to the wire contract.
 *
 * `invoke<T>()` is a cast, not a check — the returned value wears
 * `MongoRuntimeCapabilities` whether or not it is one. Everything downstream
 * (the gate in `meetsMongoRuntimeRequirement`, the deployment row in
 * `ServerInfoPanel`) then trusts fields that may not be there. A payload with
 * `minor`/`patch` missing happens to close gates (`undefined > n` is `false`)
 * but renders as a hole in the UI, and it disagrees with
 * `parseDataSourceVersion`, which coerces the same gaps to `0`. Rather than
 * leave the two readings to diverge, anything that is not the exact shape Rust
 * serializes degrades here to the fail-closed value — same direction as a
 * rejected call.
 */
function narrowCapabilities(payload: unknown): MongoRuntimeCapabilities {
  if (typeof payload !== "object" || payload === null) {
    return UNKNOWN_MONGO_RUNTIME_CAPABILITIES;
  }
  const { topology, version } = payload as {
    topology?: unknown;
    version?: unknown;
  };
  if (
    typeof topology !== "string" ||
    !KNOWN_TOPOLOGIES.includes(topology as MongoTopology)
  ) {
    return UNKNOWN_MONGO_RUNTIME_CAPABILITIES;
  }
  return {
    topology: topology as MongoTopology,
    version: narrowVersion(version),
  };
}

/** `undefined` for anything that is not a complete parsed triplet. */
function narrowVersion(version: unknown): MongoServerVersion | undefined {
  if (typeof version !== "object" || version === null) return undefined;
  const { major, minor, patch, raw } = version as Record<string, unknown>;
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch) ||
    typeof raw !== "string"
  ) {
    return undefined;
  }
  return {
    major: major as number,
    minor: minor as number,
    patch: patch as number,
    raw,
  };
}

/**
 * Resolve the runtime capability for `connectionId`.
 *
 * **Never rejects.** Every failure resolves to
 * {@link UNKNOWN_MONGO_RUNTIME_CAPABILITIES}, which satisfies no requirement —
 * so a connection that is gone, not connected, or not a document paradigm at
 * all closes version-gated features instead of opening them. Keeping the
 * fail-closed conversion here (rather than in each caller's `catch`) is what
 * makes the guarantee hold for every call site: a caller that forgot to catch
 * would otherwise turn a routine `Unsupported` into an unhandled rejection, and
 * one that caught carelessly could default to "supported".
 *
 * Backend rejections that land here:
 *   - `NotFound`    — no live adapter for this connection id
 *   - `Unsupported` — the connection is not a document (MongoDB) connection
 *
 * A payload that resolves but does not match the wire contract takes the same
 * exit — see {@link narrowCapabilities}.
 */
export async function mongoRuntimeCapabilities(
  connectionId: string,
): Promise<MongoRuntimeCapabilities> {
  try {
    return narrowCapabilities(
      await invoke<unknown>("mongo_runtime_capabilities", { connectionId }),
    );
  } catch {
    return UNKNOWN_MONGO_RUNTIME_CAPABILITIES;
  }
}
