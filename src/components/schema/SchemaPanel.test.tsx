import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SchemaPanel from "./SchemaPanel";
import { useConnectionStore } from "@stores/connectionStore";
import { normalizeActiveStatuses } from "@lib/wireCamelCase";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

vi.mock("./SchemaTree", () => ({
  default: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="schema-tree">{connectionId}</div>
  ),
}));

vi.mock("./DocumentDatabaseTree", () => ({
  default: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="document-database-tree">{connectionId}</div>
  ),
}));

function makeConn(id: string): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
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

  it("shows 'connect now' link in disconnected state and calls connectToDatabase on click", () => {
    const connectToDatabase = vi.fn();
    useConnectionStore.setState((s) => ({ ...s, connectToDatabase }));
    setupStore({ connections: [makeConn("c1")] });
    render(<SchemaPanel selectedId="c1" />);

    const btn = screen.getByRole("button", { name: /connect now/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(connectToDatabase).toHaveBeenCalledWith("c1");
  });

  it("hides 'connect now' link while connecting", () => {
    setupStore({ connections: [makeConn("c1")], connecting: ["c1"] });
    render(<SchemaPanel selectedId="c1" />);
    expect(screen.queryByRole("button", { name: /connect now/i })).toBeNull();
  });

  it("hides 'connect now' link when connection errored", () => {
    setupStore({ connections: [makeConn("c1")], errored: { c1: "timeout" } });
    render(<SchemaPanel selectedId="c1" />);
    expect(screen.queryByRole("button", { name: /connect now/i })).toBeNull();
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

  // Reason: review #1490 B1 — this role="status" area renders
  // status.message raw; a credential echo persisted by a pre-fix session
  // must be masked by the hydrate ingress (normalizeConnectionStatus)
  // before it can paint here (2026-07-11)
  it("renders a hydrated credential-echo error masked, never the secret", () => {
    setupStore({ connections: [makeConn("c1")] });
    useConnectionStore.setState({
      activeStatuses: normalizeActiveStatuses({
        c1: {
          type: "error",
          message: "FATAL: postgres://app:S3cretPw1@db:5432/x pwd='S3cretPw1'",
        },
      }),
    });
    render(<SchemaPanel selectedId="c1" />);
    expect(screen.queryByText(/S3cretPw1/)).toBeNull();
    expect(
      screen.getByText(/postgres:\/\/app:\*\*\*@db:5432\/x pwd=\*\*\*/),
    ).toBeInTheDocument();
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

  it("renders DocumentDatabaseTree when connection paradigm is document", () => {
    const mongoConn: ConnectionConfig = {
      ...makeConn("m1"),
      dbType: "mongodb",
      paradigm: "document",
    };
    setupStore({ connections: [mongoConn], active: ["m1"] });
    render(<SchemaPanel selectedId="m1" />);
    expect(screen.getByTestId("document-database-tree")).toHaveTextContent(
      "m1",
    );
    // SchemaTree (RDB) must NOT appear for a document connection.
    expect(screen.queryByTestId("schema-tree")).toBeNull();
  });
});
