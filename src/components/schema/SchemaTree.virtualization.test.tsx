import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTestWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import {
  SCHEMA_TREE_PERF_FIXTURE_COUNTS,
  makeSchemaTreePerfFixture,
  makeSchemaTreePerfTables,
  type SchemaTreePerfTableCount,
} from "./SchemaTree.perfFixtures";
import {
  emitAdvisoryTiming,
  measureAdvisoryTiming,
} from "@/lib/perf/advisoryTiming";

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

// Sprint 263 — translate flat-key seeds into the new `(connId, db)`-nested
// cache shape under `db1` and auto-seed activeStatuses for any conn id
// referenced in the schemas overlay so SchemaTree's workspace key resolves.
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
function seedActiveStatusesFor(connIds: Iterable<string>) {
  useConnectionStore.setState((s) => {
    const next = { ...s.activeStatuses };
    for (const id of connIds) {
      next[id] ??= { type: "connected", activeDb: DEFAULT_DB };
    }
    return { activeStatuses: next };
  });
}
function setSchemaStoreState(overrides: Record<string, unknown> = {}) {
  const translated = translateFlatSeeds(overrides);
  if (translated.schemas) {
    seedActiveStatusesFor(Object.keys(translated.schemas as object));
  }
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

function seedPerfFixture(count: SchemaTreePerfTableCount) {
  const fixture = makeSchemaTreePerfFixture(count);
  setSchemaStoreState({
    schemas: { conn1: fixture.schemas },
    tables: { [`conn1:${fixture.schemaName}`]: fixture.tables },
  });
}

function makeTables(count: number) {
  return makeSchemaTreePerfTables(count);
}

async function renderSchemaTreeFixture(
  count: SchemaTreePerfTableCount,
): Promise<number> {
  seedPerfFixture(count);
  await act(async () => {
    render(<SchemaTree connectionId="conn1" />);
  });
  try {
    const tableButtons = screen.getAllByLabelText(/^table_\d+ table$/);
    const renderedCount = tableButtons.length;
    expect(renderedCount).toBeLessThanOrEqual(100);
    expect(renderedCount).toBeGreaterThan(0);
    return renderedCount;
  } finally {
    cleanup();
  }
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
  it("keeps deterministic 1k and 10k SchemaTree perf fixtures available", () => {
    const oneThousand = makeSchemaTreePerfFixture(
      SCHEMA_TREE_PERF_FIXTURE_COUNTS.oneThousand,
    );
    const tenThousand = makeSchemaTreePerfFixture(
      SCHEMA_TREE_PERF_FIXTURE_COUNTS.tenThousand,
    );

    expect(oneThousand.tables).toHaveLength(1_000);
    expect(oneThousand.tables[0]?.name).toBe("table_0000");
    expect(oneThousand.tables[999]?.name).toBe("table_0999");
    expect(tenThousand.tables).toHaveLength(10_000);
    expect(tenThousand.tables[0]?.name).toBe("table_0000");
    expect(tenThousand.tables[9_999]?.name).toBe("table_9999");
  });

  it("AC-01 — caps DOM table buttons at viewport-sized window when expanded schema has 1000 tables", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": makeTables(1000) },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Sprint 144 (AC-145-1): schemas auto-expand on mount, so all 1000 table
    // rows are already in the visible-rows list — no explicit click needed.

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

  it("reports advisory render timing for deterministic 1k and 10k fixtures", async () => {
    let reportCount = 0;

    for (const count of [
      SCHEMA_TREE_PERF_FIXTURE_COUNTS.oneThousand,
      SCHEMA_TREE_PERF_FIXTURE_COUNTS.tenThousand,
    ] as const) {
      const report = await measureAdvisoryTiming(
        `SchemaTree deterministic ${count} tables render`,
        5,
        async () => {
          const renderedCount = await renderSchemaTreeFixture(count);
          expect(renderedCount).toBeLessThanOrEqual(100);
        },
      );
      const line = emitAdvisoryTiming(report);
      expect(line).toContain("p50=");
      expect(line).toContain("p95=");
      expect(line).toContain("env=");
      reportCount += 1;
    }

    expect(reportCount).toBe(2);
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

    // Sprint 144 (AC-145-1): schema auto-expands on mount, so virtualized
    // table rows must already be in the DOM without an explicit click.
    expect(
      screen.getAllByLabelText(/^table_\d+ table$/).length,
    ).toBeGreaterThan(0);

    // Collapse — the expanded categories and items vanish from the visible
    // list, the flat list drops below the threshold, and we fall back to
    // the eager nested render (which renders just the schema row).
    // Re-query the schema button after every state change because the eager
    // ↔ virtualized branches render distinct React trees, so an element ref
    // captured in one branch is detached after the threshold flips.
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

    // Sprint 144 (AC-145-1): schema auto-expands on mount; the Tables
    // category is auto-expanded too, so item rows should already be
    // present without any clicks.
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

    // Sprint 144 (AC-145-1): schema auto-expands on mount, so virtualized
    // table rows are already in the DOM.

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

    // Sprint 144 (AC-145-1): schema auto-expands on mount; virtualized
    // table rows are immediately available.
    const firstButton = screen.getAllByLabelText(/^table_\d+ table$/)[0]!;
    const expectedName = firstButton
      .getAttribute("aria-label")!
      .replace(/ table$/, "");

    await act(async () => {
      fireEvent.keyDown(firstButton, { key: "Enter" });
    });

    const tab = getTestWorkspace().tabs.find((t) => t.type === "table");
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

    // Sprint 144 (AC-145-1): schema auto-expands on mount.

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

    // Sprint 144 (AC-145-1): schema auto-expands on mount.
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

  // ---------------------------------------------------------------------
  // AC-07 (#1217) — the top-level global filter narrows the visible set and
  // the result STILL flows through the virtualized path when it stays past
  // the 200-row threshold. This is the filter × virtualization combination
  // the per-schema search (AC-06) never exercised (it always collapsed
  // below the threshold).
  // ---------------------------------------------------------------------
  it("AC-07 — global filter narrows a 500-table schema and stays virtualized", async () => {
    const tables = [
      ...Array.from({ length: 250 }, (_, i) => ({
        name: `keep_${String(i).padStart(3, "0")}`,
        schema: "public",
        row_count: null,
      })),
      ...Array.from({ length: 250 }, (_, i) => ({
        name: `drop_${String(i).padStart(3, "0")}`,
        schema: "public",
        row_count: null,
      })),
    ];
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": tables },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Filter to the 250 `keep_*` tables. visibleRows = schema(1) +
    // Tables category(1) + 250 items = 252 > 200, so the list stays
    // virtualized and only a viewport-sized window materialises.
    const filter = screen.getByLabelText("Filter all schemas and objects");
    await act(async () => {
      fireEvent.change(filter, { target: { value: "keep_" } });
    });

    const keepRows = screen.getAllByLabelText(/^keep_\d+ table$/);
    expect(keepRows.length).toBeGreaterThan(0);
    // Windowed, not all 250 → proves the virtualizer is still driving.
    expect(keepRows.length).toBeLessThanOrEqual(100);
    // Non-matching rows are gone across the whole (windowed) dataset.
    expect(screen.queryByLabelText("drop_000 table")).toBeNull();
    expect(screen.queryByLabelText("drop_249 table")).toBeNull();
  });

  // ---------------------------------------------------------------------
  // #1445 — flat (SQLite) / no-schema (MySQL) now virtualize by count. The
  // old `treeShape === "with-schema"` gate left them permanently eager, so a
  // SQLite/MySQL database with thousands of tables hung the tab.
  // ---------------------------------------------------------------------
  function seedConnection(id: string, dbType: "sqlite" | "mysql") {
    useConnectionStore.setState((s) => ({
      connections: [
        {
          id,
          name: `${id} DB`,
          dbType,
          host: "localhost",
          port: 3306,
          user: "u",
          hasPassword: false,
          database: "test",
          groupId: null,
          color: null,
          environment: null,
          paradigm: "rdb" as const,
        },
      ],
      focusedConnId: id,
      activeStatuses: {
        ...s.activeStatuses,
        [id]: { type: "connected", activeDb: "db1" },
      },
    }));
  }

  it("#1445 — SQLite (flat) windows a 1000-table root list, no schema/category rows", async () => {
    seedConnection("conn1", "sqlite");
    setSchemaStoreState({
      schemas: { conn1: [{ name: "main" }] },
      tables: { "conn1:main": makeTables(1000) },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Flat shape: no schema row, no category header — tables render directly.
    expect(screen.queryByLabelText("main schema")).toBeNull();
    expect(screen.queryByLabelText(/Tables in main/i)).toBeNull();
    // Windowed: only a viewport-sized slice of the 1000 tables is in the DOM.
    const tableButtons = screen.getAllByLabelText(/^table_\d+ table$/);
    expect(tableButtons.length).toBeGreaterThan(0);
    expect(tableButtons.length).toBeLessThanOrEqual(100);
    expect(screen.queryByLabelText("table_0999 table")).toBeNull();
  });

  it("#1445 — MySQL (no-schema) windows a 1000-table list, keeps the category header, hides the schema row", async () => {
    seedConnection("conn1", "mysql");
    setSchemaStoreState({
      schemas: { conn1: [{ name: "appdb" }] },
      tables: { "conn1:appdb": makeTables(1000) },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // No-schema shape: schema row hidden, but the category header stays.
    expect(screen.queryByLabelText("appdb schema")).toBeNull();
    expect(screen.getByLabelText("Tables in appdb")).toBeInTheDocument();
    const tableButtons = screen.getAllByLabelText(/^table_\d+ table$/);
    expect(tableButtons.length).toBeGreaterThan(0);
    expect(tableButtons.length).toBeLessThanOrEqual(100);
  });

  // Document the assumed row height so a future contributor changing
  // `ROW_HEIGHT_ESTIMATE` knows to revisit these test thresholds.
  void ROW_HEIGHT_ESTIMATE;
});
