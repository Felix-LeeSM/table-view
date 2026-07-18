import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";

// ---------------------------------------------------------------------------
// Mock @lib/tauri/window — sprint-363 (Phase 3, Q13) wires ConnectionList
// double-click into `openWorkspaceWindow(connId)` so the per-conn label
// `workspace-{id}` is build/focused by backend. Mocked at module scope so
// every test in this file can spy on the IPC call shape without hitting
// the Tauri runtime (vitest jsdom env).
// ---------------------------------------------------------------------------
const openWorkspaceWindowMock = vi.fn((connId: string) => {
  void connId;
  return Promise.resolve();
});

vi.mock("@lib/tauri/window", () => ({
  openWorkspaceWindow: (connId: string) => openWorkspaceWindowMock(connId),
}));

// Now safe to import the SUT — the mock is registered before module evaluation.
import ConnectionList from "./ConnectionList";

// ---------------------------------------------------------------------------
// Mutable drag state — tests can set this to simulate active drag
// ---------------------------------------------------------------------------
let _draggedConnectionId: string | null = null;

// ---------------------------------------------------------------------------
// Mock child components
// ---------------------------------------------------------------------------

vi.mock("./ConnectionItem", () => ({
  default: ({
    connection,
    selected,
    onSelect,
    onActivate,
  }: {
    connection: ConnectionConfig;
    selected?: boolean;
    onSelect?: (id: string) => void;
    onActivate?: (id: string) => void;
  }) => (
    <div
      data-testid="connection-item"
      data-selected={selected ? "true" : "false"}
      data-conn-id={connection.id}
      onClick={() => onSelect?.(connection.id)}
      onDoubleClick={() => onActivate?.(connection.id)}
    >
      {connection.name}
    </div>
  ),
  get draggedConnectionId() {
    return _draggedConnectionId;
  },
}));

