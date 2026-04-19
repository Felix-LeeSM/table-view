import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ConnectionRail from "./ConnectionRail";
import { useConnectionStore } from "../stores/connectionStore";
import type {
  ConnectionConfig,
  ConnectionStatus,
  EnvironmentTag,
} from "../types/connection";

vi.mock("./ConnectionDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="connection-dialog">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

const connectMock = vi.fn(() => Promise.resolve());
const disconnectMock = vi.fn(() => Promise.resolve());
const removeMock = vi.fn(() => Promise.resolve());

function makeConn(
  id: string,
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
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
    ...overrides,
  };
}

function setupStore(opts: {
  connections?: ConnectionConfig[];
  active?: string[];
  errored?: Record<string, string>;
}) {
  const conns = opts.connections ?? [];
  const active = new Set(opts.active ?? []);
  const errored = opts.errored ?? {};
  const statuses: Record<string, ConnectionStatus> = {};
  for (const c of conns) {
    if (errored[c.id]) {
      statuses[c.id] = { type: "error", message: errored[c.id]! };
    } else {
      statuses[c.id] = active.has(c.id)
        ? { type: "connected" }
        : { type: "disconnected" };
    }
  }
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
    connectToDatabase: connectMock,
    disconnectFromDatabase: disconnectMock,
    removeConnection: removeMock,
  });
}

describe("ConnectionRail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore({});
  });

  it("renders a button per connection with aria-label", () => {
    setupStore({
      connections: [makeConn("c1"), makeConn("c2")],
    });
    render(<ConnectionRail selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByLabelText(/c1 DB/)).toBeInTheDocument();
    expect(screen.getByLabelText(/c2 DB/)).toBeInTheDocument();
  });

  it("renders a + button to create a new connection", () => {
    render(<ConnectionRail selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByLabelText("New Connection")).toBeInTheDocument();
  });

  it("clicking + invokes onNewConnection prop", () => {
    const onNew = vi.fn();
    render(
      <ConnectionRail
        selectedId={null}
        onSelect={vi.fn()}
        onNewConnection={onNew}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByLabelText("New Connection"));
    });
    expect(onNew).toHaveBeenCalled();
  });

  it("opens internal dialog when no onNewConnection handler is provided", () => {
    render(<ConnectionRail selectedId={null} onSelect={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByLabelText("New Connection"));
    });
    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
  });

  it("clicking a connection invokes onSelect", () => {
    const onSelect = vi.fn();
    setupStore({ connections: [makeConn("c1")] });
    render(<ConnectionRail selectedId={null} onSelect={onSelect} />);
    act(() => {
      fireEvent.click(screen.getByLabelText(/c1 DB/));
    });
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("highlights the selected connection (aria-pressed)", () => {
    setupStore({ connections: [makeConn("c1"), makeConn("c2")] });
    render(<ConnectionRail selectedId="c2" onSelect={vi.fn()} />);
    expect(screen.getByLabelText(/c1 DB/)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText(/c2 DB/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("double-clicking a disconnected connection calls connectToDatabase + onSelect", async () => {
    const onSelect = vi.fn();
    setupStore({ connections: [makeConn("c1")] });
    render(<ConnectionRail selectedId={null} onSelect={onSelect} />);
    await act(async () => {
      fireEvent.doubleClick(screen.getByLabelText(/c1 DB/));
    });
    expect(connectMock).toHaveBeenCalledWith("c1");
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("double-clicking a connected connection disconnects", async () => {
    setupStore({ connections: [makeConn("c1")], active: ["c1"] });
    render(<ConnectionRail selectedId="c1" onSelect={vi.fn()} />);
    await act(async () => {
      fireEvent.doubleClick(screen.getByLabelText(/c1 DB/));
    });
    expect(disconnectMock).toHaveBeenCalledWith("c1");
  });

  it("right-click opens context menu with Connect/Edit/Delete", () => {
    const onSelect = vi.fn();
    setupStore({ connections: [makeConn("c1")] });
    render(<ConnectionRail selectedId={null} onSelect={onSelect} />);
    act(() => {
      fireEvent.contextMenu(screen.getByLabelText(/c1 DB/), {
        clientX: 50,
        clientY: 60,
      });
    });
    expect(onSelect).toHaveBeenCalledWith("c1");
    expect(screen.getByText("Connect")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("context menu shows Disconnect when connection is connected", () => {
    setupStore({ connections: [makeConn("c1")], active: ["c1"] });
    render(<ConnectionRail selectedId="c1" onSelect={vi.fn()} />);
    act(() => {
      fireEvent.contextMenu(screen.getByLabelText(/c1 DB/), {
        clientX: 50,
        clientY: 60,
      });
    });
    expect(screen.getByText("Disconnect")).toBeInTheDocument();
  });

  it("Edit menu item opens ConnectionDialog", () => {
    setupStore({ connections: [makeConn("c1")] });
    render(<ConnectionRail selectedId="c1" onSelect={vi.fn()} />);
    act(() => {
      fireEvent.contextMenu(screen.getByLabelText(/c1 DB/), {
        clientX: 50,
        clientY: 60,
      });
    });
    act(() => {
      fireEvent.click(screen.getByText("Edit"));
    });
    expect(screen.getByTestId("connection-dialog")).toBeInTheDocument();
  });

  it("Delete menu item calls removeConnection", async () => {
    setupStore({ connections: [makeConn("c1")] });
    render(<ConnectionRail selectedId="c1" onSelect={vi.fn()} />);
    act(() => {
      fireEvent.contextMenu(screen.getByLabelText(/c1 DB/), {
        clientX: 50,
        clientY: 60,
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Delete"));
    });
    expect(removeMock).toHaveBeenCalledWith("c1");
  });

  it("renders environment badge for connections with environment", () => {
    setupStore({
      connections: [
        makeConn("c1", { environment: "production" as EnvironmentTag }),
      ],
    });
    const { container } = render(
      <ConnectionRail selectedId="c1" onSelect={vi.fn()} />,
    );
    // Environment badge is a tiny circle styled with the env color
    const badges = container.querySelectorAll(
      "[aria-hidden='true'].rounded-full",
    );
    // 1 status dot + 1 env badge
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("dimmed appearance for disconnected connections", () => {
    setupStore({ connections: [makeConn("c1")] });
    render(<ConnectionRail selectedId="c1" onSelect={vi.fn()} />);
    const btn = screen.getByLabelText(/c1 DB/);
    expect(btn.className).toMatch(/grayscale/);
  });

  it("renders an empty rail when there are no connections (only the + button)", () => {
    setupStore({});
    render(<ConnectionRail selectedId={null} onSelect={vi.fn()} />);
    expect(screen.queryByLabelText(/c1 DB/)).toBeNull();
    expect(screen.getByLabelText("New Connection")).toBeInTheDocument();
  });
});
