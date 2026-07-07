import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Hoisted lib-boundary mocks — the auto-resolve path calls these Tauri
// bridges. Everything else (real connectionStore, real capability profiles)
// stays un-mocked so the assertion lands on the user-facing store slot.
const listDatabasesMock = vi.fn();
const switchActiveDbMock = vi.fn();

vi.mock("@/lib/api/listDatabases", () => ({
  listDatabases: (...args: unknown[]) => listDatabasesMock(...args),
}));
vi.mock("@/lib/api/switchActiveDb", () => ({
  switchActiveDb: (...args: unknown[]) => switchActiveDbMock(...args),
}));
vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return { ...actual, getCurrentWindowLabel: vi.fn() };
});

import { useAutoResolveActiveDb } from "./useAutoResolveActiveDb";
import { useConnectionStore } from "@stores/connectionStore";
import {
  setFakeWindowConnectionId,
  resetFakeWindowConnectionId,
} from "@stores/__tests__/fakeWindowConnectionId";
import type {
  ConnectionConfig,
  ConnectionStatus,
  DatabaseType,
  Paradigm,
} from "@/types/connection";

// Purpose: default-DB auto-resolve for connected switch-capable RDB windows —
// bug fix (2026-07-07). A PG connection created with an empty `database` field
// left `activeStatuses[id]` as `{type:"connected"}` (no activeDb), so the
// workspace key derived `db=""` and useSchemaCache skipped the whole schema
// load → blank schema tree + blank grid, unrecovered by reload. This hook
// heals the state reactively (runs post-hydrate too).

function makeConnection(
  overrides: Partial<ConnectionConfig> & { id: string; paradigm: Paradigm },
): ConnectionConfig {
  return {
    name: "Conn",
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    database: "",
    groupId: null,
    color: null,
    hasPassword: false,
    ...overrides,
  };
}

function seedConn(conn: ConnectionConfig, status: ConnectionStatus): void {
  useConnectionStore.setState({
    connections: [conn],
    activeStatuses: { [conn.id]: status },
    focusedConnId: null,
  });
}

function activeDbOf(id: string): string | undefined {
  const s = useConnectionStore.getState().activeStatuses[id];
  return s?.type === "connected" ? s.activeDb : undefined;
}

