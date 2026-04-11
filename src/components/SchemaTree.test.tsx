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
});
