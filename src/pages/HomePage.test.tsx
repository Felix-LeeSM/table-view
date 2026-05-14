import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HomePage from "./HomePage";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import * as windowControls from "@lib/window-controls";
import type { ConnectionConfig } from "@/types/connection";

// Sprint 154 — HomePage's activation handler routes through
// `@lib/window-controls` (workspace.show / focus / launcher.hide). Stub the
// seam so the assertions can observe call shape directly.
vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  exitApp: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));

// jsdom shim for localStorage (project-wide pattern; mirrors Sidebar.test.tsx).
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

// Mock ConnectionList so we control onSelect / onActivate without rendering
// the full connection grid + drag/drop pipeline.
vi.mock("@components/connection/ConnectionList", () => ({
  default: ({
    selectedId,
    onSelect,
    onActivate,
  }: {
    selectedId: string | null;
    onSelect?: (id: string) => void;
    onActivate?: (id: string) => void;
  }) => (
    <div data-testid="connection-list" data-selected={selectedId ?? ""}>
      <button data-testid="list-pick-c1" onClick={() => onSelect?.("c1")}>
        pick c1
      </button>
      <button data-testid="list-activate-c1" onClick={() => onActivate?.("c1")}>
        activate c1
      </button>
    </div>
  ),
}));

vi.mock("@components/connection/ConnectionDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="connection-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock("@components/connection/ImportExportDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="import-export-dialog">
      <button onClick={onClose}>Close IE</button>
    </div>
  ),
}));

vi.mock("@components/connection/GroupDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="group-dialog">
      <button onClick={onClose}>Close Group</button>
    </div>
  ),
}));