describe("useAutoResolveActiveDb", () => {
  beforeEach(() => {
    listDatabasesMock.mockReset();
    switchActiveDbMock.mockReset();
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
      focusedConnId: null,
    });
  });
  afterEach(() => {
    resetFakeWindowConnectionId();
  });

  // Reason: the core bug — connected PG with no activeDb must auto-select the
  // first listed DB via `switchActiveDb` → `setActiveDb` (order per
  // schemaStore.ts:56 contract), landing a non-empty activeDb in the store so
  // the workspace key stops resolving to `db=""` (2026-07-07).
  it("auto-selects the first database when connected RDB has no activeDb", async () => {
    setFakeWindowConnectionId("c1");
    listDatabasesMock.mockResolvedValue([
      { name: "app_db" },
      { name: "other_db" },
    ]);
    switchActiveDbMock.mockResolvedValue(undefined);
    seedConn(makeConnection({ id: "c1", paradigm: "rdb" }), {
      type: "connected",
    });

    renderHook(() => useAutoResolveActiveDb());

    await waitFor(() => {
      expect(switchActiveDbMock).toHaveBeenCalledWith("c1", "app_db");
    });
    expect(listDatabasesMock).toHaveBeenCalledWith("c1");
    // User-facing invariant: the store now carries a real activeDb, which is
    // exactly what unblocks the workspace-key → schema-load path.
    await waitFor(() => expect(activeDbOf("c1")).toBe("app_db"));
    // switch must precede set — assert set ran after a resolved switch.
    expect(switchActiveDbMock).toHaveBeenCalledTimes(1);
  });

  // Reason: an empty database list is a legitimate "nothing to select" answer.
  // Must not call setActiveDb and must not retry (once-per-connection guard).
  it("does not set activeDb and does not retry on an empty database list", async () => {
    setFakeWindowConnectionId("c1");
    listDatabasesMock.mockResolvedValue([]);
    seedConn(makeConnection({ id: "c1", paradigm: "rdb" }), {
      type: "connected",
    });

    const { rerender } = renderHook(() => useAutoResolveActiveDb());
    await waitFor(() => expect(listDatabasesMock).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    // Give any errant re-fire a tick to land.
    await Promise.resolve();
    expect(listDatabasesMock).toHaveBeenCalledTimes(1);
    expect(switchActiveDbMock).not.toHaveBeenCalled();
    expect(activeDbOf("c1")).toBeUndefined();
  });

  // Reason: listDatabases failure must be swallowed (best-effort) and must not
  // loop — the ref guard blocks a re-attempt within the same mount.
  it("does not retry after listDatabases rejects", async () => {
    setFakeWindowConnectionId("c1");
    listDatabasesMock.mockRejectedValue(new Error("no live adapter"));
    seedConn(makeConnection({ id: "c1", paradigm: "rdb" }), {
      type: "connected",
    });

    const { rerender } = renderHook(() => useAutoResolveActiveDb());
    await waitFor(() => expect(listDatabasesMock).toHaveBeenCalledTimes(1));
    rerender();
    await Promise.resolve();
    expect(listDatabasesMock).toHaveBeenCalledTimes(1);
    expect(switchActiveDbMock).not.toHaveBeenCalled();
  });

  // Reason: already-resolved activeDb is a no-op — never re-list or re-switch.
  it("is a no-op when activeDb is already set", async () => {
    setFakeWindowConnectionId("c1");
    seedConn(makeConnection({ id: "c1", paradigm: "rdb" }), {
      type: "connected",
      activeDb: "app_db",
    });

    renderHook(() => useAutoResolveActiveDb());
    await Promise.resolve();
    expect(listDatabasesMock).not.toHaveBeenCalled();
    expect(switchActiveDbMock).not.toHaveBeenCalled();
  });

  // Reason: paradigm scope — document(Mongo)/search(ES)/kv(Redis) must be
  // excluded. Redis is switch-capable but paradigm "kv" (own "0" fallback);
  // Mongo/ES have no switchDatabase capability. None should auto-resolve.
  it.each<{ paradigm: Paradigm; dbType: DatabaseType }>([
    { paradigm: "document", dbType: "mongodb" },
    { paradigm: "search", dbType: "elasticsearch" },
    { paradigm: "kv", dbType: "redis" },
  ])(
    "does not auto-resolve for non-RDB paradigm ($paradigm)",
    async ({ paradigm, dbType }) => {
      setFakeWindowConnectionId("c1");
      listDatabasesMock.mockResolvedValue([{ name: "whatever" }]);
      seedConn(makeConnection({ id: "c1", paradigm, dbType }), {
        type: "connected",
      });

      renderHook(() => useAutoResolveActiveDb());
      await Promise.resolve();
      expect(listDatabasesMock).not.toHaveBeenCalled();
      expect(switchActiveDbMock).not.toHaveBeenCalled();
    },
  );

  // Reason: mssql/oracle are RDB but NOT switch-capable (no switchDatabase
  // capability), so they render a read-only switcher — must be excluded too.
  it("does not auto-resolve for a non-switch-capable RDB (oracle)", async () => {
    setFakeWindowConnectionId("c1");
    listDatabasesMock.mockResolvedValue([{ name: "FREEPDB1" }]);
    seedConn(makeConnection({ id: "c1", paradigm: "rdb", dbType: "oracle" }), {
      type: "connected",
    });

    renderHook(() => useAutoResolveActiveDb());
    await Promise.resolve();
    expect(listDatabasesMock).not.toHaveBeenCalled();
  });

  // Reason: a disconnected connection has no live pool — auto-resolve must wait
  // until it is connected (guards against dispatching switch on a dead pool).
  it("does not auto-resolve while disconnected", async () => {
    setFakeWindowConnectionId("c1");
    listDatabasesMock.mockResolvedValue([{ name: "app_db" }]);
    seedConn(makeConnection({ id: "c1", paradigm: "rdb" }), {
      type: "disconnected",
    });

    renderHook(() => useAutoResolveActiveDb());
    await Promise.resolve();
    expect(listDatabasesMock).not.toHaveBeenCalled();
  });
});
