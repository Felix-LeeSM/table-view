import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, fireEvent } from "@testing-library/react";
import WorkspaceToolbar from "./WorkspaceToolbar";
import { useConnectionStore } from "@stores/connectionStore";
import {
  useWorkspaceStore,
  type TableTab,
  type QueryTab,
} from "@stores/workspaceStore";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

function makeConnection(
  id: string,
  overrides?: Partial<ConnectionConfig>,
): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
    ...overrides,
  };
}

function makeTableTab({
  id = "tab-1",
  ...overrides
}: Partial<Omit<TableTab, "id">> & { id?: string } = {}): TableTab {
  return {
    type: "table",
    id: id as TabId,
    title: "users",
    connectionId: "c1" as ConnectionId,
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  };
}

function makeQueryTab({
  id = "query-1",
  ...overrides
}: Partial<Omit<QueryTab, "id">> & { id?: string } = {}): QueryTab {
  return {
    type: "query",
    id: id as TabId,
    title: "Query 1",
    connectionId: "c1" as ConnectionId,
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
    useWorkspaceStore.setState({ workspaces: {} });
    setConnections({});
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
      connectionId: "c1" as ConnectionId,
      schema: "analytics",
      table: "events",
    });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<WorkspaceToolbar />);

    // Sprint 130+ — the DB switcher label tracks `activeDb` (or schema as a
    // legacy fallback). With no `activeDb` set, the schema name doubles as
    // the DB hint until the tab is reopened.
    const db = screen.getByRole("button", {
      name: /active database switcher/i,
    });
    expect(db).toBeInTheDocument();
  });

  // #1047 — Mongo (document) paradigm surfaces the toolbar DbSwitcher as a
  // read-only chip (DB scope is tab-local per ADR 0030, but the slot stays
  // visible per the ui-parity gate: same action = same entry point). The
  // interactive switcher is still absent; only the disabled chip renders.
  it("shows the DbSwitcher as a read-only chip for document query tabs (#1047)", () => {
    const mongo = makeConnection("m1", {
      dbType: "mongodb",
      paradigm: "document",
    });
    setConnections({ connections: [mongo], active: ["m1"] });

    const tab = makeQueryTab({
      id: "q1",
      connectionId: "m1" as ConnectionId,
      paradigm: "document",
      queryMode: "find",
      database: "analytics",
      collection: "events",
    });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<WorkspaceToolbar />);
    expect(
      screen.queryByRole("button", { name: /active database switcher/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /active database \(read-only\)/i }),
    ).toBeInTheDocument();
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
