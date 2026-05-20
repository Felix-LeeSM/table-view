/**
 * 작성 2026-05-17 (Phase 6 sprint-376 Q21 affordance #3-a + #7).
 *
 * 사유: Q21 9 affordance 중
 *   (3-a) Sidebar resize handle 우클릭 "Reset width" →
 *         reset_setting("sidebar_width") 1회.
 *   (7)   Sidebar 헤더 우클릭 "Collapse all" → workspace store 의
 *         sidebar.expanded 가 빈 array. cross-window 는 frontend
 *         optimistic + workspace persist 가 sprint-360 의 SQLite write
 *         로 흘러가 다른 창에 도달.
 *
 * Confirm dialog 없음 — Q21 contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

vi.mock("@components/workspace/WorkspaceSidebar", () => ({
  default: ({ selectedId }: { selectedId: string | null }) => (
    <div data-testid="schema-panel">{selectedId ?? "none"}</div>
  ),
}));

import Sidebar from "./Sidebar";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  setFakeWindowConnectionId,
  resetFakeWindowConnectionId,
} from "@/stores/__tests__/fakeWindowConnectionId";
import type { ConnectionConfig } from "@/types/connection";

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

    const connWs = useWorkspaceStore.getState().workspaces["c1"];
    const ws = connWs?.["db1"];
    expect(ws?.sidebar.expanded).toEqual([]);
  });

  // 작성 2026-05-17 (sprint-378). 사유: 사용자가 width drag 후 기본값
  // 복귀를 위해 컨텍스트/설정 패널을 거치지 않고 호버 시 노출되는 보라색
  // drag handle 을 더블클릭으로 즉시 reset 할 수 있어야 한다 (이미지 #7).
  // handle 의 단일 mousedown (drag-start) 은 reset IPC 0 — 더블클릭만이
  // reset 을 트리거.
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
    // mousedown 만으로는 drag 가 시작되더라도 reset 은 일어나지 않아야 한다.
    fireEvent.mouseUp(handle!, { clientX: 100 });

    const calls = invokeMock.mock.calls.filter(
      (call) => call[0] === "reset_setting",
    );
    expect(calls).toHaveLength(0);
  });
});
