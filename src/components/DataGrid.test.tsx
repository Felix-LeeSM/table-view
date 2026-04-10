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
    const sortIndicators = screen.getAllByText(/^\d+$/).filter(el => el.classList.contains("font-bold"));
    expect(sortIndicators.length).toBe(1);
    expect(sortIndicators[0]!.textContent).toBe("1");
    expect(await screen.findByText("▲")).toBeInTheDocument();

    // Shift+Click on second column → add to sort list
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by name"), { shiftKey: true });
    });
    // Should see two sort indicators (rank numbers)
    const newSortIndicators = screen.getAllByText(/^\d+$/).filter(el => el.classList.contains("font-bold"));
    expect(newSortIndicators.length).toBe(2);
    expect(newSortIndicators.some(n => n.textContent === "1")).toBe(true);
    expect(newSortIndicators.some(n => n.textContent === "2")).toBe(true);
  });

  // 7b. Shift+Click toggles direction on existing sort column
  it("toggles direction on Shift+Click for existing sort column", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Add first column with regular click
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    const sortIndicators1 = screen.getAllByText(/^\d+$/).filter(el => el.classList.contains("font-bold"));
    expect(sortIndicators1.length).toBe(1);
    expect(sortIndicators1[0]!.textContent).toBe("1");
    expect(await screen.findByText("▲")).toBeInTheDocument();

    // Add second column with Shift+Click
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by name"), { shiftKey: true });
    });
    const sortIndicators2 = screen.getAllByText(/^\d+$/).filter(el => el.classList.contains("font-bold"));
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
      const rankNumbers = screen.queryAllByText(/^\d+$/).filter(el => el.classList.contains("font-bold"));
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
    let sortIndicators = screen.getAllByText(/^\d+$/).filter(el => el.classList.contains("font-bold"));
    expect(sortIndicators.length).toBe(2);

    // Regular click on third column → replace all sorts
    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by meta"));
    });
    // Only meta should be sorted
    await waitFor(() => {
      sortIndicators = screen.queryAllByText(/^\d+$/).filter(el => el.classList.contains("font-bold"));
      expect(sortIndicators.length).toBe(1); // Only one sort column
    });
    // Check that meta is now rank 1
    sortIndicators = screen.queryAllByText(/^\d+$/).filter(el => el.classList.contains("font-bold"));
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
});