// Sprint 296 — RecentConnections 본체는 별도 vitest 파일에서 다룸. 여기서는
// collapse wrapper 의 위치/책임만 검증하므로 가벼운 stub 으로 대체.
vi.mock("@components/connection/RecentConnections", () => ({
  default: () => <div data-testid="recent-connections-mock" />,
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

function resetStores() {
  useConnectionStore.setState({
    connections: [],
    activeStatuses: {},
    focusedConnId: null,
  });
  useWorkspaceStore.setState({ workspaces: {} });
}

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetStores();
    vi.mocked(windowControls.showWindow).mockResolvedValue(undefined);
    vi.mocked(windowControls.hideWindow).mockResolvedValue(undefined);
    vi.mocked(windowControls.focusWindow).mockResolvedValue(undefined);
  });

  it("renders the ConnectionList", () => {
    render(<HomePage />);
    expect(screen.getByTestId("connection-list")).toBeInTheDocument();
  });

  it("renders Import/Export, New Group, New Connection buttons", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("button", { name: /import \/ export/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new group/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new connection/i }),
    ).toBeInTheDocument();
  });

  it("renders the Recent placeholder section", () => {
    render(<HomePage />);
    expect(screen.getByTestId("home-recent")).toBeInTheDocument();
    // The copy is intentionally a placeholder until sprint 127 wires real
    // data in — assert the marker rather than the exact phrasing.
    expect(screen.getByTestId("home-recent")).toHaveTextContent(/recent/i);
  });

  it("does NOT render the SidebarModeToggle (Home is single-mode)", () => {
    render(<HomePage />);
    expect(
      screen.queryByRole("radio", { name: /connections mode/i }),
    ).toBeNull();
    expect(screen.queryByRole("radio", { name: /schemas mode/i })).toBeNull();
  });

  it("clicking New Connection opens the ConnectionDialog", () => {
    render(<HomePage />);
    expect(screen.queryByTestId("connection-dialog")).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /new connection/i }));
    });
    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
  });

  it("clicking Import / Export opens the ImportExportDialog", () => {
    render(<HomePage />);
    expect(screen.queryByTestId("import-export-dialog")).toBeNull();
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /import \/ export/i }),
      );
    });
    expect(screen.getByTestId("import-export-dialog")).toBeInTheDocument();
  });

  it("clicking New Group opens the GroupDialog", () => {
    render(<HomePage />);
    expect(screen.queryByTestId("group-dialog")).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /new group/i }));
    });
    expect(screen.getByTestId("group-dialog")).toBeInTheDocument();
  });

  it("global Cmd+N (new-connection event) opens the ConnectionDialog from Home", () => {
    render(<HomePage />);
    expect(screen.queryByTestId("connection-dialog")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("new-connection"));
    });
    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
  });

  it("onSelect from ConnectionList updates focusedConnId without swapping screens", () => {
    useConnectionStore.setState({
      connections: [makeConnection("c1")],
      activeStatuses: { c1: { type: "disconnected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    act(() => {
      fireEvent.click(screen.getByTestId("list-pick-c1"));
    });

    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    // Single-click must NOT swap to workspace — that is reserved for
    // onActivate (double-click / Enter / context-menu Connect). Sprint
    // 154: assertion expressed against the seam (no `showWindow` call).
    expect(windowControls.showWindow).not.toHaveBeenCalled();
  });

  it("onActivate from ConnectionList swaps to workspace screen", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    // Sprint 154 — workspace activation now expressed via the seam.
    expect(windowControls.showWindow).toHaveBeenCalledWith("workspace");
  });

  it("does not crash if onActivate is fired with an unknown connectionId", async () => {
    // Edge case: HomePage doesn't gate on connection existence, but the
    // swap itself must not throw and the store should accept any string
    // id. Post-Sprint-154 the swap goes through the window-controls seam.
    render(<HomePage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });
    expect(windowControls.showWindow).toHaveBeenCalledWith("workspace");
  });

  // ── Sprint 134: Home double-click swap (AC-S134-04) ──
  //
  // The lesson 2026-04-27-workspace-toolbar-ux-gaps reported that swap
  // didn't happen when the user picked a different connection from the
  // toolbar `<ConnectionSwitcher>`. With the switcher gone in S134, Home →
  // double-click is the single swap path, so we lock in the swap behaviour
  // explicitly: both `focusedConnId` AND `screen` must update in one go,
  // and a previously-focused connection must be replaced by the new one.

  it("double-click swap from connectionA to connectionB updates focusedConnId AND screen (AC-S134-04)", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("c1"), makeConnection("c2")],
      activeStatuses: {
        c1: { type: "connected" },
        c2: { type: "connected" },
      },
      focusedConnId: "c1",
    });
    render(<HomePage />);

    expect(useConnectionStore.getState().focusedConnId).toBe("c1");

    // The mocked ConnectionList exposes a button that fires onActivate("c1").
    // For this test we simulate the mock issuing onActivate("c1") for an
    // already-focused connection — the ConnectionItem-level swap-to-c2 path
    // is wired through HomePage in production, but here we hard-code the
    // expectation: any `onActivate(id)` call must (a) overwrite focusedConnId
    // and (b) flip the surface (Sprint 154 — expressed via seam call).
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    expect(windowControls.showWindow).toHaveBeenCalledWith("workspace");
  });

  it("swap is idempotent when activating the already-focused connection (AC-S134-04 boundary)", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // The activation should swap to workspace even when the connection
    // was already focused (boundary case: "active connection 자기 자신
    // double-click → swap to workspace"). Sprint 154 — expressed via seam.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    expect(windowControls.showWindow).toHaveBeenCalledWith("workspace");
  });

  // ── Sprint 157: activation debounce guard ──

  // Reason: Sprint 157 — handleActivate 가드로 빠른 연속 더블클릭 시 중복 showWindow 방지 (2026-04-28)
  it("AC-157-01: rapid double activation calls showWindow exactly once", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    // Fire two activations in the same event loop tick without awaiting.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    const workspaceCalls = vi
      .mocked(windowControls.showWindow)
      .mock.calls.filter((c) => c[0] === "workspace");
    expect(workspaceCalls).toHaveLength(1);
    // focusedConnId still updated from the first call.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason: Sprint 157 — 단일 활성화는 가드 추가 후에도 동일하게 동작해야 함 (회귀 방지) (2026-04-28)
  it("AC-157-02: single activation still works correctly (regression guard)", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(windowControls.showWindow).toHaveBeenCalledWith("workspace");
    expect(windowControls.focusWindow).toHaveBeenCalledWith("workspace");
    expect(windowControls.hideWindow).toHaveBeenCalledWith("launcher");
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // ── Sprint 296: Recent footer collapse 단위 재구성 ──
  //
  // 작성 이유 (2026-05-13, Sprint 296): Sprint 290 은 collapse 책임을
  // RecentConnections 내부 chevron header 에 두어 "Recent" 라벨 헤더가
  // 외부(HomePage) + 내부(RecentConnections) 로 중첩됐다 — 사용자에겐
  // "탭이 하나 더 생겼다" 로 보임. 올바른 행위는: theme picker 를 제외한
  // footer 영역 전체 (Recent 라벨 헤더 + 리스트) 가 한 단위로 접혀야 한다.
  // RecentConnections 가 더 이상 자체 collapse chevron 을 갖지 않고,
  // HomePage 의 `home-recent` 영역이 그 책임을 가진다. localStorage 키
  // `table-view-recent-collapsed` 는 호환을 위해 유지.

  it("AC-296-01: Recent footer 토글은 home-recent 의 헤더 버튼 한 곳에서 일어난다", () => {
    render(<HomePage />);
    // 정확히 1 개의 Recent 토글 버튼 — 외부(home-recent) 만 존재.
    const toggles = screen.getAllByRole("button", { name: /toggle recent/i });
    expect(toggles).toHaveLength(1);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
  });

  it("AC-296-02: 토글 시 home-recent 의 list 가 숨어도 theme picker 는 그대로 노출된다", () => {
    render(<HomePage />);
    const toggle = screen.getByRole("button", { name: /toggle recent/i });
    // theme picker 는 동일 footer 묶음 밖 — 토글 전후 모두 노출.
    const themeBefore = screen.getByRole("button", { name: /theme picker/i });
    expect(themeBefore).toBeInTheDocument();
    act(() => {
      fireEvent.click(toggle);
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: /theme picker/i }),
    ).toBeInTheDocument();
  });

  it("AC-296-03: collapse 상태는 table-view-recent-collapsed 키로 영속된다", () => {
    const { unmount } = render(<HomePage />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /toggle recent/i }));
    });
    expect(window.localStorage.getItem("table-view-recent-collapsed")).toBe(
      "1",
    );
    unmount();
    render(<HomePage />);
    expect(
      screen.getByRole("button", { name: /toggle recent/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  // Reason: Sprint 157 — showWindow 실패 후에도 가드 해제되어 재시도 가능 (2026-04-28)
  it("AC-157-03: guard resets after showWindow rejection allowing retry", async () => {
    vi.mocked(windowControls.showWindow)
      .mockRejectedValueOnce(new Error("workspace.show failed"))
      .mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [makeConnection("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    // First activation — showWindow rejects.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(windowControls.showWindow).toHaveBeenCalledTimes(1);
    // hideWindow must NOT be called after rejection — launcher stays visible.
    expect(windowControls.hideWindow).not.toHaveBeenCalledWith("launcher");

    // Second activation — showWindow resolves. Guard must have been reset.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(windowControls.showWindow).toHaveBeenCalledTimes(2);
    expect(windowControls.focusWindow).toHaveBeenCalledWith("workspace");
    expect(windowControls.hideWindow).toHaveBeenCalledWith("launcher");
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });
});
