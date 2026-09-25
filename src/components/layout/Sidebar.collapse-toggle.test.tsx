/**
 * Collapse/expand all toggle per DB type.
 *
 * Reason: the Sidebar header's single "Collapse all" button was committed to
 * PG only, as the user capture (image #4) shows. It is upgraded to expose the
 * right object name for each of the 4 DB types (PG / MySQL / SQLite / Mongo),
 * and to toggle the same button to "Expand all *" when everything is
 * currently collapsed.
 *
 * Matrix: 4 DB types × 2 states.
 *
 * No confirm dialog (same spirit as the Q21 contract).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(() => "workspace-c1"),
  };
});

// jsdom localStorage shim (mirrors Sidebar.test.tsx).
{
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-mock" />,
}));

vi.mock("./WorkspaceSidebar", () => ({
  default: ({ selectedId }: { selectedId: string | null }) => (
    <div data-testid="schema-panel">{selectedId ?? "none"}</div>
  ),
}));

import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  resetFakeWindowConnectionId,
  setFakeWindowConnectionId,
} from "@/stores/__tests__/fakeWindowConnectionId";
import type {
  ConnectionConfig,
  DatabaseType,
  Paradigm,
} from "@/types/connection";
import Sidebar from "./Sidebar";

function makeConnection(
  id: string,
  dbType: DatabaseType,
  paradigm: Paradigm,
): ConnectionConfig {
  return {
    id,
    name: `${id} ${dbType}`,
    dbType: dbType,
    host: "localhost",
    port: 5432,
    user: "x",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm,
  };
}

function seed(opts: {
  dbType: DatabaseType;
  paradigm: Paradigm;
  expanded: string[];
}): void {
  useConnectionStore.setState({
    connections: [makeConnection("c1", opts.dbType, opts.paradigm)],
    activeStatuses: { c1: { type: "connected", activeDb: "db1" } },
    focusedConnId: null,
  });
  useWorkspaceStore.setState({
    workspaces: {
      c1: {
        db1: {
          tabs: [],
          activeTabId: null,
          closedTabHistory: [],
          dirtyTabIds: [],
          sidebar: {
            selectedNode: null,
            expanded: opts.expanded,
            scrollTop: 0,
          },
        },
      },
    },
  });
  setFakeWindowConnectionId("c1");
}

describe("Sidebar collapse/expand-all toggle per DB type (sprint-379)", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    // Reason: #1737 — expand-all enumerates the schemaStore cache; keep it
    // empty by default so the collapse cases are unaffected and shuffled
    // runs stay isolated (P3) (2026-07-24)
    useSchemaStore.setState({ schemas: {} });
  });

  afterEach(() => {
    resetFakeWindowConnectionId();
  });

  // ── PostgreSQL ──────────────────────────────────────────────────────────
  it("AC-379-01: PG + expanded≥1 → label 'Collapse all schemas', 클릭 → expanded=[]", () => {
    seed({
      dbType: "postgresql",
      paradigm: "rdb",
      expanded: ["schema.public"],
    });
    render(<Sidebar />);
    const btn = screen.getByRole("button", { name: /collapse all schemas/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(
      useWorkspaceStore.getState().workspaces.c1?.db1?.sidebar.expanded,
    ).toEqual([]);
  });

  it("AC-379-02: PG + expanded=[] → label 'Expand all schemas'", () => {
    seed({ dbType: "postgresql", paradigm: "rdb", expanded: [] });
    render(<Sidebar />);
    expect(
      screen.getByRole("button", { name: /expand all schemas/i }),
    ).toBeInTheDocument();
  });

  // Reason: #1737 — the "Expand all" button was a no-op stub with only the
  // collapse branch implemented, so clicking it showed the label and expanded
  // nothing. Every loaded schema name must be filled into sidebar.expanded.
  // The expand rule matches the bare schema name SchemaTree uses as its key.
  it("AC-1737: PG + expanded=[] → click 'Expand all schemas' populates every loaded schema name", () => {
    seed({ dbType: "postgresql", paradigm: "rdb", expanded: [] });
    useSchemaStore.setState({
      schemas: { c1: { db1: [{ name: "public" }, { name: "analytics" }] } },
    });
    render(<Sidebar />);
    const btn = screen.getByRole("button", { name: /expand all schemas/i });
    fireEvent.click(btn);
    expect(
      useWorkspaceStore.getState().workspaces.c1?.db1?.sidebar.expanded,
    ).toEqual(["public", "analytics"]);
  });

  // Reason: follow-up to #1737 — handleExpandAll's
  // `focusedSchemas.length === 0 → return` guard (a no-op when no schema is
  // loaded) had no assertion. A state-based assertion (expanded===[]) passes
  // even with the guard removed, because setExpanded is an idempotent no-op
  // returning the same reference when current===nodes → no RED. Assert
  // instead that the guard blocks the store action itself, via whether
  // setExpanded was called: removing the guard calls setExpanded → RED.
  it("AC-1737: PG + empty schema cache → click 'Expand all schemas' is a no-op (setExpanded not called)", () => {
    seed({ dbType: "postgresql", paradigm: "rdb", expanded: [] });
    // schemaStore intentionally left empty (beforeEach clears it) →
    // focusedSchemas is empty, so the guard must short-circuit.
    const setExpandedSpy = vi.spyOn(
      useWorkspaceStore.getState(),
      "setExpanded",
    );
    render(<Sidebar />);
    fireEvent.click(
      screen.getByRole("button", { name: /expand all schemas/i }),
    );
    expect(setExpandedSpy).not.toHaveBeenCalled();
    setExpandedSpy.mockRestore();
  });

  // ── MySQL ───────────────────────────────────────────────────────────────
  it("AC-379-03: MySQL + expanded≥1 → label 'Collapse all tables', 클릭 → expanded=[]", () => {
    seed({
      dbType: "mysql",
      paradigm: "rdb",
      expanded: ["table.users"],
    });
    render(<Sidebar />);
    const btn = screen.getByRole("button", { name: /collapse all tables/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(
      useWorkspaceStore.getState().workspaces.c1?.db1?.sidebar.expanded,
    ).toEqual([]);
  });

  it("AC-379-04: MySQL + expanded=[] → label 'Expand all tables'", () => {
    seed({ dbType: "mysql", paradigm: "rdb", expanded: [] });
    render(<Sidebar />);
    expect(
      screen.getByRole("button", { name: /expand all tables/i }),
    ).toBeInTheDocument();
  });

  // ── SQLite ──────────────────────────────────────────────────────────────
  it("AC-379-05: SQLite + expanded≥1 → label 'Collapse all tables', 클릭 → expanded=[]", () => {
    seed({
      dbType: "sqlite",
      paradigm: "rdb",
      expanded: ["table.t1"],
    });
    render(<Sidebar />);
    const btn = screen.getByRole("button", { name: /collapse all tables/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(
      useWorkspaceStore.getState().workspaces.c1?.db1?.sidebar.expanded,
    ).toEqual([]);
  });

  it("AC-379-06: SQLite + expanded=[] → label 'Expand all tables'", () => {
    seed({ dbType: "sqlite", paradigm: "rdb", expanded: [] });
    render(<Sidebar />);
    expect(
      screen.getByRole("button", { name: /expand all tables/i }),
    ).toBeInTheDocument();
  });

  // ── MongoDB ─────────────────────────────────────────────────────────────
  it("AC-379-07: Mongo + expanded≥1 → label 'Collapse all collections', 클릭 → expanded=[]", () => {
    seed({
      dbType: "mongodb",
      paradigm: "document",
      expanded: ["coll.docs"],
    });
    render(<Sidebar />);
    const btn = screen.getByRole("button", {
      name: /collapse all collections/i,
    });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(
      useWorkspaceStore.getState().workspaces.c1?.db1?.sidebar.expanded,
    ).toEqual([]);
  });

  it("AC-379-08: Mongo + expanded=[] → label 'Expand all collections'", () => {
    seed({ dbType: "mongodb", paradigm: "document", expanded: [] });
    render(<Sidebar />);
    expect(
      screen.getByRole("button", { name: /expand all collections/i }),
    ).toBeInTheDocument();
  });
});
