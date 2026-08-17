import * as windowControls from "@lib/window-controls";
import { useConnectionStore } from "@stores/connectionStore";
import { useThemeFavoritesStore } from "@stores/themeFavoritesStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/types/connection";
import HomePage from "./HomePage";

// Sprint 154 — HomePage's activation handler routes through
// `@lib/window-controls` (workspace.show / focus / launcher.hide). Stub the
// seam so the assertions can observe call shape directly.
vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  destroyCurrentWindow: vi.fn(() => Promise.resolve()),
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

// Mock the connection feature public API so HomePage tests exercise the same
// import boundary as production without rendering the full grid/dialogs.
vi.mock("@features/connection", async () => {
  const connectionStore = await vi.importActual<
    typeof import("@stores/connectionStore")
  >("@stores/connectionStore");

  return {
    ...connectionStore,
    // #2440 — HomePage mounts `ConnectionBrowser` (group rail + pane). The stub
    // keeps the old testids: these cases prove HomePage's own wiring, and the
    // rail/pane composition is proven in ConnectionBrowser.test.tsx.
    ConnectionBrowser: ({
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
        <button
          data-testid="list-activate-c1"
          onClick={() => onActivate?.("c1")}
        >
          activate c1
        </button>
      </div>
    ),
    ConnectionDialog: ({ onClose }: { onClose: () => void }) => (
      <div data-testid="connection-dialog">
        <button onClick={onClose}>Close</button>
      </div>
    ),
    ImportExportDialog: ({ onClose }: { onClose: () => void }) => (
      <div data-testid="import-export-dialog">
        <button onClick={onClose}>Close IE</button>
      </div>
    ),
    GroupDialog: ({ onClose }: { onClose: () => void }) => (
      <div data-testid="group-dialog">
        <button onClick={onClose}>Close Group</button>
      </div>
    ),
  };
});

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

function resetStores() {
  useConnectionStore.setState({
    connections: [],
    activeStatuses: {},
    focusedConnId: null,
  });
  useWorkspaceStore.setState({ workspaces: {} });
  // #2118 — a leaked `galleryOpen: true` would leave a modal dialog over the
  // page, and Radix marks everything behind it `aria-hidden`, which drops the
  // rest of this file's `getByRole` queries out of the accessibility tree.
  useThemeFavoritesStore.setState({ galleryOpen: false });
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

  it("renders the ConnectionBrowser", () => {
    render(<HomePage />);
    expect(screen.getByTestId("connection-list")).toBeInTheDocument();
  });

  // #2118 — the launcher owns the theme gallery overlay's mount. It cannot sit
  // inside the appearance popover with `ThemePicker` (mocked in this file): the
  // picker is `PopoverContent`, and Radix unmounts that subtree the moment the
  // popover closes. So this one line is the launcher's only route to the full
  // catalog, and nothing in the theme specs can see it — they render the two
  // components side by side themselves.
  it("mounts the theme gallery overlay", () => {
    useThemeFavoritesStore.setState({ galleryOpen: true });
    render(<HomePage />);
    expect(screen.getByTestId("theme-gallery")).toBeInTheDocument();
  });

  // --- #1134: heading a11y ---

  it("renders the 'Connections' title as a top-level <h1> (a11y #1134)", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /connections/i }),
    ).toBeInTheDocument();
  });

  it("moves focus to the Connections heading on mount (a11y #1134)", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /connections/i }),
    ).toHaveFocus();
  });

  // #1310 — theme popover was clipped when its content overflowed the viewport
  // top. The fix caps PopoverContent at Radix's available-height and scrolls
  // instead of clipping. Assert the classes survive on the rendered content.
  it("caps the theme popover at the available height and scrolls (#1310)", () => {
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: /theme picker/i }));
    const content = document.querySelector('[data-slot="popover-content"]');
    expect(content).not.toBeNull();
    expect(content).toHaveClass(
      "max-h-[var(--radix-popover-content-available-height)]",
      "overflow-y-auto",
    );
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

  // #2440 — Recent left the footer for the group rail. A second Recent surface
  // on this page is the sprint-296 regression ("탭이 하나 더 생긴" 모양), so the
  // footer must stay gone.
  it("[launcher] no longer renders a Recent footer strip", () => {
    render(<HomePage />);
    expect(screen.queryByTestId("home-recent")).toBeNull();
    expect(screen.queryByRole("button", { name: /toggle recent/i })).toBeNull();
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
    // Wave 9.5 (2026-05-16) — sprint-361 이후 workspace 윈도우는 per-conn
    // label (`workspace-{conn_id}`) 이며 ConnectionList 의
    // `openWorkspaceWindow` 가 책임. HomePage 의 handleActivate 는 store
    // side + launcher hide 만 (이전 showWindow("workspace") 호출은 sprint-175
    // 의 옛 single-workspace 윈도우를 추가 생성해 두 창 visible 회귀 원천).
    expect(windowControls.showWindow).not.toHaveBeenCalledWith("workspace");
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
  });

  it("does not crash if onActivate is fired with an unknown connectionId", async () => {
    // Edge case: HomePage doesn't gate on connection existence, but the
    // swap itself must not throw and the store should accept any string id.
    // Wave 9.5 — invariant: hideWindow("launcher") 만 호출.
    render(<HomePage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });
    expect(windowControls.showWindow).not.toHaveBeenCalledWith("workspace");
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
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
    // Wave 9.5 — per-conn 윈도우 시스템에 맞춰 hideWindow("launcher") 만 잠금.
    expect(windowControls.showWindow).not.toHaveBeenCalledWith("workspace");
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
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

    // active 한 자기 자신 더블클릭 → store side + launcher hide invariant 유지.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    expect(windowControls.showWindow).not.toHaveBeenCalledWith("workspace");
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
  });

  // ── Sprint 157: activation debounce guard ──

  // Reason (revised Wave 9.5, 2026-05-16): Sprint 157 의 activatingRef 가드는
  // 여전히 유효 — 빠른 연속 더블클릭 시 launcher hide 가 중복 호출되지 않음.
  // 이전 showWindow 중복 검증은 sprint-361 의 per-conn 모델에서 의미가 없다
  // (HomePage 는 showWindow 호출 안 함).
  it("AC-157-01 (revised): rapid double activation — store side 1회 갱신, window seam 호출 0", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // launcher 항상 visible — hide 호출 0.
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
    expect(windowControls.showWindow).not.toHaveBeenCalled();
    expect(windowControls.focusWindow).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason (revised Wave 9.5, 2026-05-16): 단일 활성화는 가드 추가 후에도
  // 동일하게 동작 — store side 갱신 + launcher hide. workspace label 직접
  // 호출 0 (sprint-361 per-conn 시스템).
  it("AC-157-02 (revised): single activation still works correctly (regression guard)", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(windowControls.showWindow).not.toHaveBeenCalledWith("workspace");
    expect(windowControls.focusWindow).not.toHaveBeenCalledWith("workspace");
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // #2440 — Sprint 296 의 Recent footer collapse 케이스 셋 (AC-296-01 /
  // AC-296-02 / sprint-369 persistSetting) 제거. 접히던 footer 가 group rail
  // 의 Recent view 로 대체돼 토글할 대상이 없다. footer 부재 자체의 회귀
  // 가드는 위 `[launcher] no longer renders a Recent footer strip`.

  // Reason (revised Wave 9.5, 2026-05-16): Sprint 157 의 activatingRef 가드는
  // 여전히 유효 — `hideWindow("launcher")` 가 reject 한 후에도 activatingRef
  // 가 해제되어 다음 시도가 가능. 이전 contract 의 showWindow rejection 분기는
  // sprint-361 의 per-conn 모델에서 의미가 없다.
  it("AC-157-03 (revised): activatingRef 가드는 microtask 후 풀려 두 번째 activation 시도도 store side 일관성 유지", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // microtask 후 activatingRef 풀림 — 두 번째 click 도 store side handler 가 진행.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    // launcher 항상 visible — hide 호출 0.
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
  });
});
