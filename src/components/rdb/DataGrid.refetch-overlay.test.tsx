// Sprint 222 — `refetch-overlay` axis split from `DataGrid.test.tsx`
// (P11 step 5, last). Covers Sprint 180 loading-flicker gate
// (centered spinner on initial load / table-in-DOM during refetch /
// post-threshold overlay / overlay removal on completion / refetch
// failure surfacing) + column resize handles + drag-mousemove width
// computation + null tableRef tolerance + race-condition stale
// response. Cases are byte-equivalent to the originals — no
// behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { SortInfo, TableData } from "@/types/schema";
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

    // Wait for the first call to start (audit M19 — replaced setTimeout(0)
    // race-pattern with explicit "first call dispatched" signal).
    await waitFor(() => {
      expect(mockQueryTableData).toHaveBeenCalledTimes(1);
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
});
