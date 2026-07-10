/**
 * #1414 (decision A, 2026-07-10) — a full app restart must reset each
 * connection's active database to the connection's configured default
 * `database`, never to whichever db the previous session was last viewing.
 * Restored tabs for other dbs stay on disk (decision A does NOT delete them);
 * only the *seeded activeDb* — which drives `useCurrentWorkspaceKey`, the
 * schema tree, and the DbSwitcher label — resets to the default.
 *
 * Why this is a regression lock, not a bug reproduction: the active db is
 * derived solely from `connectionStore.activeStatuses[connId].activeDb`, and
 * three existing mechanisms already reset it on cold boot —
 *   1. `connectToDatabase` seeds `activeDb = connection.database` (store.ts),
 *      backed by the backend `connect` seeding `active_db = config.database`.
 *   2. The retired Sprint 143 durable `activeDb` persist (AC-148-4) means no
 *      last-db value survives a reconnect.
 *   3. Session-scoped localStorage is keyed by a per-process session UUID
 *      (`AppState::new()` → `Uuid::new_v4()`), so `hydrateFromSession`
 *      restores nothing across a fresh process.
 * The persisted workspace map is the only durable "last db" carrier, and it is
 * NEVER consulted to pick the active db — `hydrateWorkspacesFromSnapshot` just
 * stores every `(connId, db)` cell. These tests pin that invariant so a future
 * re-introduction of durable last-db restoration (the exact Sprint 143
 * temptation the reporter feared) cannot silently break decision A.
 */
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Cold boot = a fresh session UUID, so session-scoped localStorage from the
// prior run is invalidated. `hydrateFromSession` therefore restores nothing.
vi.mock("@lib/scopedLocalStorage", () => ({
  persistFocusedConnId: vi.fn(),
  persistActiveStatuses: vi.fn(),
  readConnectionSession: () => ({
    focusedConnId: null,
    activeStatuses: null,
    hasFocusedConnId: false,
    hasActiveStatuses: false,
  }),
}));

vi.mock("@lib/zustand-ipc-bridge", () => ({
  attachZustandIpcBridge: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return { ...actual, getCurrentWindowLabel: vi.fn() };
});

import { useConnectionStore } from "./connectionStore";
import { useCurrentWorkspaceKey, useWorkspaceStore } from "./workspaceStore";
import type { WorkspaceState } from "./workspaceStore";
import {
  setFakeWindowConnectionId,
  resetFakeWindowConnectionId,
} from "./__tests__/fakeWindowConnectionId";

function seedRdbConnection(defaultDb: string): void {
  useConnectionStore.setState({
    connections: [
      {
        id: "c1",
        name: "TestDB",
        dbType: "postgresql",
        host: "localhost",
        port: 5432,
        user: "postgres",
        hasPassword: false,
        database: defaultDb,
        groupId: null,
        color: null,
        paradigm: "rdb",
      },
    ],
    activeStatuses: {},
    focusedConnId: null,
  });
}

/** Rehydrate a persisted workspace cell for a non-default db (last session). */
function seedPersistedWorkspaceForDb(db: string): void {
  useWorkspaceStore.getState().hydrateWorkspacesFromSnapshot({
    c1: {
      [db]: {
        activeTabId: "tab-1",
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "users",
            connectionId: "c1",
            closable: true,
            subView: "records",
            database: db,
          },
        ],
        closedTabHistory: [],
        dirtyTabIds: [],
        sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
      } as unknown as WorkspaceState,
    },
  });
}

beforeEach(() => {
  setupTauriMock({ connectToDatabase: vi.fn(() => Promise.resolve()) });
  useWorkspaceStore.setState({ workspaces: {} });
});

afterEach(() => {
  resetFakeWindowConnectionId();
  vi.clearAllMocks();
});

describe("#1414 — cold boot resets activeDb to the connection default", () => {
  it("resolves the current workspace key to the default db, not the last-viewed db", async () => {
    seedRdbConnection("test");
    setFakeWindowConnectionId("c1");
    // Prior session left tabs on the non-default "admin" db; the default
    // (c1, "test") cell was never written.
    seedPersistedWorkspaceForDb("admin");

    // Cold boot: hydrateFromSession restores nothing (fresh session UUID).
    useConnectionStore.getState().hydrateFromSession();
    // First activation after boot.
    await useConnectionStore.getState().connectToDatabase("c1");

    const status = useConnectionStore.getState().activeStatuses["c1"];
    expect(status?.type).toBe("connected");
    if (status?.type === "connected") {
      expect(status.activeDb).toBe("test");
    }

    const { result } = renderHook(() => useCurrentWorkspaceKey());
    expect(result.current).toEqual({ connId: "c1", db: "test" });
  });

  it("preserves the last-viewed db's tabs on disk (decision A does not delete tabs)", async () => {
    seedRdbConnection("test");
    setFakeWindowConnectionId("c1");
    seedPersistedWorkspaceForDb("admin");

    useConnectionStore.getState().hydrateFromSession();
    await useConnectionStore.getState().connectToDatabase("c1");

    // The "admin" cell survives; it is simply not the active workspace.
    expect(
      useWorkspaceStore.getState().workspaces.c1?.admin?.tabs,
    ).toHaveLength(1);
  });

  it("workspace-window boot: snapshot activeStatuses win over a persisted non-default cell", () => {
    // Faithful reproduction of the reporter's scenario at the boot-hydration
    // level: the workspace window rehydrates `activeStatuses` from the backend
    // snapshot (a cold-booted backend seeds `active_db = config.database`) and
    // rehydrates every persisted `(connId, db)` workspace cell. The persisted
    // "admin" cell must NOT become the active db — the snapshot's default does.
    seedRdbConnection("test");
    setFakeWindowConnectionId("c1");
    seedPersistedWorkspaceForDb("admin");
    useConnectionStore.getState().hydrateActiveStatusesFromSnapshot({
      c1: { type: "connected", activeDb: "test" },
    });

    const { result } = renderHook(() => useCurrentWorkspaceKey());
    expect(result.current).toEqual({ connId: "c1", db: "test" });
  });

  it("still follows an in-session db switch (decision A does not over-reset)", () => {
    seedRdbConnection("test");
    setFakeWindowConnectionId("c1");
    useConnectionStore.setState({
      activeStatuses: { c1: { type: "connected", activeDb: "test" } },
    });

    // Same session: the user switches to "admin" via the DbSwitcher.
    useConnectionStore.getState().setActiveDb("c1", "admin");

    const { result } = renderHook(() => useCurrentWorkspaceKey());
    expect(result.current).toEqual({ connId: "c1", db: "admin" });
  });
});
