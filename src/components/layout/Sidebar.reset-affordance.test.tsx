/**
 * Q21 affordance #3-a + #7.
 *
 * Reason: of the 9 Q21 affordances,
 *   (3-a) right-click the Sidebar resize handle → "Reset width" →
 *         reset_setting("sidebar_width") once.
 *   (7)   right-click the Sidebar header → "Collapse all" → the workspace
 *         store's sidebar.expanded becomes an empty array. Cross-window, the
 *         frontend optimistic update + workspace persist flow into the
 *         SQLite write and reach the other windows.
 *
 * No confirm dialog — Q21 contract.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(() => "workspace-c1"),
  };
});

// jsdom shim for localStorage (mirrors Sidebar.test.tsx).
{
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-mock" />,
}));

vi.mock("./WorkspaceSidebar", () => ({
  default: ({ selectedId }: { selectedId: string | null }) => (
    <div data-testid="schema-panel">{selectedId ?? "none"}</div>
  ),
}));

import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  resetFakeWindowConnectionId,
  setFakeWindowConnectionId,
} from "@/stores/__tests__/fakeWindowConnectionId";
import type { ConnectionConfig } from "@/types/connection";
import Sidebar from "./Sidebar";

function makeConnection(id: string): ConnectionConfig {
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
    environment: null,
    paradigm: "rdb",
  };
}

describe("Sidebar reset affordances (Q21 #3-a + #7)", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useConnectionStore.setState({
      connections: [makeConnection("c1")],
      activeStatuses: { c1: { type: "connected", activeDb: "db1" } },
      focusedConnId: null,
    });
    useWorkspaceStore.setState({
      workspaces: {
        c1: {
          db1: {
            tabs: [],
            activeTabId: null,
            closedTabHistory: [],
            dirtyTabIds: [],
            sidebar: {
              selectedNode: null,
              expanded: ["schema.public", "schema.private"],
              scrollTop: 0,
            },
          },
        },
      },
    });
    setFakeWindowConnectionId("c1");
  });

  afterEach(() => {
    resetFakeWindowConnectionId();
  });

  it("AC-376-03 (handle): resize handle 'Reset width' 클릭 → reset_setting('sidebar_width') 1회", () => {
    render(<Sidebar />);
    const btn = screen.getByRole("button", { name: /reset sidebar width/i });
    fireEvent.click(btn);

    const calls = invokeMock.mock.calls.filter(
      (call) => call[0] === "reset_setting",
    );
    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[1]).toEqual({ key: "sidebar_width" });
  });

  it("AC-376-07: header 'Collapse all' 클릭 → workspace sidebar.expanded 가 빈 array", () => {
    render(<Sidebar />);
    const btn = screen.getByRole("button", { name: /collapse all/i });
    fireEvent.click(btn);

    const connWs = useWorkspaceStore.getState().workspaces.c1;
    const ws = connWs?.db1;
    expect(ws?.sidebar.expanded).toEqual([]);
  });

  // Reason: after dragging the width, the user must be able to reset to the
  // default immediately by double-clicking the purple drag handle exposed on
  // hover, without going through the context menu or the settings panel
  // (image #7). A single mousedown on the handle (drag-start) sends no reset
  // IPC — only a double-click triggers the reset.
  it("AC-378-01: resize handle 더블클릭 → reset_setting('sidebar_width') 1회", () => {
    render(<Sidebar />);
    const handle = document.querySelector(
      ".cursor-col-resize",
    ) as HTMLElement | null;
    expect(handle).toBeTruthy();
    fireEvent.doubleClick(handle!);

    const calls = invokeMock.mock.calls.filter(
      (call) => call[0] === "reset_setting",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({ key: "sidebar_width" });
  });

  it("AC-378-02: resize handle 단일 mousedown (drag-start) → reset IPC 0회", () => {
    render(<Sidebar />);
    const handle = document.querySelector(
      ".cursor-col-resize",
    ) as HTMLElement | null;
    expect(handle).toBeTruthy();

    fireEvent.mouseDown(handle!, { clientX: 100 });
    // A mousedown alone must not reset, even if it starts the drag.
    fireEvent.mouseUp(handle!, { clientX: 100 });

    const calls = invokeMock.mock.calls.filter(
      (call) => call[0] === "reset_setting",
    );
    expect(calls).toHaveLength(0);
  });
});
