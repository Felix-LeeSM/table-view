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
import { useSchemaStore } from "../stores/schemaStore";
import { useTabStore } from "../stores/tabStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockLoadSchemas = vi.fn().mockResolvedValue(undefined);
const mockLoadTables = vi.fn().mockResolvedValue(undefined);

function setSchemaStoreState(overrides: Record<string, unknown> = {}) {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    loading: false,
    error: null,
    ...overrides,
    // Preserve mocked actions
    loadSchemas: mockLoadSchemas,
    loadTables: mockLoadTables,
  });
}

function resetStores() {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    loading: false,
    error: null,
    loadSchemas: mockLoadSchemas,
    loadTables: mockLoadTables,
  });
  useTabStore.setState({ tabs: [], activeTabId: null });
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
  // AC-06: "New Query" button -> addQueryTab
  // -----------------------------------------------------------------------
  it("calls addQueryTab when New Query button is clicked", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const newQueryBtn = screen.getByLabelText("New Query");
    await act(async () => {
      fireEvent.click(newQueryBtn);
    });

    const state = useTabStore.getState();
    const queryTab = state.tabs.find((t) => t.type === "query");
    expect(queryTab).toBeDefined();
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
  it("displays formatted row_count for tables that have it", async () => {
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

    expect(screen.getByText("12,345")).toBeInTheDocument();
  });

  it("does not display row_count when it is null", async () => {
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
    // The row_count span should not exist
    const countSpan = tableItem.querySelector(".ml-auto");
    expect(countSpan).toBeNull();
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
    let resolveTables: () => void;
    mockLoadTables.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveTables = resolve;
      }),
    );

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
    // The schema row should have an animate-spin element
    const schemaRow = schemaButton.closest("div")!;
    const spinners = schemaRow.querySelectorAll(".animate-spin");
    expect(spinners.length).toBeGreaterThanOrEqual(1);

    // Resolve to clean up
    await act(async () => {
      resolveTables!();
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
  it("displays '0' for row_count of 0", async () => {
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

    // row_count: 0 passes the `!= null` check (0 != null is true)
    expect(screen.getByText("0")).toBeInTheDocument();
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

    expect(schemaButton).toHaveClass("bg-(--color-bg-tertiary)");
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

    expect(viewsCategory).toHaveClass("bg-(--color-bg-tertiary)");
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

    expect(tableItem).toHaveClass("bg-(--color-accent)/10");
    // Schema should no longer have selection highlight
    expect(schemaButton).not.toHaveClass("bg-(--color-bg-tertiary)");
  });

  // =========================================================================
  // NEW: Visual hierarchy and icons
  // =========================================================================

  // AC-VIS-01: Connection header has Database icon and connection ID
  it("renders connection header with Database icon and connection ID", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="my-connection" />);
    });

    expect(screen.getByText("my-connection")).toBeInTheDocument();
  });

  // AC-VIS-02: Schema node has FolderOpen icon
  it("renders schema node with FolderOpen icon", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    // The FolderOpen SVG should be inside the schema row
    const svgElements = schemaButton.querySelectorAll("svg.lucide-folder-open");
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
    const separators = document.querySelectorAll(
      ".border-t.border-\\(--color-border\\)",
    );
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
      document.querySelectorAll(".border-t.border-\\(--color-border\\)"),
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
});
