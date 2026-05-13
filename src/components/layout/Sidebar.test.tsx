import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Sidebar from "./Sidebar";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

// jsdom in this project's setup ships an incomplete localStorage (getItem etc.
// are undefined). Provide a working in-memory shim so persistence tests run.
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

// Isolate Sidebar from the full ThemePicker (and its transitive radix portals)
// so we can assert the trigger contract without rendering 72 cards.
vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-mock" />,
}));

// Mock WorkspaceSidebar (sprint 126 swap-in for SchemaPanel) so we don't
// have to render the full paradigm-aware tree. The test still asserts on
// `data-testid="schema-panel"` for stability — the slot's role from
// Sidebar's perspective is unchanged.
vi.mock("@components/workspace/WorkspaceSidebar", () => ({
  default: ({ selectedId }: { selectedId: string | null }) => (
    <div data-testid="schema-panel">{selectedId ?? "none"}</div>
  ),
}));

vi.mock("@components/connection/ConnectionDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="connection-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

function makeConnection(id: string): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "test",
    group_id: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

function setStores(opts: {
  connections?: ConnectionConfig[];
  active?: string[];
}) {
  const conns = opts.connections ?? [];
  const active = new Set(opts.active ?? []);
  const statuses: Record<string, ConnectionStatus> = {};
  for (const c of conns) {
    // ADR 0027 — connected status must carry `activeDb` so
    // `useCurrentWorkspaceKey()` resolves the workspace slot. Default
    // every connected connection to its own `db1` sub-pool — tests can
    // override per-connection via `useConnectionStore.setState` after.
    statuses[c.id] = active.has(c.id)
      ? { type: "connected", activeDb: "db1" }
      : { type: "disconnected" };
  }
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
    focusedConnId: null,
  });
  useWorkspaceStore.setState({ workspaces: {} });
}

// Sprint 125 — Sidebar is now Workspace-only (schemas mode). Connection
// management was extracted to HomePage; the SidebarModeToggle and the
// connections-mode rendering branch were removed.
describe("Sidebar (schemas-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setStores({});
  });

  it("does NOT render the SidebarModeToggle (sprint 125)", () => {
    render(<Sidebar />);
    expect(
      screen.queryByRole("radio", { name: /connections mode/i }),
    ).toBeNull();
    expect(screen.queryByRole("radio", { name: /schemas mode/i })).toBeNull();
  });

  it("renders the SchemaPanel", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("schema-panel")).toBeInTheDocument();
  });

  it("shows connection name in the header when a connection is focused", () => {
    setStores({
      connections: [makeConnection("c1")],
      active: ["c1"],
    });
    render(<Sidebar />);
    // Sidebar's seed effect focuses the first-connected connection.
    expect(screen.getByText(/c1 DB/)).toBeInTheDocument();
  });

  it("falls back to 'Schemas' header when no connection is focused", () => {
    setStores({});
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar-connection-header")).toHaveTextContent(
      "Schemas",
    );
  });

  it("auto-syncs focus when active tab's connectionId changes", () => {
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1", "c2"],
    });
    render(<Sidebar />);

    // Seed the active tab in the CURRENTLY focused workspace (c1, db1)
    // but with `connectionId: "c2"` so the auto-sync effect observes a
    // mismatch and re-focuses to c2. Mirrors the legacy "active tab
    // belongs to a different connection" path.
    act(() => {
      useWorkspaceStore.setState(
        seedWorkspace(
          [
            {
              type: "table",
              id: "tab-x",
              title: "x",
              connectionId: "c2",
              closable: true,
              schema: "public",
              table: "users",
              subView: "records",
            },
          ],
          "tab-x",
          "c1",
          "db1",
        ),
      );
    });

    expect(screen.getByTestId("schema-panel").textContent).toBe("c2");
  });

  it("clears selection when the focused connection is removed", () => {
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1", "c2"],
    });
    const { rerender } = render(<Sidebar />);

    act(() => {
      setStores({
        connections: [makeConnection("c2")],
        active: ["c2"],
      });
    });
    rerender(<Sidebar />);

    // Falls back to c2 (the surviving connected one).
    expect(screen.getByTestId("schema-panel").textContent).toBe("c2");
  });

  describe("New Query Tab button", () => {
    it("opens a new query tab when connected", () => {
      setStores({
        connections: [makeConnection("c1")],
        active: ["c1"],
      });
      render(<Sidebar />);

      const btn = screen.getByRole("button", { name: /new query tab/i });
      expect(btn).not.toBeDisabled();
      act(() => {
        fireEvent.click(btn);
      });

      // ADR 0027 — tabs live in workspace ("c1", db1).
      const state = getTestWorkspace("c1", "db1");
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.type).toBe("query");
      expect(state.tabs[0]!.connectionId).toBe("c1");
    });

    it("is disabled when there is no connected connection", () => {
      setStores({
        connections: [makeConnection("c1")],
        active: [],
      });
      render(<Sidebar />);

      const btn = screen.getByRole("button", { name: /new query tab/i });
      expect(btn).toBeDisabled();
    });
  });

  describe("Misc", () => {
    // 작성 이유 (2026-05-13, Sprint 291): workspace 윈도우에서 Cmd+N 의
    // 의미가 "새 연결" 에서 "새 쿼리 탭" 으로 바뀌면서 Sidebar 의
    // `new-connection` listener + 임베디드 ConnectionDialog mount 가
    // 제거되었다. 본 회귀 가드는 (a) 이벤트가 와도 dialog 가 mount
    // 되지 않고 (b) 컴포넌트 자체는 정상 렌더링됨을 단언한다.
    it("Sprint 291 — new-connection 이벤트는 더 이상 dialog 를 열지 않는다", () => {
      render(<Sidebar />);
      expect(screen.queryByTestId("connection-dialog")).toBeNull();

      act(() => {
        window.dispatchEvent(new Event("new-connection"));
      });

      expect(screen.queryByTestId("connection-dialog")).toBeNull();
    });

    it("renders the theme picker trigger with current theme in aria-label", () => {
      render(<Sidebar />);
      const btn = screen.getByRole("button", {
        name: /theme picker: currently/i,
      });
      expect(btn).toBeInTheDocument();
    });

    it("opens the theme picker popover when the trigger is clicked", () => {
      render(<Sidebar />);
      const btn = screen.getByRole("button", {
        name: /theme picker: currently/i,
      });
      // Popover portal content is not mounted until the trigger is clicked.
      expect(screen.queryByTestId("theme-picker-mock")).toBeNull();
      act(() => {
        fireEvent.click(btn);
      });
      expect(screen.getByTestId("theme-picker-mock")).toBeInTheDocument();
    });

    it("has a resize handle on the right edge", () => {
      const { container } = render(<Sidebar />);
      const handle = container.querySelector(".cursor-col-resize");
      expect(handle).toBeInTheDocument();
    });
  });
});
