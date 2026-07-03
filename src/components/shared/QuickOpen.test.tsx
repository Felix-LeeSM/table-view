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
  Folder: () => <span data-testid="icon-schema" />,
}));

// The window's sidebar connection scopes schema results. Control it per test.
let mockSidebarConnId: string | null = null;
vi.mock("@hooks/useCurrentWindowConnectionId", () => ({
  useCurrentWindowConnectionId: () => mockSidebarConnId,
}));

// #1235 — cross-connection jump reuses the per-conn window-focus command and a
// Tauri broadcast. Mock both lib boundaries (Tauri IPC / event).
const mockOpenWorkspaceWindow = vi.fn().mockResolvedValue(undefined);
vi.mock("@lib/tauri/window", () => ({
  openWorkspaceWindow: (...args: unknown[]) => mockOpenWorkspaceWindow(...args),
}));

const mockEmit = vi.fn().mockResolvedValue(undefined);
// Capture the quick-open intent listener so tests can drive inbound events.
const mockListenState: { cb?: (e: { payload: unknown }) => void } = {};
vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  listen: (channel: string, cb: (e: { payload: unknown }) => void) => {
    if (channel === "quick-open:intent") mockListenState.cb = cb;
    return Promise.resolve(() => {});
  },
}));

function makeConn(
  id: string,
  name: string,
  dbType: ConnectionConfig["dbType"] = "postgresql",
): ConnectionConfig {
  return {
    id,
    name,
    dbType,
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

// Sprint 263 — `tables` / `views` / `functions` are nested by `(connId, db,
// schema)`. The test helper still accepts the legacy flat key shape
// (`"connId:schema"`) and translates internally to nested form so callsites
// stay terse, defaulting the db dimension to `db1`.
function expandFlat<V>(
  flat: Record<string, V[]>,
  db: string,
): Record<string, Record<string, Record<string, V[]>>> {
  const out: Record<string, Record<string, Record<string, V[]>>> = {};
  for (const [key, list] of Object.entries(flat)) {
    const [connId, schema] = key.split(":");
    if (!connId || !schema) continue;
    out[connId] = out[connId] ?? {};
    out[connId][db] = out[connId][db] ?? {};
    out[connId][db][schema] = list;
  }
  return out;
}

function setupStores(opts: {
  connections?: ConnectionConfig[];
  active?: string[];
  activeDb?: string;
  schemas?: Record<string, { name: string }[]>;
  tables?: Record<string, { name: string; schema: string }[]>;
  views?: Record<string, { name: string; schema: string }[]>;
  functions?: Record<
    string,
    { name: string; schema: string; kind: string; source?: string | null }[]
  >;
}) {
  const conns = opts.connections ?? [];
  const active = new Set(opts.active ?? []);
  const db = opts.activeDb ?? "db1";
  const statuses: Record<string, ConnectionStatus> = {};
  for (const c of conns) {
    statuses[c.id] = active.has(c.id)
      ? { type: "connected", activeDb: db }
      : { type: "disconnected" };
  }
  // `schemas` is nested `(connId, db) → SchemaInfo[]`.
  const schemas: Record<string, Record<string, { name: string }[]>> = {};
  for (const [connId, list] of Object.entries(opts.schemas ?? {})) {
    schemas[connId] = { [db]: list };
  }
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
  });
  useSchemaStore.setState({
    schemas,
    tables: expandFlat(
      Object.fromEntries(
        Object.entries(opts.tables ?? {}).map(([k, v]) => [
          k,
          v.map((t) => ({ ...t, row_count: null })),
        ]),
      ),
      db,
    ),
    views: expandFlat(
      Object.fromEntries(
        Object.entries(opts.views ?? {}).map(([k, v]) => [
          k,
          v.map((vw) => ({ ...vw, definition: null })),
        ]),
      ),
      db,
    ),
    functions: expandFlat(
      Object.fromEntries(
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
      db,
    ),
    loading: false,
    error: null,
  });
}

describe("QuickOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSidebarConnId = null;
    mockListenState.cb = undefined;
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

  it("surfaces schemas as first-class results and reveals on select (with-schema)", async () => {
    mockSidebarConnId = "c1"; // this window's sidebar renders c1
    const reveal = vi.fn();
    window.addEventListener("reveal-schema", reveal);

    setupStores({
      connections: [makeConn("c1", "Prod")], // postgresql → with-schema
      active: ["c1"],
      schemas: { c1: [{ name: "sales" }, { name: "public" }] },
      tables: { "c1:sales": [{ name: "orders", schema: "sales" }] },
    });

    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "sales" } });
    });

    // Exact schema-name match ranks above the table whose schema is "sales".
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("sales");

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(reveal).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { connectionId: "c1", schema: "sales" },
      }),
    );
    window.removeEventListener("reveal-schema", reveal);
  });

  it("does not surface schema results for flat (SQLite) connections", async () => {
    mockSidebarConnId = "s1"; // sidebar renders s1, so scope is satisfied
    setupStores({
      connections: [makeConn("s1", "Local", "sqlite")], // flat
      active: ["s1"],
      schemas: { s1: [{ name: "main" }] },
      tables: { "s1:main": [{ name: "orders", schema: "main" }] },
    });

    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    // Even as the sidebar connection, a flat tree has no focusable schema row —
    // the shape guard (not the scope) excludes it. Only the table is a result.
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("degrades `.` queries to plain matching on flat connections", async () => {
    setupStores({
      connections: [makeConn("s1", "Local", "sqlite")], // flat
      active: ["s1"],
      tables: { "s1:main": [{ name: "orders", schema: "main" }] },
    });

    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);
    // "main.ord" must NOT schema-scope on a flat shape — it degrades to a plain
    // literal match, which nothing contains, so the list is empty (not an error).
    await act(async () => {
      fireEvent.change(input, { target: { value: "main.ord" } });
    });
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    // A dotless query still finds the table by name.
    await act(async () => {
      fireEvent.change(input, { target: { value: "ord" } });
    });
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("does not surface schema results for no-schema (MySQL) connections", async () => {
    mockSidebarConnId = "m1"; // sidebar renders m1, so scope is satisfied
    setupStores({
      connections: [makeConn("m1", "MyApp", "mysql")], // no-schema
      active: ["m1"],
      schemas: { m1: [{ name: "appdb" }] },
      tables: { "m1:appdb": [{ name: "orders", schema: "appdb" }] },
    });

    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    // MySQL conflates schema with database and renders no focusable schema row,
    // so "appdb" is not offered as a first-class result — only the table is.
    expect(screen.queryByTestId("icon-schema")).toBeNull();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("scopes `.` to the database grouping on no-schema (MySQL) connections", async () => {
    setupStores({
      connections: [makeConn("m1", "MyApp", "mysql")], // no-schema
      active: ["m1"],
      tables: { "m1:appdb": [{ name: "orders", schema: "appdb" }] },
    });

    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);
    // no-schema still schema-scopes `.` — the grouping is the database name.
    await act(async () => {
      fireEvent.change(input, { target: { value: "appdb.ord" } });
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("orders")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(input, { target: { value: "other.ord" } });
    });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
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
    mockSidebarConnId = "c1"; // same-connection pick → local dispatch, no jump
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
    mockSidebarConnId = "c1"; // same-connection pick → local dispatch, no jump
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
    mockSidebarConnId = "c1"; // same-connection pick → local dispatch, no jump
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
    mockSidebarConnId = "c1"; // same-connection pick → local dispatch, no jump
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
    mockSidebarConnId = "c1"; // same-connection pick → local dispatch, no jump
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

  // #1235 — cross-connection jump + unified global scope.
  it("surfaces schema results for every with-schema connection (global scope)", async () => {
    mockSidebarConnId = "c1";
    setupStores({
      connections: [makeConn("c1", "Prod"), makeConn("c2", "Dev")],
      active: ["c1", "c2"],
      schemas: { c1: [{ name: "sales" }], c2: [{ name: "sales" }] },
    });

    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "sales" } });
    });

    // Both connections' "sales" schema are now first-class results.
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("cross-connection selection focuses the target window and forwards the intent", async () => {
    mockSidebarConnId = "c1"; // this window renders c1; the pick targets c2
    const local = vi.fn();
    window.addEventListener("navigate-table", local);
    setupStores({
      connections: [makeConn("c1", "Prod"), makeConn("c2", "Dev")],
      active: ["c1", "c2"],
      tables: { "c2:public": [{ name: "orders", schema: "public" }] },
    });

    render(<QuickOpen />);
    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const input = screen.getByPlaceholderText(/search tables/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "orders" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() =>
      expect(mockOpenWorkspaceWindow).toHaveBeenCalledWith("c2"),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      "quick-open:intent",
      expect.objectContaining({
        kind: "table",
        connectionId: "c2",
        table: "orders",
      }),
    );
    // A cross-connection pick must NOT also fire the local event in this window.
    expect(local).not.toHaveBeenCalled();
    window.removeEventListener("navigate-table", local);
  });

  it("re-dispatches an inbound intent for this window's connection as a local event", async () => {
    mockSidebarConnId = "c2";
    const handler = vi.fn();
    window.addEventListener("navigate-table", handler);

    render(<QuickOpen />);
    await waitFor(() => expect(mockListenState.cb).toBeDefined());

    act(() => {
      mockListenState.cb!({
        payload: {
          kind: "table",
          connectionId: "c2",
          schema: "public",
          table: "orders",
        },
      });
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          connectionId: "c2",
          schema: "public",
          table: "orders",
          objectKind: "table",
        },
      }),
    );
    window.removeEventListener("navigate-table", handler);
  });
});
