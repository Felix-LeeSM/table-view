import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";

// Hoisted mocks must precede the imports of the modules under test.
const listDatabasesMock = vi.fn();
const switchActiveDbMock = vi.fn();

vi.mock("@/lib/api/listDatabases", () => ({
  listDatabases: (...args: unknown[]) => listDatabasesMock(...args),
}));

vi.mock("@/lib/api/switchActiveDb", () => ({
  switchActiveDb: (...args: unknown[]) => switchActiveDbMock(...args),
}));

import DbSwitcher from "./DbSwitcher";
import { useTabStore, type TableTab, type QueryTab } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import type {
  ConnectionConfig,
  ConnectionStatus,
  Paradigm,
} from "@/types/connection";
import { useToastStore } from "@/lib/toast";

function makeTableTab(overrides: Partial<TableTab> = {}): TableTab {
  return {
    type: "table",
    id: "tab-1",
    title: "users",
    connectionId: "c1",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  };
}

function makeQueryTab(overrides: Partial<QueryTab> = {}): QueryTab {
  return {
    type: "query",
    id: "query-1",
    title: "Query 1",
    connectionId: "c1",
    closable: true,
    sql: "",
    queryState: { status: "idle" },
    paradigm: "rdb",
    queryMode: "sql",
    ...overrides,
  };
}

function makeConnection(
  overrides: Partial<ConnectionConfig> & { paradigm: Paradigm },
): ConnectionConfig {
  return {
    id: "c1",
    name: "Local PG",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    database: "postgres",
    group_id: null,
    color: null,
    has_password: false,
    ...overrides,
  };
}

function setStores(options: {
  paradigm: Paradigm;
  connected: boolean;
  tab?: TableTab | QueryTab;
  dbType?: ConnectionConfig["db_type"];
  /** Sprint 130 — seed the connected status with a specific activeDb. */
  activeDb?: string;
}) {
  const tab =
    options.tab ??
    (options.paradigm === "document"
      ? makeQueryTab({
          paradigm: "document",
          queryMode: "find",
          database: "analytics",
          collection: "events",
        })
      : makeTableTab());
  const conn = makeConnection({
    paradigm: options.paradigm,
    db_type:
      options.dbType ??
      (options.paradigm === "document" ? "mongodb" : "postgresql"),
  });
  useTabStore.setState({ tabs: [tab], activeTabId: tab.id });
  const status: ConnectionStatus = options.connected
    ? options.activeDb
      ? { type: "connected", activeDb: options.activeDb }
      : { type: "connected" }
    : { type: "disconnected" };
  useConnectionStore.setState({
    connections: [conn],
    activeStatuses: { [conn.id]: status },
  });
}

