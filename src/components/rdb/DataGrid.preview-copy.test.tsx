// DataGrid inline SQL Preview polish.
//
// Why: the DataGrid inline `<Dialog>` SQL Preview was a plain `<pre>`
// with no Copy affordance. The change:
//   1. Wrap each `<pre>` body in `<SqlSyntax>` → AC-252-05 (keyword
//      span markers appear).
//   2. Add a Copy button to the header (`data-testid="preview-dialog-copy"`,
//      the same testid as PreviewDialog).
//   3. Preserve the load-bearing markup: environment stripe / X button /
//      autoFocus Execute / commitError banner.
//
// Maps:
// - AC-252-05 → "the DataGrid inline preview body contains a
//   .text-syntax-keyword span" (SqlSyntax wrap)
// - AC-252-02 / AC-252-08 → "Copy button works + no regression on the
//   DataGrid commit path"

import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { SortInfo } from "@/types/schema";
import {
  mockAddTab,
  mockExecuteQuery,
  mockExecuteQueryBatch,
  mockPromoteTab,
  mockQueryTableData,
  mockSetTabDirty,
  mockUpdateTabSorts,
  renderDataGrid,
  resetDataGridMocks,
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
  subscribers.forEach((fn) => {
    fn();
  });
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

function installClipboard(impl: (text: string) => Promise<void>) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

async function makePendingEditAndOpenPreview() {
  const cells = screen.getAllByRole("gridcell");
  const nameCell = cells[1]!;
  await act(async () => {
    fireEvent.dblClick(nameCell);
  });
  const input = nameCell.querySelector("input")!;
  await act(async () => {
    fireEvent.change(input, { target: { value: "Bob" } });
    fireEvent.keyDown(input, { key: "Enter" });
  });
  // Trigger commit -> opens SQL preview modal.
  await act(async () => {
    window.dispatchEvent(new Event("commit-changes"));
  });
}

describe("DataGrid inline SQL Preview Copy + highlight (sprint-252)", () => {
  beforeEach(() => {
    resetDataGridMocks();
    resetMockTabStore();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  it("AC-252-05: inline SQL preview wraps body in SqlSyntax (text-syntax-keyword spans appear)", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    await makePendingEditAndOpenPreview();

    // Wait for the SQL preview dialog header to mount.
    await screen.findByLabelText("Execute SQL");

    const dialog = screen.getByRole("dialog");
    const keywordSpans = dialog.querySelectorAll("span.text-syntax-keyword");
    expect(keywordSpans.length).toBeGreaterThan(0);

    const keywordTexts = Array.from(keywordSpans).map((el) => el.textContent);
    // The pending edit emits an UPDATE SQL — "UPDATE" must be tokenised as
    // a keyword by SqlSyntax.
    expect(keywordTexts).toContain("UPDATE");
  });

  it("AC-252-02 / AC-252-08: Copy button is rendered with shared testid and writes the joined SQL to clipboard", async () => {
    const writeText = installClipboard(() => Promise.resolve());
    renderDataGrid();
    await screen.findByText("3 rows");
    await makePendingEditAndOpenPreview();

    await screen.findByLabelText("Execute SQL");

    const btn = screen.getByTestId("preview-dialog-copy");
    expect(btn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    // The clipboard payload must be the joined SQL preview (one statement
    // here from the single pending edit). Trim guards against whitespace
    // drift.
    const arg = writeText.mock.calls[0]?.[0] as string;
    expect(arg).toMatch(/UPDATE/i);
    expect(arg.trim().length).toBeGreaterThan(0);
  });
});
