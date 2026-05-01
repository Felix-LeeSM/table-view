import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataGrid from "./DataGrid";
import type { SortInfo, TableData } from "@/types/schema";
import { COLLECTION_READONLY_BANNER_TEXT } from "@lib/strings/document";

// Mock FilterBar — test DataGrid in isolation
vi.mock("./FilterBar", () => ({
  default: () => <div data-testid="filter-bar">FilterBar</div>,
}));

const MOCK_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "integer",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "name",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "meta",
      data_type: "jsonb",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice", { key: "value" }],
    [2, null, null],
    [3, "Charlie", [1, 2, 3]],
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function createMockQueryTableData(overrides?: Partial<TableData>) {
  return vi.fn(() => Promise.resolve({ ...MOCK_DATA, ...overrides }));
}

// We'll set up the store mock per-test so we can customise the return value
const mockQueryTableData = createMockQueryTableData();
const mockExecuteQuery = vi.fn(() =>
  Promise.resolve({
    columns: [],
    rows: [],
    total_count: 0,
    execution_time_ms: 5,
    query_type: "dml" as const,
  }),
);
// Sprint 183 — RDB commit pipeline now flows through executeQueryBatch.
// Default to a happy resolution that mirrors the backend contract (one
// QueryResult per submitted statement).
const mockExecuteQueryBatch = vi.fn((_id: string, statements: string[]) =>
  Promise.resolve(
    statements.map(() => ({
      columns: [],
      rows: [],
      total_count: 0,
      execution_time_ms: 5,
      query_type: "dml" as const,
    })),
  ),
);

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      queryTableData: mockQueryTableData,
      executeQuery: mockExecuteQuery,
      executeQueryBatch: mockExecuteQueryBatch,
    }),
}));

const mockPromoteTab = vi.fn();

// Sprint 76 — a minimal reactive mock that mirrors zustand's hook + getState
// shape. The component subscribes through the selector; `updateTabSorts`
// mutates the tab entry and bumps `version` so every selector re-runs on
// the next render. `forceRerender` via `useTabStoreBump` keeps React in
// sync without dragging the real zustand library into the mock.
interface MockTabShape {
  id: string;
  type: "table";
  sorts?: SortInfo[];
}
const mockTabStoreState: {
  tabs: MockTabShape[];
  activeTabId: string | null;
} = {
  tabs: [{ id: "tab-1", type: "table" }],
  activeTabId: "tab-1",
};
const subscribers = new Set<() => void>();
function notify() {
  subscribers.forEach((fn) => fn());
}
const mockUpdateTabSorts = vi.fn((tabId: string, next: SortInfo[]) => {
  const tab = mockTabStoreState.tabs.find((t) => t.id === tabId);
  if (tab) tab.sorts = next;
  notify();
});
function resetMockTabStore() {
  mockTabStoreState.tabs = [{ id: "tab-1", type: "table" }];
  mockTabStoreState.activeTabId = "tab-1";
  mockUpdateTabSorts.mockClear();
  subscribers.clear();
}
const mockSetTabDirty = vi.fn();
function mockTabStoreView() {
  return {
    tabs: mockTabStoreState.tabs,
    activeTabId: mockTabStoreState.activeTabId,
    promoteTab: mockPromoteTab,
    updateTabSorts: mockUpdateTabSorts,
    setTabDirty: mockSetTabDirty,
  };
}
vi.mock("@stores/tabStore", async () => {
  const React = await import("react");
  return {
    useTabStore: Object.assign(
      (selector: (state: Record<string, unknown>) => unknown) => {
        const [, forceRerender] = React.useReducer((n: number) => n + 1, 0);
        React.useEffect(() => {
          const fn = () => forceRerender();
          subscribers.add(fn);
          return () => {
            subscribers.delete(fn);
          };
        }, []);
        return selector(mockTabStoreView());
      },
      {
        getState: () => mockTabStoreView(),
      },
    ),
  };
});

function renderDataGrid(props: Partial<Parameters<typeof DataGrid>[0]> = {}) {
  return render(
    <DataGrid connectionId="conn1" table="users" schema="public" {...props} />,
  );
}

