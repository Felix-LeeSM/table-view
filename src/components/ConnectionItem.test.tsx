import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
    fireEvent.doubleClick(item);

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
    fireEvent.doubleClick(item);

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
    fireEvent.doubleClick(item);

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
    expect(() => fireEvent.doubleClick(item)).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // AC-08: Right-click opens context menu
  // -----------------------------------------------------------------------
  it("shows context menu on right-click", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });

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
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });

    expect(screen.getByText("Connect")).toBeInTheDocument();
  });

  it("shows Disconnect option when connected", () => {
    setStoreState({
      activeStatuses: { "conn-1": { type: "connected" } },
    });

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });

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
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });

    const connectBtn = screen.getByText("Connect");
    fireEvent.click(connectBtn);

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
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });

    const disconnectBtn = screen.getByText("Disconnect");
    fireEvent.click(disconnectBtn);

    expect(mockDisconnect).toHaveBeenCalledWith("conn-1");
  });

  // -----------------------------------------------------------------------
  // AC-10: Context menu Edit opens ConnectionDialog
  // -----------------------------------------------------------------------
  it("opens ConnectionDialog when Edit menu item is clicked", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });

    const editBtn = screen.getByText("Edit");
    fireEvent.click(editBtn);

    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
  });

  it("closes ConnectionDialog via onClose callback", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    // Open the dialog via context menu
    const item = screen.getByRole("button", { name: /Test DB/ });
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText("Edit"));

    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();

    // Close it
    fireEvent.click(screen.getByTestId("dialog-close"));
    expect(screen.queryByTestId("connection-dialog")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-11: Context menu Delete shows delete confirmation dialog
  // -----------------------------------------------------------------------
  it("opens delete confirmation dialog when Delete menu item is clicked", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });

    const deleteBtn = screen.getByText("Delete");
    fireEvent.click(deleteBtn);

    expect(
      screen.getByRole("dialog", { name: /delete connection/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to delete/),
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
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText("Delete"));

    // Find the actual Delete button inside the dialog
    const dialog = screen.getByRole("dialog");
    const deleteConfirmBtn = within(dialog).getAllByText("Delete").pop()!;
    fireEvent.click(deleteConfirmBtn);

    expect(mockRemove).toHaveBeenCalledWith("conn-1");
  });

  it("dismisses delete confirmation dialog when Cancel is clicked", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    // Open delete confirm
    const item = screen.getByRole("button", { name: /Test DB/ });
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText("Delete"));

    // Click Cancel
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Cancel"));

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
    fireEvent.dragStart(item, { dataTransfer });

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
    fireEvent.dragStart(item, { dataTransfer });
    expect(item.className).toContain("opacity-40");

    fireEvent.dragEnd(item);
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
    fireEvent.keyDown(item, { key: "Enter" });

    expect(mockConnect).toHaveBeenCalledWith("conn-1");
  });

  // -----------------------------------------------------------------------
  // Context menu closes via onClose
  // -----------------------------------------------------------------------
  it("closes context menu via onClose callback", () => {
    setStoreState({});

    render(<ConnectionItem connection={makeConnection()} />);

    const item = screen.getByRole("button", { name: /Test DB/ });
    fireEvent.contextMenu(item, { clientX: 100, clientY: 200 });
    expect(screen.getByTestId("context-menu")).toBeInTheDocument();

    // The mock menu calls onClose when any button is clicked
    fireEvent.click(screen.getByText("Edit"));
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

    const item = screen.getByRole("button");
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
