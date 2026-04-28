// Purpose: SchemaTree의 모든 preview tab entry point 진단 — Phase 13 Sprint 156 (2026-04-28)
//
// 사용자 보고 버그:
//   Bug 2: PG sidebar table click 시 preview tab이 swap되지 않고 누적됨
//
// SchemaTree.preview.test.tsx는 기본 click/double-click만 커버하므로,
// 여기서는 context menu, search filter, view 항목, promote 후 재클릭 등
// 모든 entry point를 진단한다.
//
// AC IDs:
//   AC-156-04a  Context menu "Data" on table → preview tab (isPreview: true)
//   AC-156-04b  Context menu "Structure" on table → structure tab behavior
//   AC-156-04c  Filtered table click (search active) → preview tab
//   AC-156-04d  Click different table after promoting one → new preview slot
//   AC-156-04e  Click a view (not table) → tab behavior

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore, type TableTab } from "@stores/tabStore";

// ── Store mocks ────────────────────────────────────────────────────────────

const mockLoadSchemas = vi.fn().mockResolvedValue(undefined);
const mockLoadTables = vi.fn().mockResolvedValue(undefined);
const mockLoadViews = vi.fn().mockResolvedValue(undefined);
const mockLoadFunctions = vi.fn().mockResolvedValue(undefined);
const mockPrefetchSchemaColumns = vi.fn().mockResolvedValue(undefined);

function setSchemaStoreState(overrides: Record<string, unknown> = {}) {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
    ...overrides,
    loadSchemas: mockLoadSchemas,
    loadTables: mockLoadTables,
    loadViews: mockLoadViews,
    loadFunctions: mockLoadFunctions,
    prefetchSchemaColumns: mockPrefetchSchemaColumns,
  });
}

function resetStores() {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
    loadSchemas: mockLoadSchemas,
    loadTables: mockLoadTables,
    loadViews: mockLoadViews,
    loadFunctions: mockLoadFunctions,
    prefetchSchemaColumns: mockPrefetchSchemaColumns,
  });
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: new Set<string>(),
  });
  useConnectionStore.setState({ connections: [] });
}

function getTableTab(index = 0): TableTab {
  const tab = useTabStore.getState().tabs[index]!;
  if (tab.type !== "table") throw new Error("Expected TableTab");
  return tab;
}

