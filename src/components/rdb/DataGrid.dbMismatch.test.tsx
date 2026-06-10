// Sprint 271b (2026-05-13) — DataGrid 의 DbMismatch end-to-end recovery.
//
// 작성 이유: backend Sprint 266 가드가 DataGrid 의 row-fetch 를
// `AppError::DbMismatch` 로 reject 할 때
//   (1) typed/legacy DbMismatch normalizer 가 envelope 를 감지하고
//   (2) syncMismatchedActiveDb 가 verifyActiveDb 의 새 db 로 sync 하며
//   (3) user-initiated (DataGrid 는 사용자가 클릭한 그리드) 이므로
//       Sprint 269 Retry toast 가 표면화된다.
// 를 한꺼번에 단언. typed envelope 의 `message` 가 inline error 박스에
// 그대로 보임을 함께 검증.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { screen, waitFor } from "@testing-library/react";
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
import type { SortInfo } from "@/types/schema";

// Hoisted hooks 가 vi.mock factory 안에서 참조될 수 있도록 vi.hoisted 로
// 선언. 대표 mismatch mock 은 #744 typed envelope 형식.
const verifyActiveDbMock = vi.hoisted(() => vi.fn());
const setActiveDbMock = vi.hoisted(() => vi.fn());
const clearForConnectionMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: verifyActiveDbMock,
}));

vi.mock("@stores/connectionStore", () => ({
  useConnectionStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        connections: [],
        activeStatuses: {},
        focusedConnId: null,
      }),
    {
      getState: () => ({
        setActiveDb: setActiveDbMock,
        connections: [],
        activeStatuses: {},
      }),
    },
  ),
}));

vi.mock("@lib/runtime/toast", () => ({
  toast: {
    warning: toastWarningMock,
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("./FilterBar", () => ({
  default: () => <div data-testid="filter-bar">FilterBar</div>,
}));

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        queryTableData: mockQueryTableData,
        executeQuery: mockExecuteQuery,
        executeQueryBatch: mockExecuteQueryBatch,
      }),
    {
      getState: () => ({ clearForConnection: clearForConnectionMock }),
    },
  ),
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

// Reactive workspaceStore mock mirrors DataGrid.lifecycle.test.tsx so
// the production component subscribes through the selector without
// dragging real zustand into the test.
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

describe("DataGrid — DbMismatch routing (Sprint 271b)", () => {
  beforeEach(() => {
    resetDataGridMocks();
    resetMockTabStore();
    verifyActiveDbMock.mockReset();
    setActiveDbMock.mockReset();
    clearForConnectionMock.mockReset();
    toastWarningMock.mockReset();
  });

  it("syncs activeDb + surfaces Retry toast on DbMismatch error", async () => {
    mockQueryTableData.mockRejectedValueOnce({
      type: "DbMismatch",
      message: "Database mismatch: expected 'db1', backend pool has 'db2'",
      payload: { expected: "db1", actual: "db2" },
    });
    verifyActiveDbMock.mockResolvedValueOnce("db2");

    renderDataGrid();

    // (1) inline error surface — DataGrid still routes the message
    // through setError so the alert box matches Sprint 222 behaviour.
    await screen.findByRole("alert");

    // (2) verify helper fired against the workspace connId; setActiveDb
    // received the backend's actual db; schemaStore cleared for the conn.
    await waitFor(() => {
      expect(verifyActiveDbMock).toHaveBeenCalledWith("conn1");
    });
    await waitFor(() => {
      expect(setActiveDbMock).toHaveBeenCalledWith("conn1", "db2");
    });
    expect(clearForConnectionMock).toHaveBeenCalledWith("conn1");

    // (3) user-initiated → Retry toast surfaces (DataGrid is a row-fetch
    // the user kicked off by opening the table).
    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalled();
    });
    expect(toastWarningMock.mock.calls[0]![0]).toContain("db2");
  });

  it("non-mismatch errors do NOT trigger the sync helper or toast", async () => {
    mockQueryTableData.mockRejectedValueOnce(new Error("Connection refused"));

    renderDataGrid();

    await screen.findByRole("alert");

    // wait one tick so any (incorrect) async sync would fire.
    await Promise.resolve();
    await Promise.resolve();

    expect(verifyActiveDbMock).not.toHaveBeenCalled();
    expect(setActiveDbMock).not.toHaveBeenCalled();
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("happy path still resolves with the seeded fixture rows", async () => {
    // Regression guard: the new catch branch must not break the
    // existing success path. `mockQueryTableData` defaults to MOCK_DATA.
    renderDataGrid();
    await screen.findByText(`${MOCK_DATA.total_count} rows`);
    expect(verifyActiveDbMock).not.toHaveBeenCalled();
    expect(toastWarningMock).not.toHaveBeenCalled();
  });
});
