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
import { useDocumentStore } from "@stores/documentStore";
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
    useDocumentStore.setState({
      databases: {},
      collections: {},
      fieldsCache: {},
      queryResults: {},
      loading: false,
      error: null,
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

  // Sprint 141 (AC-141-3) — the read-only trigger must NOT carry an HTML
  // `title=` attribute. The combination of native `title` + Radix
  // <Tooltip> caused the "stuck tooltip" bug the user reported on
  // 2026-04-27 (the native browser tooltip lingered past hover-out
  // because Radix's dismiss timing didn't apply to it).
  it("does not expose a native HTML title attribute on the read-only trigger (AC-141-3)", () => {
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger).not.toHaveAttribute("title");
  });

  // Sprint 141 (AC-141-4) — the read-only Radix tooltip copy must not
  // mention internal "sprint" / "phase" nomenclature. A user looking at
  // a kv / search / disconnected trigger should see why the action is
  // unavailable in plain language, not a roadmap reference.
  it("renders a Radix tooltip with sprint-free copy on the read-only trigger (AC-141-4)", () => {
    render(<DbSwitcher />);
    // Radix portals tooltip content; we assert the in-tree TooltipContent
    // text node directly. There may be `aria-hidden` duplicates in
    // Radix's portal — at least one node should match and none should
    // contain the offending substring.
    const candidates = screen.queryAllByText(/database/i);
    const offender = candidates.find((node) =>
      /\b(sprint|phase)\s*\d+/i.test(node.textContent ?? ""),
    );
    expect(
      offender,
      "no read-only tooltip text may name a sprint/phase number",
    ).toBeUndefined();
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

  // -- Sprint 131 — Document paradigm switch --

  it("clears the document store for the connection after a successful Mongo switch", async () => {
    setStores({ paradigm: "document", connected: true, activeDb: "analytics" });
    // Seed a couple of document-store entries so we can verify they're
    // cleared. Mirrors the RDB schema-cache test above.
    useDocumentStore.setState({
      databases: {
        c1: [{ name: "analytics" }, { name: "warehouse" }],
      },
      collections: {
        "c1:analytics": [
          { name: "events", database: "analytics", document_count: null },
        ],
      },
      fieldsCache: {},
      queryResults: {},
      loading: false,
      error: null,
    });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "analytics" },
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
    // Backend dispatch must have fired with the new DB name.
    expect(switchActiveDbMock).toHaveBeenCalledWith("c1", "warehouse");
    // The document-store cache for the connection must have been wiped
    // so the sidebar re-fetches against the new active DB.
    const docState = useDocumentStore.getState();
    expect(docState.databases["c1"]).toBeUndefined();
    expect(docState.collections["c1:analytics"]).toBeUndefined();
  });

  it("does NOT clear the schema store on a Mongo paradigm switch", async () => {
    // Cross-paradigm regression guard — clearing schemaStore on a Mongo
    // switch would wipe an unrelated RDB connection's tree state if the
    // sidebar happens to be showing both connections at once.
    setStores({ paradigm: "document", connected: true, activeDb: "analytics" });
    useSchemaStore.setState({
      schemas: { other: [{ name: "public" }] },
      tables: {
        "other:public": [{ name: "users", schema: "public", row_count: null }],
      },
      views: {},
      functions: {},
      tableColumnsCache: {},
    });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "analytics" },
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
    // schemaStore must remain untouched.
    const schemaState = useSchemaStore.getState();
    expect(schemaState.schemas["other"]).toEqual([{ name: "public" }]);
  });

  it("does NOT clear the document store on an RDB paradigm switch", async () => {
    // Symmetric guard — clearing documentStore from a PG switch would
    // erase an unrelated Mongo connection's collection cache.
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    useDocumentStore.setState({
      databases: { mongo: [{ name: "analytics" }] },
      collections: {},
      fieldsCache: {},
      queryResults: {},
      loading: false,
      error: null,
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
    expect(useDocumentStore.getState().databases["mongo"]).toEqual([
      { name: "analytics" },
    ]);
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

  // Reason: verify that the DbSwitcher falls back to the focused connection's
  // activeDb when no tab is open but a connection is focused and connected.
  // This is the core fix for the "database not selected" bug — pre-fix the
  // switcher showed "—" instead of the database name when the workspace first
  // opened. (2026-04-29)
  it("shows focused connection's activeDb when no tab is open (rdb)", () => {
    const conn = makeConnection({
      paradigm: "rdb",
      id: "c1",
    });
    useConnectionStore.setState({
      connections: [conn],
      activeStatuses: {
        c1: { type: "connected", activeDb: "warehouse" },
      },
      focusedConnId: "c1",
    });
    // No tabs open
    useTabStore.setState({ tabs: [], activeTabId: null });

    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(trigger.textContent).toMatch(/warehouse/);
  });

  it("shows focused connection's activeDb when no tab is open (document)", () => {
    const conn = makeConnection({
      paradigm: "document",
      id: "m1",
      db_type: "mongodb",
    });
    useConnectionStore.setState({
      connections: [conn],
      activeStatuses: {
        m1: { type: "connected", activeDb: "analytics" },
      },
      focusedConnId: "m1",
    });
    useTabStore.setState({ tabs: [], activeTabId: null });

    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(trigger.textContent).toMatch(/analytics/);
  });

  // Reason: when no tab AND no focused connection exist, the em-dash sentinel
  // must still appear. (2026-04-29)
  it("shows em-dash when no tab and no focused connection", () => {
    useTabStore.setState({ tabs: [], activeTabId: null });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
      focusedConnId: null,
    });

    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger.textContent).toMatch(/—/);
  });

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
