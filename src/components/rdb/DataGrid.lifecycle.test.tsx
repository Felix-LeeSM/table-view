// Sprint 222 — `lifecycle` axis split from `DataGrid.test.tsx` (P11
// step 5, last). Covers initial mount + queryTableData call shape /
// loading spinner / error message / column headers + ExportButton /
// NULL italic / JSONB stringify / executed-query bar toggle / SQL
// display / Sprint 99 empty-message branches / refresh-data event /
// PK icon / data-type sub-label / schema.table fallback / Sprint 101
// MongoDB beta-banner regression / legacy tab without `sorts`.
// Cases are byte-equivalent to the originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SortInfo } from "@/types/schema";
import { COLLECTION_READONLY_BANNER_TEXT } from "@lib/strings/document";
import {
  MOCK_DATA,
  mockQueryTableData,
  mockExecuteQuery,
  mockExecuteQueryBatch,
  mockPromoteTab,
  mockUpdateTabSorts,
  mockSetTabDirty,
  resetDataGridMocks,
  renderDataGrid,
} from "./__tests__/dataGridTestHelpers";

// Mock FilterBar — test DataGrid in isolation
vi.mock("./FilterBar", () => ({
  default: () => <div data-testid="filter-bar">FilterBar</div>,
}));

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      queryTableData: mockQueryTableData,
      executeQuery: mockExecuteQuery,
      executeQueryBatch: mockExecuteQueryBatch,
    }),
}));

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
mockUpdateTabSorts.mockImplementation((tabId: string, next: SortInfo[]) => {
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

describe("DataGrid", () => {
  beforeEach(() => {
    resetDataGridMocks();
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
  // Sprint 233 (2026-05-07): bottom strip now routes through `<SqlSyntax>`
  // so the SQL is split across token spans. The full text still lives in
  // the surrounding region's textContent — assert that instead of trying
  // to match across span boundaries with `getByText`.
  it("displays the executed SQL query", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    const region = screen.getByRole("region", { name: /SQL query/i });
    expect(region.textContent).toContain("SELECT * FROM public.users");
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
});
