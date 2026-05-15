/**
 * `addQueryTab` paradigm auto-detection (2026-05-15).
 *
 * Why these tests exist:
 *   Before this slice the store hard-coded the paradigm fallback to
 *   `"rdb"` when the caller omitted `opts.paradigm`. The sidebar
 *   "+ Query" button and the global Cmd+N shortcut both omit it, so
 *   opening a query tab against a Mongo connection produced an RDB tab.
 *   The `SqlQueryEditor` would render and the first execute would fail
 *   at the backend `as_rdb()` paradigm gate with
 *   `Unsupported operation: Operation requires a relational (RDB)
 *   connection`. The fix derives the paradigm from
 *   `connectionStore.connections[connId].db_type` via `paradigmOf()`
 *   when the caller does not pass an explicit override.
 *
 * The contract these tests lock:
 *   1. Mongo connection + no `paradigm` override → `"document"`.
 *   2. Postgres connection + no override → `"rdb"` (regression guard).
 *   3. Redis connection + no override → `"kv"`.
 *   4. Explicit `opts.paradigm` always wins, even when it disagrees
 *      with `db_type`. The override is the seam DocumentDatabaseTree
 *      uses to force `"document"` for the right-click "New query here"
 *      action and must keep working unchanged.
 *   5. Unknown `connId` falls back to `"rdb"` defensively so a stale
 *      shortcut never crashes tab creation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useConnectionStore } from "./connectionStore";
import { useWorkspaceStore } from "./workspaceStore";
import {
  getQueryTab,
  getTestWorkspace,
  installFakeLocalStorage,
  restoreLocalStorage,
} from "./__tests__/workspaceStoreTestHelpers";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";
import { paradigmOf } from "@/types/connection";

function makeConnection(
  id: string,
  dbType: DatabaseType,
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    id,
    name: `${id}-name`,
    db_type: dbType,
    host: "localhost",
    port: 5432,
    user: "user",
    database: "defaultdb",
    group_id: null,
    color: null,
    has_password: false,
    paradigm: paradigmOf(dbType),
    ...overrides,
  };
}

describe("workspaceStore.addQueryTab — paradigm auto-detection", () => {
  beforeEach(() => {
    installFakeLocalStorage();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
      focusedConnId: null,
    });
  });

  afterEach(() => {
    restoreLocalStorage();
  });

  it("infers document paradigm when the connection is MongoDB", () => {
    useConnectionStore.setState({
      connections: [makeConnection("conn-mongo", "mongodb")],
    });

    useWorkspaceStore.getState().addQueryTab("conn-mongo", "appdb");

    const tab = getQueryTab(getTestWorkspace("conn-mongo", "appdb"), 0);
    expect(tab.paradigm).toBe("document");
    // Document tabs must not carry the legacy `sql` queryMode — the
    // editor surface is mongosh-flavoured (Sprint 309 lock).
    expect(tab.queryMode).toBeUndefined();
  });

  it("keeps the rdb paradigm for Postgres connections (regression guard)", () => {
    useConnectionStore.setState({
      connections: [makeConnection("conn-pg", "postgresql")],
    });

    useWorkspaceStore.getState().addQueryTab("conn-pg", "appdb");

    const tab = getQueryTab(getTestWorkspace("conn-pg", "appdb"), 0);
    expect(tab.paradigm).toBe("rdb");
    expect(tab.queryMode).toBe("sql");
  });

  it("infers kv paradigm for Redis connections", () => {
    useConnectionStore.setState({
      connections: [makeConnection("conn-redis", "redis")],
    });

    useWorkspaceStore.getState().addQueryTab("conn-redis", "0");

    const tab = getQueryTab(getTestWorkspace("conn-redis", "0"), 0);
    expect(tab.paradigm).toBe("kv");
  });

  it("honours an explicit opts.paradigm override against db_type", () => {
    // Mongo connection, but caller insists on a `document` paradigm
    // explicitly. The store must not second-guess the override — that
    // is the seam DocumentDatabaseTree uses for "New query here".
    useConnectionStore.setState({
      connections: [makeConnection("conn-mongo", "mongodb")],
    });

    useWorkspaceStore
      .getState()
      .addQueryTab("conn-mongo", "appdb", { paradigm: "document" });

    const tab = getQueryTab(getTestWorkspace("conn-mongo", "appdb"), 0);
    expect(tab.paradigm).toBe("document");
  });

  it("falls back to rdb when the connection is missing", () => {
    // Defensive fallback — a stale Cmd+N pressed after the connection
    // was removed must not crash tab creation. The resulting tab will
    // never execute successfully (no connection), but the UI must stay
    // navigable until the user closes it.
    useWorkspaceStore.getState().addQueryTab("conn-missing", "");

    const tab = getQueryTab(getTestWorkspace("conn-missing", ""), 0);
    expect(tab.paradigm).toBe("rdb");
  });
});