describe("DbSwitcher", () => {
  beforeEach(() => {
    listDatabasesMock.mockReset();
    switchActiveDbMock.mockReset();
    useTabStore.setState({ tabs: [], activeTabId: null });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
    });
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      tableColumnsCache: {},
    });
    useToastStore.setState({ toasts: [] });
  });

  // -- Read-only chrome (S127 invariants preserved for non-eligible cases) --

  it("shows the em-dash sentinel when no tab is active (read-only)", () => {
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger.textContent).toMatch(/—/);
  });

  it("is aria-disabled and not in the keyboard tab order when no tab is active", () => {
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAttribute("tabindex", "-1");
  });

  it("exposes the read-only S130 tooltip text via title", () => {
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger).toHaveAttribute(
      "title",
      "Switching DBs lands in sprint 130",
    );
  });

  it("stays read-only when the active connection is disconnected (rdb)", () => {
    setStores({ paradigm: "rdb", connected: false });
    render(<DbSwitcher />);
    expect(
      screen.getByRole("button", { name: /active database \(read-only\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /active database switcher/i }),
    ).not.toBeInTheDocument();
  });

  it("stays read-only for kv paradigm even when connected", () => {
    setStores({
      paradigm: "kv",
      connected: true,
      dbType: "redis",
      tab: makeQueryTab({ paradigm: "kv" }),
    });
    render(<DbSwitcher />);
    expect(
      screen.getByRole("button", { name: /active database \(read-only\)/i }),
    ).toBeInTheDocument();
  });

  it("stays read-only for search paradigm even when connected", () => {
    setStores({
      paradigm: "search",
      connected: true,
      dbType: "mongodb",
      tab: makeQueryTab({ paradigm: "search" }),
    });
    render(<DbSwitcher />);
    expect(
      screen.getByRole("button", { name: /active database \(read-only\)/i }),
    ).toBeInTheDocument();
  });

  // -- S128 active behavior (rdb + connected) --

  it("renders an active switcher when the active tab paradigm is rdb and connected", () => {
    setStores({ paradigm: "rdb", connected: true });
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(trigger).not.toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("renders an active switcher when the active tab paradigm is document and connected", () => {
    setStores({ paradigm: "document", connected: true });
    render(<DbSwitcher />);
    expect(
      screen.getByRole("button", { name: /active database switcher/i }),
    ).toBeInTheDocument();
  });

  it("fetches the database list on click and renders the popover items", async () => {
    setStores({ paradigm: "rdb", connected: true });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "postgres" },
      { name: "warehouse" },
    ]);
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(listDatabasesMock).toHaveBeenCalledWith("c1");
    });

    const listbox = await screen.findByRole("listbox", {
      name: /available databases/i,
    });
    const options = within(listbox).getAllByRole("option");
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      "postgres",
      "warehouse",
    ]);
  });

  it("shows the loading state while the fetch is in flight", async () => {
    setStores({ paradigm: "rdb", connected: true });
    let resolveFetch: ((value: { name: string }[]) => void) | null = null;
    listDatabasesMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByText(/loading databases/i)).toBeInTheDocument();

    await act(async () => {
      resolveFetch?.([{ name: "postgres" }]);
    });
    await waitFor(() => {
      expect(trigger).not.toHaveAttribute("aria-busy", "true");
    });
  });

  it("renders an inline error when the fetch fails", async () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    listDatabasesMock.mockRejectedValueOnce(new Error("permission denied"));
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    fireEvent.click(trigger);

    expect(await screen.findByTestId("db-switcher-error")).toHaveTextContent(
      /permission denied/i,
    );
    // The trigger label is preserved so the toolbar layout doesn't shift.
    expect(trigger.textContent).toMatch(/postgres/);
  });

  it("renders a 'no databases' placeholder when the result is empty", async () => {
    setStores({ paradigm: "rdb", connected: true });
    listDatabasesMock.mockResolvedValueOnce([]);
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    expect(
      await screen.findByText(/no databases available/i),
    ).toBeInTheDocument();
  });

  // -- S130 switch dispatch --

  it("dispatches switch_active_db when an entry is selected", async () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "postgres" },
      { name: "warehouse" },
    ]);
    switchActiveDbMock.mockResolvedValueOnce(undefined);
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: /available databases/i,
    });
    const options = within(listbox).getAllByRole("option");
    // Pick the non-active one (warehouse) so the dispatch path runs.
    const warehouse = options.find((o) => o.textContent?.includes("warehouse"));
    expect(warehouse).toBeDefined();
    await act(async () => {
      fireEvent.click(warehouse!);
    });
    expect(switchActiveDbMock).toHaveBeenCalledWith("c1", "warehouse");
  });

  it("updates connectionStore.activeDb after a successful switch", async () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "postgres" },
      { name: "warehouse" },
    ]);
    switchActiveDbMock.mockResolvedValueOnce(undefined);
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: /available databases/i,
    });
    const warehouse = within(listbox)
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("warehouse"))!;
    await act(async () => {
      fireEvent.click(warehouse);
    });
    const status = useConnectionStore.getState().activeStatuses["c1"];
    expect(status?.type).toBe("connected");
    if (status?.type === "connected") {
      expect(status.activeDb).toBe("warehouse");
    }
  });

  it("clears the schema cache for the connection after a successful switch", async () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    // Seed a couple of schema entries so we can verify they're cleared.
    useSchemaStore.setState({
      schemas: { c1: [{ name: "public" }] },
      tables: {
        "c1:public": [{ name: "users", schema: "public", row_count: null }],
      },
      views: {},
      functions: {},
      tableColumnsCache: {},
    });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "postgres" },
      { name: "warehouse" },
    ]);
    switchActiveDbMock.mockResolvedValueOnce(undefined);
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: /available databases/i,
    });
    const warehouse = within(listbox)
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("warehouse"))!;
    await act(async () => {
      fireEvent.click(warehouse);
    });
    const schemaState = useSchemaStore.getState();
    expect(schemaState.schemas["c1"]).toBeUndefined();
    expect(schemaState.tables["c1:public"]).toBeUndefined();
  });

  it("closes the popover after a successful switch", async () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "postgres" },
      { name: "warehouse" },
    ]);
    switchActiveDbMock.mockResolvedValueOnce(undefined);
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: /available databases/i,
    });
    const warehouse = within(listbox)
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("warehouse"))!;
    await act(async () => {
      fireEvent.click(warehouse);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("listbox", { name: /available databases/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("emits a success toast after a successful switch", async () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "postgres" },
      { name: "warehouse" },
    ]);
    switchActiveDbMock.mockResolvedValueOnce(undefined);
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: /available databases/i,
    });
    const warehouse = within(listbox)
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("warehouse"))!;
    await act(async () => {
      fireEvent.click(warehouse);
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("success");
    expect(toasts[0]!.message).toMatch(/warehouse/);
  });

  it("emits an error toast and leaves the popover open when the switch fails", async () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "postgres" },
      { name: "warehouse" },
    ]);
    switchActiveDbMock.mockRejectedValueOnce(
      new Error("Failed to open sub-pool: connection refused"),
    );
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: /available databases/i,
    });
    const warehouse = within(listbox)
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("warehouse"))!;
    await act(async () => {
      fireEvent.click(warehouse);
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("error");
    expect(toasts[0]!.message).toMatch(/Failed to switch DB/);
    // activeDb should not have moved.
    const status = useConnectionStore.getState().activeStatuses["c1"];
    expect(status?.type).toBe("connected");
    if (status?.type === "connected") {
      expect(status.activeDb).toBe("postgres");
    }
  });

  it("re-clicking the active DB is a no-op (no dispatch, no toast)", async () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "postgres" },
      { name: "warehouse" },
    ]);
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: /available databases/i,
    });
    const postgres = within(listbox)
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("postgres"))!;
    await act(async () => {
      fireEvent.click(postgres);
    });
    expect(switchActiveDbMock).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  // -- Label resolution sanity --

  it("shows the activeDb on the trigger when set on the connected status", () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "warehouse" });
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(trigger.textContent).toMatch(/warehouse/);
  });

  it("falls back to the document tab database when paradigm is document", () => {
    setStores({ paradigm: "document", connected: true });
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(trigger.textContent).toMatch(/analytics/);
  });

  it("falls back to the rdb tab's schema when no activeDb is set (legacy)", () => {
    setStores({
      paradigm: "rdb",
      connected: true,
      tab: makeTableTab({ schema: "warehouse" }),
    });
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(trigger.textContent).toMatch(/warehouse/);
  });

  it("shows the (default) sentinel when no activeDb, no tab database, and no schema", () => {
    setStores({
      paradigm: "rdb",
      connected: true,
      tab: makeQueryTab({ paradigm: "rdb" }),
    });
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(trigger.textContent).toMatch(/\(default\)/);
  });
});
