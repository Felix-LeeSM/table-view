// Issue #1527 (ADR 0050) — DataGrid Cmd/Ctrl+Shift+Z keyboard binding for
// pending-edit redo, the symmetric counterpart of the Sprint 249 Cmd+Z undo
// binding (see DataGrid.undo.test.tsx). Asserted scenarios:
// - KR1: undo a pending Add, then Cmd+Shift+Z restores it.
// - KR2: Cmd+Shift+Z with an empty redo stack is a no-op.
// - KR3: focused INPUT → browser native redo wins (our handler skips).
//
// Shares the helper-mocked schema/tab stores from
// `__tests__/dataGridTestHelpers.tsx` so the pipeline matches the undo test.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { screen, fireEvent, act } from "@testing-library/react";
import type { SortInfo } from "@/types/schema";
import {
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

vi.mock("./FilterBar", () => ({
  default: () => <div data-testid="filter-bar">FilterBar</div>,
}));

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      queryTableData: mockQueryTableData,
      executeQuery: vi.fn(),
      executeQueryBatch: mockExecuteQueryBatch,
    }),
}));
beforeEach(() => {
  setupTauriMock({
    get queryTableData() {
      return mockQueryTableData;
    },
    get executeQuery() {
      return mockExecuteQuery;
    },
    get executeQueryBatch() {
      return mockExecuteQueryBatch;
    },
  });
});

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

describe("DataGrid — Issue #1527 Cmd+Shift+Z redo (KR1..KR3)", () => {
  beforeEach(() => {
    resetDataGridMocks();
    resetMockTabStore();
  });

  it("[KR1] undo a pending Add, then Cmd+Shift+Z restores it", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Add a row → 4 data rows + header.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });
    expect(screen.getAllByRole("row").length).toBe(5);

    // Cmd+Z reverts it.
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    });
    expect(screen.getAllByRole("row").length).toBe(4);

    // Cmd+Shift+Z re-applies it.
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    });
    expect(screen.getAllByRole("row").length).toBe(5);
  });

  it("[KR2] Cmd+Shift+Z with an empty redo stack is a no-op", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });
    expect(screen.getAllByRole("row").length).toBe(5);

    // Nothing was undone, so redo has nothing to replay — the pending Add stays.
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    });
    expect(screen.getAllByRole("row").length).toBe(5);
  });

  it("[KR3] Cmd+Shift+Z while focus is on an INPUT defers to browser native redo", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Build then undo a pending Add so a redo WOULD be available.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    });
    expect(screen.getAllByRole("row").length).toBe(4);

    // Open a cell editor to get a real <input> to focus.
    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!;
    await act(async () => {
      fireEvent.dblClick(nameCell);
    });
    const input = nameCell.querySelector("input") as HTMLInputElement | null;
    expect(input).not.toBeNull();

    // Cmd+Shift+Z targeted at the input must NOT re-apply the row — our handler
    // skips because target.tagName === "INPUT".
    await act(async () => {
      fireEvent.keyDown(input!, { key: "z", metaKey: true, shiftKey: true });
    });
    expect(screen.getAllByRole("row").length).toBe(4);
  });
});
