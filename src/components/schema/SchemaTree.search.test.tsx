// Sprint 216 — `search` axis split from `SchemaTree.test.tsx`. Covers
// AC-SEARCH-01..10: per-schema table filter input rendering, typing
// filter, case-insensitivity, clear (X) button, empty-result vs
// always-empty placeholders, isolation from non-tables categories,
// per-schema state independence, and placeholder text. Cases are
// byte-equivalent to the originals.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import {
  mockLoadSchemas,
  mockLoadTables,
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SchemaTree — search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
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

    // Sprint 144: both schemas auto-expanded on mount.
    // Filter in public
    const publicSearch = screen.getByLabelText("Filter tables in public");
    await act(async () => {
      fireEvent.change(publicSearch, { target: { value: "user" } });
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
});
