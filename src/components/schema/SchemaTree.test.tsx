import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import React from "react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockLoadSchemas = vi.fn().mockResolvedValue(undefined);
const mockLoadTables = vi.fn().mockResolvedValue(undefined);
const mockLoadViews = vi.fn().mockResolvedValue(undefined);
const mockLoadFunctions = vi.fn().mockResolvedValue(undefined);
const mockPrefetchSchemaColumns = vi.fn().mockResolvedValue(undefined);

function setSchemaStoreState(overrides: Record<string, unknown> = {}) {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
    ...overrides,
    // Preserve mocked actions
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
  useTabStore.setState({ tabs: [], activeTabId: null });
  useConnectionStore.setState({ connections: [] });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SchemaTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  // -----------------------------------------------------------------------
  // AC-01: Auto-load on mount
  // -----------------------------------------------------------------------
  it("calls loadSchemas with connectionId on mount", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    expect(mockLoadSchemas).toHaveBeenCalledWith("conn1");
  });

  it("does not call loadSchemas again on re-render with same connectionId", async () => {
    let rerenderFn: (ui: React.ReactElement) => void;
    await act(async () => {
      const { rerender } = render(<SchemaTree connectionId="conn1" />);
      rerenderFn = rerender;
    });
    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerenderFn!(<SchemaTree connectionId="conn1" />);
    });
    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // AC-02: Schema list rendering
  // -----------------------------------------------------------------------
  it("renders schema names from store", async () => {
    setSchemaStoreState({
      schemas: {
        conn1: [{ name: "public" }, { name: "analytics" }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    expect(screen.getByText("public")).toBeInTheDocument();
    expect(screen.getByText("analytics")).toBeInTheDocument();
  });

  it("renders nothing when schemas is empty", async () => {
    setSchemaStoreState({ schemas: { conn1: [] } });

    let container: HTMLElement;
    await act(async () => {
      const result = render(<SchemaTree connectionId="conn1" />);
      container = result.container;
    });
    // Header should still render but no schema items
    expect(screen.getByText("Schemas")).toBeInTheDocument();
    expect(container!.querySelectorAll("[aria-expanded]").length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // AC-03: Schema expand/collapse toggle
  // -----------------------------------------------------------------------
  it("expands schema on click and shows ChevronDown", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    expect(schemaButton).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(schemaButton).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses expanded schema on second click", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");

    // Expand
    await act(async () => {
      fireEvent.click(schemaButton);
    });
    expect(schemaButton).toHaveAttribute("aria-expanded", "true");

    // Collapse
    await act(async () => {
      fireEvent.click(schemaButton);
    });
    expect(schemaButton).toHaveAttribute("aria-expanded", "false");
  });

  // -----------------------------------------------------------------------
  // AC-04: loadTables called on first expand
  // -----------------------------------------------------------------------
  it("calls loadTables when expanding a schema for the first time", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "public");
  });

  it("does not call loadTables when expanding a schema that already has cached tables", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(mockLoadTables).not.toHaveBeenCalled();
  });

  it("renders tables inside expanded schema", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-05: Table click -> addTab
  // -----------------------------------------------------------------------
  it("calls addTab with correct params when table is clicked", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand the schema first
    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const tableButton = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.click(tableButton);
    });

    const state = useTabStore.getState();
    const tab = state.tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.title).toBe("public.users");
      expect(tab.connectionId).toBe("conn1");
      expect(tab.table).toBe("users");
      expect(tab.schema).toBe("public");
      expect(tab.subView).toBe("records");
      expect(tab.closable).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // AC-07: Refresh button -> reload schemas
  // -----------------------------------------------------------------------
  it("calls loadSchemas again when Refresh button is clicked", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    // One call from mount
    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);

    // Wait for the initial load to finish (loadingSchemas -> false, button re-enabled)
    await waitFor(() => {
      expect(screen.getByLabelText("Refresh schemas")).not.toBeDisabled();
    });

    const refreshBtn = screen.getByLabelText("Refresh schemas");
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    expect(mockLoadSchemas).toHaveBeenCalledTimes(2);
    expect(mockLoadSchemas).toHaveBeenLastCalledWith("conn1");
  });

  // -----------------------------------------------------------------------
  // AC-08: "No tables" for empty expanded schema
  // -----------------------------------------------------------------------
  it("shows 'No tables' when expanded schema has no tables and not loading", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "empty_schema" }] },
      tables: { "conn1:empty_schema": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("empty_schema schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(screen.getByText("No tables")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-09: row_count display
  // -----------------------------------------------------------------------
  it("displays row_count with the sprint-143 tilde estimate prefix", async () => {
    // Sprint 143 (AC-148-1) — visible cell now reads `~12,345` so the
    // user reads the number as an estimate rather than an exact count.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "big_table", schema: "public", row_count: 12345 },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(screen.getByText("~12,345")).toBeInTheDocument();
  });

  it("renders `?` for the row_count cell when the value is null (sprint 143)", async () => {
    // Sprint 143 (AC-148-2 edge case) — `null` row_count renders the
    // literal `?` instead of being suppressed, so the user reads
    // "value unknown" rather than mistaking a missing cell for `0`.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const tableItem = screen.getByLabelText("users table");
    const countSpan = tableItem.querySelector('[data-row-count="true"]');
    expect(countSpan).not.toBeNull();
    expect(countSpan?.textContent).toBe("?");
  });

  // -----------------------------------------------------------------------
  // AC-10: refresh-schema custom event
  // -----------------------------------------------------------------------
  it("reloads schemas when refresh-schema window event is dispatched", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("refresh-schema"));
    });

    expect(mockLoadSchemas).toHaveBeenCalledTimes(2);
  });

  it("removes refresh-schema listener on unmount", async () => {
    let unmountFn: () => void;
    await act(async () => {
      const { unmount } = render(<SchemaTree connectionId="conn1" />);
      unmountFn = unmount;
    });
    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);

    await act(async () => {
      unmountFn!();
    });

    // Dispatching after unmount should NOT trigger another load
    act(() => {
      window.dispatchEvent(new CustomEvent("refresh-schema"));
    });

    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Keyboard interactions
  // -----------------------------------------------------------------------
  it("expands schema on Enter key", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.keyDown(schemaButton, { key: "Enter" });
    });

    expect(schemaButton).toHaveAttribute("aria-expanded", "true");
  });

  it("expands schema on Space key", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.keyDown(schemaButton, { key: " " });
    });

    expect(schemaButton).toHaveAttribute("aria-expanded", "true");
  });

  it("calls addTab when Enter is pressed on a table item", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand first
    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.keyDown(tableItem, { key: "Enter" });
    });

    const state = useTabStore.getState();
    const tab = state.tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Loading states
  // -----------------------------------------------------------------------
  it("shows spinner in refresh button while loading schemas", async () => {
    // Make loadSchemas hang to keep loading state
    let resolveLoad: () => void;
    mockLoadSchemas.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLoad = resolve;
      }),
    );

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // While loading, the button should contain a spinner (Loader2)
    const refreshBtn = screen.getByLabelText("Refresh schemas");
    expect(refreshBtn).toBeDisabled();

    // Resolve to clean up
    await act(async () => {
      resolveLoad!();
    });
  });

  it("shows loading spinner next to schema name while tables are loading", async () => {
    // Use mockImplementation so every loadTables call (including the auto-load
    // on mount) gets the same pending promise — ensures handleExpandSchema also
    // sees a pending call and sets loadingTables.
    let resolveTables!: () => void;
    const pendingPromise = new Promise<void>((resolve) => {
      resolveTables = resolve;
    });
    mockLoadTables.mockImplementation(() => pendingPromise);

    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Should show a loading spinner next to the schema name
    const schemaRow = schemaButton.closest("div")!;
    const spinners = schemaRow.querySelectorAll(".animate-spin");
    expect(spinners.length).toBeGreaterThanOrEqual(1);

    // Resolve to clean up
    await act(async () => {
      resolveTables();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  it("works when schemas for connectionId is undefined (uses empty array)", async () => {
    setSchemaStoreState({ schemas: {} });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    expect(screen.getByText("Schemas")).toBeInTheDocument();
  });

  it("uses correct table key format connectionId:schemaName", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "my_schema" }] },
      tables: {
        "conn1:my_schema": [
          { name: "t1", schema: "my_schema", row_count: null },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("my_schema schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Tables should appear since they are pre-cached under the correct key
    expect(screen.getByText("t1")).toBeInTheDocument();
    // loadTables should NOT be called since tables are already cached
    expect(mockLoadTables).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // AC-03: connectionId change triggers new loadSchemas
  // -----------------------------------------------------------------------
  it("calls loadSchemas with new connectionId when connectionId changes", async () => {
    setSchemaStoreState({
      schemas: {
        conn1: [{ name: "public" }],
        conn2: [{ name: "dbo" }],
      },
    });

    let rerenderFn: (ui: React.ReactElement) => void;
    await act(async () => {
      const { rerender } = render(<SchemaTree connectionId="conn1" />);
      rerenderFn = rerender;
    });
    expect(mockLoadSchemas).toHaveBeenCalledWith("conn1");

    await act(async () => {
      rerenderFn!(<SchemaTree connectionId="conn2" />);
    });

    expect(mockLoadSchemas).toHaveBeenCalledWith("conn2");
  });

  // -----------------------------------------------------------------------
  // AC-04: row_count edge case — zero
  // -----------------------------------------------------------------------
  it("displays '~0' for row_count of 0 (sprint 143 — still an estimate)", async () => {
    // Sprint 143 (AC-148-1) — `0` is a valid estimate (empty table that
    // *was* analyzed) and gets the same `~` prefix as any non-null
    // estimate. Pre-S143 the cell read a bare "0".
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "empty_table", schema: "public", row_count: 0 },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(screen.getByText("~0")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-05: loadTables failure still clears loading state
  // -----------------------------------------------------------------------
  it("clears loading spinner when loadTables rejects", async () => {
    mockLoadTables.mockRejectedValueOnce(new Error("network error"));

    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Wait for the rejected promise to settle and loading state to clear
    await waitFor(() => {
      const schemaRow = schemaButton.closest("div")!;
      const spinners = schemaRow.querySelectorAll(".animate-spin");
      expect(spinners.length).toBe(0);
    });
  });

  it("clears loading spinner when loadSchemas rejects via refresh", async () => {
    mockLoadSchemas.mockResolvedValueOnce(undefined); // mount call succeeds
    mockLoadSchemas.mockRejectedValueOnce(new Error("network error")); // refresh fails

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Refresh schemas")).not.toBeDisabled();
    });

    const refreshBtn = screen.getByLabelText("Refresh schemas");
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    // After rejection, loading should be cleared
    await waitFor(() => {
      expect(screen.getByLabelText("Refresh schemas")).not.toBeDisabled();
    });
  });

  // =========================================================================
  // NEW: Category headers
  // =========================================================================

  // AC-CAT-01: Category headers are rendered when schema is expanded
  it("shows category headers (Tables, Views, Functions, Procedures) when schema is expanded", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(screen.getByLabelText("Tables in public")).toBeInTheDocument();
    expect(screen.getByLabelText("Views in public")).toBeInTheDocument();
    expect(screen.getByLabelText("Functions in public")).toBeInTheDocument();
    expect(screen.getByLabelText("Procedures in public")).toBeInTheDocument();
  });

  // AC-CAT-02: Tables category is expanded by default
  it("shows Tables category as expanded by default", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(screen.getByLabelText("Tables in public")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  // AC-CAT-03: Other categories are collapsed by default
  it("shows Views, Functions, Procedures categories as collapsed by default", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(screen.getByLabelText("Views in public")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByLabelText("Functions in public")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByLabelText("Procedures in public")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // AC-CAT-04: Collapsing and re-expanding Tables category
  it("collapses and re-expands Tables category on click", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Tables is expanded by default — collapse it
    const tablesCategory = screen.getByLabelText("Tables in public");
    expect(tablesCategory).toHaveAttribute("aria-expanded", "true");

    await act(async () => {
      fireEvent.click(tablesCategory);
    });
    expect(tablesCategory).toHaveAttribute("aria-expanded", "false");
    // Table items should no longer be visible
    expect(screen.queryByLabelText("users table")).not.toBeInTheDocument();

    // Re-expand
    await act(async () => {
      fireEvent.click(tablesCategory);
    });
    expect(tablesCategory).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("users table")).toBeInTheDocument();
  });

  // AC-CAT-05: Expanding an empty category shows empty placeholder
  it("shows 'No views' when Views category is expanded", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const viewsCategory = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCategory);
    });

    expect(screen.getByText("No views")).toBeInTheDocument();
  });

  it("shows 'No functions' when Functions category is expanded", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const functionsCategory = screen.getByLabelText("Functions in public");
    await act(async () => {
      fireEvent.click(functionsCategory);
    });

    expect(screen.getByText("No functions")).toBeInTheDocument();
  });

  it("shows 'No procedures' when Procedures category is expanded", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const proceduresCategory = screen.getByLabelText("Procedures in public");
    await act(async () => {
      fireEvent.click(proceduresCategory);
    });

    expect(screen.getByText("No procedures")).toBeInTheDocument();
  });

  // AC-CAT-06: Tables category shows table count badge
  it("shows table count badge next to Tables category when there are tables", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
          { name: "products", schema: "public", row_count: null },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not show count badge when there are zero tables", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // The "No tables" empty label should be shown since Tables is auto-expanded
    expect(screen.getByText("No tables")).toBeInTheDocument();
  });

  // =========================================================================
  // NEW: Selection highlighting
  // =========================================================================

  // AC-SEL-01: Clicking a schema selects it
  it("highlights schema node when clicked", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(schemaButton).toHaveClass("bg-muted");
  });

  // AC-SEL-02: Clicking a category selects it
  it("highlights category header when clicked", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const viewsCategory = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCategory);
    });

    expect(viewsCategory).toHaveClass("bg-muted");
  });

  // AC-SEL-03: Clicking a table selects it (and deselects previous)
  it("highlights table node when clicked and deselects schema", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand schema — schema becomes selected
    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Click table — table becomes selected
    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.click(tableItem);
    });

    expect(tableItem).toHaveClass("bg-primary/10");
    // Schema should no longer have selection highlight
    expect(schemaButton).not.toHaveClass("bg-muted");
  });

  // =========================================================================
  // NEW: Visual hierarchy and icons
  // =========================================================================

  // AC-VIS-01: Connection header shows connection name when available, falls back to connection ID
  it("renders connection header with connection name when connection exists in store", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "My PostgreSQL",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          has_password: false,
          database: "testdb",
          group_id: null,
          color: null,
          paradigm: "rdb",
        },
      ],
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(screen.getByText("My PostgreSQL")).toBeInTheDocument();
    expect(screen.queryByText("conn1")).not.toBeInTheDocument();
  });

  it("falls back to connection ID when connection is not found in store", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="my-connection" />);
    });

    expect(screen.getByText("my-connection")).toBeInTheDocument();
  });

  // AC-VIS-02: Schema node has Folder icon when collapsed
  it("renders schema node with Folder icon when collapsed", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    // The Folder SVG should be inside the schema row when collapsed
    const svgElements = schemaButton.querySelectorAll("svg.lucide-folder");
    expect(svgElements.length).toBe(1);
  });

  // AC-VIS-03: Different indentation levels
  it("applies different indentation to schema, category, and table levels", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Schema has px-3
    expect(schemaButton).toHaveClass("px-3");

    // Category has pl-6
    const tablesCategory = screen.getByLabelText("Tables in public");
    expect(tablesCategory).toHaveClass("pl-6");

    // Table item has pl-10
    const tableItem = screen.getByLabelText("users table");
    expect(tableItem).toHaveClass("pl-10");
  });

  // =========================================================================
  // NEW: Section separators between schemas
  // =========================================================================

  // AC-SEP-01: Separator between schemas
  it("renders separator between multiple schemas", async () => {
    setSchemaStoreState({
      schemas: {
        conn1: [{ name: "public" }, { name: "analytics" }],
      },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // There should be a border-t separator element between schemas
    const separators = document.querySelectorAll(".border-t.border-border");
    // Only separator between schemas (not the connection header border-b)
    const sectionSeparators = Array.from(separators).filter(
      (el) => el.classList.contains("mx-3") && el.classList.contains("my-0.5"),
    );
    expect(sectionSeparators.length).toBe(1);
  });

  it("does not render separator when there is only one schema", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const sectionSeparators = Array.from(
      document.querySelectorAll(".border-t.border-border"),
    ).filter(
      (el) => el.classList.contains("mx-3") && el.classList.contains("my-0.5"),
    );
    expect(sectionSeparators.length).toBe(0);
  });

  // =========================================================================
  // NEW: Category keyboard interactions
  // =========================================================================

  it("toggles category on Enter key", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const viewsCategory = screen.getByLabelText("Views in public");
    expect(viewsCategory).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.keyDown(viewsCategory, { key: "Enter" });
    });

    expect(viewsCategory).toHaveAttribute("aria-expanded", "true");
  });

  it("toggles category on Space key", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const viewsCategory = screen.getByLabelText("Views in public");
    expect(viewsCategory).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.keyDown(viewsCategory, { key: " " });
    });

    expect(viewsCategory).toHaveAttribute("aria-expanded", "true");
  });

  // =========================================================================
  // NEW: "Schemas" header label
  // =========================================================================

  it("renders 'Schemas' header label", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(screen.getByText("Schemas")).toBeInTheDocument();
  });

  // =========================================================================
  // NEW: Context menu — table node
  // =========================================================================

  // Helper: expand schema so table items are visible
  async function expandSchemaWithTables() {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });
  }

  // AC-CM-01: Right-clicking a table node shows context menu with correct items
  it("shows context menu with Structure/Data/Rename/Drop on table right-click", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    // ContextMenu should render with the expected items
    expect(screen.getByText("Structure")).toBeInTheDocument();
    expect(screen.getByText("Data")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Drop")).toBeInTheDocument();
  });

  // AC-CM-02: Context menu closes when onClose is called (click outside)
  it("closes table context menu when close handler fires", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    expect(screen.getByText("Structure")).toBeInTheDocument();

    // The ContextMenu component handles its own close-on-click-outside.
    // Simulate by pressing Escape
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByText("Structure")).not.toBeInTheDocument();
  });

  // AC-CM-03: Structure opens tab with subView "structure"
  it("opens tab with subView 'structure' when Structure menu item is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    // Click the Structure menu item
    await act(async () => {
      fireEvent.click(screen.getByText("Structure"));
    });

    const state = useTabStore.getState();
    const tab = state.tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("structure");
      expect(tab.table).toBe("users");
      expect(tab.schema).toBe("public");
    }
  });

  // AC-CM-04: Data opens tab with subView "records"
  it("opens tab with subView 'records' when Data menu item is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Data"));
    });

    const state = useTabStore.getState();
    const tab = state.tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("records");
      expect(tab.table).toBe("users");
    }
  });

  // AC-CM-05: Drop shows confirmation dialog
  it("shows confirmation dialog when Drop menu item is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Drop"));
    });

    // Confirmation dialog should be visible
    expect(
      screen.getByRole("dialog", { name: "Drop Table" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to drop/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This action cannot be undone/),
    ).toBeInTheDocument();
  });

  // AC-CM-06: Drop confirmation cancel closes dialog
  it("closes drop confirmation dialog when Cancel is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Drop"));
    });

    expect(
      screen.getByRole("dialog", { name: "Drop Table" }),
    ).toBeInTheDocument();

    // Click Cancel (find the one inside the dialog)
    const dialog = screen.getByRole("dialog", { name: "Drop Table" });
    const cancelBtn = dialog.querySelector("button:not([aria-label])");
    await act(async () => {
      fireEvent.click(cancelBtn!);
    });

    // Dialog should be gone
    expect(
      screen.queryByRole("dialog", { name: "Drop Table" }),
    ).not.toBeInTheDocument();
  });

  // AC-CM-07: Drop confirmation calls dropTable store action
  it("calls dropTable when confirming drop dialog", async () => {
    const mockDropTable = vi.fn().mockResolvedValue(undefined);
    // Override the dropTable action in the store
    useSchemaStore.setState({ dropTable: mockDropTable });

    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Drop"));
    });

    // Click the confirm button inside the dialog
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Drop Table" }));
    });

    expect(mockDropTable).toHaveBeenCalledWith("conn1", "users", "public");
  });

  // AC-CM-08: Rename shows rename dialog
  it("shows rename dialog when Rename menu item is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    // Rename dialog should be visible
    expect(screen.getByText("Rename Table")).toBeInTheDocument();
    expect(screen.getByText("public.users")).toBeInTheDocument();
    expect(screen.getByLabelText("New table name")).toBeInTheDocument();
    expect(screen.getByLabelText("Rename")).toBeInTheDocument();
  });

  // AC-CM-09: Rename dialog pre-fills current name
  it("pre-fills rename input with current table name", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    const input = screen.getByLabelText("New table name") as HTMLInputElement;
    expect(input.value).toBe("users");
  });

  // AC-CM-10: Rename dialog cancel closes dialog
  it("closes rename dialog when Cancel is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    expect(screen.getByText("Rename Table")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Cancel"));
    });

    expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
  });

  // AC-CM-11: Rename confirmation calls renameTable store action
  it("calls renameTable when confirming rename dialog", async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    useSchemaStore.setState({ renameTable: mockRename });

    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    // Change the name
    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "people" } });
    });

    // Confirm
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Rename"));
    });

    expect(mockRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
    );
  });

  // AC-CM-12: Rename with Enter key
  it("submits rename on Enter key", async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    useSchemaStore.setState({ renameTable: mockRename });

    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "people" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(mockRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
    );
  });

  // AC-CM-13: Rename dialog closes on Escape
  it("closes rename dialog on Escape key", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
  });

  // AC-CM-14: Rename validation - empty name
  it("shows error when renaming to empty string", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Rename"));
    });

    expect(
      screen.getByText("Table name must not be empty"),
    ).toBeInTheDocument();
  });

  // AC-CM-15: Rename validation - invalid characters
  it("shows error when renaming to name with invalid characters", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "bad-name!" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Rename"));
    });

    expect(
      screen.getByText(/must start with a letter or underscore/),
    ).toBeInTheDocument();
  });

  // AC-CM-16: Rename same name just closes dialog (no-op)
  it("closes dialog without calling renameTable when name is unchanged", async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    useSchemaStore.setState({ renameTable: mockRename });

    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    // Don't change the name, just click rename
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Rename"));
    });

    expect(mockRename).not.toHaveBeenCalled();
    expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
  });

  // =========================================================================
  // NEW: Context menu — schema node
  // =========================================================================

  // AC-CM-17: Right-clicking a schema node shows Refresh context menu
  it("shows context menu with Refresh on schema right-click", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.contextMenu(schemaButton, {
        clientX: 100,
        clientY: 200,
      });
    });

    expect(screen.getByText("Refresh")).toBeInTheDocument();
    // Table context menu items should NOT be present
    expect(screen.queryByText("Structure")).not.toBeInTheDocument();
    expect(screen.queryByText("Drop")).not.toBeInTheDocument();
  });

  // AC-CM-18: Schema Refresh reloads tables for that schema
  it("calls loadTables when schema Refresh is clicked", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.contextMenu(schemaButton, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Refresh"));
    });

    // loadTables should be called for this specific schema
    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "public");
  });

  // =========================================================================
  // NEW: Table search/filter
  // =========================================================================

  // Helper: expand schema with multiple tables for search testing
  async function expandSchemaWithMultipleTables() {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
          { name: "products", schema: "public", row_count: null },
          { name: "user_settings", schema: "public", row_count: null },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });
  }

  // AC-SEARCH-01: Search input renders in expanded Tables category
  it("renders search input when Tables category is expanded with tables", async () => {
    await expandSchemaWithMultipleTables();

    expect(
      screen.getByLabelText("Filter tables in public"),
    ).toBeInTheDocument();
  });

  // AC-SEARCH-02: Search input does not render when there are no tables
  it("does not render search input when there are no tables", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(
      screen.queryByLabelText("Filter tables in public"),
    ).not.toBeInTheDocument();
  });

  // AC-SEARCH-03: Typing in search input filters tables
  it("filters tables when typing in search input", async () => {
    await expandSchemaWithMultipleTables();

    const searchInput = screen.getByLabelText("Filter tables in public");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "user" } });
    });

    // Should show "users" and "user_settings", hide "orders" and "products"
    expect(screen.getByLabelText("users table")).toBeInTheDocument();
    expect(screen.getByLabelText("user_settings table")).toBeInTheDocument();
    expect(screen.queryByLabelText("orders table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("products table")).not.toBeInTheDocument();
  });

  // AC-SEARCH-04: Search is case-insensitive
  it("filters tables case-insensitively", async () => {
    await expandSchemaWithMultipleTables();

    const searchInput = screen.getByLabelText("Filter tables in public");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "ORD" } });
    });

    expect(screen.getByLabelText("orders table")).toBeInTheDocument();
    expect(screen.queryByLabelText("users table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("products table")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("user_settings table"),
    ).not.toBeInTheDocument();
  });

  // AC-SEARCH-05: Clear button (X) resets the filter
  it("shows clear button when search has text and clicking it clears filter", async () => {
    await expandSchemaWithMultipleTables();

    const searchInput = screen.getByLabelText("Filter tables in public");

    // No clear button when empty
    expect(
      screen.queryByLabelText("Clear table filter in public"),
    ).not.toBeInTheDocument();

    // Type something
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "user" } });
    });

    // Clear button should appear
    expect(
      screen.getByLabelText("Clear table filter in public"),
    ).toBeInTheDocument();

    // Click clear
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Clear table filter in public"));
    });

    // All tables should be visible again
    expect(screen.getByLabelText("users table")).toBeInTheDocument();
    expect(screen.getByLabelText("orders table")).toBeInTheDocument();
    expect(screen.getByLabelText("products table")).toBeInTheDocument();
    expect(screen.getByLabelText("user_settings table")).toBeInTheDocument();

    // Search input should be empty
    expect(
      (screen.getByLabelText("Filter tables in public") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  // AC-SEARCH-06: Empty result shows "No matching tables"
  it("shows 'No matching tables' when filter matches no tables", async () => {
    await expandSchemaWithMultipleTables();

    const searchInput = screen.getByLabelText("Filter tables in public");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "zzznonexistent" } });
    });

    expect(screen.getByText("No matching tables")).toBeInTheDocument();
    expect(screen.queryByLabelText("users table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("orders table")).not.toBeInTheDocument();
  });

  // AC-SEARCH-07: "No tables" (original empty label) still shows when no search active
  it("shows 'No tables' (not 'No matching tables') when category is empty and no search active", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(screen.getByText("No tables")).toBeInTheDocument();
    expect(screen.queryByText("No matching tables")).not.toBeInTheDocument();
  });

  // AC-SEARCH-08: Search does not affect non-tables categories
  it("does not affect Views/Functions/Procedures categories", async () => {
    await expandSchemaWithMultipleTables();

    // Expand Views
    const viewsCategory = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCategory);
    });

    // Type in search
    const searchInput = screen.getByLabelText("Filter tables in public");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "user" } });
    });

    // Views should still show "No views"
    expect(screen.getByText("No views")).toBeInTheDocument();
  });

  // AC-SEARCH-09: Search state is per-schema (independent)
  it("maintains separate search state per schema", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }, { name: "analytics" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
        ],
        "conn1:analytics": [
          { name: "events", schema: "analytics", row_count: null },
          { name: "page_views", schema: "analytics", row_count: null },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand public
    const publicSchema = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(publicSchema);
    });

    // Filter in public
    const publicSearch = screen.getByLabelText("Filter tables in public");
    await act(async () => {
      fireEvent.change(publicSearch, { target: { value: "user" } });
    });

    // Expand analytics
    const analyticsSchema = screen.getByLabelText("analytics schema");
    await act(async () => {
      fireEvent.click(analyticsSchema);
    });

    // Analytics search should be empty (all tables visible)
    expect(screen.getByLabelText("events table")).toBeInTheDocument();
    expect(screen.getByLabelText("page_views table")).toBeInTheDocument();
  });

  // AC-SEARCH-10: Search input has correct placeholder
  it("has 'Filter tables...' placeholder text", async () => {
    await expandSchemaWithMultipleTables();

    const searchInput = screen.getByLabelText(
      "Filter tables in public",
    ) as HTMLInputElement;
    expect(searchInput.placeholder).toBe("Filter tables...");
  });

  // -----------------------------------------------------------------------
  // select-none on root element
  // -----------------------------------------------------------------------
  it("has select-none class on root element to prevent text selection", async () => {
    const { container } = await act(async () => {
      return render(<SchemaTree connectionId="conn1" />);
    });

    const rootDiv = container.firstElementChild as HTMLElement;
    expect(rootDiv).toBeTruthy();
    expect(rootDiv.className).toContain("select-none");
  });

  // =========================================================================
  // NEW: Active tab highlight (Sprint 54)
  // =========================================================================

  // AC-ACTIVE-01: Table node matching active tab gets highlight class
  it("highlights table node when it matches the active tab", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
        ],
      },
    });

    // Pre-set an active tab pointing to public.users
    useTabStore.setState({
      tabs: [
        {
          type: "table",
          id: "tab-1",
          title: "public.users",
          connectionId: "conn1",
          closable: true,
          schema: "public",
          table: "users",
          subView: "records",
        },
      ],
      activeTabId: "tab-1",
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Schema should auto-expand due to active tab
    const schemaButton = screen.getByLabelText("public schema");
    expect(schemaButton).toHaveAttribute("aria-expanded", "true");

    // The active table (users) should have highlight class
    const usersItem = screen.getByLabelText("users table");
    expect(usersItem).toHaveClass("bg-primary/10");
    expect(usersItem).toHaveClass("text-primary");
    expect(usersItem).toHaveClass("font-semibold");

    // The other table (orders) should NOT have highlight
    const ordersItem = screen.getByLabelText("orders table");
    expect(ordersItem).not.toHaveClass("bg-primary/10");
    expect(ordersItem).not.toHaveClass("text-primary");
  });

  // AC-ACTIVE-02: No highlight when active tab is a query tab
  it("does not highlight any table when active tab is a query tab", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    // Set a query tab as active
    useTabStore.setState({
      tabs: [
        {
          type: "query",
          id: "query-1",
          title: "Query 1",
          connectionId: "conn1",
          closable: true,
          sql: "SELECT 1",
          queryState: { status: "idle" },
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
      activeTabId: "query-1",
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand schema manually
    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // No table should have active highlight from tab state
    const usersItem = screen.getByLabelText("users table");
    // It won't have bg-primary/10 from active tab since it's a query tab
    expect(usersItem).not.toHaveClass("font-semibold");
  });

  // AC-ACTIVE-03: Highlight updates when active tab changes
  it("updates highlight when active tab changes to a different table", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
        ],
      },
    });

    // Start with users tab active
    useTabStore.setState({
      tabs: [
        {
          type: "table",
          id: "tab-1",
          title: "public.users",
          connectionId: "conn1",
          closable: true,
          schema: "public",
          table: "users",
          subView: "records",
        },
      ],
      activeTabId: "tab-1",
    });

    const { rerender } = await act(async () => {
      return render(<SchemaTree connectionId="conn1" />);
    });

    // Users should be highlighted
    expect(screen.getByLabelText("users table")).toHaveClass("bg-primary/10");

    // Switch active tab to orders
    await act(async () => {
      useTabStore.setState({
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "public.users",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
          },
          {
            type: "table",
            id: "tab-2",
            title: "public.orders",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "orders",
            subView: "records",
          },
        ],
        activeTabId: "tab-2",
      });
    });

    await act(async () => {
      rerender(<SchemaTree connectionId="conn1" />);
    });

    // Now orders should be highlighted, users should not
    expect(screen.getByLabelText("orders table")).toHaveClass("bg-primary/10");
    expect(screen.getByLabelText("users table")).not.toHaveClass(
      "bg-primary/10",
    );
  });

  // =========================================================================
  // NEW: Schema auto-expand on active tab (Sprint 54)
  // =========================================================================

  // AC-EXPAND-01: Schema auto-expands when active tab targets it
  it("auto-expands schema when active tab has table in that schema", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    // Set active tab AFTER store is set up
    useTabStore.setState({
      tabs: [
        {
          type: "table",
          id: "tab-1",
          title: "public.users",
          connectionId: "conn1",
          closable: true,
          schema: "public",
          table: "users",
          subView: "records",
        },
      ],
      activeTabId: "tab-1",
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Schema should be auto-expanded without manual click
    const schemaButton = screen.getByLabelText("public schema");
    expect(schemaButton).toHaveAttribute("aria-expanded", "true");
  });

  // AC-EXPAND-02: Only the matching schema auto-expands (not others)
  it("auto-expands only the schema matching active tab, not other schemas", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }, { name: "analytics" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
        "conn1:analytics": [
          { name: "events", schema: "analytics", row_count: null },
        ],
      },
    });

    // Set active tab to public.users
    useTabStore.setState({
      tabs: [
        {
          type: "table",
          id: "tab-1",
          title: "public.users",
          connectionId: "conn1",
          closable: true,
          schema: "public",
          table: "users",
          subView: "records",
        },
      ],
      activeTabId: "tab-1",
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // public should be expanded
    expect(screen.getByLabelText("public schema")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // analytics should NOT be expanded
    expect(screen.getByLabelText("analytics schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // =========================================================================
  // NEW: Icon rendering per hierarchy level (Sprint 54)
  // =========================================================================

  // AC-ICON-02: Schema node shows Folder icon when collapsed, FolderOpen when expanded
  it("renders Folder icon when schema is collapsed and FolderOpen when expanded", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");

    // Collapsed: should have Folder icon
    const folderIcons = schemaButton.querySelectorAll("svg.lucide-folder");
    const folderOpenIcons = schemaButton.querySelectorAll(
      "svg.lucide-folder-open",
    );
    // When collapsed, should have lucide-folder (not lucide-folder-open)
    expect(folderIcons.length).toBe(1);
    expect(folderOpenIcons.length).toBe(0);

    // Expand
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Expanded: should have FolderOpen icon
    const folderOpenAfterExpand = schemaButton.querySelectorAll(
      "svg.lucide-folder-open",
    );
    const folderAfterExpand =
      schemaButton.querySelectorAll("svg.lucide-folder");
    expect(folderOpenAfterExpand.length).toBe(1);
    expect(folderAfterExpand.length).toBe(0);
  });

  // AC-ICON-03: Procedures category uses Terminal icon (distinct from Functions' Code2)
  it("renders Terminal icon for Procedures category", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Procedures category should have a Terminal icon
    const proceduresCategory = screen.getByLabelText("Procedures in public");
    const terminalIcons = proceduresCategory.querySelectorAll(
      "svg.lucide-terminal",
    );
    expect(terminalIcons.length).toBe(1);
  });

  // AC-ICON-04: Category icons are distinct from each other
  it("renders distinct icons for each category type", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const tablesCat = screen.getByLabelText("Tables in public");
    const viewsCat = screen.getByLabelText("Views in public");
    const functionsCat = screen.getByLabelText("Functions in public");
    const proceduresCat = screen.getByLabelText("Procedures in public");

    // Tables: LayoutGrid
    expect(tablesCat.querySelectorAll("svg.lucide-layout-grid").length).toBe(1);
    // Views: Eye
    expect(viewsCat.querySelectorAll("svg.lucide-eye").length).toBe(1);
    // Functions: Code2 (renders as lucide-code-xml)
    expect(functionsCat.querySelectorAll("svg.lucide-code-xml").length).toBe(1);
    // Procedures: Terminal
    expect(proceduresCat.querySelectorAll("svg.lucide-terminal").length).toBe(
      1,
    );
  });

  // =========================================================================
  // NEW: Views and Functions rendering with real data
  // =========================================================================

  it("renders view items under Views category", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {
        "conn1:public": [
          {
            name: "active_users",
            schema: "public",
            definition: "SELECT * FROM users WHERE active = true",
          },
        ],
      },
      functions: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Expand Views category
    const viewsCat = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCat);
    });

    expect(screen.getByText("active_users")).toBeInTheDocument();
  });

  it("renders function items under Functions category", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {},
      functions: {
        "conn1:public": [
          {
            name: "calculate_total",
            schema: "public",
            arguments: "user_id integer",
            returnType: "numeric",
            language: "plpgsql",
            source: "BEGIN RETURN 0; END",
            kind: "function",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Expand Functions category
    const functionsCat = screen.getByLabelText("Functions in public");
    await act(async () => {
      fireEvent.click(functionsCat);
    });

    expect(screen.getByText("calculate_total")).toBeInTheDocument();
  });

  it("renders procedure items under Procedures category", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {},
      functions: {
        "conn1:public": [
          {
            name: "do_migration",
            schema: "public",
            arguments: null,
            returnType: null,
            language: "plpgsql",
            source: "BEGIN END",
            kind: "procedure",
          },
          {
            name: "calculate_total",
            schema: "public",
            arguments: "user_id integer",
            returnType: "numeric",
            language: "plpgsql",
            source: "BEGIN RETURN 0; END",
            kind: "function",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Expand Procedures category
    const proceduresCat = screen.getByLabelText("Procedures in public");
    await act(async () => {
      fireEvent.click(proceduresCat);
    });

    // Only the procedure should appear, not the function
    expect(screen.getByText("do_migration")).toBeInTheDocument();
    expect(screen.queryByText("calculate_total")).not.toBeInTheDocument();
  });

  it("shows count badges for views and functions", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 5 }],
      },
      views: {
        "conn1:public": [
          { name: "v1", schema: "public", definition: null },
          { name: "v2", schema: "public", definition: null },
        ],
      },
      functions: {
        "conn1:public": [
          {
            name: "f1",
            schema: "public",
            arguments: null,
            returnType: null,
            language: "sql",
            source: null,
            kind: "function",
          },
          {
            name: "p1",
            schema: "public",
            arguments: null,
            returnType: null,
            language: "plpgsql",
            source: null,
            kind: "procedure",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Check count badges
    const tablesCat = screen.getByLabelText("Tables in public");
    const viewsCat = screen.getByLabelText("Views in public");
    const functionsCat = screen.getByLabelText("Functions in public");
    const proceduresCat = screen.getByLabelText("Procedures in public");

    expect(tablesCat.textContent).toContain("1");
    expect(viewsCat.textContent).toContain("2");
    expect(functionsCat.textContent).toContain("1");
    expect(proceduresCat.textContent).toContain("1");
  });

  it("loads views and functions when schema is expanded", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
      views: {},
      functions: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(mockLoadViews).toHaveBeenCalledWith("conn1", "public");
    expect(mockLoadFunctions).toHaveBeenCalledWith("conn1", "public");
  });

  it("clicking a view item opens a table tab with view name", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {
        "conn1:public": [
          { name: "active_users", schema: "public", definition: "SELECT 1" },
        ],
      },
      functions: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const viewsCat = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCat);
    });

    const viewItem = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.click(viewItem);
    });

    const tabState = useTabStore.getState();
    expect(tabState.tabs).toHaveLength(1);
    expect(tabState.tabs[0]!.type).toBe("table");
    if (tabState.tabs[0]!.type === "table") {
      expect(tabState.tabs[0]!.table).toBe("active_users");
      expect(tabState.tabs[0]!.schema).toBe("public");
    }
  });

  it("clicking a function item opens a query tab", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {},
      functions: {
        "conn1:public": [
          {
            name: "calculate_total",
            schema: "public",
            arguments: "x integer",
            returnType: "integer",
            language: "plpgsql",
            source: "BEGIN RETURN x; END",
            kind: "function",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const functionsCat = screen.getByLabelText("Functions in public");
    await act(async () => {
      fireEvent.click(functionsCat);
    });

    const funcItem = screen.getByLabelText("calculate_total function");
    await act(async () => {
      fireEvent.click(funcItem);
    });

    const tabState = useTabStore.getState();
    expect(tabState.tabs).toHaveLength(1);
    expect(tabState.tabs[0]!.type).toBe("query");
    if (tabState.tabs[0]!.type === "query") {
      expect(tabState.tabs[0]!.sql).toBe("BEGIN RETURN x; END");
    }
  });

  // =========================================================================
  // View context menu — Structure routes to ViewStructurePanel
  // =========================================================================

  async function expandSchemaWithView() {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {
        "conn1:public": [
          {
            name: "active_users",
            schema: "public",
            definition: "SELECT * FROM users WHERE active = true",
          },
        ],
      },
      functions: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const viewsCat = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCat);
    });
  }

  it("opens view tab in records mode with objectKind 'view' on left click", async () => {
    await expandSchemaWithView();

    const viewItem = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.click(viewItem);
    });

    const tab = useTabStore.getState().tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("records");
      expect(tab.objectKind).toBe("view");
      expect(tab.table).toBe("active_users");
    }
  });

  it("opens view tab in structure mode when context-menu Structure is clicked", async () => {
    await expandSchemaWithView();

    const viewItem = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.contextMenu(viewItem, { clientX: 100, clientY: 200 });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Structure"));
    });

    const tab = useTabStore.getState().tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("structure");
      expect(tab.objectKind).toBe("view");
      expect(tab.table).toBe("active_users");
    }
  });

  it("opens view tab in records mode when context-menu Data is clicked", async () => {
    await expandSchemaWithView();

    const viewItem = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.contextMenu(viewItem, { clientX: 100, clientY: 200 });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Data"));
    });

    const tab = useTabStore.getState().tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("records");
      expect(tab.objectKind).toBe("view");
    }
  });

  // =========================================================================
  // Sprint 107 (#TREE-1): F2 keyboard rename on focused table button
  // =========================================================================

  // AC-01: F2 on focused table button opens Rename Dialog
  it("opens rename dialog when F2 is pressed on a focused table button", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const tableButton = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.keyDown(tableButton, { key: "F2" });
    });

    expect(screen.getByText("Rename Table")).toBeInTheDocument();
    expect(screen.getByText("public.users")).toBeInTheDocument();
    expect(screen.getByLabelText("New table name")).toBeInTheDocument();
  });

  // AC-04: F2 on focused view button does NOT open Rename Dialog
  it("does not open rename dialog when F2 is pressed on a focused view button", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {
        "conn1:public": [
          {
            name: "active_users",
            schema: "public",
            definition: "SELECT * FROM users WHERE active = true",
          },
        ],
      },
      functions: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const viewsCat = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCat);
    });

    const viewButton = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.keyDown(viewButton, { key: "F2" });
    });

    expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
  });

  // AC-04: F2 on focused function button does NOT open Rename Dialog
  it("does not open rename dialog when F2 is pressed on a focused function button", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {},
      functions: {
        "conn1:public": [
          {
            name: "calculate_total",
            schema: "public",
            arguments: "user_id integer",
            returnType: "numeric",
            language: "plpgsql",
            source: "BEGIN RETURN 0; END",
            kind: "function",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const functionsCat = screen.getByLabelText("Functions in public");
    await act(async () => {
      fireEvent.click(functionsCat);
    });

    const funcButton = screen.getByLabelText("calculate_total function");
    await act(async () => {
      fireEvent.keyDown(funcButton, { key: "F2" });
    });

    expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
  });

  // AC-02: After dialog opens (via F2), input is focused and selection covers full name
  it("focuses rename input and selects full existing name when opened via F2", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const tableButton = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.keyDown(tableButton, { key: "F2" });
    });

    const input = screen.getByLabelText("New table name") as HTMLInputElement;
    // autoFocus + onFocus={select()} should focus the input and select its full
    // contents so the user can type to overwrite the existing name immediately.
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("users");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("users".length);
  });

  // AC-03: Enter inside the F2-opened dialog input commits the rename
  it("commits rename on Enter when dialog was opened via F2", async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);

    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });
    useSchemaStore.setState({ renameTable: mockRename });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const tableButton = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.keyDown(tableButton, { key: "F2" });
    });

    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "people" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(mockRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
    );
  });
});
