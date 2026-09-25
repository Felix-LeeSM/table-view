import * as windowControls from "@lib/window-controls";
import { useConnectionStore } from "@stores/connectionStore";
import { useThemeFavoritesStore } from "@stores/themeFavoritesStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/types/connection";
import HomePage from "./HomePage";

// HomePage's activation handler makes no `@lib/window-controls` call (no
// workspace.show / focus / launcher.hide). Stub the seam so the assertions
// can observe call shape directly.
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
  // on this page repeats an earlier regression (a doubled Recent header that
  // read as an extra tab), so the footer must stay gone.
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
    // onActivate (double-click / Enter). The assertion is expressed against
    // the seam (no `showWindow` call).
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
    // 2026-05-16 — handleActivate owns only the store side; the per-conn
    // workspace window is ConnectionList's job. See the note in
    // `handleActivate` (`HomePage.tsx`).
    expect(windowControls.showWindow).not.toHaveBeenCalledWith("workspace");
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
  });

  it("does not crash if onActivate is fired with an unknown connectionId", async () => {
    // Edge case: HomePage doesn't gate on connection existence, but the
    // swap itself must not throw and the store should accept any string id.
    // Invariant: no showWindow("workspace") and no hideWindow call.
    render(<HomePage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });
    expect(windowControls.showWindow).not.toHaveBeenCalledWith("workspace");
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
  });

  // ── Home double-click swap (AC-S134-04) ──
  //
  // The lesson 2026-04-27-workspace-toolbar-ux-gaps reported that swap
  // didn't happen when the user picked a different connection from the
  // toolbar `<ConnectionSwitcher>`. With the switcher gone, we lock in the
  // Home double-click swap explicitly: `focusedConnId` must update, and a
  // previously-focused connection must be replaced by the new one.

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
    // and (b) make no window-seam call (ConnectionList opens the window).
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    // Per-conn window model: no showWindow("workspace") and no hideWindow
    // call.
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

    // Double-clicking the already-active connection → the store-side
    // invariant holds and the launcher is not hidden.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    expect(windowControls.showWindow).not.toHaveBeenCalledWith("workspace");
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
  });

  // ── Activation debounce guard ──

  // Reason (revised 2026-05-16): the activatingRef guard still holds — a
  // rapid double activation updates the store side once. The old
  // duplicate-showWindow check means nothing in the per-conn model (HomePage
  // does not call showWindow).
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

    // The launcher stays visible — no hide call.
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
    expect(windowControls.showWindow).not.toHaveBeenCalled();
    expect(windowControls.focusWindow).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason (revised 2026-05-16): a single activation behaves the same after
  // the guard was added — the store side updates and the launcher is not
  // hidden. No direct call with the workspace label (per-conn window model).
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

  // #2440 — the Recent footer collapse cases (AC-296-01 / AC-296-02 / the
  // persistSetting case) were removed. The collapsible footer was replaced by
  // the group rail's Recent view, so there is nothing to toggle. The
  // regression guard for the footer's absence itself is
  // `[launcher] no longer renders a Recent footer strip` above.

  // Reason (revised 2026-05-16): the activatingRef guard still holds — it is
  // released after a microtask, so the next attempt can go through. The old
  // contract's showWindow-rejection branch means nothing in the per-conn
  // model.
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

    // activatingRef is released after a microtask — the second click runs
    // the store-side handler too.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    // The launcher stays visible — no hide call.
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
  });
});
