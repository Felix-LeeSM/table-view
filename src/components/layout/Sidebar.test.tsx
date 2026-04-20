import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Sidebar from "./Sidebar";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
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

// Mock useTheme to avoid localStorage issues in jsdom
let mockTheme: string = "system";
const mockSetTheme = vi.fn((t: string) => {
  mockTheme = t;
});

vi.mock("@hooks/useTheme", () => ({
  useTheme: () => ({ theme: mockTheme, setTheme: mockSetTheme }),
}));

// Mock children to isolate Sidebar wiring.
// ConnectionList exposes the props it received as data attributes so we can
// assert the contract without rendering the real list (which transitively
// pulls in store + DnD).
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
      <button data-testid="list-pick-c2" onClick={() => onSelect?.("c2")}>
        pick c2
      </button>
      <button data-testid="list-activate-c2" onClick={() => onActivate?.("c2")}>
        activate c2
      </button>
    </div>
  ),
}));

vi.mock("@components/schema/SchemaPanel", () => ({
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

vi.mock("@components/connection/ImportExportDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="import-export-dialog">
      <button onClick={onClose}>Close IE</button>
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
    statuses[c.id] = active.has(c.id)
      ? { type: "connected" }
      : { type: "disconnected" };
  }
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
  });
  useTabStore.setState({ tabs: [], activeTabId: null });
}

describe("Sidebar", () => {
  beforeEach(() => {
    mockTheme = "system";
    vi.clearAllMocks();
    window.localStorage.clear();
    setStores({});
  });

  it("renders both mode toggle tabs", () => {
    render(<Sidebar />);
    expect(
      screen.getByRole("tab", { name: /connections/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /schemas/i })).toBeInTheDocument();
  });

  it("starts in connections mode by default and renders ConnectionList", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("connection-list")).toBeInTheDocument();
    expect(screen.queryByTestId("schema-panel")).toBeNull();
  });

  it("switches to schemas mode when the Schemas tab is clicked", () => {
    setStores({
      connections: [makeConnection("c1")],
      active: ["c1"],
    });
    render(<Sidebar />);

    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /schemas/i }));
    });

    expect(screen.getByTestId("schema-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("connection-list")).toBeNull();
  });

  it("shows connection name header strip in schemas mode", () => {
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1"],
    });
    render(<Sidebar />);

    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /schemas/i }));
    });

    expect(screen.getByText(/c1 DB/)).toBeInTheDocument();
  });

  it("falls back to 'Schemas' header when no connection is selected", () => {
    setStores({});
    render(<Sidebar />);

    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /schemas/i }));
    });

    expect(screen.getByTestId("sidebar-connection-header")).toHaveTextContent(
      "Schemas",
    );
  });

  it("single-click on a connection in the list updates selectedId", () => {
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1", "c2"],
    });
    render(<Sidebar />);

    act(() => {
      screen.getByTestId("list-pick-c2").click();
    });

    // Switch to schemas to verify the panel sees the new selection
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /schemas/i }));
    });
    expect(screen.getByTestId("schema-panel").textContent).toBe("c2");
  });

  it("activate (double-click) auto-switches to schemas mode", () => {
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1", "c2"],
    });
    render(<Sidebar />);
    expect(screen.getByTestId("connection-list")).toBeInTheDocument();

    act(() => {
      screen.getByTestId("list-activate-c2").click();
    });

    expect(screen.getByTestId("schema-panel")).toBeInTheDocument();
    expect(screen.getByTestId("schema-panel").textContent).toBe("c2");
  });

  it("auto-syncs selection AND switches to schemas when active tab changes", () => {
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1", "c2"],
    });
    render(<Sidebar />);
    // Default mode is connections; selection is the first connected (c1)

    act(() => {
      useTabStore.setState({
        tabs: [
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
        activeTabId: "tab-x",
      });
    });

    // Mode should have flipped to schemas with c2 selected
    expect(screen.getByTestId("schema-panel")).toBeInTheDocument();
    expect(screen.getByTestId("schema-panel").textContent).toBe("c2");
  });

  it("clears selection when the selected connection is removed", () => {
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

    // Falls back to c2 (the surviving connected one)
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /schemas/i }));
    });
    expect(screen.getByTestId("schema-panel").textContent).toBe("c2");
  });

  it("persists mode to localStorage and restores on remount", () => {
    const { unmount } = render(<Sidebar />);
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /schemas/i }));
    });
    expect(window.localStorage.getItem("viewtable.sidebar.mode")).toBe(
      "schemas",
    );
    unmount();

    render(<Sidebar />);
    expect(screen.getByTestId("schema-panel")).toBeInTheDocument();
  });

  describe("Action button (mode-context)", () => {
    it("connections mode: + opens ConnectionDialog", () => {
      render(<Sidebar />);
      const btn = screen.getByRole("button", { name: /new connection/i });
      act(() => {
        fireEvent.click(btn);
      });
      expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
    });

    it("connections mode: Import/Export button opens the dialog", () => {
      render(<Sidebar />);
      const btn = screen.getByRole("button", { name: /import \/ export/i });
      act(() => {
        fireEvent.click(btn);
      });
      expect(screen.getByTestId("import-export-dialog")).toBeInTheDocument();
    });

    it("schemas mode: Import/Export and New Connection buttons are hidden", () => {
      setStores({
        connections: [makeConnection("c1")],
        active: ["c1"],
      });
      render(<Sidebar />);
      act(() => {
        fireEvent.click(screen.getByRole("tab", { name: /schemas/i }));
      });

      expect(
        screen.queryByRole("button", { name: /import \/ export/i }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /new connection/i }),
      ).toBeNull();
    });

    it("schemas mode: + opens a new query tab when connected", () => {
      setStores({
        connections: [makeConnection("c1")],
        active: ["c1"],
      });
      render(<Sidebar />);
      act(() => {
        fireEvent.click(screen.getByRole("tab", { name: /schemas/i }));
      });

      const btn = screen.getByRole("button", { name: /new query tab/i });
      expect(btn).not.toBeDisabled();
      act(() => {
        fireEvent.click(btn);
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.type).toBe("query");
      expect(state.tabs[0]!.connectionId).toBe("c1");
    });

    it("schemas mode: New Query is disabled when not connected", () => {
      setStores({
        connections: [makeConnection("c1")],
        active: [],
      });
      render(<Sidebar />);
      act(() => {
        fireEvent.click(screen.getByRole("tab", { name: /schemas/i }));
      });

      const btn = screen.getByRole("button", { name: /new query tab/i });
      expect(btn).toBeDisabled();
    });
  });

  describe("Misc", () => {
    it("new-connection event opens the dialog", () => {
      render(<Sidebar />);
      expect(screen.queryByTestId("connection-dialog")).toBeNull();

      act(() => {
        window.dispatchEvent(new Event("new-connection"));
      });

      expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
    });

    it("removes new-connection listener on unmount", () => {
      const { unmount } = render(<Sidebar />);
      unmount();
      act(() => {
        window.dispatchEvent(new Event("new-connection"));
      });
      expect(screen.queryByTestId("connection-dialog")).toBeNull();
    });

    it("renders the theme toggle and cycles theme on click", () => {
      render(<Sidebar />);
      const btn = screen.getByLabelText(/Theme:/);
      act(() => {
        fireEvent.click(btn);
      });
      expect(mockSetTheme).toHaveBeenCalled();
    });

    it("has a resize handle on the right edge", () => {
      const { container } = render(<Sidebar />);
      const handle = container.querySelector(".cursor-col-resize");
      expect(handle).toBeInTheDocument();
    });
  });
});
