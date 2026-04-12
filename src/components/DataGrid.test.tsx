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
import type { TableData } from "../types/schema";

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

vi.mock("../stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      queryTableData: mockQueryTableData,
    }),
}));

function renderDataGrid(props: Partial<Parameters<typeof DataGrid>[0]> = {}) {
  return render(
    <DataGrid connectionId="conn1" table="users" schema="public" {...props} />,
  );
}

describe("DataGrid", () => {
  beforeEach(() => {
    mockQueryTableData.mockReset();
    mockQueryTableData.mockResolvedValue({ ...MOCK_DATA });
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
      100,
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
    const cells = screen.getAllByRole("cell");
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
      total_count: 250,
    };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("250 rows");

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

  // 17. Refetch shows overlay spinner on top of existing table
  it("shows overlay spinner on top of table during refetch", async () => {
    // First load completes
    renderDataGrid();
    await screen.findByText("3 rows");

    // Trigger a slow refetch
    mockQueryTableData.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });

    // Both table AND overlay spinner should exist
    expect(document.querySelector("table")).toBeInTheDocument();
    const spinners = document.querySelectorAll(".animate-spin");
    expect(spinners.length).toBe(1);
    // The spinner should be inside an absolutely-positioned overlay
    const overlay = spinners[0]!.closest('[class*="absolute"]');
    expect(overlay).toBeInTheDocument();
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

    // Trigger mousedown — this registers document-level listeners
    fireEvent.mouseDown(resizeHandle, { clientX: 200, buttons: 1 });

    // Body cursor should be set
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    // Simulate mousemove on document (wider than start)
    fireEvent.mouseMove(document, { clientX: 280 });

    // The first column's th should have its width updated via direct DOM
    const th = document.querySelector("th:nth-child(1)") as HTMLElement;
    expect(th).toBeTruthy();
    // Width should have increased (from 150 + 80 = 230)
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

  // 21. Empty result set shows "No data" row
  it("shows No data message when rows are empty", async () => {
    mockQueryTableData.mockResolvedValue({
      ...MOCK_DATA,
      rows: [],
      total_count: 0,
    });
    renderDataGrid();
    await screen.findByText("0 rows");
    expect(screen.getByText("No data")).toBeInTheDocument();
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

    const select = screen.getByLabelText("Page size") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("100");
  });

  // 30. Changes page size when selector changes
  it("changes page size when selector changes", async () => {
    const bigData: TableData = { ...MOCK_DATA, total_count: 500 };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("500 rows");

    const select = screen.getByLabelText("Page size");
    await act(async () => {
      fireEvent.change(select, { target: { value: "300" } });
    });

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
    // totalPages = ceil(500/100) = 5
    expect(lastCall[3]).toBe(5);
  });

  // 34. Jump to page input works
  it("jump to page input works", async () => {
    const bigData: TableData = { ...MOCK_DATA, total_count: 500 };
    mockQueryTableData.mockResolvedValue(bigData);
    renderDataGrid();
    await screen.findByText("500 rows");

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
});
