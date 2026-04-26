import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import WorkspaceToolbar from "./WorkspaceToolbar";
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
  active?: string[];
  focusedConnId?: string | null;
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
    focusedConnId: opts.focusedConnId ?? null,
  });
}

describe("WorkspaceToolbar", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
    setConnections({});
    __resetLastActiveTabsForTests();
  });

  it("renders DB / Schema slots and the Disconnect button inside a labelled toolbar region", () => {
    render(<WorkspaceToolbar />);

    const toolbar = screen.getByRole("toolbar", { name: /workspace toolbar/i });
    expect(toolbar).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /active database \(read-only\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /active schema \(read-only\)/i }),
    ).toBeInTheDocument();
    // Sprint 134 — DisconnectButton mounts adjacent to the (keyboard-only)
    // refresh control. It exists regardless of connection state; disabled
    // when no focused connection is currently connected.
    expect(
      screen.getByRole("button", { name: /disconnect/i }),
    ).toBeInTheDocument();
  });

  // Sprint 134 — ConnectionSwitcher was removed. Guard against a
  // regression accidentally re-mounting it by asserting the combobox
  // role/name is gone.
  it("does NOT render the legacy ConnectionSwitcher combobox", () => {
    render(<WorkspaceToolbar />);
    expect(
      screen.queryByRole("combobox", { name: /active connection switcher/i }),
    ).toBeNull();
  });

  it("falls back to the empty-workspace placeholder when no tab is active", () => {
    render(<WorkspaceToolbar />);

    // DB / Schema both show the em-dash sentinel for "no value".
    const db = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    const schema = screen.getByRole("button", {
      name: /active schema \(read-only\)/i,
    });
    expect(db.textContent).toMatch(/—/);
    expect(schema.textContent).toMatch(/—/);
  });

  it("reflects the active tab's connection / schema / database", () => {
    const conn = makeConnection("c1");
    setConnections({ connections: [conn], active: ["c1"] });

    const tab = makeTableTab({
      id: "tab-1",
      connectionId: "c1",
      schema: "analytics",
      table: "events",
    });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<WorkspaceToolbar />);

    const schema = screen.getByRole("button", {
      name: /active schema \(read-only\)/i,
    });
    expect(schema.textContent).toMatch(/analytics/);
  });

  it("updates labels when the active tab changes", () => {
    const c1 = makeConnection("c1", { name: "Alpha" });
    const c2 = makeConnection("c2", { name: "Beta" });
    setConnections({ connections: [c1, c2], active: ["c1", "c2"] });

    const tab1 = makeTableTab({
      id: "t1",
      connectionId: "c1",
      schema: "public",
    });
    const tab2 = makeTableTab({
      id: "t2",
      connectionId: "c2",
      schema: "warehouse",
    });
    useTabStore.setState({ tabs: [tab1, tab2], activeTabId: tab1.id });

    const { rerender } = render(<WorkspaceToolbar />);
    expect(
      screen.getByRole("button", { name: /active schema \(read-only\)/i })
        .textContent,
    ).toMatch(/public/);

    useTabStore.setState({ activeTabId: tab2.id });
    rerender(<WorkspaceToolbar />);

    expect(
      screen.getByRole("button", { name: /active schema \(read-only\)/i })
        .textContent,
    ).toMatch(/warehouse/);
  });

  it("shows mongo database/collection labels for document query tabs", () => {
    const mongo = makeConnection("m1", {
      db_type: "mongodb",
      paradigm: "document",
    });
    setConnections({ connections: [mongo], active: ["m1"] });

    const tab = makeQueryTab({
      id: "q1",
      connectionId: "m1",
      paradigm: "document",
      queryMode: "find",
      database: "analytics",
      collection: "events",
    });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<WorkspaceToolbar />);
    // Sprint 128 — the document paradigm + connected status now activates
    // the DB switcher. The label assertion is unchanged; the role/label
    // surface flipped from read-only to interactive.
    const db = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    const schema = screen.getByRole("button", {
      name: /active schema \(read-only\)/i,
    });

    expect(db.textContent).toMatch(/analytics/);
    expect(schema.textContent).toMatch(/events/);
  });
});
