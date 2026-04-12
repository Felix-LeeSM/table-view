import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConnectionList from "./ConnectionList";
import { useConnectionStore } from "../stores/connectionStore";
import type { ConnectionConfig } from "../types/connection";

// ---------------------------------------------------------------------------
// Mutable drag state — tests can set this to simulate active drag
// ---------------------------------------------------------------------------
let _draggedConnectionId: string | null = null;

// ---------------------------------------------------------------------------
// Mock child components
// ---------------------------------------------------------------------------

vi.mock("./ConnectionItem", () => ({
  default: ({ connection }: { connection: ConnectionConfig }) => (
    <div data-testid="connection-item">{connection.name}</div>
  ),
  get draggedConnectionId() {
    return _draggedConnectionId;
  },
}));

vi.mock("./ConnectionGroup", () => ({
  default: ({
    group,
    connections,
  }: {
    group: { id: string; name: string };
    connections: ConnectionConfig[];
  }) => (
    <div data-testid="connection-group">
      {group.name} ({connections.length})
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

function makeGroup(overrides: {
  id: string;
  name: string;
  collapsed?: boolean;
}) {
  return {
    id: overrides.id,
    name: overrides.name,
    color: null as string | null,
    collapsed: overrides.collapsed ?? false,
  };
}

function setStoreState(overrides: {
  connections?: ConnectionConfig[];
  groups?: {
    id: string;
    name: string;
    color: string | null;
    collapsed: boolean;
  }[];
  moveConnectionToGroup?: () => Promise<void>;
}) {
  useConnectionStore.setState({
    connections: [],
    groups: [],
    moveConnectionToGroup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConnectionList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _draggedConnectionId = null;
    setStoreState({ connections: [], groups: [] });
  });

  // -----------------------------------------------------------------------
  // AC-01: Root connections (group_id === null) rendered as ConnectionItem
  // -----------------------------------------------------------------------
  it("renders root connections as ConnectionItem stubs", () => {
    setStoreState({
      connections: [
        makeConnection({ id: "c1", name: "Root DB 1", group_id: null }),
        makeConnection({ id: "c2", name: "Root DB 2", group_id: null }),
      ],
      groups: [],
    });

    render(<ConnectionList />);

    const items = screen.getAllByTestId("connection-item");
    expect(items).toHaveLength(2);
    expect(screen.getByText("Root DB 1")).toBeInTheDocument();
    expect(screen.getByText("Root DB 2")).toBeInTheDocument();
  });

  it("does not render grouped connections at root level", () => {
    setStoreState({
      connections: [
        makeConnection({ id: "c1", name: "Root DB", group_id: null }),
        makeConnection({ id: "c2", name: "Grouped DB", group_id: "g1" }),
      ],
      groups: [makeGroup({ id: "g1", name: "Group A" })],
    });

    render(<ConnectionList />);

    const items = screen.getAllByTestId("connection-item");
    // Only the root connection appears as ConnectionItem
    expect(items).toHaveLength(1);
    expect(screen.getByText("Root DB")).toBeInTheDocument();
  });

  it("renders nothing when connections and groups are empty", () => {
    setStoreState({ connections: [], groups: [] });

    const { container } = render(<ConnectionList />);

    expect(
      container.querySelectorAll("[data-testid='connection-item']"),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll("[data-testid='connection-group']"),
    ).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // AC-02: Groups rendered as ConnectionGroup
  // -----------------------------------------------------------------------
  it("renders groups as ConnectionGroup stubs", () => {
    setStoreState({
      connections: [
        makeConnection({ id: "c1", name: "DB A", group_id: "g1" }),
        makeConnection({ id: "c2", name: "DB B", group_id: "g2" }),
      ],
      groups: [
        makeGroup({ id: "g1", name: "Group 1" }),
        makeGroup({ id: "g2", name: "Group 2" }),
      ],
    });

    render(<ConnectionList />);

    const groups = screen.getAllByTestId("connection-group");
    expect(groups).toHaveLength(2);
    expect(screen.getByText("Group 1 (1)")).toBeInTheDocument();
    expect(screen.getByText("Group 2 (1)")).toBeInTheDocument();
  });

  it("passes correct connections to each group", () => {
    setStoreState({
      connections: [
        makeConnection({ id: "c1", name: "DB 1", group_id: "g1" }),
        makeConnection({ id: "c2", name: "DB 2", group_id: "g1" }),
        makeConnection({ id: "c3", name: "DB 3", group_id: "g2" }),
      ],
      groups: [
        makeGroup({ id: "g1", name: "Group A" }),
        makeGroup({ id: "g2", name: "Group B" }),
      ],
    });

    render(<ConnectionList />);

    expect(screen.getByText("Group A (2)")).toBeInTheDocument();
    expect(screen.getByText("Group B (1)")).toBeInTheDocument();
  });

  it("renders groups with zero connections", () => {
    setStoreState({
      connections: [],
      groups: [makeGroup({ id: "g1", name: "Empty Group" })],
    });

    render(<ConnectionList />);

    expect(screen.getByText("Empty Group (0)")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-03: Drag hint when connections > 0 but no groups
  // -----------------------------------------------------------------------
  it("shows drag hint when connections exist but no groups", () => {
    setStoreState({
      connections: [makeConnection({ id: "c1", name: "DB" })],
      groups: [],
    });

    render(<ConnectionList />);

    expect(
      screen.getByText("Drag connections onto each other to create groups"),
    ).toBeInTheDocument();
  });

  it("does not show drag hint when groups exist", () => {
    setStoreState({
      connections: [makeConnection({ id: "c1", name: "DB", group_id: "g1" })],
      groups: [makeGroup({ id: "g1", name: "Group 1" })],
    });

    render(<ConnectionList />);

    expect(
      screen.queryByText("Drag connections onto each other to create groups"),
    ).not.toBeInTheDocument();
  });

  it("does not show drag hint when no connections exist", () => {
    setStoreState({ connections: [], groups: [] });

    render(<ConnectionList />);

    expect(
      screen.queryByText("Drag connections onto each other to create groups"),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-04: Drop zone calls moveConnectionToGroup(connId, null)
  // -----------------------------------------------------------------------
  it("calls moveConnectionToGroup with null group on drop when draggedConnectionId is set", () => {
    const mockMove = vi.fn().mockResolvedValue(undefined);

    // Simulate an active drag
    _draggedConnectionId = "conn-2";

    setStoreState({
      connections: [makeConnection({ id: "c1", name: "DB" })],
      groups: [],
      moveConnectionToGroup: mockMove,
    });

    const { container } = render(<ConnectionList />);

    // The root container div is the drop zone
    const dropZone = container.firstElementChild as HTMLElement;

    // Simulate drop
    fireEvent.drop(dropZone, {
      dataTransfer: { getData: () => "fallback-id" },
    });

    expect(mockMove).toHaveBeenCalledWith("conn-2", null);
  });

  it("calls moveConnectionToGroup using dataTransfer fallback when draggedConnectionId is null", () => {
    const mockMove = vi.fn().mockResolvedValue(undefined);

    _draggedConnectionId = null;

    setStoreState({
      connections: [makeConnection({ id: "c1", name: "DB" })],
      groups: [],
      moveConnectionToGroup: mockMove,
    });

    const { container } = render(<ConnectionList />);
    const dropZone = container.firstElementChild as HTMLElement;

    fireEvent.drop(dropZone, {
      dataTransfer: { getData: () => "fallback-conn-id" },
    });

    expect(mockMove).toHaveBeenCalledWith("fallback-conn-id", null);
  });

  it("does not call moveConnectionToGroup when neither draggedConnectionId nor dataTransfer has an id", () => {
    const mockMove = vi.fn().mockResolvedValue(undefined);

    _draggedConnectionId = null;

    setStoreState({
      connections: [makeConnection({ id: "c1", name: "DB" })],
      groups: [],
      moveConnectionToGroup: mockMove,
    });

    const { container } = render(<ConnectionList />);
    const dropZone = container.firstElementChild as HTMLElement;

    fireEvent.drop(dropZone, {
      dataTransfer: { getData: () => "" },
    });

    expect(mockMove).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Drop zone visual feedback (dragOver with active drag)
  // -----------------------------------------------------------------------
  it("activates drop zone styling on dragOver when a connection is being dragged", () => {
    setStoreState({
      connections: [makeConnection({ id: "c1", name: "DB" })],
      groups: [],
    });

    _draggedConnectionId = "conn-2";

    const { container } = render(<ConnectionList />);
    const dropZone = container.firstElementChild as HTMLElement;

    const classBefore = dropZone.className;

    fireEvent.dragOver(dropZone, {
      dataTransfer: { dropEffect: "" },
    });

    // Class should change to include the accent background
    expect(dropZone.className).not.toBe(classBefore);
  });

  it("does not activate drop zone when no connection is being dragged", () => {
    setStoreState({
      connections: [makeConnection({ id: "c1", name: "DB" })],
      groups: [],
    });

    _draggedConnectionId = null;

    const { container } = render(<ConnectionList />);
    const dropZone = container.firstElementChild as HTMLElement;

    const classBefore = dropZone.className;

    fireEvent.dragOver(dropZone, {
      dataTransfer: { dropEffect: "" },
    });

    // draggedConnectionId is null, so class should not change
    expect(dropZone.className).toBe(classBefore);
  });

  // -----------------------------------------------------------------------
  // Mixed: root connections + groups together
  // -----------------------------------------------------------------------
  it("renders both root connections and groups together", () => {
    setStoreState({
      connections: [
        makeConnection({ id: "c1", name: "Root DB", group_id: null }),
        makeConnection({ id: "c2", name: "Grouped DB", group_id: "g1" }),
      ],
      groups: [makeGroup({ id: "g1", name: "My Group" })],
    });

    render(<ConnectionList />);

    expect(screen.getByText("Root DB")).toBeInTheDocument();
    expect(screen.getByText("My Group (1)")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Drag leave resets drop active state
  // -----------------------------------------------------------------------
  it("resets drop active state on dragLeave", () => {
    setStoreState({
      connections: [makeConnection({ id: "c1", name: "DB" })],
      groups: [],
    });

    _draggedConnectionId = "conn-2";

    const { container } = render(<ConnectionList />);
    const dropZone = container.firstElementChild as HTMLElement;

    // Activate via dragOver
    fireEvent.dragOver(dropZone, {
      dataTransfer: { dropEffect: "" },
    });
    const activeClass = dropZone.className;

    // dragLeave should reset
    fireEvent.dragLeave(dropZone);
    expect(dropZone.className).not.toBe(activeClass);
  });

  // -----------------------------------------------------------------------
  // select-none on root element
  // -----------------------------------------------------------------------
  it("has select-none class on root element to prevent text selection", () => {
    setStoreState({ connections: [], groups: [] });

    const { container } = render(<ConnectionList />);
    const rootDiv = container.firstElementChild as HTMLElement;
    expect(rootDiv).toBeTruthy();
    expect(rootDiv.className).toContain("select-none");
  });
});
