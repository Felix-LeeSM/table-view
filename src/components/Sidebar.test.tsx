import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Sidebar from "./Sidebar";
import { useConnectionStore } from "../stores/connectionStore";
import { useTabStore } from "../stores/tabStore";
import type { ConnectionConfig, ConnectionStatus } from "../types/connection";

// Mock useTheme to avoid localStorage issues in jsdom
let mockTheme: string = "system";
const mockSetTheme = vi.fn((t: string) => {
  mockTheme = t;
});

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ theme: mockTheme, setTheme: mockSetTheme }),
}));

// Mock children to isolate Sidebar wiring
vi.mock("./ConnectionRail", () => ({
  default: ({
    selectedId,
    onSelect,
    onNewConnection,
  }: {
    selectedId: string | null;
    onSelect: (id: string) => void;
    onNewConnection: () => void;
  }) => (
    <div data-testid="connection-rail" data-selected={selectedId ?? ""}>
      <button onClick={() => onSelect("c1")} data-testid="rail-pick-c1">
        pick c1
      </button>
      <button onClick={() => onSelect("c2")} data-testid="rail-pick-c2">
        pick c2
      </button>
      <button onClick={onNewConnection} data-testid="rail-new">
        new
      </button>
    </div>
  ),
}));

vi.mock("./SchemaPanel", () => ({
  default: ({ selectedId }: { selectedId: string | null }) => (
    <div data-testid="schema-panel">{selectedId ?? "none"}</div>
  ),
}));

vi.mock("./ConnectionDialog", () => ({
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
    password: "",
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
    setStores({});
  });

  it("renders ConnectionRail and SchemaPanel", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("connection-rail")).toBeInTheDocument();
    expect(screen.getByTestId("schema-panel")).toBeInTheDocument();
  });

  it("shows the selected connection name in the header strip", () => {
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1"],
    });
    render(<Sidebar />);
    // Initial selection should be the first connected: c1
    expect(screen.getByText(/c1 DB/)).toBeInTheDocument();
  });

  it("falls back to 'Schemas' header when no connection is selected", () => {
    setStores({});
    render(<Sidebar />);
    expect(screen.getByText("Schemas")).toBeInTheDocument();
  });

  it("rail click changes the panel's selectedId", () => {
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1", "c2"],
    });
    render(<Sidebar />);
    expect(screen.getByTestId("schema-panel").textContent).toBe("c1");

    act(() => {
      screen.getByTestId("rail-pick-c2").click();
    });
    expect(screen.getByTestId("schema-panel").textContent).toBe("c2");
  });

  it("new-connection event opens the dialog", () => {
    render(<Sidebar />);
    expect(screen.queryByTestId("connection-dialog")).toBeNull();

    act(() => {
      window.dispatchEvent(new Event("new-connection"));
    });

    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
  });

  it("rail's new-connection click also opens the dialog", () => {
    render(<Sidebar />);
    act(() => {
      screen.getByTestId("rail-new").click();
    });
    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
  });

  it("auto-syncs rail selection to the active tab's connection", () => {
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1", "c2"],
    });
    render(<Sidebar />);
    expect(screen.getByTestId("schema-panel").textContent).toBe("c1");

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

    expect(screen.getByTestId("schema-panel").textContent).toBe("c2");
  });

  it("clears selection when the selected connection is removed", () => {
    setStores({
      connections: [makeConnection("c1"), makeConnection("c2")],
      active: ["c1", "c2"],
    });
    const { rerender } = render(<Sidebar />);
    expect(screen.getByTestId("schema-panel").textContent).toBe("c1");

    act(() => {
      setStores({
        connections: [makeConnection("c2")],
        active: ["c2"],
      });
    });
    rerender(<Sidebar />);

    // Falls back to c2 (the surviving connected one)
    expect(screen.getByTestId("schema-panel").textContent).toBe("c2");
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

  it("removes new-connection listener on unmount", () => {
    const { unmount } = render(<Sidebar />);
    unmount();
    act(() => {
      window.dispatchEvent(new Event("new-connection"));
    });
    expect(screen.queryByTestId("connection-dialog")).toBeNull();
  });
});
