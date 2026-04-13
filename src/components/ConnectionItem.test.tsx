import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import ConnectionItem from "./ConnectionItem";
import { useConnectionStore } from "../stores/connectionStore";
import type { ConnectionConfig } from "../types/connection";

// ---------------------------------------------------------------------------
// Mock child components
// ---------------------------------------------------------------------------

vi.mock("./ContextMenu", () => ({
  ContextMenu: ({
    items,
    onClose,
  }: {
    items: { label: string; onClick: () => void }[];
    onClose: () => void;
  }) => (
    <div data-testid="context-menu">
      {items.map((item, i) => (
        <button
          key={item.label}
          data-testid={`menu-item-${i}`}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./ConnectionDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="connection-dialog">
      <button data-testid="dialog-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    id: "conn-1",
    name: "Test DB",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "testdb",
    group_id: null,
    color: null,
    ...overrides,
  };
}

function setStoreState(overrides: {
  connections?: ConnectionConfig[];
  activeStatuses?: Record<string, { type: string; message?: string }>;
  connectToDatabase?: () => Promise<void>;
  disconnectFromDatabase?: () => Promise<void>;
  removeConnection?: () => Promise<void>;
}) {
  useConnectionStore.setState({
    connections: [],
    activeStatuses: {},
    connectToDatabase: vi.fn().mockResolvedValue(undefined),
    disconnectFromDatabase: vi.fn().mockResolvedValue(undefined),
    removeConnection: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConnectionItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState({ connections: [], activeStatuses: {} });
  });

  // -----------------------------------------------------------------------
  // AC-05: ConnectionItem renders connection name and DB type badge
  // -----------------------------------------------------------------------
  it("renders the connection name", () => {
    setStoreState({});
    render(
      <ConnectionItem connection={makeConnection({ name: "My Prod DB" })} />,
    );

    expect(screen.getByText("My Prod DB")).toBeInTheDocument();
  });

  it.each([
    { db_type: "postgresql" as const, short: "PG" },
    { db_type: "mysql" as const, short: "MY" },
    { db_type: "sqlite" as const, short: "SQ" },
    { db_type: "mongodb" as const, short: "MG" },
    { db_type: "redis" as const, short: "RD" },
  ] as const)("renders $short badge for $db_type", ({ db_type, short }) => {
    setStoreState({});
    render(<ConnectionItem connection={makeConnection({ db_type })} />);

    expect(screen.getByText(short)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-06: Status indicator (connected=green, error=red+tooltip, disconnected=gray)
  // -----------------------------------------------------------------------
  it("renders green indicator when connected", () => {
    setStoreState({
      activeStatuses: { "conn-1": { type: "connected" } },
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const indicator = screen.getByLabelText("Connected");
    expect(indicator).toBeInTheDocument();
  });

  it("renders red indicator with error tooltip when error", () => {
    setStoreState({
      activeStatuses: {
        "conn-1": { type: "error", message: "Connection refused" },
      },
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const indicator = screen.getByLabelText("Error: Connection refused");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute("title", "Connection refused");
  });

  it("renders gray indicator when disconnected", () => {
    setStoreState({
      activeStatuses: { "conn-1": { type: "disconnected" } },
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const indicator = screen.getByLabelText("Disconnected");
    expect(indicator).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Sprint 46: Connecting spinner and error inline message
  // -----------------------------------------------------------------------
  it("renders spinner when connecting", () => {
    setStoreState({
      activeStatuses: { "conn-1": { type: "connecting" } },
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const spinner = screen.getByLabelText("Connecting");
    expect(spinner).toBeInTheDocument();
  });

  it("does not call connectToDatabase on double-click when connecting", () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    setStoreState({
      activeStatuses: { "conn-1": { type: "connecting" } },
      connectToDatabase: mockConnect,
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    fireEvent.doubleClick(item);

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("renders inline error message when error status", () => {
    setStoreState({
      activeStatuses: {
        "conn-1": { type: "error", message: "Connection refused" },
      },
    });

    render(<ConnectionItem connection={makeConnection()} />);

    expect(screen.getByText("Connection refused")).toBeInTheDocument();
  });

  it("shows full error message on click and hides on close", () => {
    setStoreState({
      activeStatuses: {
        "conn-1": { type: "error", message: "Detailed error message here" },
      },
    });

    render(<ConnectionItem connection={makeConnection()} />);

    // Click to expand error detail
    const expandBtn = screen.getByLabelText("Show error details");
    fireEvent.click(expandBtn);

    expect(screen.getByText("Detailed error message here")).toBeInTheDocument();
    expect(screen.getByLabelText("Hide error details")).toBeInTheDocument();

    // Click close
    fireEvent.click(screen.getByLabelText("Hide error details"));
    expect(screen.getByLabelText("Show error details")).toBeInTheDocument();
  });

  it("has aria-label reflecting connecting status", () => {
    setStoreState({
      activeStatuses: { "conn-1": { type: "connecting" } },
    });

    render(<ConnectionItem connection={makeConnection({ name: "ProdDB" })} />);

    const item = screen.getByRole("button");
    expect(item).toHaveAttribute("aria-label", "ProdDB — connecting");
  });

  it("renders disconnected indicator when no status exists", () => {
    setStoreState({ activeStatuses: {} });

    render(<ConnectionItem connection={makeConnection()} />);

    const indicator = screen.getByLabelText("Disconnected");
    expect(indicator).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-07: Double-click connects when disconnected or error
  // -----------------------------------------------------------------------
  it("calls connectToDatabase on double-click when disconnected", async () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    setStoreState({
      activeStatuses: { "conn-1": { type: "disconnected" } },
      connectToDatabase: mockConnect,
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.doubleClick(item);
    });

    expect(mockConnect).toHaveBeenCalledWith("conn-1");
  });

  it("calls connectToDatabase on double-click when error", async () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    setStoreState({
      activeStatuses: {
        "conn-1": { type: "error", message: "fail" },
      },
      connectToDatabase: mockConnect,
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.doubleClick(item);
    });

    expect(mockConnect).toHaveBeenCalledWith("conn-1");
  });

  it("does not call connectToDatabase on double-click when already connected", () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    setStoreState({
      activeStatuses: { "conn-1": { type: "connected" } },
      connectToDatabase: mockConnect,
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.doubleClick(item);
    });

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("handles connectToDatabase rejection on double-click without throwing", () => {
    const mockConnect = vi.fn().mockRejectedValue(new Error("fail"));
    setStoreState({
      activeStatuses: { "conn-1": { type: "disconnected" } },
      connectToDatabase: mockConnect,
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    expect(() =>
      act(() => {
        fireEvent.doubleClick(item);
      }),
    ).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // AC-08: Right-click opens context menu
  // -----------------------------------------------------------------------
  it("shows context menu on right-click", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });

    expect(screen.getByTestId("context-menu")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-09: Context menu Connect/Disconnect toggle
  // -----------------------------------------------------------------------
  it("shows Connect option when disconnected", () => {
    setStoreState({
      activeStatuses: { "conn-1": { type: "disconnected" } },
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });

    expect(screen.getByText("Connect")).toBeInTheDocument();
  });

  it("shows Disconnect option when connected", () => {
    setStoreState({
      activeStatuses: { "conn-1": { type: "connected" } },
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });

    expect(screen.getByText("Disconnect")).toBeInTheDocument();
  });

  it("calls connectToDatabase when Connect menu item is clicked", () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    setStoreState({
      activeStatuses: { "conn-1": { type: "disconnected" } },
      connectToDatabase: mockConnect,
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });

    const connectBtn = screen.getByText("Connect");
    act(() => {
      fireEvent.click(connectBtn);
    });

    expect(mockConnect).toHaveBeenCalledWith("conn-1");
  });

  it("calls disconnectFromDatabase when Disconnect menu item is clicked", () => {
    const mockDisconnect = vi.fn().mockResolvedValue(undefined);
    setStoreState({
      activeStatuses: { "conn-1": { type: "connected" } },
      disconnectFromDatabase: mockDisconnect,
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });

    const disconnectBtn = screen.getByText("Disconnect");
    act(() => {
      fireEvent.click(disconnectBtn);
    });

    expect(mockDisconnect).toHaveBeenCalledWith("conn-1");
  });

  // -----------------------------------------------------------------------
  // AC-10: Context menu Edit opens ConnectionDialog
  // -----------------------------------------------------------------------
  it("opens ConnectionDialog when Edit menu item is clicked", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });

    const editBtn = screen.getByText("Edit");
    act(() => {
      fireEvent.click(editBtn);
    });

    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
  });

  it("closes ConnectionDialog via onClose callback", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    // Open the dialog via context menu
    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByText("Edit"));
    });

    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();

    // Close it
    act(() => {
      fireEvent.click(screen.getByTestId("dialog-close"));
    });
    expect(screen.queryByTestId("connection-dialog")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-11: Context menu Delete shows delete confirmation dialog
  // -----------------------------------------------------------------------
  it("opens delete confirmation dialog when Delete menu item is clicked", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });

    const deleteBtn = screen.getByText("Delete");
    act(() => {
      fireEvent.click(deleteBtn);
    });

    const dialog = screen.getByRole("dialog", { name: /delete connection/i });
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Are you sure you want to delete/),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-12: Delete confirm calls removeConnection
  // -----------------------------------------------------------------------
  it("calls removeConnection when Delete button is clicked in confirm dialog", () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    setStoreState({ removeConnection: mockRemove });

    render(<ConnectionItem connection={makeConnection()} />);

    // Open delete confirm
    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByText("Delete"));
    });

    // Find the actual Delete button inside the dialog
    const dialog = screen.getByRole("dialog");
    const deleteConfirmBtn = within(dialog).getAllByText("Delete").pop()!;
    act(() => {
      fireEvent.click(deleteConfirmBtn);
    });

    expect(mockRemove).toHaveBeenCalledWith("conn-1");
  });

  it("dismisses delete confirmation dialog when Cancel is clicked", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    // Open delete confirm
    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByText("Delete"));
    });

    // Click Cancel
    const dialog = screen.getByRole("dialog");
    act(() => {
      fireEvent.click(within(dialog).getByText("Cancel"));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-13: Drag sets draggedConnectionId
  // -----------------------------------------------------------------------
  it("sets draggedConnectionId on dragStart", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
    };
    act(() => {
      fireEvent.dragStart(item, { dataTransfer });
    });

    // draggedConnectionId is a module-level export; after dragStart it should be set
    // We verify indirectly via the opacity change (dragging state)
    expect(item.className).toContain("opacity-40");
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "conn-1");
  });

  it("clears draggedConnectionId on dragEnd", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
    };
    act(() => {
      fireEvent.dragStart(item, { dataTransfer });
    });
    expect(item.className).toContain("opacity-40");

    act(() => {
      fireEvent.dragEnd(item);
    });
    expect(item.className).not.toContain("opacity-40");
  });

  // -----------------------------------------------------------------------
  // Keyboard: Enter triggers double-click handler
  // -----------------------------------------------------------------------
  it("calls connectToDatabase when Enter is pressed while disconnected", async () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    setStoreState({
      activeStatuses: { "conn-1": { type: "disconnected" } },
      connectToDatabase: mockConnect,
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.keyDown(item, { key: "Enter" });
    });

    expect(mockConnect).toHaveBeenCalledWith("conn-1");
  });

  // -----------------------------------------------------------------------
  // Context menu closes via onClose
  // -----------------------------------------------------------------------
  it("closes context menu via onClose callback", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    act(() => {
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    });
    expect(screen.getByTestId("context-menu")).toBeInTheDocument();

    // The mock menu calls onClose when any button is clicked
    act(() => {
      fireEvent.click(screen.getByText("Edit"));
    });
    expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // aria-label reflects status
  // -----------------------------------------------------------------------
  it("has aria-label reflecting connected status", () => {
    setStoreState({
      activeStatuses: { "conn-1": { type: "connected" } },
    });

    render(<ConnectionItem connection={makeConnection({ name: "ProdDB" })} />);

    const item = screen.getByRole("button");
    expect(item).toHaveAttribute("aria-label", "ProdDB — connected");
  });

  it("has aria-label reflecting error status", () => {
    setStoreState({
      activeStatuses: {
        "conn-1": { type: "error", message: "timeout" },
      },
    });

    render(<ConnectionItem connection={makeConnection({ name: "ProdDB" })} />);

    const item = screen.getByRole("button", { name: /ProdDB — error/ });
    expect(item).toHaveAttribute("aria-label", "ProdDB — error");
  });

  it("has aria-label reflecting disconnected status", () => {
    setStoreState({
      activeStatuses: {},
    });

    render(<ConnectionItem connection={makeConnection({ name: "ProdDB" })} />);

    const item = screen.getByRole("button");
    expect(item).toHaveAttribute("aria-label", "ProdDB — disconnected");
  });

  // -----------------------------------------------------------------------
  // DB type badge title attribute
  // -----------------------------------------------------------------------
  it("shows db_type as title on the badge", () => {
    setStoreState({});

    render(
      <ConnectionItem connection={makeConnection({ db_type: "mysql" })} />,
    );

    const badge = screen.getByText("MY");
    expect(badge).toHaveAttribute("title", "mysql");
  });

  // -----------------------------------------------------------------------
  // select-none on root element
  // -----------------------------------------------------------------------
  it("has select-none class on root element to prevent text selection", () => {
    setStoreState({});
    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    expect(item.className).toContain("select-none");
  });
});
