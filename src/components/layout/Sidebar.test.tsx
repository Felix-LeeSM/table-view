import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, fireEvent, act } from "@testing-library/react";

// sprint-366 (2026-05-16) — Sidebar reads its window's connection identity
// from `useCurrentWindowConnectionId()` (which delegates to
// `getCurrentWindowLabel()`). Tests inject the label via this mock so
// each `setStores({ connections: [...] })` call can pair with
// `setFakeWindowConnectionId("<id>")` to drive the new derive path.
vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(),
  };
});

import Sidebar from "./Sidebar";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  setFakeWindowConnectionId,
  resetFakeWindowConnectionId,
} from "@/stores/__tests__/fakeWindowConnectionId";
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
  /**
   * sprint-366 — Synthetic Tauri window label connection id. Pre-sprint-366
   * the Sidebar read `focusedConnId` from the store; tests seeded that
   * slot. After Q15 lock the Sidebar reads from
   * `useCurrentWindowConnectionId()` (window label derive). Tests that
   * previously relied on the "seed focus to first-connected" effect now
   * pass an explicit window connection id here. Default `null` (launcher
   * / jsdom path) so tests that exercise the "no-connection" branch
   * still pass.
   */
  windowConnId?: string | null;
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
  setFakeWindowConnectionId(opts.windowConnId ?? null);
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

  afterEach(() => {
    // sprint-366: ensure each test's window-label mock value doesn't bleed
    // into the next describe block.
    resetFakeWindowConnectionId();
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

  it("AC-366-04: Sidebar's selectedId comes from the window label hook (fake provider)", () => {
    // 사유 (2026-05-16, sprint-366, Phase 4 Q15): contract AC-366-04 —
    // verify the connId Sidebar passes to its WorkspaceSidebar slot is
    // sourced from `useCurrentWindowConnectionId()` (label `workspace-c-fake`
    // → `"c-fake"`) and *not* from `connectionStore.focusedConnId`.
    // The connectionStore.focusedConnId is intentionally seeded to a
    // different value so any regression that resurrects the store read
    // would surface here.
    useConnectionStore.setState({
      connections: [makeConnection("c-fake"), makeConnection("c-bait")],
      activeStatuses: { "c-fake": { type: "connected", activeDb: "db1" } },
      focusedConnId: "c-bait", // intentional bait — must NOT win
    });
    setFakeWindowConnectionId("c-fake");
    render(<Sidebar />);
    expect(screen.getByTestId("schema-panel").textContent).toBe("c-fake");
  });

  it("shows connection name in the header when a connection is focused", () => {
    // sprint-366: the focused connection comes from the window label
    // (workspace-c1) — `windowConnId: "c1"` simulates a workspace
    // window opened for c1.
    setStores({
      connections: [makeConnection("c1")],
      active: ["c1"],
      windowConnId: "c1",
    });
    render(<Sidebar />);
    expect(screen.getByText(/c1 DB/)).toBeInTheDocument();
  });

  it("falls back to 'Schemas' header when no connection is focused", () => {
    setStores({});
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar-connection-header")).toHaveTextContent(
      "Schemas",
    );
  });

  it("sprint-366: sidebar shows the WINDOW's connection id (label derive), not the active tab's", () => {
    // 사유 (2026-05-16, sprint-366, Phase 4 Q15): pre-sprint-366 Sidebar
    // would auto-`setFocusedConn(activeTabConnId)` when a tab from a
    // different conn became active. Under per-conn windows (sprint-361)
    // this is by-construction impossible — a workspace window only ever
    // holds tabs for its own connection. The defensive invariant locked
    // here: even if a stray cross-conn tab seeds the active workspace,
    // the sidebar still surfaces the *window's* connection id
    // (`useCurrentWindowConnectionId()` → label "workspace-c1" → "c1").
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1", "c2"],
      windowConnId: "c1",
    });
    render(<Sidebar />);

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

    expect(screen.getByTestId("schema-panel").textContent).toBe("c1");
  });

  it("sprint-366: sidebar reflects window connection id even after the connection list mutates", () => {
    // 사유 (2026-05-16, sprint-366): pre-sprint-366 the "heal vanished
    // focused conn" effect re-pointed focus to the first surviving
    // connected conn. Under per-conn windows, deleting the window's own
    // conn means the window itself should close (handled elsewhere);
    // until that lands, the sidebar still surfaces the window's label-
    // derived conn id rather than silently switching to another conn,
    // so the user sees an unambiguous "this window's conn vanished"
    // state.
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1", "c2"],
      windowConnId: "c1",
    });
    const { rerender } = render(<Sidebar />);

    act(() => {
      setStores({
        connections: [makeConnection("c2")],
        active: ["c2"],
        windowConnId: "c1",
      });
    });
    rerender(<Sidebar />);

    expect(screen.getByTestId("schema-panel").textContent).toBe("c1");
  });

  describe("New Query Tab button", () => {
    it("opens a new query tab when connected", () => {
      // sprint-366: button enabled requires the window-derived
      // `focusedConnId` to be present and connected.
      setStores({
        connections: [makeConnection("c1")],
        active: ["c1"],
        windowConnId: "c1",
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
      // sprint-366: even with `windowConnId: "c1"`, the connection's
      // status is "disconnected" so `selectedConnected` is false → button
      // disabled.
      setStores({
        connections: [makeConnection("c1")],
        active: [],
        windowConnId: "c1",
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
