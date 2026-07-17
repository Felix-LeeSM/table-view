import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
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
import {
  useWorkspaceStore,
  type TableTab,
  type QueryTab,
} from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useDocumentStore } from "@/test-utils/documentStore";
import type {
  ConnectionConfig,
  ConnectionStatus,
  Paradigm,
} from "@/types/connection";
import { useToastStore } from "@/stores/toastStore";

function makeTableTab(overrides: Partial<TableTab> = {}): TableTab {
  return {
    type: "table",
    id: "tab-1" as TabId,
    title: "users",
    connectionId: "c1" as ConnectionId,
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
    id: "query-1" as TabId,
    title: "Query 1",
    connectionId: "c1" as ConnectionId,
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
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    database: "postgres",
    groupId: null,
    color: null,
    hasPassword: false,
    ...overrides,
  };
}

function setStores(options: {
  paradigm: Paradigm;
  connected: boolean;
  tab?: TableTab | QueryTab;
  dbType?: ConnectionConfig["dbType"];
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
    dbType:
      options.dbType ??
      (options.paradigm === "document" ? "mongodb" : "postgresql"),
  });
  // Workspace key must match `(focusedConnId, activeDb)` so the
  // DbSwitcher's `useActiveTab()` resolves the seeded tab. Use the
  // tab's `database` (or "default" sentinel) so RDB tests that don't
  // set `activeDb` still land in a deterministic slot.
  const tabDb =
    (tab.type === "table"
      ? (tab as TableTab).database
      : (tab as QueryTab).database) ?? "default";
  const wsDb = options.activeDb ?? tabDb;
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id, conn.id, wsDb));
  const status: ConnectionStatus = options.connected
    ? { type: "connected", activeDb: options.activeDb ?? wsDb }
    : { type: "disconnected" };
  useConnectionStore.setState({
    focusedConnId: conn.id,
    connections: [conn],
    activeStatuses: { [conn.id]: status },
  });
}

