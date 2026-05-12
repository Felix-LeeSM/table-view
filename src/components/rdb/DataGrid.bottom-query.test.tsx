// Sprint 233 — DataGrid bottom executed-query strip syntax highlighting.
// 작성 일자: 2026-05-07. 작성 이유: 사용자 보고 (2026-05-07) — `SELECT * FROM
// "public"."brief_news_tasks" LIMIT 300 OFFSET 0` 같은 query 가 하단 strip
// 에 plain `<code>` 로 떠서 색상이 전혀 없음. `<SqlSyntax>` 컴포넌트가 이미
// 존재 (Sprint 227 CreateTableDialog 인라인 preview 에서 사용중). 한 element
// 교체로 keyword (SELECT/FROM/LIMIT/OFFSET) 색상 적용 + `"public"`,
// `"brief_news_tasks"` 가 identifier 로 분류 (string 으로 오인되지 않음).
//
// 본 테스트는 (a) bottom strip 이 SqlSyntax 가 emit 하는 token span 구조를
// 실제로 갖는지, (b) keyword 색상 클래스가 SELECT/FROM/LIMIT/OFFSET 모두에
// 적용되는지, (c) PG double-quoted identifier 가 `text-syntax-string` 이 아닌
// `text-foreground` (identifier) 로 분류되는지 (sqlTokenize.ts:213-220 분기)
// 를 확인한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
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

// Mirror the user-reported query shape verbatim so the test pins down the
// exact PG-double-quoted identifier surface that triggered the bug report.
const USER_REPRO_DATA: TableData = {
  ...MOCK_DATA,
  executed_query:
    'SELECT * FROM "public"."brief_news_tasks" LIMIT 300 OFFSET 0',
};

describe("DataGrid — bottom executed-query strip (Sprint 233)", () => {
  beforeEach(() => {
    resetDataGridMocks();
    resetMockTabStore();
    mockQueryTableData.mockResolvedValue({ ...USER_REPRO_DATA });
  });

  // AC-233-04 (a) — the strip is no longer a plain `<code>`. SqlSyntax wraps
  // the SQL in a parent `<span>` that contains one `<span>` per token. Assert
  // both the parent shape (font-mono root) and at least one keyword span.
  it("renders the executed query through SqlSyntax with keyword token spans (AC-233-04)", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    const region = screen.getByRole("region", { name: /SQL query/i });

    // The font-mono root is the SqlSyntax component's outer span.
    const root = region.querySelector("span.font-mono");
    expect(root).not.toBeNull();

    // At least one keyword span exists (SELECT, at minimum).
    const keywordSpans = region.querySelectorAll(".text-syntax-keyword");
    expect(keywordSpans.length).toBeGreaterThan(0);
  });

  // AC-233-04 (b) — every reserved word in the user-reported query carries
  // the keyword color class. SELECT / FROM / LIMIT / OFFSET each appear
  // exactly once and each is wrapped in a `.text-syntax-keyword` span.
  it("colorizes SELECT, FROM, LIMIT, OFFSET as keywords (AC-233-04)", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    const region = screen.getByRole("region", { name: /SQL query/i });

    const keywordTexts = Array.from(
      region.querySelectorAll(".text-syntax-keyword"),
    ).map((el) => el.textContent);
    expect(keywordTexts).toContain("SELECT");
    expect(keywordTexts).toContain("FROM");
    expect(keywordTexts).toContain("LIMIT");
    expect(keywordTexts).toContain("OFFSET");
  });

  // AC-233-04 (c) — `"public"` and `"brief_news_tasks"` are PG double-quoted
  // identifiers, NOT string literals. `sqlTokenize.ts:213-220` distinguishes
  // by quote char (`"` → identifier, `'` → string). The rendered DOM must
  // therefore mark them with the identifier class (`text-foreground`), not
  // the string class (`text-syntax-string`).
  it("classifies PG double-quoted identifiers as identifiers, not strings (AC-233-04)", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    const region = screen.getByRole("region", { name: /SQL query/i });

    // Collect all text-syntax-string spans — none should contain the
    // double-quoted identifier text. (If the tokenizer regressed to treat
    // `"..."` as a string, this assertion would fail loudly.)
    const stringTexts = Array.from(
      region.querySelectorAll(".text-syntax-string"),
    ).map((el) => el.textContent);
    expect(stringTexts).not.toContain('"public"');
    expect(stringTexts).not.toContain('"brief_news_tasks"');

    // Conversely, the quoted identifiers must each appear inside a
    // `.text-foreground` span (the identifier color class).
    const identifierTexts = Array.from(
      region.querySelectorAll(".text-foreground"),
    ).map((el) => el.textContent);
    expect(identifierTexts).toContain('"public"');
    expect(identifierTexts).toContain('"brief_news_tasks"');
  });

  // AC-233-04 (d) — number literals (300, 0) get the number color class.
  // Guards the LIMIT / OFFSET argument coloring so the user can scan the
  // pagination bounds at a glance.
  it("colorizes LIMIT / OFFSET numeric arguments as numbers (AC-233-04)", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    const region = screen.getByRole("region", { name: /SQL query/i });

    const numberTexts = Array.from(
      region.querySelectorAll(".text-syntax-number"),
    ).map((el) => el.textContent);
    expect(numberTexts).toContain("300");
    expect(numberTexts).toContain("0");
  });
});
