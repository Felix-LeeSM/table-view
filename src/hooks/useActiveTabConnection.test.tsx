// Sprint 256 (2026-05-09): `useActiveTabConnection` — combine
// `useWorkspaceStore.activeTabId` + `useConnectionStore.connections` →
// `Connection | null`. Drives the EnvironmentChromeStripe + prod window
// border + ExecuteButton callsites. Tests cover: happy path (tab →
// connection), absent active tab → null, connection deleted while tab
// still references it → null fallback, and re-subscription on store
// mutation (the load-bearing reactivity that makes the chrome update in
// one frame when the user switches tabs).
//
// AC mapping: AC-256-01 (chrome stripe data source), AC-256-03 (instant
// activation on tab switch).

import { describe, it, expect, beforeEach } from "vitest";
import type { TabId } from "@/types/branded";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { renderHook, act } from "@testing-library/react";
import { useActiveTabConnection } from "./useActiveTabConnection";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";
import type { Tab } from "@stores/workspaceStore";

function makeConnection(
  id: string,
  environment: string | null = null,
): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment,
    paradigm: "rdb",
  };
}

function makeQueryTab(id: string, connectionId: string): Tab {
  // Minimal QueryTab shape — `useActiveTabConnection` only reads
  // `connectionId` so other fields can be stubs.
  return {
    id: id as TabId,
    type: "query",
    connectionId,
    title: "untitled",
    closable: true,
    sql: "",
    queryState: { status: "idle" },
    paradigm: "rdb",
    queryMode: "sql",
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: {} });
  useConnectionStore.setState({
    connections: [],
    activeStatuses: {},
    focusedConnId: null,
  });
});

describe("useActiveTabConnection", () => {
  it("returns null when no active tab", () => {
    const { result } = renderHook(() => useActiveTabConnection());
    expect(result.current).toBeNull();
  });

  it("returns the connection for the active tab", () => {
    const conn = makeConnection("c1", "production");
    useConnectionStore.setState({ connections: [conn] });
    useWorkspaceStore.setState(seedWorkspace([makeQueryTab("t1", "c1")], "t1"));

    const { result } = renderHook(() => useActiveTabConnection());
    expect(result.current?.id).toBe("c1");
    expect(result.current?.environment).toBe("production");
  });

  it("returns null when active tab references a missing connection", () => {
    // Tab survives a connection deletion (TabBar-side cleanup is async)
    // — the hook must not blow up; instead it falls back to null so the
    // chrome stripe disappears.
    useConnectionStore.setState({ connections: [] });
    useWorkspaceStore.setState(
      seedWorkspace([makeQueryTab("t1", "ghost")], "t1"),
    );

    const { result } = renderHook(() => useActiveTabConnection());
    expect(result.current).toBeNull();
  });

  it("re-subscribes when activeTabId changes (chrome must update one-frame)", () => {
    // Sets the AC-256-03 invariant: switching the active tab from a dev
    // connection to a prod connection produces a *new* hook value
    // synchronously on the next render.
    const dev = makeConnection("dev", "development");
    const prod = makeConnection("prod", "production");
    useConnectionStore.setState({ connections: [dev, prod] });
    useWorkspaceStore.setState(
      seedWorkspace(
        [makeQueryTab("t-dev", "dev"), makeQueryTab("t-prod", "prod")],
        "t-dev",
      ),
    );

    const { result } = renderHook(() => useActiveTabConnection());
    expect(result.current?.environment).toBe("development");

    // seedWorkspace placed the workspace at ("dev", "db1") because the
    // first tab's connectionId is "dev"; flip activeTabId there.
    act(() => {
      useWorkspaceStore.setState((state) => ({
        workspaces: {
          ...state.workspaces,
          dev: {
            ...state.workspaces.dev,
            db1: { ...state.workspaces.dev!.db1!, activeTabId: "t-prod" },
          },
        },
      }));
    });

    expect(result.current?.environment).toBe("production");
  });

  it("re-subscribes when the connection list mutates (deletion → null)", () => {
    const conn = makeConnection("c1", "staging");
    useConnectionStore.setState({ connections: [conn] });
    useWorkspaceStore.setState(seedWorkspace([makeQueryTab("t1", "c1")], "t1"));

    const { result } = renderHook(() => useActiveTabConnection());
    expect(result.current?.id).toBe("c1");

    act(() => {
      useConnectionStore.setState({ connections: [] });
    });

    expect(result.current).toBeNull();
  });
});
