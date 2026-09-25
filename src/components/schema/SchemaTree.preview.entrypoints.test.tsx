// Purpose: diagnose every preview tab entry point in SchemaTree
//
// User-reported bug:
//   Bug 2: clicking a PG sidebar table accumulates preview tabs instead of
//   swapping them
//
// SchemaTree.preview.test.tsx covers only the basic click/double-click, so
// this file diagnoses every entry point: context menu, search filter, view
// items, re-click after promote.
//
// AC IDs:
//   AC-156-04a  Context menu "Data" on table → preview tab (isPreview: true)
//   AC-156-04b  Context menu "Structure" on table → structure tab behavior
//   AC-156-04c  Filtered table click (search active) → preview tab
//   AC-156-04d  Click different table after promoting one → new preview slot
//   AC-156-04e  Click a view (not table) → tab behavior

import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { type TableTab, useWorkspaceStore } from "@stores/workspaceStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import SchemaTree from "./SchemaTree";

// ── Store mocks ────────────────────────────────────────────────────────────

const mockLoadSchemas = vi.fn().mockResolvedValue(undefined);
const mockLoadTables = vi.fn().mockResolvedValue(undefined);
const mockLoadViews = vi.fn().mockResolvedValue(undefined);
const mockLoadFunctions = vi.fn().mockResolvedValue(undefined);
const mockPrefetchSchemaColumns = vi.fn().mockResolvedValue(undefined);

// Translate legacy flat-key seeds into the new
// `(connId, db)`-nested cache shape under `db1` so existing test seeds
// continue to work against the db-aware schemaStore.
const DEFAULT_DB = "db1";
function translateFlatSeeds(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...overrides };
  if ("schemas" in overrides && overrides.schemas) {
    const schemas = overrides.schemas as Record<string, unknown>;
    const sample = Object.values(schemas)[0];
    if (Array.isArray(sample)) {
      const next: Record<string, Record<string, unknown>> = {};
      for (const [cid, list] of Object.entries(schemas)) {
        next[cid] = { [DEFAULT_DB]: list };
      }
      out.schemas = next;
    }
  }
  for (const axis of ["tables", "views", "functions"] as const) {
    if (axis in overrides && overrides[axis]) {
      const raw = overrides[axis] as Record<string, unknown>;
      const keys = Object.keys(raw);
      if (keys.some((k) => k.includes(":"))) {
        const next: Record<
          string,
          Record<string, Record<string, unknown>>
        > = {};
        for (const [composite, list] of Object.entries(raw)) {
          const [cid, schema] = composite.split(":");
          if (!cid || !schema) continue;
          next[cid] ??= {};
          next[cid]![DEFAULT_DB] ??= {};
          next[cid]![DEFAULT_DB]![schema] = list;
        }
        out[axis] = next;
      }
    }
  }
  return out;
}
function setSchemaStoreState(overrides: Record<string, unknown> = {}) {
  const translated = translateFlatSeeds(overrides);
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
    ...translated,
    loadSchemas: mockLoadSchemas,
    loadTables: mockLoadTables,
    loadViews: mockLoadViews,
    loadFunctions: mockLoadFunctions,
    prefetchSchemaColumns: mockPrefetchSchemaColumns,
  });
}

function resetStores() {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
    loadSchemas: mockLoadSchemas,
    loadTables: mockLoadTables,
    loadViews: mockLoadViews,
    loadFunctions: mockLoadFunctions,
    prefetchSchemaColumns: mockPrefetchSchemaColumns,
  });
  useWorkspaceStore.setState({ workspaces: {} });
  // ADR 0027 — workspace key resolves via `(focusedConnId, activeDb)`.
  useConnectionStore.setState({
    connections: [],
    focusedConnId: "conn1",
    activeStatuses: { conn1: { type: "connected", activeDb: "db1" } },
  });
}

function getTableTab(index = 0): TableTab {
  const tab = getTestWorkspace().tabs[index]!;
  if (tab.type !== "table") throw new Error("Expected TableTab");
  return tab;
}

