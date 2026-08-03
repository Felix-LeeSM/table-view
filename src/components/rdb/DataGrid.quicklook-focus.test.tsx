// Issue #1734 (5) — keyboard focus visibility between the grid and Quick Look.
//
// The grid publishes a single tab stop (roving tabindex), so Tab cannot reach
// the panel and come back. `F6` does that walk, and every path that closes the
// panel returns focus to the grid cell the user came from — otherwise focus
// falls to `<body>` and the next arrow key goes nowhere.
//
// Also pins the owner's stated default from the 2026-08-02 decision comment:
// moving the row selection while the panel is open re-syncs the detail body.
//
// Mock preamble mirrors `DataGrid.esc.test.tsx` — `vi.mock` factories cannot
// live in `__tests__/dataGridTestHelpers.tsx`, so each axis file re-declares
// them (see that helper's header).

import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(panel()).toBeInTheDocument();
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
    expect(panel()).toBeInTheDocument();
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
    expect(panel()).toBeInTheDocument();
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
