import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ConnectionSwitcher from "./ConnectionSwitcher";
import { useConnectionStore } from "@stores/connectionStore";
import {
  useTabStore,
  __resetLastActiveTabsForTests,
  type TableTab,
  type QueryTab,
} from "@stores/tabStore";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

function makeConnection(
  id: string,
  overrides?: Partial<ConnectionConfig>,
): ConnectionConfig {
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
    paradigm: "rdb",
    ...overrides,
  };
}

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
    sql: "SELECT 1",
    queryState: { status: "idle" },
    paradigm: "rdb",
    queryMode: "sql",
    ...overrides,
  };
}

function setConnections(opts: {
  connections?: ConnectionConfig[];
  connected?: string[];
  disconnected?: string[];
  connecting?: string[];
  errored?: string[];
}) {
  const conns = opts.connections ?? [];
  const connected = new Set(opts.connected ?? []);
  const disconnected = new Set(opts.disconnected ?? []);
  const connecting = new Set(opts.connecting ?? []);
  const errored = new Set(opts.errored ?? []);
  const statuses: Record<string, ConnectionStatus> = {};
  for (const c of conns) {
    if (errored.has(c.id)) statuses[c.id] = { type: "error", message: "boom" };
    else if (connecting.has(c.id)) statuses[c.id] = { type: "connecting" };
    else if (disconnected.has(c.id)) statuses[c.id] = { type: "disconnected" };
    else if (connected.has(c.id)) statuses[c.id] = { type: "connected" };
    else statuses[c.id] = { type: "disconnected" };
  }
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
  });
}