function seedRelationalSchema() {
  setSchemaStoreState({
    schemas: { conn1: [{ name: "public" }] },
    tables: {
      "conn1:public": [
        { name: "users", schema: "public", row_count: null },
        { name: "orders", schema: "public", row_count: null },
        { name: "products", schema: "public", row_count: null },
      ],
    },
    views: {
      "conn1:public": [{ name: "active_users", schema: "public" }],
    },
    functions: {},
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AC-156-04*: SchemaTree preview entry points diagnostic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
    seedRelationalSchema();
  });

  // Reason: clicking context menu "Data" must call `handleTableClick` and
  //         create a preview tab. User report — check whether opening from
  //         the context menu accumulates tabs.
  it("AC-156-04a: context menu 'Data' on a table opens a preview tab (isPreview: true)", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tableItem = screen.getByLabelText("users table");

    // Open context menu.
    await act(async () => {
      fireEvent.contextMenu(tableItem, { clientX: 100, clientY: 200 });
    });

    // Click the "Data" menu item.
    await act(async () => {
      fireEvent.click(screen.getByText("Data"));
    });

    const state = getTestWorkspace();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab().isPreview).toBe(true);
    expect(getTableTab().table).toBe("users");
    expect(getTableTab().subView).toBe("records");
  });

  // Reason: clicking context menu "Structure" must open a tab whose subView
  //         is "structure". Checks both the preview flag and the subView
  //         value.
  it("AC-156-04b: context menu 'Structure' on a table opens a structure tab with subView='structure'", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tableItem = screen.getByLabelText("users table");

    await act(async () => {
      fireEvent.contextMenu(tableItem, { clientX: 100, clientY: 200 });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Structure"));
    });

    const state = getTestWorkspace();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab().subView).toBe("structure");
    expect(getTableTab().table).toBe("users");
    // Structure tab created via handleOpenStructure calls addTab, which
    // creates a new tab. It may or may not be preview — we diagnose.
    // Diagnostic: check if it replaces an existing preview slot.
    expect(getTableTab().isPreview).toBe(true);
  });

  // Reason: preview swap must still work when the search filter is active.
  //         Checks that the search filter does not change the `addTab`
  //         branch.
  it("AC-156-04c: clicking a filtered table (search active) opens a preview tab and swap still works", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Type into the search filter to narrow the table list.
    const searchInput = screen.getByLabelText("Filter tables in public");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "ord" } });
    });

    // "orders" should still be visible.
    const ordersItem = screen.getByLabelText("orders table");
    await act(async () => {
      fireEvent.click(ordersItem);
    });

    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("orders");
    expect(getTableTab().isPreview).toBe(true);

    // Clear filter and click a different table — must swap the preview.
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });

    // Should still be 1 tab — the preview slot swapped from orders → users.
    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("users");
    expect(getTableTab().isPreview).toBe(true);
  });

  // Reason: after a promote, clicking another table must leave 2 tabs —
  //         permanent + preview. The existing test
  //         (SchemaTree.preview.test.tsx AC-S136-02) checks the follow-up
  //         click; here the diagnosis runs 3 steps: promote → another table →
  //         yet another table.
  it("AC-156-04d: clicking a different table after promoting one → 2 tabs (1 permanent + 1 preview)", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Step 1: click "users" → preview tab.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });
    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(getTableTab().isPreview).toBe(true);

    // Step 2: double-click "users" → promote.
    await act(async () => {
      fireEvent.doubleClick(screen.getByLabelText("users table"));
    });
    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(getTableTab().isPreview).toBe(false);

    // Step 3: click "orders" → new preview tab alongside the permanent "users".
    await act(async () => {
      fireEvent.click(screen.getByLabelText("orders table"));
    });

    const state = getTestWorkspace();
    expect(state.tabs).toHaveLength(2);

    // Find the permanent and preview tabs.
    const permanent = state.tabs.find(
      (t): t is TableTab => t.type === "table" && t.table === "users",
    );
    const preview = state.tabs.find(
      (t): t is TableTab => t.type === "table" && t.table === "orders",
    );
    expect(permanent).toBeDefined();
    expect(preview).toBeDefined();
    expect(permanent!.isPreview).toBe(false);
    expect(preview!.isPreview).toBe(true);

    // Step 4: click "products" → preview slot swaps (still 2 tabs).
    await act(async () => {
      fireEvent.click(screen.getByLabelText("products table"));
    });

    const state2 = getTestWorkspace();
    expect(state2.tabs).toHaveLength(2);

    const previewAfterSwap = state2.tabs.find(
      (t): t is TableTab => t.type === "table" && t.isPreview === true,
    );
    expect(previewAfterSwap).toBeDefined();
    expect(previewAfterSwap!.table).toBe("products");

    // The permanent "users" tab must remain untouched.
    const permanentStill = state2.tabs.find(
      (t): t is TableTab =>
        t.type === "table" && t.table === "users" && !t.isPreview,
    );
    expect(permanentStill).toBeDefined();
  });

  // Reason: check how a tab is created on a view click. Views go through
  //         `handleViewClick` and set objectKind: "view". Diagnoses whether a
  //         view takes part in the preview slot.
  it("AC-156-04e: clicking a view opens a tab with objectKind='view'", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand the Views category to reveal the "active_users" view.
    const viewsCategoryButton = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCategoryButton);
    });

    // Click the view item.
    const viewItem = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.click(viewItem);
    });

    const state = getTestWorkspace();
    expect(state.tabs).toHaveLength(1);
    const tab = getTableTab();
    expect(tab.table).toBe("active_users");
    expect(tab.objectKind).toBe("view");
    // Diagnostic: check if view tabs participate in the preview system.
    // If this fails, view tabs may always be permanent (isPreview: false).
    expect(tab.isPreview).toBe(true);
  });

  // Reason: check that preview swap works when one view click follows
  //         another. `handleViewClick` calls `addTab`, so it must take the
  //         same swap path.
  it("AC-156-04e (extended): clicking a second view swaps the preview slot", async () => {
    // Seed two views.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {
        "conn1:public": [
          { name: "active_users", schema: "public" },
          { name: "recent_orders", schema: "public" },
        ],
      },
      functions: {},
      loadSchemas: mockLoadSchemas,
      loadTables: mockLoadTables,
      loadViews: mockLoadViews,
      loadFunctions: mockLoadFunctions,
      prefetchSchemaColumns: mockPrefetchSchemaColumns,
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand Views category.
    const viewsCategoryButton = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCategoryButton);
    });

    // Click first view.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("active_users view"));
    });
    expect(getTestWorkspace().tabs).toHaveLength(1);

    // Click second view — must swap, not accumulate.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("recent_orders view"));
    });

    const state = getTestWorkspace();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("recent_orders");
  });

  // Reason: diagnose whether preview swap works when another table is
  //         clicked after context menu "Data". Checks that the context-menu
  //         path and the plain click path take the same `addTab` branch.
  it("AC-156-04a (swap): context menu 'Data' then clicking a different table swaps the preview slot", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Open "users" via context menu → Data.
    const usersItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(usersItem, { clientX: 100, clientY: 200 });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Data"));
    });

    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("users");

    // Now click "orders" via regular click — must swap, not accumulate.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("orders table"));
    });

    const state = getTestWorkspace();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("orders");
    expect(getTableTab().isPreview).toBe(true);
  });

  // Reason: after promoting a table, clicking a view must leave 2 tabs — the
  //         permanent table + the preview view. Diagnoses cross-objectKind
  //         preview slot independence.
  it("AC-156-04d (cross-kind): after promoting a table, clicking a view creates a new preview alongside permanent", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Click "users" → preview.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });
    // Double-click → promote.
    await act(async () => {
      fireEvent.doubleClick(screen.getByLabelText("users table"));
    });
    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(getTableTab().isPreview).toBe(false);

    // Now click a view.
    const viewsCategoryButton = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCategoryButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("active_users view"));
    });

    const state = getTestWorkspace();
    // Should be 2 tabs: permanent "users" + preview "active_users".
    expect(state.tabs).toHaveLength(2);
  });

  // Reason: diagnose whether context menu "Structure" replaces the existing
  //         preview tab. `handleOpenStructure` calls `addTab`, so a preview
  //         swap should happen, but a different subView can fail the
  //         exact-match.
  it("AC-156-04b (swap): context menu 'Structure' after a preview 'Data' tab → replaces the preview slot", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Open "users" via regular click → preview (subView: records).
    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });
    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(getTableTab().subView).toBe("records");
    expect(getTableTab().isPreview).toBe(true);

    // Now open "users" Structure via context menu.
    const usersItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(usersItem, { clientX: 100, clientY: 200 });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Structure"));
    });

    const state = getTestWorkspace();
    // addTab now includes subView in the exact-match and
    // preview-swap checks. A Data preview (records) and Structure tab are
    // treated as separate tabs, so clicking "Structure" after a Data preview
    // creates a second tab instead of activating/replacing the Data preview.
    expect(state.tabs).toHaveLength(2);
    const dataTab = state.tabs.find(
      (t): t is TableTab =>
        t.type === "table" && (t as TableTab).subView === "records",
    );
    const structTab = state.tabs.find(
      (t): t is TableTab =>
        t.type === "table" && (t as TableTab).subView === "structure",
    );
    expect(dataTab).toBeDefined();
    expect(structTab).toBeDefined();
    expect(structTab!.table).toBe("users");
    // The active tab should be the newly created Structure tab
    expect(state.activeTabId).toBe(structTab!.id);
  });
});
