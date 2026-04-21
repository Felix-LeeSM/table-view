import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SchemaPanel from "./SchemaPanel";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

vi.mock("./SchemaTree", () => ({
  default: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="schema-tree">{connectionId}</div>
  ),
}));

function makeConn(id: string): ConnectionConfig {
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

function setupStore(opts: {
  connections?: ConnectionConfig[];
  active?: string[];
  errored?: Record<string, string>;
  connecting?: string[];
}) {
  const conns = opts.connections ?? [];
  const active = new Set(opts.active ?? []);
  const connecting = new Set(opts.connecting ?? []);
  const errored = opts.errored ?? {};
  const statuses: Record<string, ConnectionStatus> = {};
  for (const c of conns) {
    if (errored[c.id]) {
      statuses[c.id] = { type: "error", message: errored[c.id]! };
    } else if (connecting.has(c.id)) {
      statuses[c.id] = { type: "connecting" };
    } else if (active.has(c.id)) {
      statuses[c.id] = { type: "connected" };
    } else {
      statuses[c.id] = { type: "disconnected" };
    }
  }
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
  });
}

describe("SchemaPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore({});
  });

  it("shows the empty-state when no connections exist", () => {
    render(<SchemaPanel selectedId={null} />);
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("schema-tree")).toBeNull();
  });

  it("prompts to select a connection when none is selected but some exist", () => {
    setupStore({ connections: [makeConn("c1")] });
    render(<SchemaPanel selectedId={null} />);
    expect(screen.getByText(/select a connection/i)).toBeInTheDocument();
    expect(screen.queryByTestId("schema-tree")).toBeNull();
  });

  it("prompts to double-click when selected connection is disconnected", () => {
    setupStore({ connections: [makeConn("c1")] });
    render(<SchemaPanel selectedId="c1" />);
    expect(screen.getByText("c1 DB")).toBeInTheDocument();
    expect(
      screen.getByText(/double-click in the connections tab/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("schema-tree")).toBeNull();
  });

  it("shows Connect button in disconnected state and calls connectToDatabase on click", () => {
    const connectToDatabase = vi.fn();
    useConnectionStore.setState((s) => ({ ...s, connectToDatabase }));
    setupStore({ connections: [makeConn("c1")] });
    render(<SchemaPanel selectedId="c1" />);

    const btn = screen.getByRole("button", { name: /^connect$/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(connectToDatabase).toHaveBeenCalledWith("c1");
  });

  it("hides Connect button while connecting", () => {
    setupStore({ connections: [makeConn("c1")], connecting: ["c1"] });
    render(<SchemaPanel selectedId="c1" />);
    expect(screen.queryByRole("button", { name: /^connect$/i })).toBeNull();
  });

  it("hides Connect button when connection errored", () => {
    setupStore({ connections: [makeConn("c1")], errored: { c1: "timeout" } });
    render(<SchemaPanel selectedId="c1" />);
    expect(screen.queryByRole("button", { name: /^connect$/i })).toBeNull();
  });

  it("shows 'Connecting…' message during the connecting state", () => {
    setupStore({ connections: [makeConn("c1")], connecting: ["c1"] });
    render(<SchemaPanel selectedId="c1" />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it("shows error message when connection failed", () => {
    setupStore({
      connections: [makeConn("c1")],
      errored: { c1: "Auth failed" },
    });
    render(<SchemaPanel selectedId="c1" />);
    expect(screen.getByText(/auth failed/i)).toBeInTheDocument();
  });

  it("renders SchemaTree when the selected connection is connected", () => {
    setupStore({ connections: [makeConn("c1")], active: ["c1"] });
    render(<SchemaPanel selectedId="c1" />);
    expect(screen.getByTestId("schema-tree")).toHaveTextContent("c1");
  });

  it("renders nothing when selectedId points at an unknown connection", () => {
    setupStore({ connections: [makeConn("c1")] });
    const { container } = render(<SchemaPanel selectedId="ghost" />);
    expect(container.textContent).toBe("");
  });
});