vi.mock("./ConnectionGroup", () => ({
  default: ({
    group,
    connections,
    selectedId,
    onSelect,
    onActivate,
    isDropTarget,
    onDragOverGroup,
  }: {
    group: { id: string; name: string };
    connections: ConnectionConfig[];
    selectedId?: string | null;
    onSelect?: (id: string) => void;
    onActivate?: (id: string) => void;
    isDropTarget?: boolean;
    onDragOverGroup?: (groupId: string) => void;
  }) => (
    <div
      data-testid="connection-group"
      data-group-id={group.id}
      data-selected={selectedId ?? ""}
      data-has-onselect={onSelect ? "true" : "false"}
      data-has-onactivate={onActivate ? "true" : "false"}
      data-drop-target={isDropTarget ? "true" : "false"}
      // The real ConnectionGroup calls onDragOverGroup(group.id) and
      // stopPropagation() on dragover; the stub mirrors both so the event does
      // not bubble to the list's root onDragOver (which the real group blocks).
      onDragOver={(e) => {
        e.stopPropagation();
        onDragOverGroup?.(group.id);
      }}
    >
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
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "testdb",
    groupId: null,
    color: null,
    paradigm: "rdb",
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
  // AC-01: Root connections (groupId === null) rendered as ConnectionItem
  // -----------------------------------------------------------------------
  it("renders root connections as ConnectionItem stubs", () => {
    setStoreState({
      connections: [
        makeConnection({ id: "c1", name: "Root DB 1", groupId: null }),
        makeConnection({ id: "c2", name: "Root DB 2", groupId: null }),
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
        makeConnection({ id: "c1", name: "Root DB", groupId: null }),
        makeConnection({ id: "c2", name: "Grouped DB", groupId: "g1" }),
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
        makeConnection({ id: "c1", name: "DB A", groupId: "g1" }),
        makeConnection({ id: "c2", name: "DB B", groupId: "g2" }),
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
        makeConnection({ id: "c1", name: "DB 1", groupId: "g1" }),
        makeConnection({ id: "c2", name: "DB 2", groupId: "g1" }),
        makeConnection({ id: "c3", name: "DB 3", groupId: "g2" }),
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
      connections: [makeConnection({ id: "c1", name: "DB", groupId: "g1" })],
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
    act(() => {
      fireEvent.drop(dropZone, {
        dataTransfer: { getData: () => "fallback-id" },
      });
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

    act(() => {
      fireEvent.drop(dropZone, {
        dataTransfer: { getData: () => "fallback-conn-id" },
      });
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

    act(() => {
      fireEvent.drop(dropZone, {
        dataTransfer: { getData: () => "" },
      });
    });

    expect(mockMove).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Mixed: root connections + groups together
  // -----------------------------------------------------------------------
  it("renders both root connections and groups together", () => {
    setStoreState({
      connections: [
        makeConnection({ id: "c1", name: "Root DB", groupId: null }),
        makeConnection({ id: "c2", name: "Grouped DB", groupId: "g1" }),
      ],
      groups: [makeGroup({ id: "g1", name: "My Group" })],
    });

    render(<ConnectionList />);

    expect(screen.getByText("Root DB")).toBeInTheDocument();
    expect(screen.getByText("My Group (1)")).toBeInTheDocument();
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

  // -----------------------------------------------------------------------
  // Accessibility: root drop zone has aria-label for screen readers
  // -----------------------------------------------------------------------
  it("root drop zone carries an aria-label for the ungrouped drop region", () => {
    setStoreState({ connections: [], groups: [] });
    const { container } = render(<ConnectionList />);
    const dropZone = container.firstElementChild as HTMLElement;
    expect(dropZone.getAttribute("aria-label")).toMatch(
      /ungrouped connections drop area/i,
    );
  });

  // -----------------------------------------------------------------------
  // 2026-05-05 — drop visual indicators were removed per user request
  // ("group에서 제거할 때 indicator가 남아있어"). The hint dialog and the
  // dashed outline are no longer rendered at any point during the drag.
  // Lock the absence so a future re-introduction is caught in unit tests.
  // -----------------------------------------------------------------------
  it("never renders an ungrouped-drop-hint dialog during a drag", () => {
    setStoreState({
      connections: [makeConnection({ id: "c1", name: "DB", groupId: "g1" })],
      groups: [makeGroup({ id: "g1", name: "G" })],
    });
    _draggedConnectionId = "c1";

    const { container } = render(<ConnectionList />);
    const dropZone = container.firstElementChild as HTMLElement;
    act(() => {
      fireEvent.dragOver(dropZone, {
        dataTransfer: { dropEffect: "" },
      });
    });

    expect(screen.queryByTestId("ungrouped-drop-hint")).toBeNull();
    expect(dropZone.className).not.toMatch(/outline-dashed/);
    expect(dropZone.className).not.toMatch(/bg-primary\/5/);
  });

  describe("Selection forwarding", () => {
    it("marks the matching root connection as selected", () => {
      setStoreState({
        connections: [
          makeConnection({ id: "c1", name: "Root 1", groupId: null }),
          makeConnection({ id: "c2", name: "Root 2", groupId: null }),
        ],
        groups: [],
      });

      render(<ConnectionList selectedId="c2" />);

      const items = screen.getAllByTestId("connection-item");
      expect(items[0]?.getAttribute("data-selected")).toBe("false");
      expect(items[1]?.getAttribute("data-selected")).toBe("true");
    });

    it("forwards onSelect from a clicked root connection", () => {
      const onSelect = vi.fn();
      setStoreState({
        connections: [
          makeConnection({ id: "c1", name: "Root 1", groupId: null }),
        ],
        groups: [],
      });

      render(<ConnectionList onSelect={onSelect} />);

      act(() => {
        fireEvent.click(screen.getByTestId("connection-item"));
      });
      expect(onSelect).toHaveBeenCalledWith("c1");
    });

    it("forwards onActivate from a double-clicked root connection", () => {
      const onActivate = vi.fn();
      setStoreState({
        connections: [
          makeConnection({ id: "c1", name: "Root 1", groupId: null }),
        ],
        groups: [],
      });

      render(<ConnectionList onActivate={onActivate} />);

      act(() => {
        fireEvent.doubleClick(screen.getByTestId("connection-item"));
      });
      expect(onActivate).toHaveBeenCalledWith("c1");
    });

    it("forwards selectedId, onSelect, onActivate to ConnectionGroup", () => {
      setStoreState({
        connections: [
          makeConnection({ id: "g-1", name: "Inside", groupId: "grp" }),
        ],
        groups: [makeGroup({ id: "grp", name: "Group A" })],
      });

      render(
        <ConnectionList
          selectedId="g-1"
          onSelect={() => {}}
          onActivate={() => {}}
        />,
      );

      const group = screen.getByTestId("connection-group");
      expect(group.getAttribute("data-selected")).toBe("g-1");
      expect(group.getAttribute("data-has-onselect")).toBe("true");
      expect(group.getAttribute("data-has-onactivate")).toBe("true");
    });
  });

  // ---------------------------------------------------------------------------
  // 작성 2026-05-16 (Phase 3 sprint-363) — Q13 같은 conn focus + per-conn
  // workspace window IPC 호출 규약.
  //
  // 사유: sprint-361 의 `openWorkspaceWindow(connId)` wrapper 는 backend
  // 의 idempotent `workspace-{conn_id}` 라벨 build/focus 분기를 호출하는
  // 유일한 frontend 경로. sprint-363 의 contract 는 connection
  // double-click 시 이 wrapper 가 invoke 되어야 한다. 본 테스트는
  // ConnectionList 가 onActivate 콜백을 wrap 해서 IPC 와 store-side
  // 처리를 둘 다 발사함을 잠근다.
  //
  // 시나리오 매트릭스:
  //   - AC-363-FE-01 single double-click → openWorkspaceWindow(id) 1회
  //   - AC-363-FE-02 같은 conn 두 번 double-click → openWorkspaceWindow 2회
  //     (backend idempotent 분기는 별 cargo test 에서 잠금됨)
  //   - AC-363-FE-03 IPC reject 시 onActivate 는 여전히 호출됨 (store
  //     side 가 IPC 결과와 독립적으로 user signal 을 받아야 함)
  //   - AC-363-FE-04 onActivate 없이도 IPC 는 fire 된다 (정말로 window
  //     open 만 원하는 caller 도 working flow)
  // ---------------------------------------------------------------------------
  describe("AC-363-FE-*: openWorkspaceWindow on double-click", () => {
    beforeEach(() => {
      openWorkspaceWindowMock.mockClear();
      openWorkspaceWindowMock.mockResolvedValue(undefined);
    });

    it("AC-363-FE-01: double-click fires openWorkspaceWindow(connId) exactly once", () => {
      const onActivate = vi.fn();
      setStoreState({
        connections: [
          makeConnection({ id: "conn-a", name: "Conn A", groupId: null }),
        ],
        groups: [],
      });

      render(<ConnectionList onActivate={onActivate} />);

      act(() => {
        fireEvent.doubleClick(screen.getByTestId("connection-item"));
      });

      expect(openWorkspaceWindowMock).toHaveBeenCalledTimes(1);
      expect(openWorkspaceWindowMock).toHaveBeenCalledWith("conn-a");
      expect(onActivate).toHaveBeenCalledWith("conn-a");
    });

    it("AC-363-FE-02: same connection clicked twice → IPC fired twice (backend dedups)", () => {
      setStoreState({
        connections: [
          makeConnection({ id: "conn-a", name: "Conn A", groupId: null }),
        ],
        groups: [],
      });

      render(<ConnectionList />);

      const item = screen.getByTestId("connection-item");
      act(() => {
        fireEvent.doubleClick(item);
        fireEvent.doubleClick(item);
      });

      // Frontend fires every double-click; the backend `open_workspace_window`
      // implementation collapses the second call to a `set_focus` on the
      // existing window (covered by cargo test
      // `ac_363_02_same_conn_second_call_emits_focus_event_with_is_new_false`).
      expect(openWorkspaceWindowMock).toHaveBeenCalledTimes(2);
      expect(openWorkspaceWindowMock).toHaveBeenNthCalledWith(1, "conn-a");
      expect(openWorkspaceWindowMock).toHaveBeenNthCalledWith(2, "conn-a");
    });

    it("AC-363-FE-03: IPC rejection still calls onActivate (store-side updates decoupled)", async () => {
      const onActivate = vi.fn();
      openWorkspaceWindowMock.mockRejectedValueOnce(new Error("ipc down"));

      setStoreState({
        connections: [
          makeConnection({ id: "conn-x", name: "X", groupId: null }),
        ],
        groups: [],
      });

      render(<ConnectionList onActivate={onActivate} />);

      await act(async () => {
        fireEvent.doubleClick(screen.getByTestId("connection-item"));
        // Allow microtask of the .catch() to settle.
        await Promise.resolve();
      });

      // The store-side hook MUST fire regardless of IPC outcome — the
      // user's intent ("activate conn-x") is decoupled from the window
      // IPC; the rejection is logged.
      expect(onActivate).toHaveBeenCalledWith("conn-x");
      expect(openWorkspaceWindowMock).toHaveBeenCalledWith("conn-x");
    });

    it("AC-363-FE-04: IPC fires even when caller did not pass onActivate", () => {
      setStoreState({
        connections: [
          makeConnection({ id: "conn-z", name: "Z", groupId: null }),
        ],
        groups: [],
      });

      // No onActivate prop — pure window-open caller.
      render(<ConnectionList />);

      act(() => {
        fireEvent.doubleClick(screen.getByTestId("connection-item"));
      });

      expect(openWorkspaceWindowMock).toHaveBeenCalledWith("conn-z");
    });

    it("AC-363-FE-05: single-click (onSelect) does NOT fire openWorkspaceWindow", () => {
      const onSelect = vi.fn();
      setStoreState({
        connections: [
          makeConnection({ id: "conn-q", name: "Q", groupId: null }),
        ],
        groups: [],
      });

      render(<ConnectionList onSelect={onSelect} />);

      act(() => {
        fireEvent.click(screen.getByTestId("connection-item"));
      });

      expect(onSelect).toHaveBeenCalledWith("conn-q");
      // Single-click is select-only; window open is reserved for double-click.
      expect(openWorkspaceWindowMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Drop-location preview (2026-07-18) — the list owns which group the dragged
  // connection is over and flags exactly that group as the drop target. The
  // single dragend/drop cleanup means an Esc cancel leaves no highlight behind.
  // The root highlight stays removed (see the 2026-05-05 lock above).
  // ---------------------------------------------------------------------------
  describe("drop-target highlight state", () => {
    beforeEach(() => {
      setStoreState({
        connections: [
          makeConnection({ id: "c1", name: "DB A", groupId: "g1" }),
          makeConnection({ id: "c2", name: "DB B", groupId: "g2" }),
        ],
        groups: [
          makeGroup({ id: "g1", name: "Group 1" }),
          makeGroup({ id: "g2", name: "Group 2" }),
        ],
      });
      _draggedConnectionId = "c1";
    });

    // Reason: dragover 시 그 그룹만 drop 대상으로 하이라이트 (2026-07-18)
    it("flags only the hovered group as the drop target on dragover", () => {
      render(<ConnectionList />);
      const [g1, g2] = screen.getAllByTestId("connection-group");
      act(() => {
        fireEvent.dragOver(g1!);
      });
      expect(g1).toHaveAttribute("data-drop-target", "true");
      expect(g2).toHaveAttribute("data-drop-target", "false");
    });

    // Reason: 포인터가 다른 그룹으로 옮겨가면 하이라이트도 따라 이동 (2026-07-18)
    it("moves the highlight to the group under the pointer", () => {
      render(<ConnectionList />);
      const [g1, g2] = screen.getAllByTestId("connection-group");
      act(() => {
        fireEvent.dragOver(g1!);
      });
      act(() => {
        fireEvent.dragOver(g2!);
      });
      expect(g1).toHaveAttribute("data-drop-target", "false");
      expect(g2).toHaveAttribute("data-drop-target", "true");
    });

    // Reason: dragend(=드롭/Esc 취소) 시 하이라이트 제거, 상태 누수 없음 (2026-07-18)
    it("clears the highlight on dragend so an Esc cancel leaves nothing behind", () => {
      const { container } = render(<ConnectionList />);
      const [g1] = screen.getAllByTestId("connection-group");
      act(() => {
        fireEvent.dragOver(g1!);
      });
      expect(g1).toHaveAttribute("data-drop-target", "true");

      const root = container.firstElementChild as HTMLElement;
      act(() => {
        fireEvent.dragEnd(root);
      });
      expect(g1).toHaveAttribute("data-drop-target", "false");
    });

    // Reason: drop 완료 후 하이라이트 제거 (2026-07-18)
    it("clears the highlight after a drop on the root area", () => {
      const { container } = render(<ConnectionList />);
      const [g1] = screen.getAllByTestId("connection-group");
      act(() => {
        fireEvent.dragOver(g1!);
      });
      const root = container.firstElementChild as HTMLElement;
      act(() => {
        fireEvent.drop(root, { dataTransfer: { getData: () => "" } });
      });
      expect(g1).toHaveAttribute("data-drop-target", "false");
    });

    // Reason: 포인터가 루트(비그룹) 영역으로 나가면 그룹 하이라이트 해제 (2026-07-18)
    it("clears the group highlight when the pointer moves to the root area", () => {
      const { container } = render(<ConnectionList />);
      const [g1] = screen.getAllByTestId("connection-group");
      act(() => {
        fireEvent.dragOver(g1!);
      });
      expect(g1).toHaveAttribute("data-drop-target", "true");

      const root = container.firstElementChild as HTMLElement;
      act(() => {
        fireEvent.dragOver(root, { dataTransfer: { dropEffect: "" } });
      });
      expect(g1).toHaveAttribute("data-drop-target", "false");
    });
  });
});