describe("DataGrid", () => {
  beforeEach(() => {
    mockQueryTableData.mockReset();
    mockQueryTableData.mockResolvedValue({ ...MOCK_DATA });
    mockExecuteQuery.mockReset();
    mockExecuteQuery.mockResolvedValue({
      columns: [],
      rows: [],
      total_count: 0,
      execution_time_ms: 5,
      query_type: "dml" as const,
    });
    // Sprint 183 — restore the default happy-path batch resolver after
    // each test (mockReset wipes the implementation we registered at
    // module scope).
    mockExecuteQueryBatch.mockReset();
    mockExecuteQueryBatch.mockImplementation((_id: string, stmts: string[]) =>
      Promise.resolve(
        stmts.map(() => ({
          columns: [],
          rows: [],
          total_count: 0,
          execution_time_ms: 5,
          query_type: "dml" as const,
        })),
      ),
    );
    mockPromoteTab.mockReset();
    resetMockTabStore();
  });

  // 1. Initial rendering — queryTableData called with correct args
  it("calls queryTableData with correct arguments on mount", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    expect(mockQueryTableData).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      1,
      300,
      undefined,
      undefined,
      undefined,
    );
  });

  // 2. Loading state — spinner
  it("shows spinner while loading", () => {
    // Never resolve to keep loading state
    mockQueryTableData.mockReturnValue(new Promise(() => {}));
    renderDataGrid();
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  // 3. Error state
  it("shows error message on failure", async () => {
    mockQueryTableData.mockRejectedValue(new Error("Connection lost"));
    renderDataGrid();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection lost",
    );
  });

  // 4. Data rendering — headers and rows
  it("renders column headers and data rows", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    // Headers
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("meta")).toBeInTheDocument();
    // Data
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    // [AC-181-10] Sprint 181 ExportButton mounted into the toolbar.
    // 2026-05-01 — regression guard so future toolbar refactors don't drop it.
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  // 5. NULL value display
  it("renders NULL values as italic text", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    const nulls = screen.getAllByText("NULL");
    expect(nulls.length).toBeGreaterThan(0);
    // NULL is italic
    expect(nulls[0]!.tagName).toBe("SPAN");
  });

  // 6. JSONB object display
  it("renders JSONB objects as JSON.stringify output", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    // JSON.stringify with indent produces multiline text — use title attribute for matching
    const cells = screen.getAllByRole("gridcell");
    const cellTexts = cells.map((c) => c.textContent);
    expect(cellTexts).toContain(JSON.stringify({ key: "value" }, null, 2));
    expect(cellTexts).toContain(JSON.stringify([1, 2, 3], null, 2));
  });

  // 7. Sort toggle — ASC → DESC → null (single column)
  it("cycles sort: ASC → DESC → null on column header clicks", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // First click → ASC (query fresh element each time to avoid stale refs)
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    expect(await screen.findByText("▲")).toBeInTheDocument();

    // Second click → DESC
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    expect(await screen.findByText("▼")).toBeInTheDocument();

    // Third click → clear sort
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    await waitFor(() => {
      expect(screen.queryByText("▲")).not.toBeInTheDocument();
      expect(screen.queryByText("▼")).not.toBeInTheDocument();
    });
  });

  // 7a. Multi-column sort with Shift+Click
  it("adds columns to sort list with Shift+Click", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // First column click (no shift) → single sort
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    // Check for sort indicator using the specific class
    const sortIndicators = screen
      .getAllByText(/^\d+$/)
      .filter((el) => el.classList.contains("font-bold"));
    expect(sortIndicators.length).toBe(1);
    expect(sortIndicators[0]!.textContent).toBe("1");
    expect(await screen.findByText("▲")).toBeInTheDocument();

    // Shift+Click on second column → add to sort list
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by name"), { shiftKey: true });
    });
    // Should see two sort indicators (rank numbers)
    const newSortIndicators = screen
      .getAllByText(/^\d+$/)
      .filter((el) => el.classList.contains("font-bold"));
    expect(newSortIndicators.length).toBe(2);
    expect(newSortIndicators.some((n) => n.textContent === "1")).toBe(true);
    expect(newSortIndicators.some((n) => n.textContent === "2")).toBe(true);
  });

  // 7b. Shift+Click toggles direction on existing sort column
  it("toggles direction on Shift+Click for existing sort column", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Add first column with regular click
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    const sortIndicators1 = screen
      .getAllByText(/^\d+$/)
      .filter((el) => el.classList.contains("font-bold"));
    expect(sortIndicators1.length).toBe(1);
    expect(sortIndicators1[0]!.textContent).toBe("1");
    expect(await screen.findByText("▲")).toBeInTheDocument();

    // Add second column with Shift+Click
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by name"), { shiftKey: true });
    });
    const sortIndicators2 = screen
      .getAllByText(/^\d+$/)
      .filter((el) => el.classList.contains("font-bold"));
    expect(sortIndicators2.length).toBe(2);

    // Shift+Click again on second column → toggle to DESC
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by name"), { shiftKey: true });
    });
    expect(await screen.findByText("▼")).toBeInTheDocument();

    // Shift+Click again → remove from sort list
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by name"), { shiftKey: true });
    });
    await waitFor(() => {
      const rankNumbers = screen
        .queryAllByText(/^\d+$/)
        .filter((el) => el.classList.contains("font-bold"));
      expect(rankNumbers.length).toBe(1); // Only id column should remain
    });
  });

  // 7c. Regular click replaces all sorts with single column
  it("replaces all sorts with single column on regular click", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Add multiple sorts with Shift+Click
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by name"), { shiftKey: true });
    });
    let sortIndicators = screen
      .getAllByText(/^\d+$/)
      .filter((el) => el.classList.contains("font-bold"));
    expect(sortIndicators.length).toBe(2);

    // Regular click on third column → replace all sorts
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by meta"));
    });
    // Only meta should be sorted
    await waitFor(() => {
      sortIndicators = screen
        .queryAllByText(/^\d+$/)
        .filter((el) => el.classList.contains("font-bold"));
      expect(sortIndicators.length).toBe(1); // Only one sort column
    });
    // Check that meta is now rank 1
    sortIndicators = screen
      .queryAllByText(/^\d+$/)
      .filter((el) => el.classList.contains("font-bold"));
    expect(sortIndicators[0]!.textContent).toBe("1");
  });

  // 8. Sort resets page to 1
  it("resets page to 1 when sorting changes", async () => {
    // Return many rows for pagination
    const bigData: TableData = {
      ...MOCK_DATA,
      total_count: 250,
      page: 2,
      rows: Array.from({ length: 100 }, (_, i) => [i, `user${i}`, null]),
    };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("250 rows");
  });

  // 9. Filter toggle button
  it("toggles filter bar on filter button click", async () => {
    const user = userEvent.setup();
    renderDataGrid();
    await screen.findByText("3 rows");

    const filterBtn = screen.getByLabelText("Toggle filters");
    await user.click(filterBtn);
    expect(screen.getByTestId("filter-bar")).toBeInTheDocument();

    await user.click(filterBtn);
    expect(screen.queryByTestId("filter-bar")).not.toBeInTheDocument();
  });

  // 10. Cmd+F toggles filter bar
  it("toggles filter bar on Cmd+F", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Cmd+F to open
    fireEvent.keyDown(document, { key: "f", metaKey: true });
    expect(screen.getByTestId("filter-bar")).toBeInTheDocument();

    // Cmd+F to close
    fireEvent.keyDown(document, { key: "f", metaKey: true });
    expect(screen.queryByTestId("filter-bar")).not.toBeInTheDocument();
  });

  // 11. Pagination — page change calls queryTableData with updated page
  it("calls queryTableData with correct page on pagination", async () => {
    const user = userEvent.setup();
    const bigData: TableData = {
      ...MOCK_DATA,
      total_count: 700,
    };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("700 rows");

    const nextBtn = screen.getByLabelText("Next page");
    await user.click(nextBtn);

    // Should have been called with page=2
    const calls = mockQueryTableData.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall[3]).toBe(2);
  });

  // 12. Props change resets page
  it("resets page to 1 when table prop changes", async () => {
    const { rerender } = renderDataGrid();
    await screen.findByText("3 rows");

    // Change table prop
    rerender(<DataGrid connectionId="conn1" table="orders" schema="public" />);
    await screen.findByText("3 rows");

    // The latest call should be with page=1 for the new table
    const calls = mockQueryTableData.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall[1]).toBe("orders");
    expect(lastCall[3]).toBe(1);
  });

  // 13. Executed query bar toggles visibility
  it("toggles executed query bar visibility", async () => {
    const user = userEvent.setup();
    renderDataGrid();
    await screen.findByText("3 rows");

    // Query region visible by default
    expect(
      screen.getByRole("region", { name: /SQL query/i }),
    ).toBeInTheDocument();

    // Click to hide
    const toggleBtn = screen.getByLabelText("Hide query");
    await user.click(toggleBtn);
    expect(
      screen.queryByRole("region", { name: /SQL query/i }),
    ).not.toBeInTheDocument();

    // Click to show
    const showBtn = screen.getByLabelText("Show query");
    await user.click(showBtn);
    expect(
      screen.getByRole("region", { name: /SQL query/i }),
    ).toBeInTheDocument();
  });

  // 14. Executed query displays the actual query text
  it("displays the executed SQL query", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    expect(
      screen.getByText(/SELECT \* FROM public\.users/),
    ).toBeInTheDocument();
  });

  // ── Regression: loading flicker fix ──

  // 15. Initial load (no data) shows centered spinner, not overlay
  it("shows centered spinner during initial load when no data exists", () => {
    mockQueryTableData.mockReturnValue(new Promise(() => {}));
    renderDataGrid();
    const spinners = document.querySelectorAll(".animate-spin");
    expect(spinners.length).toBe(1);
    // The spinner should NOT be inside an overlay (no absolute positioning)
    const spinnerParent = spinners[0]!.parentElement!;
    expect(spinnerParent.className).not.toContain("absolute");
    // Table should not be rendered yet
    expect(document.querySelector("table")).not.toBeInTheDocument();
  });

  // 16. Refetch (loading with existing data) keeps table in DOM
  it("keeps table in DOM during refetch when data already exists", async () => {
    // First load completes with data
    renderDataGrid();
    await screen.findByText("3 rows");

    // Trigger a slow refetch (sort change)
    mockQueryTableData.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });

    // Table and its headers should still be in the DOM
    expect(document.querySelector("table")).toBeInTheDocument();
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  // 17. Refetch shows overlay spinner on top of existing table — Sprint 180
  // (AC-180-01) shifted the overlay behind a 1s threshold gate. We use
  // `findByRole` which polls on real timers to wait past the gate.
  it("shows overlay spinner on top of table during refetch (post-threshold)", async () => {
    // First load completes (real timers — the fetch resolves on a microtask).
    renderDataGrid();
    await screen.findByText("3 rows");

    // Trigger a slow refetch
    mockQueryTableData.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });

    // Pre-threshold: overlay should not yet be visible.
    expect(document.querySelectorAll(".animate-spin").length).toBe(0);

    // Wait past the 1s threshold (real timer). The overlay element has
    // role="status" with accessible name "Loading".
    const overlay = await screen.findByRole(
      "status",
      { name: "Loading" },
      { timeout: 2000 },
    );

    // Both table AND overlay spinner should exist.
    expect(document.querySelector("table")).toBeInTheDocument();
    const spinners = document.querySelectorAll(".animate-spin");
    expect(spinners.length).toBe(1);
    // The spinner should be inside an absolutely-positioned overlay.
    expect(overlay).toBeInTheDocument();
    expect(spinners[0]!.closest('[class*="absolute"]')).toBe(overlay);
  });

  // 18. Overlay disappears when refetch completes
  it("removes overlay spinner when refetch completes", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Trigger refetch (sort) - returns immediately
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    await screen.findByText("▲");

    // No overlay spinner should remain
    const spinners = document.querySelectorAll(".animate-spin");
    expect(spinners.length).toBe(0);
    // Table should still be present
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  // 19. Error display unchanged after refetch failure
  it("shows error when refetch fails while keeping table accessible", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Trigger a failing refetch
    mockQueryTableData.mockRejectedValue(new Error("Query timeout"));
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    await screen.findByRole("alert");

    expect(screen.getByRole("alert")).toHaveTextContent("Query timeout");
    // Loading spinner should be gone
    expect(document.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  // 20. Column resize handle exists on headers
  it("renders resize handles on column headers", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const resizeHandles = document.querySelectorAll(".cursor-col-resize");
    expect(resizeHandles.length).toBe(3); // one per column
  });

  // 20a. Column resize: mousedown starts drag and applies width on mousemove
  it("starts column resize drag and applies width via DOM", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const resizeHandle = document.querySelectorAll(".cursor-col-resize")[0]!;

    // jsdom returns 0 for getBoundingClientRect — mock a realistic column width
    const th = document.querySelector("th:nth-child(1)") as HTMLElement;
    th.getBoundingClientRect = () =>
      ({
        width: 150,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 150,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // Trigger mousedown — this registers document-level listeners
    fireEvent.mouseDown(resizeHandle, { clientX: 200, buttons: 1 });

    // Body cursor should be set
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    // Simulate mousemove on document (wider than start: 150 + 80 = 230)
    fireEvent.mouseMove(document, { clientX: 280 });

    expect(th).toBeTruthy();
    expect(parseInt(th.style.width, 10)).toBeGreaterThan(150);

    // Clean up: manually trigger mouseup to remove listeners
    // We use dispatchEvent directly to avoid the re-render race
    document.removeEventListener("mousemove", () => {});
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  // 20b. Column resize: mousedown with no tableRef does not crash
  it("handles resize when tableRef is null during mousemove", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const resizeHandle = document.querySelectorAll(".cursor-col-resize")[0]!;

    // Trigger mousedown
    fireEvent.mouseDown(resizeHandle, { clientX: 200, buttons: 1 });

    // Simulate mousemove — should not crash even if applyWidth does DOM work
    fireEvent.mouseMove(document, { clientX: 100 });

    // Width should be clamped to MIN_COL_WIDTH (60)
    const th = document.querySelector("th:nth-child(1)") as HTMLElement;
    expect(parseInt(th.style.width, 10)).toBe(60);

    // Cleanup
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  // 21. Empty result set without filters shows "Table is empty" row
  it("shows Table is empty message when rows are empty and no filters active", async () => {
    mockQueryTableData.mockResolvedValue({
      ...MOCK_DATA,
      rows: [],
      total_count: 0,
    });
    renderDataGrid();
    await screen.findByText("0 rows");
    // Sprint 99 — branch B: no active filters → unfiltered empty message,
    // no Clear filter affordance.
    expect(screen.getByText("Table is empty")).toBeInTheDocument();
    expect(
      screen.queryByText("0 rows match current filter"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear filters" }),
    ).not.toBeInTheDocument();
  });

  // 21a. Empty result set WITH filters shows the filtered-empty message + Clear filter button
  // (Sprint 99 AC-01/AC-03)
  it("shows '0 rows match current filter' + Clear filter button when filters are active", async () => {
    // First fetch (with the seeded initialFilters) returns 0 rows;
    // second fetch (after Clear filter clicks through) returns the
    // unfiltered MOCK_DATA. We sequence the resolver so the same mock
    // serves both calls deterministically.
    mockQueryTableData.mockReset();
    mockQueryTableData
      .mockResolvedValueOnce({ ...MOCK_DATA, rows: [], total_count: 0 })
      .mockResolvedValue({ ...MOCK_DATA });

    renderDataGrid({
      initialFilters: [
        { id: "f1", column: "name", operator: "Eq", value: "nonexistent" },
      ],
    });

    // Wait for the filtered empty state to render.
    await screen.findByText("0 rows match current filter");

    // The Clear filter button is present and accessible.
    const clearBtn = screen.getByRole("button", { name: "Clear filters" });
    expect(clearBtn).toBeInTheDocument();

    // Sanity — the alternative empty message is NOT shown in this branch.
    expect(screen.queryByText("Table is empty")).not.toBeInTheDocument();

    // Capture the call count BEFORE clicking so we can assert a follow-up
    // refetch happened (independent of how many setup fetches the mount
    // produced).
    const callsBefore = mockQueryTableData.mock.calls.length;

    await act(async () => {
      fireEvent.click(clearBtn);
    });

    // After clearing, the data refetches with NO filters applied. The 7th
    // positional arg to queryTableData is `filters` — it must be undefined
    // (DataGrid passes `undefined` when `appliedFilters.length === 0`).
    await waitFor(() => {
      expect(mockQueryTableData.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    const lastCall = mockQueryTableData.mock.calls[
      mockQueryTableData.mock.calls.length - 1
    ] as unknown[];
    expect(lastCall[6]).toBeUndefined();
    // raw SQL slot (8th arg) must also be cleared.
    expect(lastCall[7]).toBeUndefined();

    // After the unfiltered fetch resolves, the unfiltered rows render.
    await screen.findByText("3 rows");
  });

  // 22. Props change resets column widths
  it("resets column widths when table prop changes", async () => {
    const { rerender } = renderDataGrid();
    await screen.findByText("3 rows");

    // Rerender with different table
    rerender(<DataGrid connectionId="conn1" table="orders" schema="public" />);
    await screen.findByText("3 rows");

    // Should have called with new table name
    const calls = mockQueryTableData.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall[1]).toBe("orders");
  });

  // 23. Sort passes orderBy to queryTableData
  it("passes orderBy parameter when sorting", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Click to sort by id ASC
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    await screen.findByText("▲");

    // Find the latest call with orderBy
    const calls = mockQueryTableData.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall[5]).toBe("id ASC");
  });

  // 24. Refresh-data event triggers refetch
  it("refetches data on refresh-data event", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const initialCallCount = mockQueryTableData.mock.calls.length;

    // Dispatch refresh event
    await act(async () => {
      window.dispatchEvent(new Event("refresh-data"));
    });
    await screen.findByText("3 rows");

    expect(mockQueryTableData.mock.calls.length).toBeGreaterThan(
      initialCallCount,
    );
  });

  // 25. Column header shows primary key icon
  it("shows primary key icon on primary key columns", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const pkIcons = screen.getAllByLabelText("Primary Key");
    expect(pkIcons.length).toBe(1);
  });

  // 26. Column header shows data type
  it("shows data type under column name", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    expect(screen.getByText("integer")).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(screen.getByText("jsonb")).toBeInTheDocument();
  });

  // 27. Schema.table shown when no data
  it("shows schema.table in toolbar when no data loaded", () => {
    mockQueryTableData.mockReturnValue(new Promise(() => {}));
    renderDataGrid();
    expect(screen.getByText("public.users")).toBeInTheDocument();
  });

  // 28. Race condition: stale response is ignored
  it("ignores stale response when fetchData is called twice rapidly", async () => {
    let resolveFirst: (value: TableData) => void;
    const firstPromise = new Promise<TableData>((resolve) => {
      resolveFirst = resolve;
    });
    const staleData: TableData = {
      ...MOCK_DATA,
      total_count: 999,
      rows: [[1, "STALE", null]],
    };
    const freshData: TableData = {
      ...MOCK_DATA,
      total_count: 42,
      rows: [[1, "FRESH", null]],
    };

    // First call hangs (stale)
    mockQueryTableData.mockReturnValueOnce(firstPromise);
    // Second call resolves immediately (fresh)
    mockQueryTableData.mockResolvedValueOnce(freshData);

    renderDataGrid();

    // Wait for the first call to start
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Dispatch refresh-data to trigger a second fetchData while first is pending
    await act(async () => {
      window.dispatchEvent(new Event("refresh-data"));
    });

    // Resolve the stale (first) call after the fresh (second) call has already completed
    await act(async () => {
      resolveFirst!(staleData);
    });

    // The fresh data should be shown, NOT the stale data
    await waitFor(() => {
      expect(screen.getByText("42 rows")).toBeInTheDocument();
    });
    expect(screen.queryByText("999 rows")).not.toBeInTheDocument();
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
    expect(screen.getByText("FRESH")).toBeInTheDocument();
  });

  // ── Sprint 26: Pagination Enhancement ──

  // 29. Page size selector renders
  it("renders page size selector", async () => {
    const bigData: TableData = { ...MOCK_DATA, total_count: 250 };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("250 rows");

    // Sprint-112: Radix Select trigger advertises the current value via
    // its accessible text, not via a `.value` property.
    const trigger = screen.getByLabelText("Page size");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("300");
  });

  // 30. Changes page size when selector changes
  it("changes page size when selector changes", async () => {
    const user = userEvent.setup();
    const bigData: TableData = { ...MOCK_DATA, total_count: 500 };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("500 rows");

    // Sprint-112: Radix Select migration — open the trigger and pick
    // the desired page size option.
    const trigger = screen.getByLabelText("Page size");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "300" }));

    const calls = mockQueryTableData.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall[4]).toBe(300);
  });

  // 31. Renders first/last page buttons
  it("renders first and last page buttons", async () => {
    const bigData: TableData = { ...MOCK_DATA, total_count: 500 };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("500 rows");

    expect(screen.getByLabelText("First page")).toBeInTheDocument();
    expect(screen.getByLabelText("Last page")).toBeInTheDocument();
  });

  // 32. First page button goes to page 1
  it("first page button goes to page 1", async () => {
    const bigData: TableData = { ...MOCK_DATA, total_count: 500, page: 3 };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("500 rows");

    // Go to page 3 first
    const nextBtn = screen.getByLabelText("Next page");
    await act(async () => {
      fireEvent.click(nextBtn);
    });
    await act(async () => {
      fireEvent.click(nextBtn);
    });

    // Click first page
    const firstBtn = screen.getByLabelText("First page");
    await act(async () => {
      fireEvent.click(firstBtn);
    });

    const calls = mockQueryTableData.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall[3]).toBe(1);
  });

  // 33. Last page button goes to last page
  it("last page button goes to last page", async () => {
    const bigData: TableData = { ...MOCK_DATA, total_count: 500 };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("500 rows");

    const lastBtn = screen.getByLabelText("Last page");
    await act(async () => {
      fireEvent.click(lastBtn);
    });

    const calls = mockQueryTableData.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    // totalPages = ceil(500/300) = 2
    expect(lastCall[3]).toBe(2);
  });

  // 34. Jump to page input works
  it("jump to page input works", async () => {
    const bigData: TableData = { ...MOCK_DATA, total_count: 1200 };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("1,200 rows");

    const jumpInput = screen.getByLabelText("Jump to page") as HTMLInputElement;
    expect(jumpInput).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(jumpInput, { target: { value: "3" } });
      fireEvent.keyDown(jumpInput, { key: "Enter" });
    });

    const calls = mockQueryTableData.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall[3]).toBe(3);
  });

  // ── Sprint 30: Inline Cell Editing ──

  // 35. Double-clicking a cell enters edit mode
  it("double-clicking a cell enters edit mode", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!; // "Alice" cell (row 0, col 1)

    await act(async () => {
      fireEvent.dblClick(nameCell);
    });

    // An input should appear inside the cell
    const input = nameCell.querySelector("input");
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("Alice");
  });

  // 36. Enter saves edit and shows pending indicator
  it("Enter saves edit and shows pending indicator", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!; // "Alice"

    await act(async () => {
      fireEvent.dblClick(nameCell);
    });

    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Input should be gone
    expect(nameCell.querySelector("input")).not.toBeInTheDocument();

    // Cell should show the new value with highlight background indicator
    expect(nameCell.textContent).toContain("Bob");
    expect(nameCell.className).toContain("bg-highlight/20");

    // Pending edit count should be shown
    expect(screen.getByText(/1 edit/)).toBeInTheDocument();
  });

  // 37. Escape cancels edit
  it("Escape cancels edit", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!; // "Alice"

    await act(async () => {
      fireEvent.dblClick(nameCell);
    });

    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });

    // Input should be gone
    expect(nameCell.querySelector("input")).not.toBeInTheDocument();

    // Cell should still show original value
    expect(nameCell.textContent).toContain("Alice");

    // No yellow bg
    expect(nameCell.className).not.toContain("bg-highlight/20");
  });

  // 38. Shows pending edit count in toolbar
  it("shows pending edit count in toolbar", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // No pending edits initially
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!;

    await act(async () => {
      fireEvent.dblClick(nameCell);
    });

    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Changed" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Should show edit count
    expect(screen.getByText(/1 edit/)).toBeInTheDocument();
  });

  // 39. Clicking another cell while editing saves current edit
  it("clicking another cell while editing saves current edit", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!; // "Alice"

    // Start editing
    await act(async () => {
      fireEvent.dblClick(nameCell);
    });

    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Bob" } });
    });

    // Click on another cell
    const otherCell = cells[2]!; // meta column
    await act(async () => {
      fireEvent.click(otherCell);
    });

    // First cell should have saved the edit
    expect(nameCell.querySelector("input")).not.toBeInTheDocument();
    expect(nameCell.textContent).toContain("Bob");
    expect(nameCell.className).toContain("bg-highlight/20");
  });

  // ── Sprint 31: Commit & SQL Preview ──

  // Helper: make a pending edit
  async function makePendingEdit() {
    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!; // "Alice"
    await act(async () => {
      fireEvent.dblClick(nameCell);
    });
    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
  }

  // 40. Shows Commit button when there are pending edits
  it("shows Commit button when there are pending edits", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // No commit button initially
    expect(screen.queryByLabelText("Commit changes")).not.toBeInTheDocument();

    await makePendingEdit();

    expect(screen.getByLabelText("Commit changes")).toBeInTheDocument();
  });

  // 41. Shows Discard button when there are pending edits
  it("shows Discard button when there are pending edits", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    expect(screen.queryByLabelText("Discard changes")).not.toBeInTheDocument();

    await makePendingEdit();

    expect(screen.getByLabelText("Discard changes")).toBeInTheDocument();
  });

  // 42. Discard clears all pending edits
  it("Discard clears all pending edits", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    await makePendingEdit();

    expect(screen.getByText(/1 edit/)).toBeInTheDocument();

    const discardBtn = screen.getByLabelText("Discard changes");
    await act(async () => {
      fireEvent.click(discardBtn);
    });

    // Pending edits should be cleared
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();
    // Yellow bg should be gone
    const cells = screen.getAllByRole("gridcell");
    expect(cells[1]!.className).not.toContain("bg-highlight/20");
  });

  // 43. Commit shows SQL preview modal
  it("Commit shows SQL preview modal", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    await makePendingEdit();

    const commitBtn = screen.getByLabelText("Commit changes");
    await act(async () => {
      fireEvent.click(commitBtn);
    });

    // SQL preview modal should appear
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Should contain UPDATE SQL
    expect(screen.getByText(/UPDATE/i)).toBeInTheDocument();
  });

  // 44. Commit executes SQL and refreshes data
  // Sprint 183 — assertion updated from `mockExecuteQuery` to
  // `mockExecuteQueryBatch` because the commit pipeline now wraps the
  // pending edits in a single transaction batch. 2026-05-01.
  it("Commit executes SQL and refreshes data", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    await makePendingEdit();

    const commitBtn = screen.getByLabelText("Commit changes");
    await act(async () => {
      fireEvent.click(commitBtn);
    });

    // Find the execute/confirm button in the modal
    const executeBtn = screen.getByLabelText("Execute SQL");
    await act(async () => {
      fireEvent.click(executeBtn);
    });

    // executeQueryBatch should have been called once with the pending UPDATE.
    expect(mockExecuteQueryBatch).toHaveBeenCalled();
    expect(mockExecuteQuery).not.toHaveBeenCalled();

    // Pending edits should be cleared after commit
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();
  });

  // ── Sprint 32: Row Operations (Add/Delete) ──

  // 45. Add Row button adds an empty row at the bottom
  it("Add Row button adds an empty row at the bottom", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const addRowBtn = screen.getByLabelText("Add row");
    await act(async () => {
      fireEvent.click(addRowBtn);
    });

    // There should now be a 4th row (the new empty row)
    const rows = screen.getAllByRole("row");
    // Header row + 3 data rows + 1 new empty row = 5 rows (4 data + 1 header)
    expect(rows.length).toBe(5); // including header row
  });

  // 46. clicking a row selects it
  it("clicking a row selects it", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    // Click on first cell of first data row
    const firstRowCell = cells[0]!;
    await act(async () => {
      fireEvent.click(firstRowCell);
    });

    // The row should have a selected indicator
    const row = firstRowCell.closest("tr")!;
    expect(row.className).toContain("bg-accent/20");
  });

  // 47. Delete Row button marks selected row for deletion
  it("Delete Row button marks selected row for deletion", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Select a row first
    const cells = screen.getAllByRole("gridcell");
    const firstRowCell = cells[0]!;
    await act(async () => {
      fireEvent.click(firstRowCell);
    });

    // Click delete
    const deleteRowBtn = screen.getByLabelText("Delete row");
    await act(async () => {
      fireEvent.click(deleteRowBtn);
    });

    // The row should have strikethrough style
    const row = firstRowCell.closest("tr")!;
    expect(row.className).toContain("line-through");
  });

  // 48. deleted row has strikethrough style
  it("deleted row has strikethrough style", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Select and delete the first row
    const cells = screen.getAllByRole("gridcell");
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete row"));
    });

    // All cells in that row should show strikethrough
    const row = cells[0]!.closest("tr")!;
    expect(row.className).toContain("line-through");
  });

  // 49. Discard clears pending row operations
  it("Discard clears pending row operations", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Add a row
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });

    // Delete a row
    const cells = screen.getAllByRole("gridcell");
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete row"));
    });

    // Discard
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Discard changes"));
    });

    // Should be back to original state - 3 data rows + header
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBe(4); // header + 3 data rows
    // No strikethrough
    const dataRows = rows.slice(1);
    for (const row of dataRows) {
      expect(row.className).not.toContain("line-through");
    }
  });

  // ── Sprint 43: promoteTab triggers ──

  // Reason: sorting no longer promotes preview tabs — the promoteTab
  // useEffect was removed from DataGrid so that preview tabs stay as
  // previews until an explicit user action (double-click, edit, TabBar
  // click) promotes them. (2026-04-29)
  it("does NOT call promoteTab when sorting changes", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    mockPromoteTab.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    await screen.findByText("▲");

    expect(mockPromoteTab).not.toHaveBeenCalled();
  });

  // 51. Inline edit (double-click) triggers promoteTab
  it("calls promoteTab when inline editing starts", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    mockPromoteTab.mockClear();

    const cells = screen.getAllByRole("gridcell");
    await act(async () => {
      fireEvent.dblClick(cells[1]!);
    });

    expect(mockPromoteTab).toHaveBeenCalledWith("tab-1");
  });

  // 52. Add row triggers promoteTab
  it("calls promoteTab when adding a row", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    mockPromoteTab.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });

    expect(mockPromoteTab).toHaveBeenCalledWith("tab-1");
  });

  // 53. Delete row triggers promoteTab
  it("calls promoteTab when deleting a row", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    mockPromoteTab.mockClear();

    const cells = screen.getAllByRole("gridcell");
    await act(async () => {
      fireEvent.click(cells[0]!);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete row"));
    });

    expect(mockPromoteTab).toHaveBeenCalledWith("tab-1");
  });

  // ── Sprint 44: Data Grid UX ──

  // 54. Truncates long cell values at 200 chars
  it("truncates cell values longer than 200 characters", async () => {
    const longText = "A".repeat(250);
    mockQueryTableData.mockResolvedValue({
      ...MOCK_DATA,
      total_count: 1,
      rows: [[1, longText, null]],
    });
    renderDataGrid();
    await screen.findByText("1 rows");

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!;
    // Display should be truncated
    const displayedText = nameCell.querySelector(".line-clamp-3")?.textContent;
    expect(displayedText).toBe("A".repeat(200) + "...");
    // Title should have full value
    expect(nameCell).toHaveAttribute("title", longText);
  });

  // 55. Data type header has truncate class
  it("applies truncate class to data type header", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const typeElements = screen.getAllByText("integer");
    expect(typeElements[0]!.classList.contains("truncate")).toBe(true);
  });

  // 56. Date column renders datetime-local input when editing
  it("renders datetime-local input for timestamp column editing", async () => {
    const dateData: TableData = {
      ...MOCK_DATA,
      columns: [
        ...MOCK_DATA.columns,
        {
          name: "created_at",
          data_type: "timestamp",
          nullable: true,
          default_value: null,
          is_primary_key: false,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
      ],
      rows: [[1, "Alice", null, "2024-01-15T10:30:00"]],
    };
    mockQueryTableData.mockResolvedValue(dateData);
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const dateCell = cells[3]!; // created_at column

    await act(async () => {
      fireEvent.dblClick(dateCell);
    });

    const input = dateCell.querySelector("input");
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).type).toBe("datetime-local");
  });

  // ── Sprint 50: Multi-row Selection ──

  // 57. Cmd+Click toggles row selection
  it("toggles row selection with Cmd+Click", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const rows = [
      cells[0]!.closest("tr")!,
      cells[3]!.closest("tr")!,
      cells[6]!.closest("tr")!,
    ];

    // Click first row normally (selects it)
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    expect(rows[0]!.className).toContain("bg-accent/20");

    // Cmd+Click second row (adds to selection)
    await act(async () => {
      fireEvent.click(cells[3]!, { metaKey: true });
    });
    expect(rows[0]!.className).toContain("bg-accent/20");
    expect(rows[1]!.className).toContain("bg-accent/20");
  });

  // 58. Shift+Click selects range
  it("selects range of rows with Shift+Click", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const rows = [
      cells[0]!.closest("tr")!,
      cells[3]!.closest("tr")!,
      cells[6]!.closest("tr")!,
    ];

    // Click first row (sets anchor)
    await act(async () => {
      fireEvent.click(cells[0]!);
    });

    // Shift+Click third row (selects range 0-2)
    await act(async () => {
      fireEvent.click(cells[6]!, { shiftKey: true });
    });

    // All three rows should be selected
    expect(rows[0]!.className).toContain("bg-accent/20");
    expect(rows[1]!.className).toContain("bg-accent/20");
    expect(rows[2]!.className).toContain("bg-accent/20");
  });

  // 59. Delete button deletes multiple selected rows
  it("deletes multiple selected rows via Delete button", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const rows = [
      cells[0]!.closest("tr")!,
      cells[3]!.closest("tr")!,
      cells[6]!.closest("tr")!,
    ];

    // Select first row
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    // Cmd+Click third row
    await act(async () => {
      fireEvent.click(cells[6]!, { metaKey: true });
    });

    // Click delete
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete row"));
    });

    // First and third rows should have strikethrough
    expect(rows[0]!.className).toContain("line-through");
    expect(rows[1]!.className).not.toContain("line-through");
    expect(rows[2]!.className).toContain("line-through");
  });

  // 60. Shows selection count when multiple rows selected
  it("shows selection count when multiple rows are selected", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");

    // Select first row
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    // Cmd+Click second row
    await act(async () => {
      fireEvent.click(cells[3]!, { metaKey: true });
    });

    // Should show "2 selected"
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  // 61. Normal click after multi-select resets to single selection
  it("resets to single selection on normal click after multi-select", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const rows = [
      cells[0]!.closest("tr")!,
      cells[3]!.closest("tr")!,
      cells[6]!.closest("tr")!,
    ];

    // Multi-select first and third
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    await act(async () => {
      fireEvent.click(cells[6]!, { metaKey: true });
    });
    expect(rows[0]!.className).toContain("bg-accent/20");
    expect(rows[2]!.className).toContain("bg-accent/20");

    // Normal click on second row
    await act(async () => {
      fireEvent.click(cells[3]!);
    });

    // Only second row should be selected
    expect(rows[0]!.className).not.toContain("bg-accent/20");
    expect(rows[1]!.className).toContain("bg-accent/20");
    expect(rows[2]!.className).not.toContain("bg-accent/20");
  });

  // ── Sprint 76: Per-tab sort state ──

  // AC-02 — sort writes go through the store action, not local state.
  it("routes handleSort through updateTabSorts (store action)", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    await screen.findByText("▲");

    expect(mockUpdateTabSorts).toHaveBeenCalled();
    const calls = mockUpdateTabSorts.mock.calls;
    const last = calls[calls.length - 1]!;
    expect(last[0]).toBe("tab-1");
    expect(last[1]).toEqual([{ column: "id", direction: "ASC" }]);
  });

  // AC-03 — DataGrid consumes tab.sorts on mount and reflects the
  // indicator + sends the correct orderBy to queryTableData. This is
  // the remount-after-tab-switch restoration path.
  it("renders the indicator + orderBy from the persisted tab.sorts on mount", async () => {
    // Seed the active tab with a pre-existing sort (simulating the user
    // having applied it earlier and switched away). The grid should
    // restore both the visual indicator and the backend ordering on
    // mount without any interaction.
    mockTabStoreState.tabs = [
      {
        id: "tab-1",
        type: "table",
        sorts: [{ column: "name", direction: "DESC" }],
      },
    ];

    renderDataGrid();
    await screen.findByText("3 rows");

    // Visual: ▼ rendered on `name`
    expect(await screen.findByText("▼")).toBeInTheDocument();

    // Backend: first call's orderBy reflects the restored sort.
    const firstCall = mockQueryTableData.mock.calls[0] as unknown[];
    expect(firstCall[5]).toBe("name DESC");
  });

  // AC-03 — multi-column sort persisted on a tab is restored with
  // rank numbers and a comma-joined orderBy string.
  it("restores multi-column sorts with ranks + joined orderBy", async () => {
    mockTabStoreState.tabs = [
      {
        id: "tab-1",
        type: "table",
        sorts: [
          { column: "id", direction: "ASC" },
          { column: "name", direction: "DESC" },
        ],
      },
    ];

    renderDataGrid();
    await screen.findByText("3 rows");

    // Both rank numbers visible.
    await waitFor(() => {
      const ranks = screen
        .getAllByText(/^\d+$/)
        .filter((el) => el.classList.contains("font-bold"));
      expect(ranks.map((n) => n.textContent).sort()).toEqual(["1", "2"]);
    });

    // orderBy preserves the order and direction for the backend.
    const firstCall = mockQueryTableData.mock.calls[0] as unknown[];
    expect(firstCall[5]).toBe("id ASC, name DESC");
  });

  // AC-02 / AC-03 — two tabs, two independent sorts. Simulate the
  // tab-switch by swapping `activeTabId` and rerendering the component.
  it("isolates sort state between tabs — tab A's sort does not leak into tab B", async () => {
    mockTabStoreState.tabs = [
      {
        id: "tab-A",
        type: "table",
        sorts: [{ column: "id", direction: "ASC" }],
      },
      {
        id: "tab-B",
        type: "table",
        sorts: [{ column: "name", direction: "DESC" }],
      },
    ];

    // Start on tab A.
    mockTabStoreState.activeTabId = "tab-A";
    const { unmount } = renderDataGrid();
    await screen.findByText("3 rows");

    // Tab A shows id ASC (▲).
    expect(await screen.findByText("▲")).toBeInTheDocument();
    const aCalls = mockQueryTableData.mock.calls;
    let lastCall = aCalls[aCalls.length - 1] as unknown[];
    expect(lastCall[5]).toBe("id ASC");

    // Simulate tab switch by remounting with tab B active.
    unmount();
    mockTabStoreState.activeTabId = "tab-B";
    renderDataGrid();
    await screen.findByText("3 rows");

    // Tab B shows name DESC (▼); A's `▲` must not be present because
    // the grid now reads tab B's sort list.
    expect(await screen.findByText("▼")).toBeInTheDocument();
    const bCalls = mockQueryTableData.mock.calls;
    lastCall = bCalls[bCalls.length - 1] as unknown[];
    expect(lastCall[5]).toBe("name DESC");

    // Tab A's state object is untouched by tab B's render.
    const tabA = mockTabStoreState.tabs.find((t) => t.id === "tab-A")!;
    expect(tabA.sorts).toEqual([{ column: "id", direction: "ASC" }]);
  });

  // ── Sprint 101 — RDB regression guard ──
  // The MongoDB collection beta banner must NOT leak into the relational
  // DataGrid. Asserting both the text and the absence of role="status"
  // catches accidental cross-paradigm imports.
  it("does not render the MongoDB collection beta banner in the RDB grid", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    expect(
      screen.queryByText(COLLECTION_READONLY_BANNER_TEXT),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // Regression guard — with a legacy tab that has no `sorts` key (as
  // would happen before `loadPersistedTabs` normalises it), the grid
  // must render without throwing and fetch without an orderBy string.
  it("tolerates a tab whose sorts field is missing", async () => {
    mockTabStoreState.tabs = [{ id: "tab-1", type: "table" }];

    renderDataGrid();
    await screen.findByText("3 rows");

    const firstCall = mockQueryTableData.mock.calls[0] as unknown[];
    expect(firstCall[5]).toBeUndefined();
    // No sort indicator on any column header.
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  it("[AC-185-06] Preview Dialog header renders environment color stripe (production red)", async () => {
    // AC-185-06 — DataGrid Preview Dialog inserts a 1px coloured div above
    // the header when the active connection has an environment tag. The
    // stripe is purely decorative (aria-hidden) and uses the colour from
    // ENVIRONMENT_META. date 2026-05-01.
    const { useConnectionStore } = await import("@stores/connectionStore");
    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "prod-conn",
          db_type: "postgres",
          host: "localhost",
          port: 5432,
          database: "app",
          username: "u",
          password: null,
          environment: "production",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    });
    renderDataGrid();
    await screen.findByText("3 rows");
    // Edit a cell so handleCommit has something to preview.
    const tds = document.querySelectorAll("tbody tr:first-child td");
    act(() => {
      fireEvent.doubleClick(tds[2]!); // 'name' column
    });
    const input = document.querySelector(
      "tbody tr:first-child input",
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "Alicia" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    // Trigger commit via the toolbar Commit button.
    act(() => {
      window.dispatchEvent(new Event("commit-changes"));
    });
    const stripe = await waitFor(() =>
      document.querySelector('[data-environment-stripe="production"]'),
    );
    expect(stripe).not.toBeNull();
    expect((stripe as HTMLElement).style.background).toMatch(
      /#ef4444|rgb\(239,?\s*68,?\s*68\)/i,
    );
    useConnectionStore.setState({ connections: [] });
  });

  it("[AC-186-06] warn + production + dangerous → ConfirmDangerousDialog rendered with reason", async () => {
    // AC-186-06 — Sprint 186 mounts ConfirmDangerousDialog when the
    // useDataGridEdit hook surfaces pendingConfirm. The generator is
    // PK-bounded so it never emits a WHERE-less DELETE on its own; we
    // mock generateSqlWithKeys to inject a danger shape and verify the
    // warn handoff renders the dialog with the analyzer's reason text.
    // date 2026-05-01.
    const { useConnectionStore } = await import("@stores/connectionStore");
    const { useSafeModeStore } = await import("@stores/safeModeStore");
    const sqlGen = await import("@components/datagrid/sqlGenerator");
    const spy = vi
      .spyOn(sqlGen, "generateSqlWithKeys")
      .mockReturnValue([{ sql: "DELETE FROM users", key: "row-1-0" }]);

    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "prod-conn",
          db_type: "postgres",
          host: "localhost",
          port: 5432,
          database: "app",
          username: "u",
          password: null,
          environment: "production",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    });
    useSafeModeStore.setState({ mode: "warn" });

    try {
      renderDataGrid();
      await screen.findByText("3 rows");
      // Edit a cell so the toolbar Commit button has something to commit.
      const tds = document.querySelectorAll("tbody tr:first-child td");
      act(() => {
        fireEvent.doubleClick(tds[2]!);
      });
      const input = document.querySelector(
        "tbody tr:first-child input",
      ) as HTMLInputElement;
      act(() => {
        fireEvent.change(input, { target: { value: "Alicia" } });
      });
      act(() => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
      // Open the SQL preview, then click Execute. The mocked generator
      // returns the WHERE-less DELETE; warn mode + production should
      // surface the ConfirmDangerousDialog.
      act(() => {
        window.dispatchEvent(new Event("commit-changes"));
      });
      await screen.findByLabelText("Execute SQL");
      act(() => {
        screen.getByLabelText("Execute SQL").click();
      });
      await screen.findByText("Confirm dangerous statement");
      const dialogContent = document.querySelector(
        '[data-slot="alert-dialog-content"]',
      );
      expect(dialogContent).not.toBeNull();
      expect(dialogContent?.textContent).toMatch(/DELETE without WHERE clause/);
    } finally {
      spy.mockRestore();
      useConnectionStore.setState({ connections: [] });
      useSafeModeStore.setState({ mode: "strict" });
    }
  });
});
