// Issue #1734 (5) — keyboard focus visibility between the grid and Quick Look.
//
// The grid publishes a single tab stop (roving tabindex), so Tab reaches the
// panel only by walking its controls and re-enters the grid at that one tab
// stop rather than at the cell the user left. `F6` is the direct walk in both
// directions, and the panel disappearing must not leave focus on `<body>`,
// where the next arrow key goes nowhere.
//
// An earlier fix held that second half by calling a restore from each close
// handler; the two cases at the bottom of this file are the ones that reach no
// handler. `useQuickLookFocus` now hangs the restore off the panel node leaving
// the DOM, so the close-button and `Cmd+L` cases below prove the same one
// mechanism the commit and refetch cases do — neutering it reds 9 of the 17
// tests across this file and `useQuickLookFocus.test.tsx`.
//
// Also pins the owner's stated default from the 2026-08-02 decision comment:
// moving the row selection while the panel is open re-syncs the detail body.
//
// Mock preamble mirrors `DataGrid.esc.test.tsx` — `vi.mock` factories cannot
// live in `__tests__/dataGridTestHelpers.tsx`, so each axis file re-declares
// them (see that helper's header).

import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { SortInfo } from "@/types/schema";
import {
  MOCK_DATA,
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

/** The single grid tab stop — what focus must come back to. */
function rovingAnchor(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    '[data-grid-row][tabindex="0"]',
  );
  if (!el) throw new Error("no roving anchor cell");
  return el;
}

function panel(): HTMLElement {
  return screen.getByRole("region", { name: "Row Details" });
}

/**
 * Selects data row `rowIdx` by clicking its first cell, leaves DOM focus on
 * that cell (jsdom does not focus on click), then opens Quick Look with
 * Cmd+L. Returns the focused cell.
 */
async function selectRowAndOpenPanel(rowIdx: number): Promise<HTMLElement> {
  const cell = document.querySelector<HTMLElement>(
    `[data-grid-row="${rowIdx}"][data-grid-col="0"]`,
  );
  if (!cell) throw new Error(`no cell for row ${rowIdx}`);
  await act(async () => {
    fireEvent.click(cell);
    cell.focus();
  });
  await act(async () => {
    fireEvent.keyDown(document, { key: "l", metaKey: true });
  });
  return cell;
}

