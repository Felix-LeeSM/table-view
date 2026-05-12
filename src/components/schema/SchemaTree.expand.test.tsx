// Sprint 216 — `expand` axis split from `SchemaTree.test.tsx`. Covers
// schema expand/collapse mechanics, category headers (Tables/Views/
// Functions/Procedures), keyboard toggling, schema/category loading
// spinners, auto-expand on mount, and rendering of view/function/
// procedure rows. Cases are byte-equivalent to the originals.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  mockLoadSchemas,
  mockLoadTables,
  mockLoadViews,
  mockLoadFunctions,
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SchemaTree — expand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  // -----------------------------------------------------------------------
  // AC-03: Schema expand/collapse toggle
  // -----------------------------------------------------------------------
  it("toggles schema expanded state on click (sprint 144 — auto-expanded on mount)", async () => {
    // Sprint 144 (AC-145-1): all schemas paint expanded on first mount, so
    // the first click now COLLAPSES rather than expands. The toggle still
    // works — second click re-expands — which we cover in the next test.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    expect(schemaButton).toHaveAttribute("aria-expanded", "true");

    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(schemaButton).toHaveAttribute("aria-expanded", "false");
  });

  it("collapses then re-expands schema across two clicks (sprint 144 — auto-expanded on mount)", async () => {
    // Sprint 144 (AC-145-1): initial state is expanded, so first click
    // collapses, second click re-expands. Test still covers both edges
    // of the toggle, just from the new starting state.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    expect(schemaButton).toHaveAttribute("aria-expanded", "true");

    // Collapse
    await act(async () => {
      fireEvent.click(schemaButton);
    });
    expect(schemaButton).toHaveAttribute("aria-expanded", "false");

    // Re-expand
    await act(async () => {
      fireEvent.click(schemaButton);
    });
    expect(schemaButton).toHaveAttribute("aria-expanded", "true");
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

    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "public");
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

    // Sprint 144 (AC-145-1): schema is auto-expanded on mount; tables are
    // visible without an explicit click.
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
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

    // Sprint 144: schema is auto-expanded on mount.
    expect(screen.getByText("No tables")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Keyboard interactions
  // -----------------------------------------------------------------------
  it("toggles schema (collapse) on Enter key (sprint 144 — auto-expanded on mount)", async () => {
    // Sprint 144 (AC-145-1): schemas paint expanded; Enter now collapses.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    expect(schemaButton).toHaveAttribute("aria-expanded", "true");

    await act(async () => {
      fireEvent.keyDown(schemaButton, { key: "Enter" });
    });

    expect(schemaButton).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles schema (collapse) on Space key (sprint 144 — auto-expanded on mount)", async () => {
    // Sprint 144 (AC-145-1): schemas paint expanded; Space now collapses.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    expect(schemaButton).toHaveAttribute("aria-expanded", "true");

    await act(async () => {
      fireEvent.keyDown(schemaButton, { key: " " });
    });

    expect(schemaButton).toHaveAttribute("aria-expanded", "false");
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
    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.keyDown(tableItem, { key: "Enter" });
    });

    const state = getTestWorkspace();
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
    // Sprint 144 (AC-145-1): mount-time auto-expand prefetches loadTables
    // as fire-and-forget — the per-schema spinner is set only inside
    // `handleExpandSchema`. To exercise the spinner path we collapse the
    // auto-expanded schema and re-expand it; the second click goes
    // through `handleExpandSchema` and toggles `loadingTables`.
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
    // Collapse, then re-expand — the re-expand goes through
    // handleExpandSchema which sets the per-schema loadingTables flag.
    await act(async () => {
      fireEvent.click(schemaButton);
    });
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

    // The "No tables" empty label should be shown since Tables is auto-expanded
    expect(screen.getByText("No tables")).toBeInTheDocument();
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

    const viewsCategory = screen.getByLabelText("Views in public");
    expect(viewsCategory).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.keyDown(viewsCategory, { key: " " });
    });

    expect(viewsCategory).toHaveAttribute("aria-expanded", "true");
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
    useWorkspaceStore.setState(
      seedWorkspace(
        [
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
        "tab-1",
      ),
    );

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Schema should be auto-expanded without manual click
    const schemaButton = screen.getByLabelText("public schema");
    expect(schemaButton).toHaveAttribute("aria-expanded", "true");
  });

  // AC-EXPAND-02 (sprint 144 update): pre-S144 only the schema matching the
  // active tab was auto-expanded; S144 (AC-145-1) extended auto-expand to
  // ALL schemas on first paint, so this test now verifies the new
  // contract — every schema is expanded regardless of active tab.
  it("auto-expands ALL schemas on mount regardless of active tab (sprint 144)", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }, { name: "analytics" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
        "conn1:analytics": [
          { name: "events", schema: "analytics", row_count: null },
        ],
      },
    });

    // Set active tab to public.users — pre-S144 this would have been the
    // only signal expanding `public`. Post-S144, both schemas expand
    // unconditionally.
    useWorkspaceStore.setState(
      seedWorkspace(
        [
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
        "tab-1",
      ),
    );

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // BOTH schemas must be expanded on first paint.
    expect(screen.getByLabelText("public schema")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("analytics schema")).toHaveAttribute(
      "aria-expanded",
      "true",
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

    // Expand Procedures category
    const proceduresCat = screen.getByLabelText("Procedures in public");
    await act(async () => {
      fireEvent.click(proceduresCat);
    });

    // Only the procedure should appear, not the function
    expect(screen.getByText("do_migration")).toBeInTheDocument();
    expect(screen.queryByText("calculate_total")).not.toBeInTheDocument();
  });

  it("loads views and functions when schema is expanded via click", async () => {
    // Sprint 144: schemas paint expanded on mount, but `handleExpandSchema`
    // (the click handler) is the entry point that triggers loadViews /
    // loadFunctions. Mount-time auto-expand only seeds the expanded *state*
    // and fires loadTables; views/functions are still lazy-loaded on the
    // first user expand action. We exercise that by clicking once to
    // collapse, then clicking again to re-expand — the re-expand call
    // now triggers loadViews + loadFunctions.
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
    // Collapse, then re-expand — second click is the handleExpandSchema
    // path that loads views/functions.
    await act(async () => {
      fireEvent.click(schemaButton);
    });
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(mockLoadViews).toHaveBeenCalledWith("conn1", "db1", "public");
    expect(mockLoadFunctions).toHaveBeenCalledWith("conn1", "db1", "public");
  });
});