describe("ConnectionSwitcher", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
    setConnections({});
    __resetLastActiveTabsForTests();
  });

  it("trigger label reflects the active tab's connection name", () => {
    const c1 = makeConnection("c1", { name: "Production" });
    setConnections({ connections: [c1], connected: ["c1"] });
    const tab = makeTableTab({ id: "t1", connectionId: "c1" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<ConnectionSwitcher />);
    const trigger = screen.getByRole("combobox", {
      name: /active connection switcher/i,
    });
    expect(trigger.textContent).toMatch(/Production/);
  });

  it("falls back to a 'No connection' placeholder when no tab is active", () => {
    setConnections({
      connections: [makeConnection("c1")],
      connected: ["c1"],
    });
    render(<ConnectionSwitcher />);
    expect(screen.getByText(/no connection/i)).toBeInTheDocument();
  });

  it("is disabled when zero connections are currently connected", () => {
    setConnections({
      connections: [makeConnection("c1"), makeConnection("c2")],
      // both intentionally disconnected
    });
    render(<ConnectionSwitcher />);
    const trigger = screen.getByRole("combobox", {
      name: /active connection switcher/i,
    });
    expect(trigger).toBeDisabled();
  });

  it("excludes disconnected / connecting / errored connections from the option list", () => {
    const connected = makeConnection("conn-on", { name: "OnlineDB" });
    const disconnected = makeConnection("conn-off", { name: "OfflineDB" });
    const connecting = makeConnection("conn-busy", { name: "BusyDB" });
    const errored = makeConnection("conn-bad", { name: "BadDB" });
    setConnections({
      connections: [connected, disconnected, connecting, errored],
      connected: ["conn-on"],
      disconnected: ["conn-off"],
      connecting: ["conn-busy"],
      errored: ["conn-bad"],
    });

    render(<ConnectionSwitcher />);
    act(() => {
      fireEvent.click(
        screen.getByRole("combobox", {
          name: /active connection switcher/i,
        }),
      );
    });

    // Radix `Select.Item` sets aria-labelledby to its ItemText id, so we
    // assert via the literal `[aria-label]` attribute the contract requires.
    expect(
      document.querySelector('[aria-label="Connection: OnlineDB"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[aria-label="Connection: OfflineDB"]'),
    ).toBeNull();
    expect(
      document.querySelector('[aria-label="Connection: BusyDB"]'),
    ).toBeNull();
    expect(
      document.querySelector('[aria-label="Connection: BadDB"]'),
    ).toBeNull();
  });

  it("selecting another connection routes to its last-active tab", () => {
    const c1 = makeConnection("c1");
    const c2 = makeConnection("c2");
    setConnections({
      connections: [c1, c2],
      connected: ["c1", "c2"],
    });
    const tabA = makeTableTab({
      id: "t-a",
      connectionId: "c2",
      schema: "public",
      table: "alpha",
    });
    const tabB = makeTableTab({
      id: "t-b",
      connectionId: "c2",
      schema: "public",
      table: "beta",
    });
    const tabC = makeTableTab({
      id: "t-c",
      connectionId: "c1",
      schema: "public",
      table: "gamma",
    });
    useTabStore.setState({
      tabs: [tabA, tabB, tabC],
      activeTabId: tabA.id, // make c2's last-active = tabA
    });
    // Now activate the c1 tab so the "current" view is c1.
    act(() => {
      useTabStore.getState().setActiveTab(tabB.id); // c2 last-active = tabB
    });
    act(() => {
      useTabStore.getState().setActiveTab(tabC.id); // active connection = c1
    });

    render(<ConnectionSwitcher />);
    act(() => {
      fireEvent.click(
        screen.getByRole("combobox", {
          name: /active connection switcher/i,
        }),
      );
    });
    act(() => {
      const option = document.querySelector<HTMLElement>(
        '[aria-label="Connection: c2 DB"]',
      );
      if (!option) throw new Error("expected c2 DB option to be in document");
      fireEvent.click(option);
    });

    expect(useTabStore.getState().activeTabId).toBe(tabB.id);
  });

  it("falls back to the first existing tab when no last-active exists", () => {
    const c1 = makeConnection("c1");
    const c2 = makeConnection("c2");
    setConnections({
      connections: [c1, c2],
      connected: ["c1", "c2"],
    });
    const c2first = makeTableTab({
      id: "t-c2-1",
      connectionId: "c2",
      table: "first",
    });
    const c2second = makeTableTab({
      id: "t-c2-2",
      connectionId: "c2",
      table: "second",
    });
    const c1tab = makeTableTab({ id: "t-c1", connectionId: "c1" });
    useTabStore.setState({
      tabs: [c2first, c2second, c1tab],
      activeTabId: c1tab.id,
    });

    render(<ConnectionSwitcher />);
    act(() => {
      fireEvent.click(
        screen.getByRole("combobox", {
          name: /active connection switcher/i,
        }),
      );
    });
    act(() => {
      const option = document.querySelector<HTMLElement>(
        '[aria-label="Connection: c2 DB"]',
      );
      if (!option) throw new Error("expected c2 DB option to be in document");
      fireEvent.click(option);
    });

    expect(useTabStore.getState().activeTabId).toBe(c2first.id);
  });

  it("spawns a new query tab when no tab exists for the chosen connection", () => {
    const c1 = makeConnection("c1");
    const c2 = makeConnection("c2");
    setConnections({
      connections: [c1, c2],
      connected: ["c1", "c2"],
    });
    const c1tab = makeQueryTab({ id: "q-c1", connectionId: "c1" });
    useTabStore.setState({ tabs: [c1tab], activeTabId: c1tab.id });

    render(<ConnectionSwitcher />);
    act(() => {
      fireEvent.click(
        screen.getByRole("combobox", {
          name: /active connection switcher/i,
        }),
      );
    });
    act(() => {
      const option = document.querySelector<HTMLElement>(
        '[aria-label="Connection: c2 DB"]',
      );
      if (!option) throw new Error("expected c2 DB option to be in document");
      fireEvent.click(option);
    });

    const state = useTabStore.getState();
    // A new query tab against c2 should now exist and be active.
    const c2Tabs = state.tabs.filter((t) => t.connectionId === "c2");
    expect(c2Tabs).toHaveLength(1);
    expect(c2Tabs[0]!.type).toBe("query");
    expect(state.activeTabId).toBe(c2Tabs[0]!.id);
  });

  it("renders a Connection: <name> aria-label on each option", () => {
    const c1 = makeConnection("c1", { name: "Alpha" });
    const c2 = makeConnection("c2", { name: "Beta" });
    setConnections({ connections: [c1, c2], connected: ["c1", "c2"] });
    render(<ConnectionSwitcher />);
    act(() => {
      fireEvent.click(
        screen.getByRole("combobox", {
          name: /active connection switcher/i,
        }),
      );
    });

    // Radix uses aria-labelledby on the option element so accessible-name
    // matching reads from the visible text. The contract requires the
    // literal `aria-label="Connection: <name>"` attribute as well, which
    // is what we assert here.
    expect(
      document.querySelector('[aria-label="Connection: Alpha"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[aria-label="Connection: Beta"]'),
    ).not.toBeNull();
  });
});
