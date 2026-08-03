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

/**
 * The wire enum, as a `Record` rather than an array so that a missing member
 * is a compile error (TS2741) instead of a silently narrower check.
 */
const KNOWN_TOPOLOGIES: Record<MongoTopology, true> = {
  standalone: true,
  replicaSet: true,
  sharded: true,
  unknown: true,
};

/** Own-property lookup, so inherited members are not topologies. */
const isKnownTopology = (value: string): value is MongoTopology =>
  Object.prototype.hasOwnProperty.call(KNOWN_TOPOLOGIES, value);

/** Rust serializes the triplet as three `u32`s. */
const isU32 = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 0xffff_ffff;

/**
 * Narrow the raw IPC payload to the wire contract — `invoke<T>()` is a cast,
 * not a check. Anything off-contract degrades to the fail-closed value, the
 * same exit a rejected call takes.
 */
function narrowCapabilities(payload: unknown): MongoRuntimeCapabilities {
  if (typeof payload !== "object" || payload === null) {
    return UNKNOWN_MONGO_RUNTIME_CAPABILITIES;
  }
  const { topology, version } = payload as {
    topology?: unknown;
    version?: unknown;
  };
  if (typeof topology !== "string" || !isKnownTopology(topology)) {
    return UNKNOWN_MONGO_RUNTIME_CAPABILITIES;
  }
  return {
    topology,
    version: narrowVersion(version),
  };
}

/** `undefined` for anything that is not a complete parsed triplet. */
function narrowVersion(version: unknown): MongoServerVersion | undefined {
  if (typeof version !== "object" || version === null) return undefined;
  const { major, minor, patch, raw } = version as Record<string, unknown>;
  if (
    !isU32(major) ||
    !isU32(minor) ||
    !isU32(patch) ||
    typeof raw !== "string"
  ) {
    return undefined;
  }
  return { major, minor, patch, raw };
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
