import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import ConnectionGroup from "./ConnectionGroup";
import { useConnectionStore } from "@stores/connectionStore";
import type {
  ConnectionConfig,
  ConnectionGroup as ConnectionGroupType,
} from "@/types/connection";

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
  set draggedConnectionId(v: string | null) {
    _draggedConnectionId = v;
  },
}));

vi.mock("@components/shared/ContextMenu", () => ({
  ContextMenu: ({
    items,
    onClose,
  }: {
    items: { label: string; onClick: () => void }[];
    onClose: () => void;
  }) => (
    <div data-testid="context-menu">
      {items.map((item) => (
        <button
          key={item.label}
          data-testid={`menu-item-${item.label}`}
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGroup(
  overrides: Partial<ConnectionGroupType> = {},
): ConnectionGroupType {
  return {
    id: "g1",
    name: "Production",
    color: null,
    collapsed: false,
    ...overrides,
  };
}

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
    group_id: "g1",
    color: null,
    ...overrides,
  };
}

const mockRemoveGroup = vi.fn().mockResolvedValue(undefined);
const mockUpdateGroup = vi.fn().mockResolvedValue(undefined);
const mockMoveConnectionToGroup = vi.fn().mockResolvedValue(undefined);

function setStoreState() {
  useConnectionStore.setState({
    removeGroup: mockRemoveGroup,
    updateGroup: mockUpdateGroup,
    moveConnectionToGroup: mockMoveConnectionToGroup,
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConnectionGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _draggedConnectionId = null;
    setStoreState();
  });

  // -----------------------------------------------------------------------
  // AC-01: Group header displays group name and connection count
  // -----------------------------------------------------------------------
  it("renders the group name", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ name: "Production" })}
        connections={[]}
      />,
    );

    expect(screen.getByText("Production")).toBeInTheDocument();
  });

  it("renders the connection count", () => {
    render(
      <ConnectionGroup
        group={makeGroup()}
        connections={[
          makeConnection(),
          makeConnection({ id: "conn-2", name: "DB 2" }),
        ]}
      />,
    );

    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("renders zero count when no connections", () => {
    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    expect(screen.getByText("(0)")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-02: Click toggles collapse (ChevronRight / ChevronDown)
  // -----------------------------------------------------------------------
  it("shows ChevronDown when expanded", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ collapsed: false })}
        connections={[]}
      />,
    );

    // The header is a role="button" with aria-label
    const header = screen.getByRole("button");
    // When expanded, ChevronDown is rendered (lucide renders SVGs)
    expect(header.querySelector("svg")).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("shows ChevronRight when collapsed", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ collapsed: true })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles from expanded to collapsed on click", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ collapsed: false })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    expect(header).toHaveAttribute("aria-expanded", "true");

    act(() => {
      fireEvent.click(header);
    });
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles from collapsed to expanded on click", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ collapsed: true })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    expect(header).toHaveAttribute("aria-expanded", "false");

    act(() => {
      fireEvent.click(header);
    });
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  // -----------------------------------------------------------------------
  // AC-03: Expanded state renders connection items
  // -----------------------------------------------------------------------
  it("renders connection items when expanded", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ collapsed: false })}
        connections={[
          makeConnection({ id: "c1", name: "DB Alpha" }),
          makeConnection({ id: "c2", name: "DB Beta" }),
        ]}
      />,
    );

    expect(screen.getAllByTestId("connection-item")).toHaveLength(2);
    expect(screen.getByText("DB Alpha")).toBeInTheDocument();
    expect(screen.getByText("DB Beta")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-04: Collapsed state hides connection items
  // -----------------------------------------------------------------------
  it("hides connection items when collapsed", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ collapsed: true })}
        connections={[makeConnection()]}
      />,
    );

    expect(screen.queryByTestId("connection-item")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-05: Right-click shows context menu
  // -----------------------------------------------------------------------
  it("shows context menu on right-click", () => {
    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });

    expect(screen.getByTestId("context-menu")).toBeInTheDocument();
    expect(screen.getByTestId("menu-item-Rename")).toBeInTheDocument();
    expect(screen.getByTestId("menu-item-Delete Group")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-06: Rename menu item triggers inline rename input
  // -----------------------------------------------------------------------
  it("shows rename input when Rename menu item is clicked", () => {
    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });

    const renameBtn = screen.getByTestId("menu-item-Rename");
    act(() => {
      fireEvent.click(renameBtn);
    });

    // The context menu mock calls onClick then onClose
    // After clicking Rename, an input should appear
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-07: Rename Enter submits with updateGroup call
  // -----------------------------------------------------------------------
  it("calls updateGroup with new name on Enter key", async () => {
    render(
      <ConnectionGroup
        group={makeGroup({ name: "Production" })}
        connections={[]}
      />,
    );

    // Trigger rename via context menu
    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    const input = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(input, { target: { value: "Staging" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith(
        expect.objectContaining({ id: "g1", name: "Staging" }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC-08: Escape cancels rename
  // -----------------------------------------------------------------------
  it("cancels rename on Escape key without calling updateGroup", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ name: "Production" })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    const input = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(input, { target: { value: "Staging" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(mockUpdateGroup).not.toHaveBeenCalled();
    // Input should be gone, original name should be visible
    expect(screen.getByText("Production")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-09: Empty or same name skips updateGroup
  // -----------------------------------------------------------------------
  it("does not call updateGroup when rename value is empty", async () => {
    render(
      <ConnectionGroup
        group={makeGroup({ name: "Production" })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    const input = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(input, { target: { value: "   " } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(mockUpdateGroup).not.toHaveBeenCalled();
    });
  });

  it("does not call updateGroup when rename value is the same as current name", async () => {
    render(
      <ConnectionGroup
        group={makeGroup({ name: "Production" })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    const input = screen.getByRole("textbox");
    // Value is already "Production" (set from group.name), just press Enter
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(mockUpdateGroup).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // AC-10: Delete Group calls removeGroup
  // -----------------------------------------------------------------------
  it("calls removeGroup when Delete Group menu item is clicked", () => {
    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });

    const deleteBtn = screen.getByTestId("menu-item-Delete Group");
    act(() => {
      fireEvent.click(deleteBtn);
    });

    expect(mockRemoveGroup).toHaveBeenCalledWith("g1");
  });

  // -----------------------------------------------------------------------
  // AC-11: Drag and drop moves connection to group
  // -----------------------------------------------------------------------
  it("calls moveConnectionToGroup on drop when draggedConnectionId is set", async () => {
    _draggedConnectionId = "conn-42";

    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.drop(header, {
        dataTransfer: { getData: () => "" },
      });
    });

    await waitFor(() => {
      expect(mockMoveConnectionToGroup).toHaveBeenCalledWith("conn-42", "g1");
    });
  });

  it("uses dataTransfer fallback when draggedConnectionId is null", async () => {
    _draggedConnectionId = null;

    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.drop(header, {
        dataTransfer: { getData: () => "fallback-conn-id" },
      });
    });

    await waitFor(() => {
      expect(mockMoveConnectionToGroup).toHaveBeenCalledWith(
        "fallback-conn-id",
        "g1",
      );
    });
  });

  it("does not call moveConnectionToGroup when no connection id is available", () => {
    _draggedConnectionId = null;

    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.drop(header, {
        dataTransfer: { getData: () => "" },
      });
    });

    expect(mockMoveConnectionToGroup).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Drag over / drag leave visual feedback
  // -----------------------------------------------------------------------
  it("sets drop active styling on dragOver when draggedConnectionId is set", () => {
    _draggedConnectionId = "conn-1";

    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");
    const classBefore = header.className;

    act(() => {
      fireEvent.dragOver(header, {
        dataTransfer: { dropEffect: "" },
      });
    });

    expect(header.className).not.toBe(classBefore);
    expect(header.className).toContain("outline");
  });

  it("does not set drop active when no connection is being dragged", () => {
    _draggedConnectionId = null;

    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");
    const classBefore = header.className;

    act(() => {
      fireEvent.dragOver(header, {
        dataTransfer: { dropEffect: "" },
      });
    });

    expect(header.className).toBe(classBefore);
  });

  it("resets drop active styling on dragLeave", () => {
    _draggedConnectionId = "conn-1";

    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");

    act(() => {
      fireEvent.dragOver(header, {
        dataTransfer: { dropEffect: "" },
      });
    });
    const activeClass = header.className;

    act(() => {
      fireEvent.dragLeave(header);
    });
    expect(header.className).not.toBe(activeClass);
  });

  it("resets drop active styling on drop", async () => {
    _draggedConnectionId = "conn-1";

    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");

    act(() => {
      fireEvent.dragOver(header, {
        dataTransfer: { dropEffect: "" },
      });
    });

    act(() => {
      fireEvent.drop(header, {
        dataTransfer: { getData: () => "" },
      });
    });

    // After drop, the connection id exists so moveConnectionToGroup is called
    await waitFor(() => {
      expect(mockMoveConnectionToGroup).toHaveBeenCalled();
    });

    // dropActive should be false now (no outline class)
    expect(header.className).not.toContain("outline");
  });

  // -----------------------------------------------------------------------
  // Keyboard: Enter and Space toggle collapse
  // -----------------------------------------------------------------------
  it("toggles collapse on Enter key", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ collapsed: false })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    expect(header).toHaveAttribute("aria-expanded", "true");

    act(() => {
      fireEvent.keyDown(header, { key: "Enter" });
    });
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles collapse on Space key", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ collapsed: true })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    expect(header).toHaveAttribute("aria-expanded", "false");

    act(() => {
      fireEvent.keyDown(header, { key: " " });
    });
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  // -----------------------------------------------------------------------
  // Click during renaming does not toggle collapse
  // -----------------------------------------------------------------------
  it("does not toggle collapse when clicking during rename", () => {
    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");

    // Open rename mode
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    expect(screen.getByRole("textbox")).toBeInTheDocument();

    const ariaBefore = header.getAttribute("aria-expanded");

    // Click on the input (which is inside the header) should not toggle
    const input = screen.getByRole("textbox");
    act(() => {
      fireEvent.click(input);
    });

    expect(header).toHaveAttribute("aria-expanded", ariaBefore);
  });

  // -----------------------------------------------------------------------
  // Keyboard during renaming: Enter/Space do not toggle
  // -----------------------------------------------------------------------
  it("does not toggle collapse on Enter key during renaming", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ collapsed: false })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");

    // Enter rename mode
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    const ariaBefore = header.getAttribute("aria-expanded");

    act(() => {
      fireEvent.keyDown(header, { key: "Enter" });
    });
    expect(header).toHaveAttribute("aria-expanded", ariaBefore);
  });

  // -----------------------------------------------------------------------
  // Blur submits rename
  // -----------------------------------------------------------------------
  it("calls updateGroup on blur with new name", async () => {
    render(
      <ConnectionGroup
        group={makeGroup({ name: "Production" })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    const input = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(input, { target: { value: "Staging" } });
    });
    act(() => {
      fireEvent.blur(input);
    });

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith(
        expect.objectContaining({ id: "g1", name: "Staging" }),
      );
    });
  });

  it("does not call updateGroup on blur with same name", async () => {
    render(
      <ConnectionGroup
        group={makeGroup({ name: "Production" })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    const input = screen.getByRole("textbox");
    act(() => {
      fireEvent.blur(input);
    });

    await waitFor(() => {
      expect(mockUpdateGroup).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // aria-label
  // -----------------------------------------------------------------------
  it("has correct aria-label with group name and connection count", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ name: "Production" })}
        connections={[makeConnection(), makeConnection({ id: "c2" })]}
      />,
    );

    const header = screen.getByRole("button");
    expect(header).toHaveAttribute(
      "aria-label",
      "Production group (2 connections)",
    );
  });

  // -----------------------------------------------------------------------
  // Rename input stopPropagation on click
  // -----------------------------------------------------------------------
  it("stops click propagation on rename input so collapse is not toggled", () => {
    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    const input = screen.getByRole("textbox");
    const ariaBefore = header.getAttribute("aria-expanded");

    // Clicking the input should not toggle collapse
    act(() => {
      fireEvent.click(input);
    });
    expect(header).toHaveAttribute("aria-expanded", ariaBefore);
  });

  // -----------------------------------------------------------------------
  // Context menu closes via onClose callback
  // -----------------------------------------------------------------------
  it("closes context menu when onClose is called", () => {
    render(<ConnectionGroup group={makeGroup()} connections={[]} />);

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    expect(screen.getByTestId("context-menu")).toBeInTheDocument();

    // The mock menu calls onClose when any button is clicked
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });
    expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Rename trims whitespace
  // -----------------------------------------------------------------------
  it("trims whitespace from rename value before submitting", async () => {
    render(
      <ConnectionGroup
        group={makeGroup({ name: "Production" })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    const input = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(input, { target: { value: "  Staging  " } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Staging" }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Collapsed initialized from group.collapsed
  // -----------------------------------------------------------------------
  it("initializes collapsed state from group.collapsed prop", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ collapsed: true })}
        connections={[makeConnection()]}
      />,
    );

    const header = screen.getByRole("button");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("connection-item")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Rename sets renameValue to group.name on start
  // -----------------------------------------------------------------------
  it("pre-fills rename input with current group name", () => {
    render(
      <ConnectionGroup
        group={makeGroup({ name: "Production" })}
        connections={[]}
      />,
    );

    const header = screen.getByRole("button");
    act(() => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 200 });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("menu-item-Rename"));
    });

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Production");
  });

  // -----------------------------------------------------------------------
  // select-none on root element
  // -----------------------------------------------------------------------
  it("has select-none class on root element to prevent text selection", () => {
    const { container } = render(
      <ConnectionGroup group={makeGroup()} connections={[]} />,
    );

    const rootDiv = container.firstElementChild as HTMLElement;
    expect(rootDiv).toBeTruthy();
    expect(rootDiv.className).toContain("select-none");
  });
});
