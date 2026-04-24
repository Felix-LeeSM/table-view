import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  act,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import QuickOpen from "./QuickOpen";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

// Mock lucide-react icons used by QuickOpen
vi.mock("lucide-react", () => ({
  Search: () => <span data-testid="icon-search" />,
  X: () => <span data-testid="icon-x" />,
  Table2: () => <span data-testid="icon-table" />,
  Eye: () => <span data-testid="icon-view" />,
  Code2: () => <span data-testid="icon-function" />,
  Terminal: () => <span data-testid="icon-procedure" />,
}));

function makeConn(id: string, name: string): ConnectionConfig {
  return {
    id,
    name,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "test",
    group_id: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

function setupStores(opts: {
  connections?: ConnectionConfig[];
  active?: string[];
  tables?: Record<string, { name: string; schema: string }[]>;
  views?: Record<string, { name: string; schema: string }[]>;
  functions?: Record<
    string,
    { name: string; schema: string; kind: string; source?: string | null }[]
  >;
}) {
  const conns = opts.connections ?? [];
  const active = new Set(opts.active ?? []);
  const statuses: Record<string, ConnectionStatus> = {};
  for (const c of conns) {
    statuses[c.id] = active.has(c.id)
      ? { type: "connected" }
      : { type: "disconnected" };
  }
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
  });
  useSchemaStore.setState({
    schemas: {},
    tables: Object.fromEntries(
      Object.entries(opts.tables ?? {}).map(([k, v]) => [
        k,
        v.map((t) => ({ ...t, row_count: null })),
      ]),
    ),
    views: Object.fromEntries(
      Object.entries(opts.views ?? {}).map(([k, v]) => [
        k,
        v.map((vw) => ({ ...vw, definition: null })),
      ]),
    ),
    functions: Object.fromEntries(
      Object.entries(opts.functions ?? {}).map(([k, v]) => [
        k,
        v.map((f) => ({
          ...f,
          arguments: null,
          returnType: null,
          language: null,
          source: f.source ?? null,
        })),
      ]),
    ),
    loading: false,
    error: null,
  });
}

describe("QuickOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      loading: false,
      error: null,
    });
    useConnectionStore.setState({ connections: [], activeStatuses: {} });
  });

  it("does not render by default", () => {
    render(<QuickOpen />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders on quick-open event", () => {
    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows hint when no connected databases exist", () => {
    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });
    expect(screen.getByText(/no connected databases/i)).toBeInTheDocument();
  });

  it("populates inventory from connected databases' cached schemas", () => {
    setupStores({
      connections: [makeConn("c1", "Prod"), makeConn("c2", "Dev")],
      active: ["c1", "c2"],
      tables: {
        "c1:public": [{ name: "users", schema: "public" }],
        "c2:public": [{ name: "orders", schema: "public" }],
      },
      views: {
        "c1:public": [{ name: "active_users", schema: "public" }],
      },
      functions: {
        "c2:public": [
          { name: "calc_total", schema: "public", kind: "function" },
          { name: "do_migration", schema: "public", kind: "procedure" },
        ],
      },
    });

    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    // 5 items total: 2 tables + 1 view + 1 function + 1 procedure
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(5);
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("active_users")).toBeInTheDocument();
    expect(screen.getByText("calc_total")).toBeInTheDocument();
    expect(screen.getByText("do_migration")).toBeInTheDocument();
  });

  it("excludes disconnected connections", () => {
    setupStores({
      connections: [makeConn("c1", "Prod"), makeConn("c2", "Idle")],
      active: ["c1"], // c2 is configured but not connected
      tables: {
        "c1:public": [{ name: "users", schema: "public" }],
        "c2:public": [{ name: "secrets", schema: "public" }],
      },
    });

    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.queryByText("secrets")).toBeNull();
  });

  it("filter matches against connection name, schema, and item name", async () => {
    setupStores({
      connections: [makeConn("c1", "Prod"), makeConn("c2", "Dev")],
      active: ["c1", "c2"],
      tables: {
        "c1:public": [{ name: "users", schema: "public" }],
        "c2:public": [{ name: "users", schema: "audit" }],
      },
    });

    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: "audit" } });
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("audit", { exact: false })).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(input, { target: { value: "prod users" } });
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    // Only the c1/public/users row (Prod connection)
    expect(screen.getByText("Prod")).toBeInTheDocument();
  });

  it("Escape closes the modal", () => {
    setupStores({
      connections: [makeConn("c1", "Prod")],
      active: ["c1"],
      tables: { "c1:public": [{ name: "users", schema: "public" }] },
    });
    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Enter on a table dispatches navigate-table with objectKind=table", async () => {
    const handler = vi.fn();
    window.addEventListener("navigate-table", handler);

    setupStores({
      connections: [makeConn("c1", "Prod")],
      active: ["c1"],
      tables: { "c1:public": [{ name: "users", schema: "public" }] },
    });
    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          connectionId: "c1",
          schema: "public",
          table: "users",
          objectKind: "table",
        },
      }),
    );
    window.removeEventListener("navigate-table", handler);
  });

  it("Enter on a view dispatches navigate-table with objectKind=view", async () => {
    const handler = vi.fn();
    window.addEventListener("navigate-table", handler);

    setupStores({
      connections: [makeConn("c1", "Prod")],
      active: ["c1"],
      views: {
        "c1:public": [{ name: "active_users", schema: "public" }],
      },
    });
    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ objectKind: "view" }),
      }),
    );
    window.removeEventListener("navigate-table", handler);
  });

  it("Enter on a function dispatches quickopen-function with source", async () => {
    const handler = vi.fn();
    window.addEventListener("quickopen-function", handler);

    setupStores({
      connections: [makeConn("c1", "Prod")],
      active: ["c1"],
      functions: {
        "c1:public": [
          {
            name: "calc",
            schema: "public",
            kind: "function",
            source: "BEGIN RETURN 0; END",
          },
        ],
      },
    });
    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          connectionId: "c1",
          source: "BEGIN RETURN 0; END",
        }),
      }),
    );
    window.removeEventListener("quickopen-function", handler);
  });

  it("ArrowDown / ArrowUp move active row, Enter activates it", async () => {
    const handler = vi.fn();
    window.addEventListener("navigate-table", handler);

    setupStores({
      connections: [makeConn("c1", "Prod")],
      active: ["c1"],
      tables: {
        "c1:public": [
          { name: "alpha", schema: "public" },
          { name: "bravo", schema: "public" },
        ],
      },
    });
    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });

    const second = screen.getByRole("option", { name: /bravo/ });
    expect(second).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ table: "bravo" }),
      }),
    );
    window.removeEventListener("navigate-table", handler);
  });

  it("clicking a row dispatches and closes modal", async () => {
    const handler = vi.fn();
    window.addEventListener("navigate-table", handler);

    setupStores({
      connections: [makeConn("c1", "Prod")],
      active: ["c1"],
      tables: { "c1:public": [{ name: "users", schema: "public" }] },
    });
    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const option = screen.getByRole("option", { name: /users/ });
    await act(async () => {
      option.click();
    });

    expect(handler).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    window.removeEventListener("navigate-table", handler);
  });
});
