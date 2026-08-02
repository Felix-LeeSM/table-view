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
  UNKNOWN_MONGO_RUNTIME_CAPABILITIES,
} from "@/types/dataSource";

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
 */
export async function mongoRuntimeCapabilities(
  connectionId: string,
): Promise<MongoRuntimeCapabilities> {
  try {
    return await invoke<MongoRuntimeCapabilities>(
      "mongo_runtime_capabilities",
      { connectionId },
    );
  } catch {
    return UNKNOWN_MONGO_RUNTIME_CAPABILITIES;
  }
}