describe("DbSwitcher", () => {
  beforeEach(() => {
    listDatabasesMock.mockReset();
    switchActiveDbMock.mockReset();
    useWorkspaceStore.setState({ workspaces: {} });
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
    // #1270 — toast queue reset moved to the shared `test-setup.ts` beforeEach
    // (process-singleton isolation, alongside datagrid/tableActivity stores).
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

  it.each(["redis", "valkey"] as const)(
    "renders an active switcher for connected %s kv profile",
    async (dbType) => {
      setStores({
        paradigm: "kv",
        connected: true,
        dbType,
        tab: makeQueryTab({ paradigm: "kv" }),
        activeDb: "0",
      });
      listDatabasesMock.mockResolvedValueOnce([{ name: "0" }, { name: "1" }]);
      render(<DbSwitcher />);
      const trigger = screen.getByRole("button", {
        name: /active database switcher/i,
      });
      expect(trigger.textContent).toMatch(/0/);

      fireEvent.click(trigger);

      const listbox = await screen.findByRole("listbox", {
        name: /available databases/i,
      });
      expect(within(listbox).getAllByRole("option")).toHaveLength(2);
    },
  );

  it("stays read-only for search paradigm even when connected", async () => {
    setStores({
      paradigm: "search",
      connected: true,
      dbType: "elasticsearch",
      tab: makeQueryTab({ paradigm: "search" }),
    });
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger).toBeInTheDocument();
    fireEvent.pointerMove(trigger);
    expect(
      await screen.findAllByText(
        /search scope is selected by index, alias, or data stream/i,
      ),
    ).not.toHaveLength(0);
    expect(screen.queryAllByText(/redis|valkey|kv/i)).toHaveLength(0);
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

  it("stays read-only for SQLite because the database is the connection file", () => {
    setStores({ paradigm: "rdb", connected: true, dbType: "sqlite" });
    render(<DbSwitcher />);
    expect(
      screen.getByRole("button", { name: /active database \(read-only\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /active database switcher/i }),
    ).not.toBeInTheDocument();
  });

  // #1047 — Mongo (document) paradigm must not hide the toolbar switcher
  // (former `return null` violated the ui-parity gate: same action = same
  // entry point). It now surfaces the shared read-only chip whose Radix
  // tooltip explains the tab-local DB scope (ADR 0030 preserved — only the
  // exposure changes, per the #1046 standard).
  it("renders a read-only chip with a tab-local tooltip for document (mongo) paradigm (#1047)", async () => {
    setStores({ paradigm: "document", connected: true });
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    // No interactive switcher for document — DB scope is tab-local.
    expect(
      screen.queryByRole("button", { name: /active database switcher/i }),
    ).not.toBeInTheDocument();
    fireEvent.pointerMove(trigger);
    expect(await screen.findAllByText(/per (query )?tab/i)).not.toHaveLength(0);
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

  // #1132 — the listbox declared `role="option"` rows but had no keyboard
  // model beyond autofocusing the first row. It now rovs a single tab stop
  // with ArrowUp/Down + Home/End, anchored on the active db.
  it("roves a single tab stop across options with Arrow/Home/End keys (#1132)", async () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    listDatabasesMock.mockResolvedValueOnce([
      { name: "postgres" },
      { name: "warehouse" },
      { name: "analytics" },
    ]);
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: /available databases/i,
    });
    const options = within(listbox).getAllByRole("option");

    // Single tab stop: exactly one option is tabbable.
    expect(
      options.filter((o) => o.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
    // Roving anchor starts on the active db (postgres, index 0).
    await waitFor(() => expect(options[0]).toHaveFocus());

    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(options[1]).toHaveFocus();
    expect(options[1]).toHaveAttribute("tabindex", "0");
    expect(options[0]).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(listbox, { key: "End" });
    expect(options[2]).toHaveFocus();

    fireEvent.keyDown(listbox, { key: "Home" });
    expect(options[0]).toHaveFocus();

    // ArrowUp at the top clamps (no wrap).
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(options[0]).toHaveFocus();
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

  // Sprint 263 — DbSwitcher no longer wipes the per-connection schema
  // cache on toggle. schemaStore caches are now `(connId, db)` keyed; the
  // sidebar re-subscribes to the new slot via the workspace key, and an
  // already-populated slot is reused instantly across toggles. This test
  // (was AC-262-pre-263 "clears … on switch") now anchors that the
  // *previously-loaded* db1 cache survives a db1 → db2 toggle.
  it("preserves schema caches across a successful DB toggle (AC-263-04)", async () => {
    setStores({ paradigm: "rdb", connected: true, activeDb: "postgres" });
    // Seed db1's slot — after the switch this MUST still exist.
    useSchemaStore.setState({
      schemas: { c1: { postgres: [{ name: "public" }] } },
      tables: {
        c1: {
          postgres: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
        },
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
    // Previous db1 cache is intact — toggle did not wipe it.
    expect(schemaState.schemas.c1?.postgres).toEqual([{ name: "public" }]);
    expect(schemaState.tables.c1?.postgres?.public).toHaveLength(1);
  });

  // Sprint 131 "Document paradigm switch" cases (clears document store on
  // Mongo switch / does NOT clear schema store on Mongo switch) were
  // removed in Sprint 328 — the Mongo branch of this component no longer
  // renders, so its dispatch path is unreachable. The cross-paradigm
  // guard below ("does NOT clear the document store on an RDB paradigm
  // switch") is preserved because the symmetric RDB path is still live.

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
    useWorkspaceStore.setState({ workspaces: {} });

    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(trigger.textContent).toMatch(/warehouse/);
  });

  // Sprint 328 — Mongo display branches removed. The two cases below
  // ("shows focused connection's activeDb when no tab is open (document)"
  // and "falls back to the document tab database when paradigm is
  // document") asserted Mongo-side rendering of the toolbar chip, which
  // no longer exists. RDB equivalents above still apply.

  // Reason: when no tab AND no focused connection exist, the em-dash sentinel
  // must still appear. (2026-04-29)
  it("shows em-dash when no tab and no focused connection", () => {
    useWorkspaceStore.setState({ workspaces: {} });
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

  // ADR 0027 (Sprint 262) — workspace state is keyed by `(connId, db)`,
  // so `useActiveTab()` can only resolve a tab when the connection has
  // an `activeDb`. The two legacy fallback scenarios below — "no
  // activeDb, fall back to tab.schema" and "no activeDb / no tab.database
  // / no tab.schema → (default) sentinel" — describe a state that the
  // new architecture cannot represent (a tab can't live in a workspace
  // slot without a `db` key, and `useCurrentWorkspaceKey()` returns
  // `null` when `activeDb` is missing). Production callers always set
  // `activeDb` via `connectToDatabase`. The DbSwitcher still falls back
  // to `(default)` when `paradigm === "rdb"` but the focused connection
  // has no activeDb (e.g. mid-connection); that branch is exercised by
  // `shows em-dash when no tab and no focused connection` + the
  // production wiring in `connectionStore.connectToDatabase`.
});
