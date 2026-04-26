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

vi.mock("@/lib/api/listDatabases", () => ({
  listDatabases: (...args: unknown[]) => listDatabasesMock(...args),
}));

import DbSwitcher from "./DbSwitcher";
import { useTabStore, type TableTab, type QueryTab } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig, Paradigm } from "@/types/connection";
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
  useConnectionStore.setState({
    connections: [conn],
    activeStatuses: options.connected
      ? { [conn.id]: { type: "connected" } }
      : { [conn.id]: { type: "disconnected" } },
  });
}

describe("DbSwitcher", () => {
  beforeEach(() => {
    listDatabasesMock.mockReset();
    useTabStore.setState({ tabs: [], activeTabId: null });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
    });
    useToastStore.setState({ toasts: [] });
  });

  // ── Read-only chrome (S127 invariants preserved for non-eligible cases) ──

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
      // search has no DatabaseType yet, mongodb is closest available;
      // paradigm is the discriminator the component checks.
      dbType: "mongodb",
      tab: makeQueryTab({ paradigm: "search" }),
    });
    render(<DbSwitcher />);
    expect(
      screen.getByRole("button", { name: /active database \(read-only\)/i }),
    ).toBeInTheDocument();
  });

  // ── S128 active behavior (rdb + connected) ──

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
    setStores({ paradigm: "rdb", connected: true });
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
    expect(trigger.textContent).toMatch(/public/);
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

  it("selecting an item is a no-op against tab and connection stores", async () => {
    setStores({ paradigm: "rdb", connected: true });
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
    const tabSnapshotBefore = JSON.stringify(useTabStore.getState());
    const connSnapshotBefore = JSON.stringify(useConnectionStore.getState());

    const options = within(listbox).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    fireEvent.click(options[0]!);

    expect(JSON.stringify(useTabStore.getState())).toBe(tabSnapshotBefore);
    expect(JSON.stringify(useConnectionStore.getState())).toBe(
      connSnapshotBefore,
    );
  });

  it("selecting an item surfaces the inline hint via toast", async () => {
    setStores({ paradigm: "rdb", connected: true });
    listDatabasesMock.mockResolvedValueOnce([{ name: "postgres" }]);
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: /available databases/i,
    });
    const options = within(listbox).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    fireEvent.click(options[0]!);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("info");
    expect(toasts[0]!.message).toBe("Switching active DB lands in sprint 130");
  });

  it("renders the inline 'lands in sprint 130' hint inside the popover", async () => {
    setStores({ paradigm: "rdb", connected: true });
    listDatabasesMock.mockResolvedValueOnce([{ name: "postgres" }]);
    render(<DbSwitcher />);
    fireEvent.click(
      screen.getByRole("button", { name: /active database switcher/i }),
    );
    expect(await screen.findByTestId("db-switcher-hint")).toHaveTextContent(
      "Switching active DB lands in sprint 130",
    );
  });

  // ── Label resolution sanity (preserved from S127) ──

  it("shows the document-paradigm tab's database name on the trigger", () => {
    setStores({ paradigm: "document", connected: true });
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(trigger.textContent).toMatch(/analytics/);
  });

  it("shows the rdb tab's schema as the placeholder label", () => {
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

  it("shows the (default) sentinel when an active tab has no schema/database", () => {
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
