import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("renders the DB slot and the Disconnect button inside a labelled toolbar region", () => {
    render(<WorkspaceToolbar />);

    const toolbar = screen.getByRole("toolbar", { name: /workspace toolbar/i });
    expect(toolbar).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /active database \(read-only\)/i }),
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

  // Sprint 135 — SchemaSwitcher was removed. Schema selection lives in the
  // sidebar tree only. Guard the toolbar against a regression that would
  // re-mount the (now deleted) read-only schema chip.
  it("does NOT render the legacy SchemaSwitcher chip (AC-S135-01)", () => {
    render(<WorkspaceToolbar />);
    expect(
      screen.queryByRole("button", { name: /active schema \(read-only\)/i }),
    ).toBeNull();
  });

  it("falls back to the empty-workspace placeholder when no tab is active", () => {
    render(<WorkspaceToolbar />);

    // DB shows the em-dash sentinel for "no value".
    const db = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(db.textContent).toMatch(/—/);
  });

  it("reflects the active tab's connection / database", () => {
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

    // Sprint 130+ — the DB switcher label tracks `activeDb` (or schema as a
    // legacy fallback). With no `activeDb` set, the schema name doubles as
    // the DB hint until the tab is reopened.
    const db = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(db).toBeInTheDocument();
  });

  it("shows mongo database labels for document query tabs", () => {
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

    expect(db.textContent).toMatch(/analytics/);
  });

  // Post-Sprint-187 hotfix [HF-187-A3] — the History button surfaces the
  // existing `GlobalQueryLogPanel` from the toolbar so the panel is
  // discoverable without the Cmd+Shift+C shortcut. It must dispatch the
  // canonical `toggle-global-query-log` CustomEvent on click. date 2026-05-01.
  it("[HF-187-A3] History button mounts and dispatches toggle-global-query-log", () => {
    render(<WorkspaceToolbar />);

    const btn = screen.getByRole("button", { name: /toggle query history/i });
    expect(btn).toBeInTheDocument();

    const handler = vi.fn();
    window.addEventListener("toggle-global-query-log", handler);
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("toggle-global-query-log", handler);
  });
});
