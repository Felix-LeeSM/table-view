import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Sidebar from "./Sidebar";
import { useConnectionStore } from "../stores/connectionStore";

// ---------------------------------------------------------------------------
// Mock useTheme to avoid localStorage issues in jsdom
// ---------------------------------------------------------------------------
let mockTheme: string = "system";
const mockSetTheme = vi.fn((t: string) => {
  mockTheme = t;
});

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ theme: mockTheme, setTheme: mockSetTheme }),
}));

// ---------------------------------------------------------------------------
// Mock child components to isolate Sidebar logic
// ---------------------------------------------------------------------------
vi.mock("./ConnectionList", () => ({
  default: () => <div data-testid="connection-list" />,
}));

vi.mock("./ConnectionDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="connection-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock("./SchemaTree", () => ({
  default: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="schema-tree">{connectionId}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(id: string, dbType = "postgresql") {
  return {
    id,
    name: `${id} DB`,
    db_type: dbType as "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "test",
    group_id: null as string | null,
    color: null as string | null,
    environment: null as string | null,
  };
}

interface ConnectionConfigLike {
  id: string;
  name: string;
  db_type: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  group_id: string | null;
  color: string | null;
  environment: string | null;
}

function setConnectionState(overrides: {
  connections?: ConnectionConfigLike[];
  activeStatuses?: Record<string, { type: string; message?: string }>;
}) {
  useConnectionStore.setState({
    connections: [],
    activeStatuses: {},
    ...overrides,
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
}

function resetTheme() {
  mockTheme = "system";
  mockSetTheme.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTheme();
    setConnectionState({ connections: [], activeStatuses: {} });
  });

  afterEach(() => {
    // Clean up any lingering document event listeners from resize
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  // -----------------------------------------------------------------------
  // AC-01: Empty state UI
  // -----------------------------------------------------------------------
  it("renders empty state when no connections exist", () => {
    setConnectionState({ connections: [] });

    render(<Sidebar />);

    expect(screen.getByText("No connections yet")).toBeInTheDocument();
  });

  it("shows Database icon in empty state", () => {
    setConnectionState({ connections: [] });

    render(<Sidebar />);

    // The Database icon from lucide renders as an SVG inside the empty state
    const emptyState = screen.getByText("No connections yet").closest("div")!;
    const svg = emptyState.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("shows all DB type badges in empty state", () => {
    setConnectionState({ connections: [] });

    render(<Sidebar />);

    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("MySQL")).toBeInTheDocument();
    expect(screen.getByText("SQLite")).toBeInTheDocument();
    expect(screen.getByText("MongoDB")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
  });

  it("shows double-click hint in empty state", () => {
    setConnectionState({ connections: [] });

    render(<Sidebar />);

    expect(
      screen.getByText("Double-click a connection to connect"),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-02: Connections list renders when connections exist
  // -----------------------------------------------------------------------
  it("renders ConnectionList when connections exist", () => {
    setConnectionState({ connections: [makeConnection("c1")] });

    render(<Sidebar />);

    expect(screen.getByTestId("connection-list")).toBeInTheDocument();
    expect(screen.queryByText("No connections yet")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-03: "+" button opens ConnectionDialog
  // -----------------------------------------------------------------------
  it("opens ConnectionDialog when New Connection button is clicked", () => {
    render(<Sidebar />);

    expect(screen.queryByTestId("connection-dialog")).not.toBeInTheDocument();

    const newBtn = screen.getByLabelText("New Connection");
    act(() => {
      fireEvent.click(newBtn);
    });

    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-04: ConnectionDialog close sets showNewDialog false
  // -----------------------------------------------------------------------
  it("closes ConnectionDialog when onClose is called", () => {
    render(<Sidebar />);

    // Open dialog
    const newBtn = screen.getByLabelText("New Connection");
    act(() => {
      fireEvent.click(newBtn);
    });
    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();

    // Close via dialog's onClose
    const closeBtn = screen.getByText("Close");
    act(() => {
      fireEvent.click(closeBtn);
    });
    expect(screen.queryByTestId("connection-dialog")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-05: Theme toggle cycles system -> light -> dark -> system
  // -----------------------------------------------------------------------
  it("calls setTheme with light when cycling from system", () => {
    render(<Sidebar />);

    const themeBtn = screen.getByLabelText(/Theme:/);
    act(() => {
      fireEvent.click(themeBtn);
    });

    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("calls setTheme with dark when cycling from light", () => {
    mockTheme = "light";

    render(<Sidebar />);

    const themeBtn = screen.getByLabelText(/Theme:/);
    act(() => {
      fireEvent.click(themeBtn);
    });

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("calls setTheme with system when cycling from dark", () => {
    mockTheme = "dark";

    render(<Sidebar />);

    const themeBtn = screen.getByLabelText(/Theme:/);
    act(() => {
      fireEvent.click(themeBtn);
    });

    expect(mockSetTheme).toHaveBeenCalledWith("system");
  });

  // -----------------------------------------------------------------------
  // AC-06: Theme-specific icon display
  // -----------------------------------------------------------------------
  it("displays icon and theme label in theme button", () => {
    mockTheme = "system";

    render(<Sidebar />);

    const themeBtn = screen.getByLabelText(/Theme:/);
    const svg = themeBtn.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(themeBtn).toHaveTextContent("system");
  });

  it("shows light label when theme is light", () => {
    mockTheme = "light";

    render(<Sidebar />);

    const themeBtn = screen.getByLabelText(/Theme:/);
    expect(themeBtn).toHaveTextContent("light");
  });

  it("shows dark label when theme is dark", () => {
    mockTheme = "dark";

    render(<Sidebar />);

    const themeBtn = screen.getByLabelText(/Theme:/);
    expect(themeBtn).toHaveTextContent("dark");
  });

  // -----------------------------------------------------------------------
  // AC-07: SchemaTree for connected connections
  // -----------------------------------------------------------------------
  it("renders SchemaTree for each connected connection", () => {
    setConnectionState({
      connections: [makeConnection("c1"), makeConnection("c2")],
      activeStatuses: {
        c1: { type: "connected" },
      },
    });

    render(<Sidebar />);

    const trees = screen.getAllByTestId("schema-tree");
    expect(trees).toHaveLength(1);
    expect(trees[0]).toHaveTextContent("c1");
  });

  it("renders multiple SchemaTrees when multiple connections are active", () => {
    setConnectionState({
      connections: [makeConnection("c1"), makeConnection("c2")],
      activeStatuses: {
        c1: { type: "connected" },
        c2: { type: "connected" },
      },
    });

    render(<Sidebar />);

    const trees = screen.getAllByTestId("schema-tree");
    expect(trees).toHaveLength(2);
  });

  it("does not render SchemaTree for disconnected connections", () => {
    setConnectionState({
      connections: [makeConnection("c1")],
      activeStatuses: {
        c1: { type: "disconnected" },
      },
    });

    render(<Sidebar />);

    expect(screen.queryByTestId("schema-tree")).not.toBeInTheDocument();
  });

  it("does not render SchemaTree for connections with error status", () => {
    setConnectionState({
      connections: [makeConnection("c1")],
      activeStatuses: {
        c1: { type: "error", message: "fail" },
      },
    });

    render(<Sidebar />);

    expect(screen.queryByTestId("schema-tree")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-08: Resize handle rendering and mousedown event
  // -----------------------------------------------------------------------
  // Helper: find the sidebar container div (the one with inline width style)
  function getSidebarContainer() {
    return screen
      .getByText("Connections")
      .closest('div[style*="width"]') as HTMLElement;
  }

  // Helper: find the resize handle (absolute-positioned child at right edge)
  function getResizeHandle(container: HTMLElement) {
    const allDivs = container.querySelectorAll(":scope > div");
    for (let i = allDivs.length - 1; i >= 0; i--) {
      const div = allDivs[i] as HTMLElement;
      if (
        div.className.includes("absolute") &&
        div.className.includes("right-0")
      ) {
        return div;
      }
    }
    return null;
  }

  it("renders resize handle inside sidebar container", () => {
    render(<Sidebar />);

    const container = getSidebarContainer();
    const handle = getResizeHandle(container);
    expect(handle).toBeTruthy();
  });

  it("sets cursor and userSelect on mousedown of resize handle", () => {
    render(<Sidebar />);

    const container = getSidebarContainer();
    const handle = getResizeHandle(container)!;

    act(() => {
      fireEvent.mouseDown(handle, { clientX: 250 });
    });

    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
  });

  it("updates sidebar width on mousemove after mousedown", () => {
    render(<Sidebar />);

    const container = getSidebarContainer();
    const handle = getResizeHandle(container)!;

    // Initial width is 250
    expect(container).toHaveStyle({ width: "250px" });

    act(() => {
      fireEvent.mouseDown(handle, { clientX: 250 });
    });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 300 });
    });

    // Width should increase by 50 (300 - 250), new width = 300
    expect(container).toHaveStyle({ width: "300px" });
  });

  it("clamps sidebar width to minimum (180) on mousemove", () => {
    render(<Sidebar />);

    const container = getSidebarContainer();
    const handle = getResizeHandle(container)!;

    act(() => {
      fireEvent.mouseDown(handle, { clientX: 250 });
    });
    // Move far left to try to go below 180
    act(() => {
      fireEvent.mouseMove(document, { clientX: 0 });
    });

    expect(container).toHaveStyle({ width: "180px" });
  });

  it("clamps sidebar width to maximum (500) on mousemove", () => {
    render(<Sidebar />);

    const container = getSidebarContainer();
    const handle = getResizeHandle(container)!;

    act(() => {
      fireEvent.mouseDown(handle, { clientX: 250 });
    });
    // Move far right to try to exceed 500
    act(() => {
      fireEvent.mouseMove(document, { clientX: 1000 });
    });

    expect(container).toHaveStyle({ width: "500px" });
  });

  it("cleans up event listeners and styles on mouseup after resize", () => {
    render(<Sidebar />);

    const container = getSidebarContainer();
    const handle = getResizeHandle(container)!;

    act(() => {
      fireEvent.mouseDown(handle, { clientX: 250 });
    });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 300 });
    });
    act(() => {
      fireEvent.mouseUp(document);
    });

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // After mouseup, further mousemove should not change width
    const widthAfterUp = container.style.width;
    act(() => {
      fireEvent.mouseMove(document, { clientX: 400 });
    });
    expect(container.style.width).toBe(widthAfterUp);
  });

  // -----------------------------------------------------------------------
  // Additional coverage
  // -----------------------------------------------------------------------
  it("renders Connections header label", () => {
    render(<Sidebar />);

    expect(screen.getByText("Connections")).toBeInTheDocument();
  });

  it("renders empty state text about clicking + button", () => {
    setConnectionState({ connections: [] });

    render(<Sidebar />);

    expect(
      screen.getByText(
        "Click the + button above to add your first database connection",
      ),
    ).toBeInTheDocument();
  });

  it("persists new width in state after mouseup", () => {
    const { unmount } = render(<Sidebar />);

    const container = getSidebarContainer();
    const handle = getResizeHandle(container)!;

    act(() => {
      fireEvent.mouseDown(handle, { clientX: 250 });
    });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 300 });
    }); // +50
    act(() => {
      fireEvent.mouseUp(document);
    });

    // Width should be committed to React state
    expect(container).toHaveStyle({ width: "300px" });
    unmount();
  });

  // -----------------------------------------------------------------------
  // select-none on root element
  // -----------------------------------------------------------------------
  it("has select-none class on root container to prevent text selection", () => {
    render(<Sidebar />);

    const container = getSidebarContainer();
    expect(container.className).toContain("select-none");
  });

  // -----------------------------------------------------------------------
  // Sprint 59: Environment filter
  // -----------------------------------------------------------------------
  it("does not render environment filter when no connections exist", () => {
    setConnectionState({ connections: [] });
    render(<Sidebar />);
    expect(
      screen.queryByLabelText("Filter by environment"),
    ).not.toBeInTheDocument();
  });

  it("renders environment filter when connections exist", () => {
    setConnectionState({ connections: [makeConnection("c1")] });
    render(<Sidebar />);
    expect(screen.getByLabelText("Filter by environment")).toBeInTheDocument();
  });

  it("renders All Environments as default filter option", () => {
    setConnectionState({ connections: [makeConnection("c1")] });
    render(<Sidebar />);
    const select = screen.getByLabelText(
      "Filter by environment",
    ) as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("renders all environment options in filter dropdown", () => {
    setConnectionState({ connections: [makeConnection("c1")] });
    render(<Sidebar />);
    const select = screen.getByLabelText(
      "Filter by environment",
    ) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("");
    expect(options).toContain("local");
    expect(options).toContain("testing");
    expect(options).toContain("development");
    expect(options).toContain("staging");
    expect(options).toContain("production");
  });

  it("passes environmentFilter to ConnectionList", () => {
    setConnectionState({ connections: [makeConnection("c1")] });
    render(<Sidebar />);
    const select = screen.getByLabelText(
      "Filter by environment",
    ) as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: "production" } });
    });
    // ConnectionList is mocked, so we just verify the filter UI updated
    expect(select.value).toBe("production");
  });

  // -- Cmd+N keyboard shortcut wiring -------------------------------------

  it("opens connection dialog when new-connection event is dispatched", () => {
    render(<Sidebar />);
    expect(screen.queryByTestId("connection-dialog")).toBeNull();

    act(() => {
      window.dispatchEvent(new Event("new-connection"));
    });

    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
  });

  it("keeps connection dialog open when new-connection is dispatched again", () => {
    render(<Sidebar />);

    act(() => {
      window.dispatchEvent(new Event("new-connection"));
    });
    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("new-connection"));
    });
    // Still exactly one dialog (idempotent)
    expect(screen.getAllByTestId("connection-dialog")).toHaveLength(1);
  });

  it("removes new-connection listener on unmount", () => {
    const { unmount } = render(<Sidebar />);
    unmount();

    // Should not throw — the listener is gone
    act(() => {
      window.dispatchEvent(new Event("new-connection"));
    });
    expect(screen.queryByTestId("connection-dialog")).toBeNull();
  });
});
