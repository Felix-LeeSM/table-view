// Sprint 222 — `filters-pagination` axis split from `DataGrid.test.tsx`
// (P11 step 5, last). Covers filter-bar toggle (button + Cmd+F) +
// pagination (next-page / page-size / first-last / jump-to-page —
// Sprint 26) + props-change page reset + props-change column-width
// reset. Cases are byte-equivalent to the originals — no behaviour
// change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataGrid from "./DataGrid";
import type { SortInfo, TableData } from "@/types/schema";
import {
  MOCK_DATA,
  mockQueryTableData,
  mockExecuteQuery,
  mockExecuteQueryBatch,
  mockPromoteTab,
  mockUpdateTabSorts,
  mockSetTabDirty,
  mockAddTab,
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

// Sprint 354 (L2 fix, 2026-05-16) — `queryTableData` / `executeQuery` /
// `executeQueryBatch` moved out of `schemaStore` to `@lib/tauri`. Use
// `importOriginal` so the real exports (cancelQuery, executeQueryDryRun,
// etc.) stay live and only the three commit-path symbols become spies.
// The getter-property pattern defers the spy lookup until the call site
// fires, which sidesteps the
// `Cannot access '__vi_import_X__'` hoisting race that hits when the
// factory closes over the helper-exported spy reference directly.
vi.mock("@lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/tauri")>("@lib/tauri");
  return {
    ...actual,
    get queryTableData() {
      return mockQueryTableData;
    },
    get executeQuery() {
      return mockExecuteQuery;
    },
    get executeQueryBatch() {
      return mockExecuteQueryBatch;
    },
  };
});

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
function mockWorkspaceView() {
  return {
    workspaces: {
      conn1: {
        db1: {
          tabs: mockTabStoreState.tabs,
          activeTabId: mockTabStoreState.activeTabId,
          closedTabHistory: [],
          dirtyTabIds: [],
          sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
        },
      },
    },
    addTab: mockAddTab,
    promoteTab: mockPromoteTab,
    updateTabSorts: mockUpdateTabSorts,
    setTabDirty: mockSetTabDirty,
  };
}
vi.mock("@stores/workspaceStore", async () => {
  const React = await import("react");
  return {
    useActiveTabId: () => mockTabStoreState.activeTabId,
    useCurrentWorkspaceKey: () => ({ connId: "conn1", db: "db1" }),
    useWorkspaceStore: Object.assign(
      (selector: (state: Record<string, unknown>) => unknown) => {
        const [, forceRerender] = React.useReducer((n: number) => n + 1, 0);
        React.useEffect(() => {
          const fn = () => forceRerender();
          subscribers.add(fn);
          return () => {
            subscribers.delete(fn);
          };
        }, []);
        return selector(mockWorkspaceView());
      },
      {
        getState: () => mockWorkspaceView(),
      },
    ),
  };
});

describe("DataGrid", () => {
  beforeEach(() => {
    resetDataGridMocks();
    resetMockTabStore();
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
    // Sprint 354 (L2 fix) — see DataGrid.lifecycle.test for the
    // index-shift rationale (db moved to last positional slot).
    expect(lastCall[3]).toBe(2);
  });

  // 12. Props change resets page
  it("resets page to 1 when table prop changes", async () => {
    const { rerender } = renderDataGrid();
    await screen.findByText("3 rows");

    // Change table prop
    rerender(
      <DataGrid
        connectionId="conn1"
        database="db1"
        table="orders"
        schema="public"
      />,
    );
    await screen.findByText("3 rows");

    // The latest call should be with page=1 for the new table
    const calls = mockQueryTableData.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall[1]).toBe("orders");
    expect(lastCall[3]).toBe(1);
  });

  // 22. Props change resets column widths
  it("resets column widths when table prop changes", async () => {
    const { rerender } = renderDataGrid();
    await screen.findByText("3 rows");

    // Rerender with different table
    rerender(
      <DataGrid
        connectionId="conn1"
        database="db1"
        table="orders"
        schema="public"
      />,
    );
    await screen.findByText("3 rows");

    // Should have called with new table name
    const calls = mockQueryTableData.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall[1]).toBe("orders");
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
    // Sprint 354 (L2 fix) — see DataGrid.lifecycle.test for the
    // index-shift rationale (db moved to last positional slot).
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
});