function seedRelationalSchema() {
  setSchemaStoreState({
    schemas: { conn1: [{ name: "public" }] },
    tables: {
      "conn1:public": [
        { name: "users", schema: "public", row_count: null },
        { name: "orders", schema: "public", row_count: null },
        { name: "products", schema: "public", row_count: null },
      ],
    },
    views: {
      "conn1:public": [{ name: "active_users", schema: "public" }],
    },
    functions: {},
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AC-156-04*: SchemaTree preview entry points diagnostic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
    seedRelationalSchema();
  });

  // Reason: Context menu "Data" 클릭 시 handleTableClick이 호출되어 preview tab이
  //         생성되어야 함. 사용자 보고 — context menu로 열었을 때 누적되는지 확인 (2026-04-28)
  it("AC-156-04a: context menu 'Data' on a table opens a preview tab (isPreview: true)", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tableItem = screen.getByLabelText("users table");

    // Open context menu.
    await act(async () => {
      fireEvent.contextMenu(tableItem, { clientX: 100, clientY: 200 });
    });

    // Click the "Data" menu item.
    await act(async () => {
      fireEvent.click(screen.getByText("Data"));
    });

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab().isPreview).toBe(true);
    expect(getTableTab().table).toBe("users");
    expect(getTableTab().subView).toBe("records");
  });

  // Reason: Context menu "Structure" 클릭 시 subView가 "structure"인 tab이 열려야 함.
  //         preview 여부와 subView 값을 모두 검증 (2026-04-28)
  it("AC-156-04b: context menu 'Structure' on a table opens a structure tab with subView='structure'", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tableItem = screen.getByLabelText("users table");

    await act(async () => {
      fireEvent.contextMenu(tableItem, { clientX: 100, clientY: 200 });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Structure"));
    });

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab().subView).toBe("structure");
    expect(getTableTab().table).toBe("users");
    // Structure tab created via handleOpenStructure calls addTab, which
    // creates a new tab. It may or may not be preview — we diagnose.
    // Diagnostic: check if it replaces an existing preview slot.
    expect(getTableTab().isPreview).toBe(true);
  });

  // Reason: 검색 필터가 활성화된 상태에서 클릭해도 preview swap이 동작해야 함.
  //         search filter가 addTab 분기를 변경하지 않는지 확인 (2026-04-28)
  it("AC-156-04c: clicking a filtered table (search active) opens a preview tab and swap still works", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Type into the search filter to narrow the table list.
    const searchInput = screen.getByLabelText("Filter tables in public");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "ord" } });
    });

    // "orders" should still be visible.
    const ordersItem = screen.getByLabelText("orders table");
    await act(async () => {
      fireEvent.click(ordersItem);
    });

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("orders");
    expect(getTableTab().isPreview).toBe(true);

    // Clear filter and click a different table — must swap the preview.
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });

    // Should still be 1 tab — the preview slot swapped from orders → users.
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("users");
    expect(getTableTab().isPreview).toBe(true);
  });

  // Reason: promote 후 다른 테이블 클릭 시 permanent + preview 2개 탭이 있어야 함.
  //         기존 테스트(SchemaTree.preview.test.tsx AC-S136-02)에서 후속 클릭을
  //         검증하지만, 여기서는 promote → 다른 테이블 → 또 다른 테이블 순서로
  //         3-step 진단 (2026-04-28)
  it("AC-156-04d: clicking a different table after promoting one → 2 tabs (1 permanent + 1 preview)", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Step 1: click "users" → preview tab.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(getTableTab().isPreview).toBe(true);

    // Step 2: double-click "users" → promote.
    await act(async () => {
      fireEvent.doubleClick(screen.getByLabelText("users table"));
    });
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(getTableTab().isPreview).toBe(false);

    // Step 3: click "orders" → new preview tab alongside the permanent "users".
    await act(async () => {
      fireEvent.click(screen.getByLabelText("orders table"));
    });

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(2);

    // Find the permanent and preview tabs.
    const permanent = state.tabs.find(
      (t): t is TableTab => t.type === "table" && t.table === "users",
    );
    const preview = state.tabs.find(
      (t): t is TableTab => t.type === "table" && t.table === "orders",
    );
    expect(permanent).toBeDefined();
    expect(preview).toBeDefined();
    expect(permanent!.isPreview).toBe(false);
    expect(preview!.isPreview).toBe(true);

    // Step 4: click "products" → preview slot swaps (still 2 tabs).
    await act(async () => {
      fireEvent.click(screen.getByLabelText("products table"));
    });

    const state2 = useTabStore.getState();
    expect(state2.tabs).toHaveLength(2);

    const previewAfterSwap = state2.tabs.find(
      (t): t is TableTab => t.type === "table" && t.isPreview === true,
    );
    expect(previewAfterSwap).toBeDefined();
    expect(previewAfterSwap!.table).toBe("products");

    // The permanent "users" tab must remain untouched.
    const permanentStill = state2.tabs.find(
      (t): t is TableTab =>
        t.type === "table" && t.table === "users" && !t.isPreview,
    );
    expect(permanentStill).toBeDefined();
  });

  // Reason: view 클릭 시 tab 생성 방식 확인. views는 handleViewClick을 사용하며
  //         objectKind: "view"가 설정됨. view는 preview slot에 참여하는지 진단 (2026-04-28)
  it("AC-156-04e: clicking a view opens a tab with objectKind='view'", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand the Views category to reveal the "active_users" view.
    const viewsCategoryButton = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCategoryButton);
    });

    // Click the view item.
    const viewItem = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.click(viewItem);
    });

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    const tab = getTableTab();
    expect(tab.table).toBe("active_users");
    expect(tab.objectKind).toBe("view");
    // Diagnostic: check if view tabs participate in the preview system.
    // If this fails, view tabs may always be permanent (isPreview: false).
    expect(tab.isPreview).toBe(true);
  });

  // Reason: view 클릭 후 다른 view 클릭 시 preview swap이 동작하는지 확인.
  //         handleViewClick이 addTab을 호출하므로 같은 swap 로직을 타야 함 (2026-04-28)
  it("AC-156-04e (extended): clicking a second view swaps the preview slot", async () => {
    // Seed two views.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {
        "conn1:public": [
          { name: "active_users", schema: "public" },
          { name: "recent_orders", schema: "public" },
        ],
      },
      functions: {},
      loadSchemas: mockLoadSchemas,
      loadTables: mockLoadTables,
      loadViews: mockLoadViews,
      loadFunctions: mockLoadFunctions,
      prefetchSchemaColumns: mockPrefetchSchemaColumns,
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand Views category.
    const viewsCategoryButton = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCategoryButton);
    });

    // Click first view.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("active_users view"));
    });
    expect(useTabStore.getState().tabs).toHaveLength(1);

    // Click second view — must swap, not accumulate.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("recent_orders view"));
    });

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("recent_orders");
  });

  // Reason: context menu "Data" 후 다른 테이블 클릭 시 preview swap이 정상 동작하는지
  //         진단. context menu 경로와 일반 click 경로가 같은 addTab 분기를 타는지 확인 (2026-04-28)
  it("AC-156-04a (swap): context menu 'Data' then clicking a different table swaps the preview slot", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Open "users" via context menu → Data.
    const usersItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(usersItem, { clientX: 100, clientY: 200 });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Data"));
    });

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("users");

    // Now click "orders" via regular click — must swap, not accumulate.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("orders table"));
    });

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab().table).toBe("orders");
    expect(getTableTab().isPreview).toBe(true);
  });

  // Reason: 테이블 promote 후 view 클릭 시 permanent 테이블 + preview view 2개 탭이
  //         있어야 함. cross-objectKind preview slot 독립성 진단 (2026-04-28)
  it("AC-156-04d (cross-kind): after promoting a table, clicking a view creates a new preview alongside permanent", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Click "users" → preview.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });
    // Double-click → promote.
    await act(async () => {
      fireEvent.doubleClick(screen.getByLabelText("users table"));
    });
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(getTableTab().isPreview).toBe(false);

    // Now click a view.
    const viewsCategoryButton = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCategoryButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("active_users view"));
    });

    const state = useTabStore.getState();
    // Should be 2 tabs: permanent "users" + preview "active_users".
    expect(state.tabs).toHaveLength(2);
  });

  // Reason: context menu "Structure"이 기존 preview tab을 대체하는지 진단.
  //         handleOpenStructure이 addTab을 호출하므로 preview swap이 일어나야 하지만
  //         subView가 다르면 exact-match가 실패할 수 있음 (2026-04-28)
  it("AC-156-04b (swap): context menu 'Structure' after a preview 'Data' tab → replaces the preview slot", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Open "users" via regular click → preview (subView: records).
    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(getTableTab().subView).toBe("records");
    expect(getTableTab().isPreview).toBe(true);

    // Now open "users" Structure via context menu.
    const usersItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(usersItem, { clientX: 100, clientY: 200 });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Structure"));
    });

    const state = useTabStore.getState();
    // Sprint 158 fix: addTab now includes subView in the exact-match and
    // preview-swap checks. A Data preview (records) and Structure tab are
    // treated as separate tabs, so clicking "Structure" after a Data preview
    // creates a second tab instead of activating/replacing the Data preview.
    expect(state.tabs).toHaveLength(2);
    const dataTab = state.tabs.find(
      (t): t is TableTab =>
        t.type === "table" && (t as TableTab).subView === "records",
    );
    const structTab = state.tabs.find(
      (t): t is TableTab =>
        t.type === "table" && (t as TableTab).subView === "structure",
    );
    expect(dataTab).toBeDefined();
    expect(structTab).toBeDefined();
    expect(structTab!.table).toBe("users");
    // The active tab should be the newly created Structure tab
    expect(state.activeTabId).toBe(structTab!.id);
  });
});
