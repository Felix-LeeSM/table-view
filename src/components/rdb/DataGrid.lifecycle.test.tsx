// Sprint 222 — `lifecycle` axis split from `DataGrid.test.tsx` (P11
// step 5, last). Covers initial mount + queryTableData call shape /
// loading spinner / error message / column headers + ExportButton /
// NULL italic / JSONB stringify / executed-query bar toggle / SQL
// display / Sprint 99 empty-message branches / refresh-data event /
// PK icon / data-type sub-label / schema.table fallback / Sprint 101
// MongoDB beta-banner regression / legacy tab without `sorts`.
// Cases are byte-equivalent to the originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  // 1. Initial rendering — queryTableData called with correct args
  //
  // Sprint 354 (L2 fix, 2026-05-16) — the schemaStore wrapper accepted
  // `(connId, db, table, schema, ...)`; the new direct `tauri.queryTableData`
  // signature is `(connectionId, table, schema, page, pageSize, orderBy,
  // filters, rawWhere, expectedDatabase)`. `db` moves to the last
  // positional slot (`expectedDatabase`).
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
      "db1",
      // Issue #1269 (P1) — per-browse cancel-token id threaded to the backend.
      expect.any(String),
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

  // Sprint 343 (2026-05-15) — JSONB / ARRAY object cells now render as
  // `{ ... }` / `[ N items ]` sentinels that toggle the inline JSON
  // tree panel. Sprint 238's "compact one-line JSON" rendering was
  // replaced because cell-level inline edit on a stringified JSON
  // payload was lossy + error-prone; the tree panel edits leaves
  // through jsonb_set so the wire literal stays canonical.
  it("renders JSONB cells as expandable sentinels (Sprint 343)", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    // `{ key: "value" }` row → object sentinel (Expand meta button).
    // `[1, 2, 3]` row → array sentinel (Expand meta button + "3 items").
    const expandButtons = screen.getAllByRole("button", {
      name: /Expand meta/i,
    });
    expect(expandButtons.length).toBe(2);
    // One of them carries the array's child count.
    const buttonTexts = expandButtons.map((b) => b.textContent);
    expect(buttonTexts).toContain("3 items");
    // Raw JSON text from Sprint 238 must NOT appear as a cell value.
    const cells = screen.getAllByRole("gridcell");
    const cellTexts = cells.map((c) => c.textContent);
    expect(cellTexts).not.toContain(JSON.stringify({ key: "value" }));
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

    // After clearing, the data refetches with NO filters applied. Sprint
    // 354 (L2 fix) — the schemaStore wrapper accepted `db` as positional
    // arg 1 so `filters` was at index 7 and `rawWhere` at index 8. The
    // new direct tauri signature is `(conn, table, schema, page,
    // pageSize, orderBy, filters, rawWhere, expectedDatabase)` — filters
    // is now at index 6 and rawWhere at index 7.
    await waitFor(() => {
      expect(mockQueryTableData.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    const lastCall = mockQueryTableData.mock.calls[
      mockQueryTableData.mock.calls.length - 1
    ] as unknown[];
    expect(lastCall[6]).toBeUndefined();
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

  // Regression guard — with a legacy tab that has no `sorts` key (as
  // would happen before `loadPersistedTabs` normalises it), the grid
  // must render without throwing and fetch without an orderBy string.
  it("tolerates a tab whose sorts field is missing", async () => {
    mockTabStoreState.tabs = [{ id: "tab-1", type: "table" }];

    renderDataGrid();
    await screen.findByText("3 rows");

    const firstCall = mockQueryTableData.mock.calls[0] as unknown[];
    expect(firstCall[6]).toBeUndefined();
    // No sort indicator on any column header.
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------
  // Sprint 344 Slice F (2026-05-15) — end-to-end `+ key` / `+ item`
  // adds through the RDB grid. Locks Slice E's central assumption that
  // the inline tree panel's `onCommitEdit("<segment>", v)` for a
  // jsonb / ARRAY cell at column idx C materialises a pendingEdit
  // keyed `"<row>-<C>:<segment>"`, and that the SQL preview emits the
  // expected `jsonb_set(..., true)` / `ARRAY[..., <new>]::etype[]`
  // wire shape.
  //
  // Uses a custom fixture (text[] + jsonb) because MOCK_DATA's `meta`
  // is jsonb but has no Postgres ARRAY column for the `+ item` flow.
  // -----------------------------------------------------------------
  describe("inline tree `+ key` / `+ item` end-to-end (Sprint 344 Slice F)", () => {
    // Fixture used by both AC-344-F-02 and AC-344-F-03. Row 0:
    //   meta = { existing: "foo" }  (jsonb)  — add `newKey: 42`
    //   tags = ["a", "b"]           (text[]) — push `c`
    function buildSliceFData(): TableData {
      return {
        columns: [
          {
            name: "id",
            data_type: "integer",
            nullable: false,
            default_value: null,
            is_primary_key: true,
            is_foreign_key: false,
            fk_reference: null,
            comment: null,
          },
          {
            name: "meta",
            data_type: "jsonb",
            nullable: true,
            default_value: null,
            is_primary_key: false,
            is_foreign_key: false,
            fk_reference: null,
            comment: null,
          },
          {
            name: "tags",
            data_type: "text[]",
            nullable: true,
            default_value: null,
            is_primary_key: false,
            is_foreign_key: false,
            fk_reference: null,
            comment: null,
          },
        ],
        rows: [[1, { existing: "foo" }, ["a", "b"]]],
        total_count: 1,
        page: 1,
        page_size: 100,
        executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
      };
    }

    it("AC-344-F-02: jsonb `+ key` add — preview SQL contains `jsonb_set(meta, '{\"newKey\"}', '42'::jsonb, true)`", async () => {
      mockQueryTableData.mockResolvedValue(buildSliceFData());
      renderDataGrid();
      await screen.findByText("1 rows");

      // Open the inline tree on the jsonb `meta` cell (col idx 1).
      const expandMeta = screen.getByRole("button", { name: /Expand meta/i });
      fireEvent.click(expandMeta);
      expect(screen.getByTestId("rdb-nested-detail-row-0")).toBeInTheDocument();

      // `+ key` on the root of the cell tree.
      fireEvent.click(screen.getByTestId("tree-add-key-__root"));
      const keyInput = screen.getByTestId("tree-add-key-input-__root");
      const valueInput = screen.getByTestId("tree-add-value-input-__root");
      fireEvent.change(keyInput, { target: { value: "newKey" } });
      // Bare numeric → Slice D coerces to number 42 → jsonb literal `'42'`.
      fireEvent.change(valueInput, { target: { value: "42" } });
      fireEvent.keyDown(valueInput, { key: "Enter" });

      // Pending pill appears on the panel.
      await waitFor(() => {
        expect(
          screen.getByTestId("document-tree-pending-pill"),
        ).toBeInTheDocument();
      });

      // Commit → SQL preview emits the create-missing `jsonb_set` form.
      const commitBtn = screen.getByLabelText("Commit changes");
      await act(async () => {
        fireEvent.click(commitBtn);
      });
      const preview = await screen.findByRole("dialog");
      // The dialog body is split across `<SqlSyntax>` token spans, so we
      // assert on the dialog's flattened text content.
      const previewText = preview.textContent ?? "";
      expect(previewText).toMatch(/UPDATE/);
      expect(previewText).toMatch(/jsonb_set/);
      expect(previewText).toContain(`'{"newKey"}'`);
      expect(previewText).toContain(`'42'::jsonb`);
      // 4-arg form with create_missing=true.
      expect(previewText).toMatch(/, true\)/);
    });

    it("AC-344-F-03: text[] `+ item` push — preview SQL contains `ARRAY['a', 'b', 'c']::text[]`", async () => {
      mockQueryTableData.mockResolvedValue(buildSliceFData());
      renderDataGrid();
      await screen.findByText("1 rows");

      // Open the inline tree on the text[] `tags` cell (col idx 2).
      const expandTags = screen.getByRole("button", { name: /Expand tags/i });
      fireEvent.click(expandTags);
      expect(screen.getByTestId("rdb-nested-detail-row-0")).toBeInTheDocument();

      // `+ item` on the root array. The auto-derived next index is [2]
      // (cellValue length = 2, no prior pending appends).
      fireEvent.click(screen.getByTestId("tree-add-item-"));
      const valueInput = screen.getByTestId("tree-add-item-input-");
      // Quoted value → Slice D coerces to the string "c" (jsonb-style
      // outer-quotes rule). For text[] elementType the SQL generator
      // single-quotes it.
      fireEvent.change(valueInput, { target: { value: '"c"' } });
      fireEvent.keyDown(valueInput, { key: "Enter" });

      // Pending pill appears.
      await waitFor(() => {
        expect(
          screen.getByTestId("document-tree-pending-pill"),
        ).toBeInTheDocument();
      });

      const commitBtn = screen.getByLabelText("Commit changes");
      await act(async () => {
        fireEvent.click(commitBtn);
      });
      const preview = await screen.findByRole("dialog");
      const previewText = preview.textContent ?? "";
      expect(previewText).toMatch(/UPDATE/);
      // Original two items preserved + new 'c' appended, all single-
      // quoted as text[] elements.
      expect(previewText).toContain(`ARRAY['a', 'b', 'c']::text[]`);
    });
  });
});
