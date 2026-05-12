// Sprint 222 — `sort` axis split from `DataGrid.test.tsx` (P11 step 5,
// last). Covers single-column sort cycle (ASC → DESC → null) +
// Shift+Click multi-column variants (add / toggle / remove) + regular
// click replaces all + sort resets page + orderBy plumbing + Sprint 76
// per-tab sort state (AC-02 / AC-03 — store action route, mount-time
// restoration, multi-column restoration, cross-tab isolation).
// Cases are byte-equivalent to the originals — no behaviour change.
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
mockUpdateTabSorts.mockImplementation(
  (_connId: string, _db: string, tabId: string, next: SortInfo[]) => {
    const tab = mockTabStoreState.tabs.find((t) => t.id === tabId);
    if (tab) tab.sorts = next;
    notify();
  },
);
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
    // ADR 0027 — `(connId, db, tabId, sorts)` arity.
    expect(last[0]).toBe("conn1");
    expect(last[1]).toBe("db1");
    expect(last[2]).toBe("tab-1");
    expect(last[3]).toEqual([{ column: "id", direction: "ASC" }]);
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
});