describe("DataGrid — Quick Look focus exchange (#1734 (5))", () => {
  beforeEach(() => {
    resetDataGridMocks();
    resetMockTabStore();
  });

  // Reason: the grid's roving tabindex leaves exactly one tab stop, so without
  // F6 there is no keyboard route into the panel at all.
  it("F6 walks focus grid → panel → grid", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    const cell = await selectRowAndOpenPanel(0);
    expect(document.activeElement).toBe(cell);

    await act(async () => {
      fireEvent.keyDown(window, { key: "F6" });
    });
    expect(document.activeElement).toBe(panel());

    await act(async () => {
      fireEvent.keyDown(window, { key: "F6" });
    });
    expect(document.activeElement).toBe(rovingAnchor());
    // Round trip, not a one-way door: the panel is still open.
    expect(
      screen.queryByRole("region", { name: "Row Details" }),
    ).toBeInTheDocument();
  });

  // Reason: the panel is reachable only programmatically (`tabIndex={-1}`), so
  // if it did not paint a focus ring the user would have no idea F6 landed.
  it("the panel is a focusable target that shows a --color-ring focus ring", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    await selectRowAndOpenPanel(0);

    expect(panel()).toHaveAttribute("tabindex", "-1");
    expect(panel().className).toContain("focus-visible:outline-ring");
  });

  // Reason: Escape inside the panel must hand focus back WITHOUT closing —
  // closing here would collide with the grid's own Escape discard gate.
  it("Escape in the panel returns focus to the grid cell and leaves the panel open", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    await selectRowAndOpenPanel(0);

    await act(async () => {
      fireEvent.keyDown(window, { key: "F6" });
    });
    expect(document.activeElement).toBe(panel());

    await act(async () => {
      fireEvent.keyDown(panel(), { key: "Escape" });
    });
    expect(document.activeElement).toBe(rovingAnchor());
    expect(
      screen.queryByRole("region", { name: "Row Details" }),
    ).toBeInTheDocument();
  });

  // Reason: Escape inside a field already means "revert this draft"
  // (`FieldRow`). Stealing focus there would abandon the edit the user is in.
  it("Escape inside a panel field keeps focus in the field", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    await selectRowAndOpenPanel(0);

    const nameInput = within(panel()).getByLabelText("Edit value for name");
    await act(async () => {
      nameInput.focus();
    });
    await act(async () => {
      fireEvent.keyDown(nameInput, { key: "Escape" });
    });
    expect(document.activeElement).toBe(nameInput);
  });

  // Reason: closing while focus sits inside the panel drops focus to <body>
  // unless the close path restores it — arrow keys would then do nothing.
  it("closing the panel returns focus to the grid cell", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    await selectRowAndOpenPanel(0);

    await act(async () => {
      fireEvent.keyDown(window, { key: "F6" });
    });
    const closeButton = within(panel()).getByLabelText(/Close row details/i);
    await act(async () => {
      fireEvent.click(closeButton);
    });

    expect(
      screen.queryByRole("region", { name: "Row Details" }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(rovingAnchor());
  });

  // Reason: Cmd+L is the other close path (#2107 kept it as a toggle); it must
  // restore focus the same way the Close button does.
  it("Cmd+L closing the panel returns focus to the grid cell", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    await selectRowAndOpenPanel(0);

    await act(async () => {
      fireEvent.keyDown(window, { key: "F6" });
    });
    expect(document.activeElement).toBe(panel());

    await act(async () => {
      fireEvent.keyDown(document, { key: "l", metaKey: true });
    });
    expect(
      screen.queryByRole("region", { name: "Row Details" }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(rovingAnchor());
  });

  // Reason: owner default from the 2026-08-02 decision comment — "Quick Look
  // 열림 중 행 선택 이동 시 상세 동기화 포함". Fixture rows: 0 = Alice, 2 = Charlie.
  it("moving the row selection while the panel is open re-syncs the detail body", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    await selectRowAndOpenPanel(0);
    expect(within(panel()).getByDisplayValue("Alice")).toBeInTheDocument();

    const row2Cell = document.querySelector<HTMLElement>(
      '[data-grid-row="2"][data-grid-col="0"]',
    );
    await act(async () => {
      fireEvent.click(row2Cell!);
    });

    expect(within(panel()).getByDisplayValue("Charlie")).toBeInTheDocument();
    expect(
      within(panel()).queryByDisplayValue("Alice"),
    ).not.toBeInTheDocument();
  });

  // Reason: #1734 (5) B1 — the restore must not depend on the anchor being
  // findable by `[data-grid-row][tabindex="0"]`. Past 200 rows the RDB grid
  // virtualizes and that selector matches nothing while the anchor row is
  // scrolled out, which is what made the tabindex-only restore drop focus on
  // <body>. jsdom has no layout so the virtualizer cannot be driven faithfully
  // here; demoting the attribute reproduces the same observable — the fallback
  // lookup cannot find the cell — and proves `DataGrid` really wired its focuser
  // through `RdbDataGridContent`. The scroll-in + retry that focuser performs
  // is covered by `useGridRoving.test.tsx`.
  it("closing restores focus even when the anchor is not findable by the tabindex lookup", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    const cell = await selectRowAndOpenPanel(0);

    await act(async () => {
      fireEvent.keyDown(window, { key: "F6" });
    });
    expect(document.activeElement).toBe(panel());
    // Still programmatically focusable, just no longer the tab stop the
    // fallback selector looks for.
    cell.setAttribute("tabindex", "-1");
    expect(document.querySelector('[data-grid-row][tabindex="0"]')).toBeNull();

    const closeButton = within(panel()).getByLabelText(/Close row details/i);
    await act(async () => {
      fireEvent.click(closeButton);
    });

    expect(document.activeElement).toBe(cell);
  });

  // Reason: #1734 (5) — the two paths that remove the panel without
  // going through any close handler. Both were live regressions of the same
  // shape the close-handler restore already fixed: the panel vanishes and focus
  // is left on `<body>`, so the next arrow key goes nowhere. They are here rather
  // than in `useQuickLookFocus.test.tsx` because what they pin is the real
  // wiring — a commit and a refetch, neither of which knows Quick Look exists.
  describe("paths that remove the panel without a close handler", () => {
    /** Grid-cell edit on the selected row, so a commit has something to write. */
    async function makePendingEdit() {
      const nameCell = document.querySelector<HTMLElement>(
        '[data-grid-row="0"][data-grid-col="1"]',
      );
      if (!nameCell) throw new Error("no name cell");
      await act(async () => {
        fireEvent.dblClick(nameCell);
      });
      const input = nameCell.querySelector("input");
      if (!input) throw new Error("cell did not enter edit mode");
      await act(async () => {
        fireEvent.change(input, { target: { value: "Bob" } });
        fireEvent.keyDown(input, { key: "Enter" });
      });
    }

    // Reason: commit success runs `clearPendingAfterCommit` →`clearSelection`,
    // and the panel's mount gate is `selectedRowIds.size > 0`. No close handler
    // is involved, so a handler-driven restore simply never ran here.
    it("a successful commit empties the selection and the panel it unmounts hands focus back", async () => {
      renderDataGrid();
      await screen.findByText("3 rows");
      await selectRowAndOpenPanel(0);
      await makePendingEdit();

      await act(async () => {
        fireEvent.keyDown(window, { key: "F6" });
      });
      expect(document.activeElement).toBe(panel());

      // Same event `Cmd/Ctrl+S` dispatches from `App` — the panel region is not
      // an editable target, so the global commit shortcut fires from there.
      await act(async () => {
        window.dispatchEvent(new Event("commit-changes"));
      });
      const executeBtn = await screen.findByLabelText("Execute SQL");
      await waitFor(() => {
        expect(executeBtn).not.toBeDisabled();
      });
      await act(async () => {
        fireEvent.click(executeBtn);
      });

      expect(
        screen.queryByRole("region", { name: "Row Details" }),
      ).not.toBeInTheDocument();
      expect(document.activeElement).toBe(rovingAnchor());
    });

    // Reason: a refetch that returns fewer rows than the selected index makes
    // `RdbQuickLookBody` render `null` while `showQuickLook` is still true —
    // the panel disappears with no state change to hang a restore on. The
    // reviewer's page-1 page-size shrink is the same class; a refresh is the
    // instance that keeps focus inside the panel while the rows change.
    it("a refetch that drops the selected row out of range hands focus back", async () => {
      renderDataGrid();
      await screen.findByText("3 rows");
      await selectRowAndOpenPanel(2);

      await act(async () => {
        fireEvent.keyDown(window, { key: "F6" });
      });
      expect(document.activeElement).toBe(panel());

      mockQueryTableData.mockResolvedValue({
        ...MOCK_DATA,
        rows: MOCK_DATA.rows.slice(0, 1),
        total_count: 1,
      });
      await act(async () => {
        window.dispatchEvent(new Event("refresh-data"));
      });

      expect(
        screen.queryByRole("region", { name: "Row Details" }),
      ).not.toBeInTheDocument();
      expect(document.activeElement).toBe(rovingAnchor());
    });
  });

  // Reason: F6 is a new global binding — it must stay inert when the panel is
  // not mounted, or it would blur whatever the user is actually typing in.
  it("F6 does nothing while the panel is closed", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    const cell = rovingAnchor();
    await act(async () => {
      cell.focus();
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "F6" });
    });
    expect(document.activeElement).toBe(cell);
  });
});
