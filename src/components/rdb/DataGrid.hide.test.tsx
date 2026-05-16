// Sprint 318 (2026-05-15) — Slice D.2: RDB DataGrid hide column wire-up.
//
// 작성 이유: paradigm-shared `useHiddenColumns` 가 RDB DataGrid 에서
// 도 (a) header context menu → hide → 회복 lifeline (badge + Show
// all) 까지 한 사이클이 돌아가는지, (b) persist key 가
// `hidden-columns:rdb:<schema>:<table>` 인지를 lock. `DataGridTable.hide`
// 는 prop 차원 회귀를, 이 파일은 RDB shell 차원의 통합 회귀를 검증.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  resetDataGridMocks();
  resetMockTabStore();
  window.localStorage.clear();
});

describe("RDB DataGrid — hide column (Sprint 318 D.2)", () => {
  it("renders no hidden columns badge initially and shows all three headers", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    expect(screen.queryByLabelText("Hidden columns badge")).toBeNull();
    expect(screen.getByTitle("Sort by id")).toBeInTheDocument();
    expect(screen.getByTitle("Sort by name")).toBeInTheDocument();
    expect(screen.getByTitle("Sort by meta")).toBeInTheDocument();
  });

  it("Hide column removes the column from the grid and surfaces a badge", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Open context menu on the `meta` header.
    fireEvent.contextMenu(screen.getByTitle("Sort by meta"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    });

    // The `meta` header disappears from the grid.
    await waitFor(() => {
      expect(screen.queryByTitle("Sort by meta")).toBeNull();
    });

    // The badge appears with the count + Show all affordance.
    const badge = await screen.findByLabelText("Hidden columns badge");
    expect(badge).toHaveTextContent("1 column hidden");
    expect(
      screen.getByRole("button", { name: "Show all hidden columns" }),
    ).toBeInTheDocument();

    // The remaining columns survive.
    expect(screen.getByTitle("Sort by id")).toBeInTheDocument();
    expect(screen.getByTitle("Sort by name")).toBeInTheDocument();
  });

  it("persists hidden columns under hidden-columns:rdb:<schema>:<table>", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    fireEvent.contextMenu(screen.getByTitle("Sort by meta"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    });

    await waitFor(() => {
      const raw = window.localStorage.getItem(
        "hidden-columns:rdb:public:users",
      );
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!) as string[];
      expect(parsed).toEqual(["meta"]);
    });
  });

  it("Show all restores every column and wipes persisted state", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    fireEvent.contextMenu(screen.getByTitle("Sort by meta"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    });
    fireEvent.contextMenu(screen.getByTitle("Sort by name"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Hidden columns badge")).toHaveTextContent(
        "2 columns hidden",
      );
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Show all hidden columns" }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Hidden columns badge")).toBeNull();
    });
    expect(screen.getByTitle("Sort by meta")).toBeInTheDocument();
    expect(screen.getByTitle("Sort by name")).toBeInTheDocument();
    expect(
      window.localStorage.getItem("hidden-columns:rdb:public:users"),
    ).toBeNull();
  });

  it("loads persisted hidden columns on mount", async () => {
    window.localStorage.setItem(
      "hidden-columns:rdb:public:users",
      JSON.stringify(["meta"]),
    );

    renderDataGrid();
    await screen.findByText("3 rows");

    // `meta` should be hidden from the start.
    expect(screen.queryByTitle("Sort by meta")).toBeNull();
    expect(screen.getByLabelText("Hidden columns badge")).toHaveTextContent(
      "1 column hidden",
    );
  });
});
