import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useTabStore } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { TableInfo } from "@/types/schema";

/**
 * Sprint-115 (#PERF-2, #TREE-4) — virtualization regression tests.
 *
 * The SchemaTree flattens its expanded subtree into a "visible rows" list and
 * hands rendering off to `@tanstack/react-virtual` once that list grows past
 * `VIRTUALIZE_THRESHOLD = 200`. jsdom returns 0 for `offsetWidth` /
 * `offsetHeight` and clamps `getBoundingClientRect` to a zero rect, which
 * makes the virtualizer think the scroll container has no viewport and
 * render zero rows. Patching `offsetWidth` / `offsetHeight` /
 * `getBoundingClientRect` on `HTMLElement.prototype` (the same trick
 * sprint-114 uses for the DataGrid virtualization tests) lifts the viewport
 * to a sensible size so `getVirtualItems()` returns a stable window.
 */

const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT_ESTIMATE = 26;

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
  useTabStore.setState({ tabs: [], activeTabId: null });
  useConnectionStore.setState({ connections: [] });
}

function makeTables(count: number): TableInfo[] {
  const out: TableInfo[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      name: `table_${i.toString().padStart(4, "0")}`,
      schema: "public",
      row_count: null,
    });
  }
  return out;
}

const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalClientHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientHeight",
);
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;

