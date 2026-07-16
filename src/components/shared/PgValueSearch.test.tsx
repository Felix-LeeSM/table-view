import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  act,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import PgValueSearch from "./PgValueSearch";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

vi.mock("lucide-react", () => ({
  Search: () => <span data-testid="icon-search" />,
  X: () => <span data-testid="icon-x" />,
  Table2: () => <span data-testid="icon-table" />,
}));

let mockConnId: string | null = "c1";
vi.mock("@hooks/useCurrentWindowConnectionId", () => ({
  useCurrentWindowConnectionId: () => mockConnId,
}));

const mockSearch = vi.fn();
const mockCancel = vi.fn().mockResolvedValue("cancelled");
vi.mock("@lib/tauri", () => ({
  pgSearchValues: (...args: unknown[]) => mockSearch(...args),
  cancelQuery: (...args: unknown[]) => mockCancel(...args),
}));

// `@lib/quickOpenIntent` is an own util, not a boundary — `dispatchLocalIntent`
// is a pure `window.dispatchEvent` wrapper. Observe the real `navigate-table`
// event instead of mocking it.

vi.mock("@lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function makeConn(
  id: string,
  dbType: ConnectionConfig["dbType"] = "postgresql",
): ConnectionConfig {
  return {
    id,
    name: id,
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

function setupStore(dbType: ConnectionConfig["dbType"] = "postgresql") {
  const conn = makeConn("c1", dbType);
  const status: ConnectionStatus = { type: "connected", activeDb: "db1" };
  useConnectionStore.setState({
    connections: [conn],
    activeStatuses: { c1: status },
  });
  useSchemaStore.setState({
    schemas: { c1: { db1: [{ name: "public" }, { name: "app" }] } },
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
  });
}

function open() {
  act(() => {
    window.dispatchEvent(new CustomEvent("pg-value-search"));
  });
}

describe("PgValueSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnId = "c1";
    useConnectionStore.setState({ connections: [], activeStatuses: {} });
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      loading: false,
      error: null,
    });
  });

  it("does not render by default", () => {
    render(<PgValueSearch />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a PostgreSQL-only note for a non-PG connection", () => {
    setupStore("mysql");
    render(<PgValueSearch />);
    open();
    expect(screen.getByText(/available for PostgreSQL/i)).toBeInTheDocument();
    // Input is disabled off PostgreSQL.
    expect(screen.getByRole("searchbox")).toBeDisabled();
  });

  it("runs a search and renders matched table/column/value", async () => {
    setupStore("postgresql");
    mockSearch.mockResolvedValue({
      matches: [
        { schema: "public", table: "users", column: "email", value: "a@b.co" },
      ],
      truncated: false,
      scannedTables: 3,
    });
    render(<PgValueSearch />);
    open();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "a@b" },
    });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("public.users")).toBeInTheDocument();
    });
    expect(screen.getByText("· email")).toBeInTheDocument();
    expect(screen.getByText("a@b.co")).toBeInTheDocument();
    // Default scope = all user schemas of the active db.
    expect(mockSearch).toHaveBeenCalledWith(
      "c1",
      ["public", "app"],
      "a@b",
      expect.any(String),
      "db1",
    );
  });

  it("clicking a match fires the real navigate-table event", async () => {
    setupStore("postgresql");
    mockSearch.mockResolvedValue({
      matches: [
        { schema: "public", table: "users", column: "email", value: "x" },
      ],
      truncated: false,
      scannedTables: 1,
    });
    const navSpy = vi.fn();
    window.addEventListener("navigate-table", navSpy);
    try {
      render(<PgValueSearch />);
      open();
      fireEvent.change(screen.getByRole("searchbox"), {
        target: { value: "x" },
      });
      fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
      const match = await screen.findByText("public.users");

      fireEvent.click(match);
      expect(navSpy).toHaveBeenCalledTimes(1);
      const detail = (navSpy.mock.calls[0]![0] as CustomEvent).detail;
      expect(detail).toMatchObject({
        connectionId: "c1",
        schema: "public",
        table: "users",
        objectKind: "table",
      });
    } finally {
      window.removeEventListener("navigate-table", navSpy);
    }
  });

  it("renders an error state when the search rejects", async () => {
    setupStore("postgresql");
    mockSearch.mockRejectedValue(new Error("relation does not exist"));
    render(<PgValueSearch />);
    open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "x" } });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("relation does not exist");
  });

  it("shows a no-results message when nothing matches", async () => {
    setupStore("postgresql");
    mockSearch.mockResolvedValue({
      matches: [],
      truncated: false,
      scannedTables: 2,
    });
    render(<PgValueSearch />);
    open();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzz" },
    });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });

    expect(await screen.findByText(/No matches found/i)).toBeInTheDocument();
  });

  it("cancel button aborts the in-flight scan via cancelQuery", async () => {
    setupStore("postgresql");
    // Keep the search pending so the Cancel button is visible.
    let resolveSearch: (v: unknown) => void = () => {};
    mockSearch.mockReturnValue(
      new Promise((r) => {
        resolveSearch = r;
      }),
    );
    render(<PgValueSearch />);
    open();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "term" },
    });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });

    const cancelBtn = await screen.findByText("Cancel");
    fireEvent.click(cancelBtn);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    resolveSearch({ matches: [], truncated: false, scannedTables: 0 });
  });
});
