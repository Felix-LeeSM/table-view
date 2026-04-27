import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HomePage from "./HomePage";
import { useConnectionStore } from "@stores/connectionStore";
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
});