describe("SchemaTree virtualization (sprint-115)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    mockLoadViews.mockResolvedValue(undefined);
    mockLoadFunctions.mockResolvedValue(undefined);
    resetStores();

    // Force every element to report a non-zero size so `react-virtual`
    // thinks the scroll container has a viewport. Constant height here is
    // enough — the test only needs `getVirtualItems()` to return a stable
    // windowed slice, not pixel-perfect placement.
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return 320;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return VIEWPORT_HEIGHT;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return VIEWPORT_HEIGHT;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 320,
        bottom: VIEWPORT_HEIGHT,
        width: 320,
        height: VIEWPORT_HEIGHT,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  });

  afterEach(() => {
    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        originalOffsetWidth,
      );
    }
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    }
    if (originalClientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientHeight",
        originalClientHeight,
      );
    }
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  // ---------------------------------------------------------------------
  // AC-01 — DOM cap with 1000-table fixture
  // ---------------------------------------------------------------------
  it("AC-01 — caps DOM table buttons at viewport-sized window when expanded schema has 1000 tables", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": makeTables(1000) },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand the schema so all 1000 table rows enter the visible-rows list.
    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // After expansion the visible-rows list is roughly:
    //   schema (1) + 4 categories + search input (1) + 1000 table items
    // = 1006 — well past the 200-row threshold, so the virtualizer kicks in
    // and only renders a viewport-sized window of `<button aria-label="X table">`
    // rows. Estimated row height = 26px, viewport = 600px ⇒ ~23 visible +
    // overscan(8) on each side ≈ 40 rows; 100 is a generous upper bound.
    const tableButtons = screen.getAllByLabelText(/^table_\d+ table$/);
    expect(tableButtons.length).toBeLessThanOrEqual(100);
    // Sanity: at least one row materialised (otherwise the polyfill failed
    // and we'd be measuring an empty viewport).
    expect(tableButtons.length).toBeGreaterThan(0);
    // Sanity: total dataset is still 1000 — the virtualizer just hides the
    // tail. The schema row label should still be present.
    expect(screen.getByLabelText("public schema")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // AC-02 — expand/collapse re-flattens the visible list
  // ---------------------------------------------------------------------
  it("AC-02 — collapsing the schema removes virtualized item rows from DOM", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": makeTables(1000) },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Re-query the schema button after every state change because the eager
    // ↔ virtualized branches render distinct React trees, so an element ref
    // captured in one branch is detached after the threshold flips.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("public schema"));
    });

    // Some virtualized table rows must be in the DOM after expand.
    expect(
      screen.getAllByLabelText(/^table_\d+ table$/).length,
    ).toBeGreaterThan(0);

    // Collapse — the expanded categories and items vanish from the visible
    // list, the flat list drops below the threshold, and we fall back to
    // the eager nested render (which renders just the schema row).
    await act(async () => {
      fireEvent.click(screen.getByLabelText("public schema"));
    });

    expect(screen.getByLabelText("public schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryAllByLabelText(/^table_\d+ table$/).length).toBe(0);
  });

  it("AC-02 — collapsing the Tables category drops item rows out of the virtual window", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": makeTables(1000) },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("public schema"));
    });

    // Tables is auto-expanded, so item rows should be present.
    expect(
      screen.getAllByLabelText(/^table_\d+ table$/).length,
    ).toBeGreaterThan(0);

    // Collapse the Tables category. The flat visible-rows list collapses to
    // schema (1) + 4 categories = 5 rows — well below the threshold — so
    // the eager path takes over and zero table item buttons are rendered.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Tables in public"));
    });

    expect(screen.getByLabelText("Tables in public")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryAllByLabelText(/^table_\d+ table$/).length).toBe(0);
  });

  // ---------------------------------------------------------------------
  // AC-03 — F2 rename still works under virtualization (sprint-107 regression)
  // ---------------------------------------------------------------------
  it("AC-03 — F2 on a virtualized table row opens the rename dialog with the input focused", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": makeTables(1000) },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Pick the first virtualized table row that's actually in the DOM —
    // we don't care which one, only that F2 on a virtualized item still
    // opens the rename Dialog with the row's name selected, identical to
    // the non-virtualized path (sprint-107).
    const tableButtons = screen.getAllByLabelText(/^table_\d+ table$/);
    expect(tableButtons.length).toBeGreaterThan(0);
    const firstButton = tableButtons[0]!;
    const expectedName = firstButton
      .getAttribute("aria-label")!
      .replace(/ table$/, "");

    await act(async () => {
      fireEvent.keyDown(firstButton, { key: "F2" });
    });

    expect(screen.getByText("Rename Table")).toBeInTheDocument();
    expect(screen.getByText(`public.${expectedName}`)).toBeInTheDocument();
    const input = screen.getByLabelText("New table name") as HTMLInputElement;
    expect(input.value).toBe(expectedName);
    // autoFocus + onFocus={select()} should focus the input and select its
    // entire contents so users can immediately type to overwrite.
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(expectedName.length);
  });

  // ---------------------------------------------------------------------
  // AC-04 — keyboard Enter still routes through addTab on a virtualized row
  // ---------------------------------------------------------------------
  it("AC-04 — Enter on a virtualized table row opens a table tab", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": makeTables(1000) },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const firstButton = screen.getAllByLabelText(/^table_\d+ table$/)[0]!;
    const expectedName = firstButton
      .getAttribute("aria-label")!
      .replace(/ table$/, "");

    await act(async () => {
      fireEvent.keyDown(firstButton, { key: "Enter" });
    });

    const tab = useTabStore.getState().tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.table).toBe(expectedName);
      expect(tab.schema).toBe("public");
    }
  });

  // ---------------------------------------------------------------------
  // AC-05 — eager path still renders every row when below threshold
  // ---------------------------------------------------------------------
  it("AC-05 — datasets that yield ≤ 200 visible rows skip virtualization", async () => {
    // 50 tables ⇒ schema(1) + categories(4) + search(1) + items(50) = 56 rows,
    // well under the 200-row threshold, so the eager nested layout runs and
    // every row is in the DOM.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": makeTables(50) },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const tableButtons = screen.getAllByLabelText(/^table_\d+ table$/);
    expect(tableButtons).toHaveLength(50);
  });

  // ---------------------------------------------------------------------
  // AC-06 — search filter survives the virtualization boundary
  // ---------------------------------------------------------------------
  it("AC-06 — search filter still narrows the visible row set when virtualized", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": makeTables(1000) },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    const searchInput = screen.getByLabelText("Filter tables in public");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "table_0001" } });
    });

    // Only `table_0001` matches the filter, so the flat visible-rows list
    // collapses to 7 rows (schema + 4 categories + search + 1 item) and we
    // fall back to the eager path. The single matching row must be present
    // and no others.
    expect(screen.getByLabelText("table_0001 table")).toBeInTheDocument();
    expect(screen.queryByLabelText("table_0002 table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("table_0500 table")).not.toBeInTheDocument();
  });

  // Document the assumed row height so a future contributor changing
  // `ROW_HEIGHT_ESTIMATE` knows to revisit these test thresholds.
  void ROW_HEIGHT_ESTIMATE;
});
