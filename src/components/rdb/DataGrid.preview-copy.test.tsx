// Sprint 252 (2026-05-09) — DataGrid 인라인 SQL Preview polish.
//
// Why: DataGrid 의 인라인 `<Dialog>` SQL Preview 는 plain `<pre>` 였고
// Copy affordance 가 없었다. 본 sprint 에서:
//   1. 각 `<pre>` body 를 `<SqlSyntax>` 로 wrap → AC-252-05 (keyword
//      span 마커 출현).
//   2. Header 에 Copy 버튼 추가 (`data-testid="preview-dialog-copy"` 통일,
//      PreviewDialog 와 동일 testid).
//   3. environment stripe / X 버튼 / autoFocus Execute / commitError 배너
//      load-bearing markup 보존.
//
// /tdd 흐름: 본 파일은 구현보다 먼저 작성됨. 구현 후 통과 예상.
//
// Maps:
// - AC-252-05 → "DataGrid 인라인 preview body 가 .text-syntax-keyword
//   span 포함" (SqlSyntax wrap)
// - AC-252-02 / AC-252-08 → "Copy 버튼 동작 + DataGrid commit-path 회귀
//   없음"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import type { SortInfo } from "@/types/schema";
import {
  mockQueryTableData,
  mockExecuteQuery,
  mockExecuteQueryBatch,
  mockPromoteTab,
  mockUpdateTabSorts,
  mockSetTabDirty,
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
