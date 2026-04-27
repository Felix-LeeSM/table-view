import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore, type TableTab } from "@stores/tabStore";

// ---------------------------------------------------------------------------
// Sprint 136 — Preview / persist click semantics for the relational tree.
//
// The PG sidebar must satisfy:
//   AC-S136-01  single-click on a table row → preview tab (`isPreview: true`).
//                Switching rows swaps the preview slot (no accumulation).
//   AC-S136-02  same-row double-click → promote (`isPreview: false`).
//   AC-S136-04  same-row single-click twice → idempotent (no second tab, no
//                promote). Only an explicit double-click promotes.
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
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
  });
  useConnectionStore.setState({ connections: [] });
}

function getTableTab(): TableTab {
  const tab = useTabStore.getState().tabs[0]!;
  if (tab.type !== "table") throw new Error("Expected TableTab");
  return tab;
}

describe("SchemaTree — Sprint 136 preview / persist click semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
        ],
      },
    });
  });

  it("AC-S136-01: single-click on a table row opens a preview tab (isPreview=true)", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Single-click `users` table.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(getTableTab().isPreview).toBe(true);
    expect(getTableTab().table).toBe("users");
  });

  it("AC-S136-01: clicking a different row swaps the preview slot (no tab accumulation)", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Click `users` then `orders`. The preview slot must follow the
    // most recent click rather than spawning a second tab.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("orders table"));
    });

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("orders");
    expect(getTableTab().isPreview).toBe(true);
  });

  it("AC-S136-02: double-click on a table row promotes the preview tab (isPreview=false)", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Double-click `users` table — a single click first opens the preview,
    // then the dblclick handler promotes the active tab.
    await act(async () => {
      fireEvent.doubleClick(screen.getByLabelText("users table"));
    });

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(getTableTab().isPreview).toBe(false);
    expect(getTableTab().table).toBe("users");

    // Subsequent single-click on a different row spawns a NEW preview
    // tab beside the now-persistent tab — confirms promote stuck.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("orders table"));
    });
    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(2);
    const tab0 = state.tabs[0]!;
    const tab1 = state.tabs[1]!;
    expect(tab0.type).toBe("table");
    expect(tab1.type).toBe("table");
    if (tab0.type === "table" && tab1.type === "table") {
      expect(tab0.table).toBe("users");
      expect(tab0.isPreview).toBe(false);
      expect(tab1.table).toBe("orders");
      expect(tab1.isPreview).toBe(true);
    }
  });

  it("AC-S136-04: same-row single-click twice is idempotent (no extra tab, no promote)", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });
    const previewId = useTabStore.getState().tabs[0]!.id;

    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    // Same tab — no replacement.
    expect(state.tabs[0]!.id).toBe(previewId);
    // Still preview — single-click never promotes.
    expect(getTableTab().isPreview).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sprint 136 — AC-S136-05: function category overflow cap.
//
// When a schema's function list is large the rendered list must be capped
// (max-height + overflow-y-auto) so it cannot push schema rows or other
// categories out of the sidebar viewport. We assert the presence of the
// cap classes on the function category container; JSDOM does not lay out
// real heights, so a class-based assertion is the reliable signal here.
// ---------------------------------------------------------------------------

describe("SchemaTree — Sprint 136 function category overflow (AC-S136-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  it("caps the function category container with max-h-[50vh] + overflow-y-auto when 60+ functions are present", async () => {
    // 60 function fixtures — well above any plausible single-screen list.
    const functions = Array.from({ length: 60 }, (_, i) => ({
      name: `fn_${String(i).padStart(3, "0")}`,
      schema: "public",
      kind: "function",
      arguments: "",
      returnType: "void",
      language: "sql",
      source: "",
    }));
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      functions: { "conn1:public": functions },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand the function category (it is collapsed by default; tables is
    // the only category in DEFAULT_EXPANDED).
    const functionsCategoryButton = screen.getByLabelText(
      "Functions in public",
    );
    await act(async () => {
      fireEvent.click(functionsCategoryButton);
    });

    // The container directly following the category header must carry the
    // max-h + overflow-y-auto cap so the function list scrolls inside the
    // sidebar instead of pushing layout. The container is tagged with
    // `data-category-overflow="capped"` so the assertion stays robust to
    // future sibling restructuring.
    const cappedContainer = document.querySelector(
      '[data-category-overflow="capped"]',
    );
    expect(cappedContainer).not.toBeNull();
    expect(cappedContainer?.className).toContain("max-h-[50vh]");
    expect(cappedContainer?.className).toContain("overflow-y-auto");

    // Sanity — at least the first function row is rendered inside the
    // capped container so the cap is actually wrapping the list.
    expect(
      cappedContainer?.querySelector('[aria-label$="function"]'),
    ).not.toBeNull();
  });
});
