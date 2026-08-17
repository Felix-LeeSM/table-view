import { useConnectionStore } from "@stores/connectionStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/types/connection";

// ---------------------------------------------------------------------------
// #2440 — launcher shape: group rail on the left, filtered connections on the
// right. Cases carry the `[launcher]` token so the acceptance criteria can
// count them with `--reporter=verbose`.
//
// The rail's drop target and the pane's filtering are the two branches that
// change behaviour, so both the accept path and the "must NOT happen" path are
// asserted. `ConnectionItem` / `ConnectionGroup` are stubbed (repo pattern from
// ConnectionList.test.tsx) — this file proves composition, not row internals.
// ---------------------------------------------------------------------------

const openWorkspaceWindowMock = vi.fn((connId: string) => {
  void connId;
  return Promise.resolve();
});

vi.mock("@lib/tauri/window", () => ({
  openWorkspaceWindow: (connId: string) => openWorkspaceWindowMock(connId),
}));

let _draggedConnectionId: string | null = null;

vi.mock("./ConnectionItem", () => ({
  default: ({
    connection,
    onSelect,
    onActivate,
  }: {
    connection: ConnectionConfig;
    onSelect?: (id: string) => void;
    onActivate?: (id: string) => void;
  }) => (
    <div
      data-testid="connection-item"
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
  }: {
    group: { id: string; name: string };
    connections: ConnectionConfig[];
  }) => (
    <div data-testid="connection-group" data-group-id={group.id}>
      {group.name}
      {connections.map((c) => (
        <div key={c.id} data-testid="connection-item" data-conn-id={c.id}>
          {c.name}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("./RecentConnections", () => ({
  default: () => <div data-testid="recent-connections" />,
}));

import ConnectionBrowser from "./ConnectionBrowser";

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

function makeGroup(id: string, name: string) {
  return { id, name, color: null as string | null, collapsed: false };
}

const moveConnectionToGroup = vi.fn().mockResolvedValue(undefined);

function setStoreState(overrides: {
  connections?: ConnectionConfig[];
  groups?: ReturnType<typeof makeGroup>[];
}) {
  useConnectionStore.setState({
    connections: [],
    groups: [],
    moveConnectionToGroup,
    ...overrides,
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
}

/** Two groups, one connection in each, plus one ungrouped. */
function seedTwoGroups() {
  setStoreState({
    connections: [
      makeConnection({ id: "c-root", name: "Root DB", groupId: null }),
      makeConnection({ id: "c-a", name: "Alpha DB", groupId: "g-a" }),
      makeConnection({ id: "c-b", name: "Beta DB", groupId: "g-b" }),
    ],
    groups: [makeGroup("g-a", "Alpha"), makeGroup("g-b", "Beta")],
  });
}

function connIds() {
  return screen
    .queryAllByTestId("connection-item")
    .map((el) => el.getAttribute("data-conn-id"));
}

function railRow(name: RegExp) {
  return screen.getByRole("button", { name });
}

describe("ConnectionBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _draggedConnectionId = null;
    setStoreState({ connections: [], groups: [] });
  });

  it("[launcher] rail lists All, Recent and every group", () => {
    seedTwoGroups();
    render(<ConnectionBrowser />);

    expect(screen.getByTestId("rail-all")).toBeInTheDocument();
    expect(screen.getByTestId("rail-recent")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("rail-group").map((el) => el.textContent),
    ).toEqual(["Alpha", "Beta"]);
  });

  it("[launcher] All is the default view and keeps the group headers", () => {
    seedTwoGroups();
    render(<ConnectionBrowser />);

    expect(screen.getByTestId("rail-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Headers stay in All view — that is where a group is renamed, recoloured
    // and deleted from its context menu.
    expect(
      screen.getAllByTestId("connection-group").map((el) => el.textContent),
    ).toHaveLength(2);
    expect(connIds()).toEqual(["c-root", "c-a", "c-b"]);
  });

  it("[launcher] picking a group narrows the pane to that group's connections", () => {
    seedTwoGroups();
    render(<ConnectionBrowser />);

    act(() => {
      fireEvent.click(railRow(/Alpha/));
    });

    expect(connIds()).toEqual(["c-a"]);
  });

  it("[launcher] picking a group drops the now-redundant group header", () => {
    seedTwoGroups();
    render(<ConnectionBrowser />);

    act(() => {
      fireEvent.click(railRow(/Alpha/));
    });

    expect(screen.queryByTestId("connection-group")).not.toBeInTheDocument();
  });

  it("[launcher] an empty group says so instead of showing the add-your-first empty state", () => {
    setStoreState({
      connections: [makeConnection({ id: "c-a", groupId: "g-a" })],
      groups: [makeGroup("g-a", "Alpha"), makeGroup("g-empty", "Empty")],
    });
    render(<ConnectionBrowser />);

    act(() => {
      fireEvent.click(railRow(/Empty/));
    });

    expect(connIds()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent(
      /no connections in this group/i,
    );
  });

  it("[launcher] Recent is a rail view, not a footer strip", () => {
    seedTwoGroups();
    render(<ConnectionBrowser />);

    // Not mounted until the rail selects it — the old footer rendered it
    // alongside the list at all times.
    expect(screen.queryByTestId("recent-connections")).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId("rail-recent"));
    });

    expect(screen.getByTestId("recent-connections")).toBeInTheDocument();
    expect(connIds()).toEqual([]);
  });

  it("[launcher] dropping a connection on a rail group moves it into that group", async () => {
    seedTwoGroups();
    render(<ConnectionBrowser />);
    _draggedConnectionId = "c-a";

    const beta = railRow(/Beta/);
    fireEvent.dragOver(beta, { dataTransfer: { dropEffect: "" } });
    expect(beta).toHaveAttribute("data-drop-target", "true");

    await act(async () => {
      fireEvent.drop(beta, { dataTransfer: { getData: () => "" } });
    });

    expect(moveConnectionToGroup).toHaveBeenCalledWith("c-a", "g-b");
    expect(beta).not.toHaveAttribute("data-drop-target");
  });

  it("[launcher] dropping inside a filtered pane does not silently ungroup the connection", async () => {
    seedTwoGroups();
    render(<ConnectionBrowser />);

    act(() => {
      fireEvent.click(railRow(/Alpha/));
    });
    _draggedConnectionId = "c-a";

    await act(async () => {
      fireEvent.drop(screen.getByTestId("connection-list-root"), {
        dataTransfer: { getData: () => "c-a" },
      });
    });

    // The All view still ungroups on a root drop; a group's own pane must not,
    // or a stray drop inside it would eject the row the user is looking at.
    expect(moveConnectionToGroup).not.toHaveBeenCalled();
  });

  it("[launcher] deleting the selected group falls back to All", () => {
    seedTwoGroups();
    render(<ConnectionBrowser />);

    act(() => {
      fireEvent.click(railRow(/Beta/));
    });
    expect(connIds()).toEqual(["c-b"]);

    // Group removed from the All view's header context menu, or by another
    // window's broadcast.
    act(() => {
      useConnectionStore.setState({ groups: [makeGroup("g-a", "Alpha")] });
    });

    expect(screen.getByTestId("rail-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(connIds()).toEqual(["c-root", "c-a"]);
  });

  it("[launcher] rail stays put when there are no groups at all", () => {
    setStoreState({
      connections: [makeConnection({ id: "c-root", groupId: null })],
      groups: [],
    });
    render(<ConnectionBrowser />);

    // All + Recent are two real destinations, so there is nothing to collapse
    // away — Recent has no other home now.
    expect(screen.getByTestId("connection-rail")).toBeInTheDocument();
    expect(screen.queryAllByTestId("rail-group")).toEqual([]);
    expect(screen.getByTestId("rail-recent")).toBeInTheDocument();
  });

  it("[launcher] selection and activation still reach the parent from a filtered pane", async () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    seedTwoGroups();
    render(<ConnectionBrowser onSelect={onSelect} onActivate={onActivate} />);

    act(() => {
      fireEvent.click(railRow(/Alpha/));
    });

    const row = screen.getByTestId("connection-item");
    act(() => {
      fireEvent.click(row);
    });
    expect(onSelect).toHaveBeenCalledWith("c-a");

    await act(async () => {
      fireEvent.doubleClick(row);
    });
    expect(onActivate).toHaveBeenCalledWith("c-a");
    expect(openWorkspaceWindowMock).toHaveBeenCalledWith("c-a");
  });
});
