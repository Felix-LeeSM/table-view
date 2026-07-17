import { describe, it, expect, beforeEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import {
  getTestWorkspace,
  seedConnection,
  seedWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, fireEvent, act } from "@testing-library/react";
import TabBar from "./TabBar";
import { useWorkspaceStore, type TableTab } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";

function addTableTab(
  overrides: Partial<Omit<TableTab, "id" | "connectionId">> & {
    connectionId?: string;
  } = {},
) {
  // Workspace key is hardcoded to conn1/db1 so legacy tests that mixed
  // tabs from different connections (via `connectionId` overrides on the
  // init payload) still surface every tab through `useCurrentTabs()`.
  // Tests asserting per-workspace separation should use `seedWorkspace`
  // / `addTab(connId, ...)` directly.
  useWorkspaceStore.getState().addTab("conn1", {
    title: "Test Tab",
    connectionId: "conn1" as ConnectionId,
    type: "table",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  });
}

function fireAuxClick(element: Element, button: number) {
  fireEvent(
    element,
    new MouseEvent("auxclick", { bubbles: true, button, cancelable: true }),
  );
}

describe("TabBar", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [],
      groups: [],
      activeStatuses: {},
      loading: false,
      error: null,
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
    seedConnection("conn1", "db1");
  });

  it("renders nothing when no tabs", () => {
    const { container } = render(<TabBar />);
    expect(container.innerHTML).toBe("");
  });

  it("renders tabs with titles", () => {
    addTableTab({
      title: "public.users",
      table: "users",
      connectionId: "conn1" as ConnectionId,
    });
    addTableTab({
      title: "public.orders",
      table: "orders",
      connectionId: "conn2",
    });

    render(<TabBar />);
    // Unique table names → only table name shown (no schema prefix)
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("shows schema.table when two tabs share the same table name", () => {
    // Same table name from two different connections → must disambiguate with schema prefix
    addTableTab({
      title: "public.users",
      schema: "public",
      table: "users",
      connectionId: "conn1" as ConnectionId,
    });
    addTableTab({
      title: "public.users",
      schema: "public",
      table: "users",
      connectionId: "conn2",
    });

    render(<TabBar />);
    // Ambiguous table name → full schema.table shown for both tabs
    expect(screen.getAllByText("public.users")).toHaveLength(2);
  });

  it("closes tab on middle-click (auxclick button 1)", () => {
    addTableTab({
      title: "public.users",
      table: "users",
      connectionId: "conn1" as ConnectionId,
    });
    addTableTab({
      title: "public.orders",
      table: "orders",
      connectionId: "conn2",
    });

    render(<TabBar />);

    const state = getTestWorkspace();
    expect(state.tabs).toHaveLength(2);

    const ordersTab = screen.getByText("orders").closest("[role='tab']")!;
    fireAuxClick(ordersTab, 1);

    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(screen.queryByText("orders")).not.toBeInTheDocument();
  });

  it("does not close tab on right-click (auxclick button 2)", () => {
    addTableTab({
      title: "public.users",
      table: "users",
      connectionId: "conn1" as ConnectionId,
    });
    addTableTab({
      title: "public.orders",
      table: "orders",
      connectionId: "conn2",
    });

    render(<TabBar />);

    const ordersTab = screen.getByText("orders").closest("[role='tab']")!;
    fireAuxClick(ordersTab, 2);

    expect(getTestWorkspace().tabs).toHaveLength(2);
  });

  it("activates tab on click", () => {
    addTableTab({
      title: "public.users",
      table: "users",
      connectionId: "conn1" as ConnectionId,
    });
    addTableTab({
      title: "public.orders",
      table: "orders",
      connectionId: "conn2",
    });

    render(<TabBar />);

    const state = getTestWorkspace();
    const firstTabId = state.tabs[0]!.id;

    // Click the first tab (second tab is currently active)
    const usersTab = screen.getByText("users").closest("[role='tab']")!;
    act(() => {
      fireEvent.click(usersTab);
    });

    expect(getTestWorkspace().activeTabId).toBe(firstTabId);
  });

  // #1131 — ArrowLeft/Right/Home/End rove focus + activation across the tab
  // strip so tabs past Cmd/Ctrl+1..9's reach stay keyboard-navigable, with a
  // single roving tab stop.
  it("#1131 arrow keys rove tab activation with a single tab stop", () => {
    const mkTab = (id: string, table: string): TableTab => ({
      id: id as TabId,
      type: "table",
      title: table,
      connectionId: "conn1" as ConnectionId,
      closable: true,
      subView: "records",
      isPreview: false,
      schema: "public",
      table,
    });
    useWorkspaceStore.setState(
      seedWorkspace(
        [mkTab("t1", "a"), mkTab("t2", "b"), mkTab("t3", "c")],
        "t3",
      ),
    );

    render(<TabBar />);

    const tablist = screen.getByRole("tablist");
    expect(getTestWorkspace().activeTabId).toBe("t3");

    // ArrowRight from the last tab wraps to the first.
    act(() => {
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
    });
    expect(getTestWorkspace().activeTabId).toBe("t1");

    // ArrowLeft from the first wraps to the last.
    act(() => {
      fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    });
    expect(getTestWorkspace().activeTabId).toBe("t3");

    // Home → first, and exactly one tab owns tabindex 0.
    act(() => {
      fireEvent.keyDown(tablist, { key: "Home" });
    });
    expect(getTestWorkspace().activeTabId).toBe("t1");
    const stops = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAttribute("data-tab-id", "t1");
  });

  it("closes tab via close button", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const closeBtn = screen.getByLabelText("Close Users");
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(getTestWorkspace().tabs).toHaveLength(0);
  });

  // 2026-05-11 — regression. The pointer-events drag migration started
  // calling `setPointerCapture(e.pointerId)` on the tab div in
  // `pointerdown`. When the pointerdown bubbled up from the close
  // button, the capture rerouted the following `pointerup` to the tab
  // div, and the synthesized `click` then fired on the tab div instead
  // of the close button — the user-visible symptom was "X 버튼이 안
  // 닫힘". The fix bails out of drag setup whenever pointerdown
  // originates inside an interactive child (`.closest('button')`),
  // which leaves the close button's own click path intact. The
  // bare-click test above passes via `fireEvent.click` alone and
  // therefore does not exercise the pointer-events path, so we add an
  // explicit pointerdown → pointerup → click sequence here.
  it("closes tab via close button under full pointer-events sequence", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const closeBtn = screen.getByLabelText("Close Users");
    act(() => {
      fireEvent.pointerDown(closeBtn, { button: 0, pointerId: 1 });
      fireEvent.pointerUp(closeBtn, { button: 0, pointerId: 1 });
      fireEvent.click(closeBtn);
    });

    expect(getTestWorkspace().tabs).toHaveLength(0);
  });

  it("renders query tab with correct icon", () => {
    addTableTab({ title: "Users", table: "users" });
    useWorkspaceStore.getState().addQueryTab("conn1", "db1");

    render(<TabBar />);
    const tabs = screen.getAllByRole("tab");
    // Second tab should be the query tab
    const queryTab = tabs[1]!;
    expect(queryTab).toHaveAttribute("aria-selected", "true");
  });

  it("has select-none class on root element to prevent text selection", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("select-none");
  });

  // ── Sprint 77: Compact tab bar height ──

  // AC-01 — the tab row must stay in the compact regime. `py-1 text-sm`
  // yields ~28px content (20px line-height + 4px+4px padding); combined
  // with the 1px bottom border the row is ≤ 32px as the contract requires.
  // `text-sm` keeps the close button (size-6 = 24px) inside a ≥ 28px
  // vertical hit target. Failing this assertion means someone bumped the
  // padding / font size back up — revisit AC-01 intentionally.
  it("compact tab metrics — py-1 + text-sm, not py-1.5", () => {
    addTableTab({ title: "public.users", table: "users" });

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    expect(tab.className).toContain("py-1");
    expect(tab.className).toContain("text-sm");
    // Guard against regression to the pre-Sprint 77 padding.
    expect(tab.className).not.toContain("py-1.5");
    expect(tab.className).not.toContain("py-2");
  });

  // ── Sprint 253 (AC-253-03): TabBar connection-color stripe REMOVED ──
  //
  // 이전 (Sprint 28 / Sprint 45) 의 좌측 1px connection-색 stripe 는
  // ADR 0023 의 13-question grill Q11 결과 *완전 제거* 되었다 (다중
  // connection workflow 부재 + 후속 chrome H 가 환경 시그널을 carry).
  // 본 회귀 가드는 stripe 가 어떤 connection 설정 조합에서도 다시
  // mount 되지 않음을 단언한다. 작성 일자: 2026-05-09.

  function makeConnection(
    overrides: Partial<ConnectionConfig> = {},
  ): ConnectionConfig {
    return {
      id: "conn1",
      name: "Test DB",
      dbType: "postgresql",
      host: "localhost",
      port: 5432,
      user: "postgres",
      hasPassword: false,
      database: "testdb",
      groupId: null,
      color: null,
      paradigm: "rdb",
      ...overrides,
    };
  }

  it("does NOT render a connection-color stripe even when a color is set (AC-253-03)", () => {
    useConnectionStore.setState({
      connections: [makeConnection({ id: "conn1", color: "red" })],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    render(<TabBar />);

    // No stripe — the affordance was retired in Sprint 253.
    expect(screen.queryByLabelText("Connection color")).toBeNull();
  });

  it("does NOT render any connection-color stripe across multi-connection setups (AC-253-03)", () => {
    useConnectionStore.setState({
      connections: [
        makeConnection({ id: "conn1", color: "red" }),
        makeConnection({ id: "conn2", color: "blue" }),
      ],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    addTableTab({ title: "Orders", table: "orders", connectionId: "conn2" });
    render(<TabBar />);

    expect(screen.queryAllByLabelText("Connection color")).toHaveLength(0);
  });

  // ── Sprint 29: Preview Tab Display ──

  it("preview tab has italic title", () => {
    addTableTab({ title: "public.users", table: "users" });
    // New tabs are preview by default

    render(<TabBar />);
    const titleEl = screen.getByText("users");
    expect(titleEl.className).toContain("italic");
  });

  it("permanent tab does not have italic title", () => {
    addTableTab({ title: "public.users", table: "users" });

    // Promote the tab to permanent
    const state = getTestWorkspace();
    const tabId = state.tabs[0]!.id;
    useWorkspaceStore.getState().promoteTab("conn1", "db1", tabId);

    render(<TabBar />);
    const titleEl = screen.getByText("users");
    expect(titleEl.className).not.toContain("italic");
  });

  // ── Sprint 43: Double-click tab promotion ──

  it("promotes preview tab on double-click", () => {
    addTableTab({ title: "public.users", table: "users" });
    // New tab is preview by default
    const state = getTestWorkspace();
    expect((state.tabs[0] as TableTab).isPreview).toBe(true);

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    act(() => {
      fireEvent.doubleClick(tab);
    });

    const updatedTab = getTestWorkspace().tabs[0] as TableTab;
    expect(updatedTab.isPreview).toBe(false);
  });

  it("does not change permanent tab on double-click", () => {
    addTableTab({ title: "public.users", table: "users" });
    const state = getTestWorkspace();
    const tabId = state.tabs[0]!.id;
    useWorkspaceStore.getState().promoteTab("conn1", "db1", tabId);

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    act(() => {
      fireEvent.doubleClick(tab);
    });

    const updatedTab = getTestWorkspace().tabs[0] as TableTab;
    expect(updatedTab.isPreview).toBe(false);
  });

  it("does not call promoteTab on query tab double-click", () => {
    addTableTab({ title: "Users", table: "users" });
    useWorkspaceStore.getState().addQueryTab("conn1", "db1");

    render(<TabBar />);
    const tabs = screen.getAllByRole("tab");
    const queryTab = tabs[1]!;

    act(() => {
      fireEvent.doubleClick(queryTab);
    });

    // Query tab should still exist and be active
    expect(getTestWorkspace().tabs[1]!.type).toBe("query");
  });

  // ── Sprint 253 (AC-253-03): Sprint 45 tooltip test retired ──
  //
  // The "Connection color" stripe (and its connection-name tooltip) was
  // removed in Sprint 253. Replaced by the regression guards above.

  // ── Drag-and-drop reorder ──

  // Helper: set tabs directly in the store to bypass the preview-replacement
  // logic in addTab (which collapses multiple same-connection tabs into one).
  function setThreeTabs() {
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            id: "t1" as TabId,
            type: "table",
            title: "users",
            connectionId: "conn1" as ConnectionId,
            closable: true,
            subView: "records" as const,
            isPreview: false,
            schema: "public",
            table: "users",
          },
          {
            id: "t2" as TabId,
            type: "table",
            title: "orders",
            connectionId: "conn1" as ConnectionId,
            closable: true,
            subView: "records" as const,
            isPreview: false,
            schema: "public",
            table: "orders",
          },
          {
            id: "t3" as TabId,
            type: "table",
            title: "products",
            connectionId: "conn1" as ConnectionId,
            closable: true,
            subView: "records" as const,
            isPreview: false,
            schema: "public",
            table: "products",
          },
        ],
        "t1",
      ),
    );
  }

  // 2026-05-11 — drag-reorder migrated mouse → pointer events with
  // `setPointerCapture` so a release outside the WKWebView window can
  // never leave the ghost stranded. All three regression cases below
  // exercise the new contract via `fireEvent.pointer*`.
  //
  // Helper layout used by every drag-DnD case: three 100px-wide tabs.
  // We must mock getBoundingClientRect because the new pointerup path
  // resolves drop target via per-tab rects (jsdom returns 0 by default).
  function mockTabRects(
    rects: { left: number; right: number; width: number }[],
  ) {
    const tabEls = document.querySelectorAll<HTMLElement>("[data-tab-id]");
    tabEls.forEach((el, i) => {
      const r = rects[i];
      if (!r) return;
      el.getBoundingClientRect = () =>
        ({
          left: r.left,
          right: r.right,
          top: 0,
          bottom: 32,
          width: r.width,
          height: 32,
          x: r.left,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    });
  }

  it("reorders tabs when dragging first tab onto third", () => {
    setThreeTabs();
    render(<TabBar />);

    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    const before = getTestWorkspace().tabs.map((t) => t.id);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);

    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      // dx=200 > 8 → isDragging.
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 250 });
      // Release with cursor over t3's right half → "after t3" → [t2, t3, t1].
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 260 });
    });

    const after = getTestWorkspace().tabs.map((t) => t.id);
    // t1 moves past t3 → [t2, t3, t1]
    expect(after).toEqual([before[1], before[2], before[0]]);
  });

  it("does not reorder when dropping a tab onto itself", () => {
    setThreeTabs();
    render(<TabBar />);

    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    const before = getTestWorkspace().tabs.map((t) => t.id);
    const tabs = screen.getAllByRole("tab");

    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      // dx=20 > 8 → isDragging, but release lands back over t1.
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 70 });
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 30 });
    });

    expect(getTestWorkspace().tabs.map((t) => t.id)).toEqual(before);
  });

  it("activeTabId is unchanged after drag reorder", () => {
    setThreeTabs();
    render(<TabBar />);

    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    const { activeTabId } = getTestWorkspace();
    const tabs = screen.getAllByRole("tab");

    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 250 });
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 260 });
    });

    expect(getTestWorkspace().activeTabId).toBe(activeTabId);
  });

  // 2026-05-11 — drag-end 불변식 매트릭스 헬퍼.
  //
  // 어떤 종료 경로 (pointerup, pointercancel, 임계값 미달 release,
  // viewport 밖 release 등) 든 다음 4 개 상태가 동시에 reset 되어야 한다.
  // ghost 와 cursor cleanup 누락이 2026-05-11 user report 의 핵심 증상.
  function expectCleanDragState() {
    expect(document.querySelector("[aria-hidden][class*='fixed']")).toBeNull();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    // No tab should still carry the dragging dim (opacity-50).
    const dimmed = document.querySelectorAll(
      "[role='tab'][class*='opacity-50']",
    );
    expect(dimmed.length).toBe(0);
  }

  // 2026-05-11 회귀 — pre-2026-05-11 회귀: 트랙패드 클릭이 1–6px 미세
  // 이동을 동반하면 4px 임계값을 넘어 ghost 가 잠시 표시됐다. 새 8px
  // 임계값 하에서 같은 미세 이동은 ghost 를 트리거하지 않아야 한다.
  it("does not start dragging when cursor drifts under the 8px threshold (2026-05-11)", () => {
    setThreeTabs();
    render(<TabBar />);

    const tabs = screen.getAllByRole("tab");
    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      // 7px drift — below threshold.
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 57 });
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 57 });
    });

    // No ghost mounted at any point.
    expectCleanDragState();
  });

  // 2026-05-11 — pointerdown 즉시 native text-selection 차단.
  //
  // `setPointerCapture` 는 pointer 이벤트만 라우팅하고 브라우저의
  // selection 로직 (mousedown 에서 anchor → mousemove 로 확장) 은
  // 그대로 동작한다. 임계값 (`dx > 8`) 을 넘은 뒤에 `userSelect=none` 을
  // 거는 pre-2026-05-11 구현은 selection 이 이미 시작된 뒤라 무효였다.
  // 회귀 가드: pointerdown 시점에 즉시 `userSelect=none` 이어야 한다.
  it("suppresses native text selection from pointerdown (not after threshold)", () => {
    setThreeTabs();
    render(<TabBar />);

    const tabs = screen.getAllByRole("tab");
    expect(document.body.style.userSelect).toBe("");

    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
    });
    // BEFORE any pointermove — selection must already be suppressed.
    expect(document.body.style.userSelect).toBe("none");

    // Cleanup restores.
    act(() => {
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 50 });
    });
    expect(document.body.style.userSelect).toBe("");
  });

  // 2026-05-11 — 임계값 경계 매트릭스. 코드는 `dx > 8` 이므로:
  //   dx = 7  → drag 안 시작
  //   dx = 8  → drag 안 시작 (경계 미포함)
  //   dx = 9  → drag 시작
  // 각 경계에서 ghost mount 여부 + cleanup 불변식 둘 다 단언.
  it.each([
    { dx: 7, shouldDrag: false, label: "below threshold (7px)" },
    { dx: 8, shouldDrag: false, label: "exactly at threshold (8px)" },
    { dx: 9, shouldDrag: true, label: "just over threshold (9px)" },
  ])("drag-threshold boundary: $label", ({ dx, shouldDrag }) => {
    setThreeTabs();
    render(<TabBar />);

    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    const tabs = screen.getAllByRole("tab");
    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 50 + dx });
    });

    if (shouldDrag) {
      // Ghost present, originating tab dimmed.
      expect(
        document.querySelector("[aria-hidden][class*='fixed']"),
      ).not.toBeNull();
    } else {
      // No drag — ghost never mounted.
      expect(
        document.querySelector("[aria-hidden][class*='fixed']"),
      ).toBeNull();
    }

    // Release — cleanup invariant must hold regardless of branch.
    act(() => {
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 50 + dx });
    });
    expectCleanDragState();
  });

  // 2026-05-11 회귀 — drop 후 ghost 가 cursor 를 계속 따라다니던 버그.
  // WKWebView 가 native mouseup 을 swallow 했을 때 cleanup 이 누락되어
  // dragStateRef + ghostStyle 이 살아남았다. pointer event + capture 는
  // pointerup 이 capturing element 로 보장 delivery 되므로 구조적으로 차단.
  // 그래도 cleanup 이 모든 release 경로에서 실제로 호출되는지 회귀 가드.
  it("cleans up ghost and drag state after pointerup, even at non-tab coordinates (2026-05-11)", () => {
    setThreeTabs();
    render(<TabBar />);

    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    const tabs = screen.getAllByRole("tab");

    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 150 });
      // Release way outside any tab — sim user dropping over a different
      // window / off-screen. pointer capture routes pointerup back to
      // the captured element; cleanup must still run.
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 9999 });
    });

    expectCleanDragState();
  });

  // 2026-05-11 회귀 — pointercancel 경로 (OS 가 드래그를 가로채는 경우)
  // 에서도 cleanup 이 호출되어야 한다.
  it("cleans up on pointercancel without reordering (2026-05-11)", () => {
    setThreeTabs();
    render(<TabBar />);

    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    const before = getTestWorkspace().tabs.map((t) => t.id);
    const tabs = screen.getAllByRole("tab");

    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 250 });
      fireEvent.pointerCancel(tabs[0]!, { pointerId: 1, clientX: 250 });
    });

    // No reorder happened.
    expect(getTestWorkspace().tabs.map((t) => t.id)).toEqual(before);
    expectCleanDragState();
  });

  // 2026-05-11 — onClick 이 drag 직후 발화해도 (DOM 표준 동작) 탭이
  // 재활성화되면 안 된다. justDraggedRef 가드가 click 을 한 번 swallow.
  it("does not re-activate the dragged tab via the click event that follows pointerup", () => {
    setThreeTabs();
    render(<TabBar />);

    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    // Start with t2 active, drag t1 onto t3, then synthesize the trailing
    // click — activeTabId should NOT collapse to t1.
    useWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        conn1: {
          ...state.workspaces.conn1,
          db1: {
            ...(state.workspaces.conn1?.db1 ?? {
              tabs: [],
              activeTabId: null,
              closedTabHistory: [],
              dirtyTabIds: [],
              sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
            }),
            activeTabId: "t2",
          },
        },
      },
    }));
    const tabs = screen.getAllByRole("tab");

    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 250 });
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 260 });
      // Browser fires `click` on the originating element after pointerup
      // when down + up landed on the same element. We replay that here.
      fireEvent.click(tabs[0]!);
    });

    // moveTab repositioned t1 to the end → active tab still t2 (untouched).
    expect(getTestWorkspace().activeTabId).toBe("t2");
  });

  // ── Sprint 97: dirty indicator + close gate ──

  // AC-01 — a tab in `dirtyTabIds` renders a visible dirty marker
  // (data-dirty="true" + aria-label hint) so the user can spot unsaved
  // edits at a glance.
  it("renders a dirty mark for tabs in dirtyTabIds (AC-01)", () => {
    addTableTab({ title: "Users", table: "users" });
    const tabId = getTestWorkspace().tabs[0]!.id;
    act(() => {
      useWorkspaceStore.getState().setTabDirty("conn1", "db1", tabId, true);
    });

    render(<TabBar />);

    const tab = screen.getByText("users").closest("[role='tab']")!;
    const dot = tab.querySelector('[data-dirty="true"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-label", "Unsaved changes");
  });

  // AC-03 — when dirty drops to 0 the mark disappears immediately on the
  // next render, without needing a tab switch / remount.
  it("removes the dirty mark when dirtyTabIds clears (AC-03)", () => {
    addTableTab({ title: "Users", table: "users" });
    const tabId = getTestWorkspace().tabs[0]!.id;
    act(() => {
      useWorkspaceStore.getState().setTabDirty("conn1", "db1", tabId, true);
    });

    const { rerender } = render(<TabBar />);
    let tab = screen.getByText("users").closest("[role='tab']")!;
    expect(tab.querySelector('[data-dirty="true"]')).not.toBeNull();

    // Clean → mark must vanish.
    act(() => {
      useWorkspaceStore.getState().setTabDirty("conn1", "db1", tabId, false);
    });
    rerender(<TabBar />);
    tab = screen.getByText("users").closest("[role='tab']")!;
    expect(tab.querySelector('[data-dirty="true"]')).toBeNull();
  });

  // AC-04 — a clean tab never sprouts a dirty mark, even after another
  // sibling tab toggles dirty (regression guard).
  it("does not render a dirty mark for clean tabs", () => {
    addTableTab({
      title: "users",
      table: "users",
      connectionId: "conn1" as ConnectionId,
    });
    addTableTab({
      title: "orders",
      table: "orders",
      connectionId: "conn2",
    });
    const dirtyId = getTestWorkspace().tabs[0]!.id;
    act(() => {
      useWorkspaceStore.getState().setTabDirty("conn1", "db1", dirtyId, true);
    });

    render(<TabBar />);
    const cleanTab = screen.getByText("orders").closest("[role='tab']")!;
    expect(cleanTab.querySelector('[data-dirty="true"]')).toBeNull();
  });

  // ── Sprint 134 (AC-S134-06): dirty marker is independent of activeTabId ──
  //
  // Lesson 2026-04-27-workspace-toolbar-ux-gaps (#9) reported that the
  // dirty dot was perceived to render only on the active tab. The
  // production code at `TabBar.tsx` keys the marker on
  // `dirtyTabIds.has(tab.id)` (NOT `tab.id === activeTabId`), so these
  // tests guard against any future refactor accidentally re-coupling
  // the two.

  it("renders the dirty mark on a tab that is NOT the active tab (AC-S134-06)", () => {
    addTableTab({
      title: "users",
      table: "users",
      connectionId: "conn1" as ConnectionId,
    });
    addTableTab({
      title: "orders",
      table: "orders",
      connectionId: "conn2",
    });
    const tabs = getTestWorkspace().tabs;
    const dirtyId = tabs[0]!.id; // "users" — will be DIRTY
    const activeId = tabs[1]!.id; // "orders" — will be ACTIVE
    act(() => {
      useWorkspaceStore.setState((state) => ({
        workspaces: {
          ...state.workspaces,
          conn1: {
            ...state.workspaces.conn1,
            db1: {
              ...(state.workspaces.conn1?.db1 ?? {
                tabs: [],
                activeTabId: null,
                closedTabHistory: [],
                dirtyTabIds: [],
                sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
              }),
              activeTabId: activeId,
            },
          },
        },
      }));
      useWorkspaceStore.getState().setTabDirty("conn1", "db1", dirtyId, true);
    });

    render(<TabBar />);

    const dirtyTabEl = screen.getByText("users").closest("[role='tab']")!;
    const activeTabEl = screen.getByText("orders").closest("[role='tab']")!;

    // The dirty (inactive) tab carries the marker.
    expect(dirtyTabEl.querySelector('[data-dirty="true"]')).not.toBeNull();
    // The active (clean) tab does NOT carry the marker.
    expect(activeTabEl.querySelector('[data-dirty="true"]')).toBeNull();
    // Sanity — confirm aria-selected matches the active tab so the
    // assertion above isn't testing a layout/role coincidence.
    expect(activeTabEl).toHaveAttribute("aria-selected", "true");
    expect(dirtyTabEl).toHaveAttribute("aria-selected", "false");
  });

  it("does NOT render a dirty mark on the active tab when only an inactive sibling is dirty (AC-S134-06)", () => {
    addTableTab({
      title: "users",
      table: "users",
      connectionId: "conn1" as ConnectionId,
    });
    addTableTab({
      title: "orders",
      table: "orders",
      connectionId: "conn2",
    });
    addTableTab({
      title: "events",
      table: "events",
      connectionId: "conn3",
    });
    const tabs = getTestWorkspace().tabs;
    const activeId = tabs[2]!.id; // "events" — active + clean
    const dirtyId = tabs[0]!.id; // "users" — dirty + NOT active
    act(() => {
      useWorkspaceStore.setState((state) => ({
        workspaces: {
          ...state.workspaces,
          conn1: {
            ...state.workspaces.conn1,
            db1: {
              ...(state.workspaces.conn1?.db1 ?? {
                tabs: [],
                activeTabId: null,
                closedTabHistory: [],
                dirtyTabIds: [],
                sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
              }),
              activeTabId: activeId,
            },
          },
        },
      }));
      useWorkspaceStore.getState().setTabDirty("conn1", "db1", dirtyId, true);
    });

    render(<TabBar />);

    const activeTabEl = screen.getByText("events").closest("[role='tab']")!;
    const dirtyTabEl = screen.getByText("users").closest("[role='tab']")!;

    // The active tab is clean — no dot. (Regression guard against the
    // observed bug where activeTabId was used as the dirty selector.)
    expect(activeTabEl.querySelector('[data-dirty="true"]')).toBeNull();
    expect(activeTabEl).toHaveAttribute("aria-selected", "true");

    // The dirty (inactive) sibling DOES render the dot.
    expect(dirtyTabEl.querySelector('[data-dirty="true"]')).not.toBeNull();
  });

  // AC-02 — clean tab close button still removes the tab synchronously
  // (no ConfirmDialog), so the gate is strictly opt-in on dirty state.
  it("close button on a clean tab removes it without confirmation", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const closeBtn = screen.getByLabelText("Close Users");
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(getTestWorkspace().tabs).toHaveLength(0);
    // Dialog must NOT appear for a clean close.
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
  });

  // AC-02 — confirm branch: dirty close → ConfirmDialog → click "Discard
  // and close" → tab is actually removed.
  it("dirty close opens ConfirmDialog and removes tab on confirm (AC-02)", () => {
    addTableTab({ title: "Users", table: "users" });
    const tabId = getTestWorkspace().tabs[0]!.id;
    act(() => {
      useWorkspaceStore.getState().setTabDirty("conn1", "db1", tabId, true);
    });

    render(<TabBar />);
    expect(getTestWorkspace().tabs).toHaveLength(1);

    const closeBtn = screen.getByLabelText("Close Users");
    act(() => {
      fireEvent.click(closeBtn);
    });

    // Tab still present — gate held the close.
    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();

    // Confirm → close completes.
    const confirmBtn = screen.getByRole("button", {
      name: "Discard and close",
    });
    act(() => {
      fireEvent.click(confirmBtn);
    });

    expect(getTestWorkspace().tabs).toHaveLength(0);
    // dirtyTabIds is cleaned up by removeTab.
    expect(getTestWorkspace().dirtyTabIds.includes(tabId)).toBe(false);
  });

  // AC-02 — cancel branch: dirty close → ConfirmDialog → click "Cancel" →
  // tab stays open, dirty state preserved.
  it("dirty close cancel keeps the tab open (AC-02)", () => {
    addTableTab({ title: "Users", table: "users" });
    const tabId = getTestWorkspace().tabs[0]!.id;
    act(() => {
      useWorkspaceStore.getState().setTabDirty("conn1", "db1", tabId, true);
    });

    render(<TabBar />);
    const closeBtn = screen.getByLabelText("Close Users");
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    act(() => {
      fireEvent.click(cancelBtn);
    });

    // Tab survives, still dirty.
    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(getTestWorkspace().dirtyTabIds.includes(tabId)).toBe(true);
    // Dialog torn down.
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
  });

  // ── Sprint 123: paradigm visual cues ──

  it("renders a Mongo paradigm marker for document-paradigm tabs", () => {
    // Document tabs are partitioned by `database`; production callers
    // always pass it (see DocumentDatabaseTree). Mirror that here so
    // the tab lands in the active workspace key (conn1, db1).
    addTableTab({
      title: "users",
      table: "users",
      database: "db1",
      connectionId: "conn1" as ConnectionId,
      paradigm: "document",
    });

    render(<TabBar />);
    const marker = screen.getByLabelText("MongoDB collection tab");
    expect(marker).toBeInTheDocument();
  });

  it("does not render the Mongo marker for RDB tabs (snapshot parity)", () => {
    addTableTab({
      title: "users",
      table: "users",
      connectionId: "conn1" as ConnectionId,
      // paradigm omitted → legacy "rdb" path
    });

    render(<TabBar />);
    expect(screen.queryByLabelText("MongoDB collection tab")).toBeNull();
    expect(screen.queryByLabelText("MongoDB query tab")).toBeNull();
  });

  it("labels a Mongo query tab as a query (not a collection)", () => {
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            id: "q1" as TabId,
            type: "query",
            title: "find()",
            connectionId: "conn1" as ConnectionId,
            closable: true,
            sql: "{ }",
            queryState: { status: "idle" },
            paradigm: "document",
            queryMode: "find",
          },
        ],
        "q1",
      ),
    );

    render(<TabBar />);
    expect(screen.getByLabelText("MongoDB query tab")).toBeInTheDocument();
    // The collection-tab label must not surface for a query tab.
    expect(screen.queryByLabelText("MongoDB collection tab")).toBeNull();
  });

  // ── Sprint 136 (AC-S136-06): preview cue coexists with dirty marker ──
  //
  // The preview visual cue (`italic` + `opacity-70` on the title span)
  // and the dirty marker (`data-dirty="true"` dot to the right of the
  // title) must render together on the same tab without overlap or
  // mutual exclusion. These two tests pin both cues independently and
  // jointly so a future refactor cannot accidentally re-couple them.

  it("preview tab carries the preview visual cue (italic + opacity-70) without a dirty marker (AC-S136-06)", () => {
    addTableTab({ title: "public.users", table: "users" });
    // New tab is preview by default; not dirty.

    render(<TabBar />);
    const titleEl = screen.getByText("users");
    // Preview cue — italic + faded.
    expect(titleEl.className).toContain("italic");
    expect(titleEl.className).toContain("opacity-70");
    // No dirty marker on a clean preview tab.
    const tab = titleEl.closest("[role='tab']")!;
    expect(tab.querySelector('[data-dirty="true"]')).toBeNull();
  });

  it("preview cue and dirty marker coexist on the same tab (AC-S136-06)", () => {
    addTableTab({ title: "public.users", table: "users" });
    const tabId = getTestWorkspace().tabs[0]!.id;
    // Mark dirty while leaving the preview flag untouched.
    act(() => {
      useWorkspaceStore.getState().setTabDirty("conn1", "db1", tabId, true);
    });

    render(<TabBar />);
    const titleEl = screen.getByText("users");
    // Preview cue still applied to the title span.
    expect(titleEl.className).toContain("italic");
    expect(titleEl.className).toContain("opacity-70");
    // Dirty dot still rendered alongside the title.
    const tab = titleEl.closest("[role='tab']")!;
    const dot = tab.querySelector('[data-dirty="true"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-label", "Unsaved changes");
  });

  // ── Sprint 142 (AC-147-1, AC-147-3): data-preview attribute on the
  //    tab element so e2e + integration tests + future styling can hook
  //    onto preview-vs-permanent state at the DOM level (italic class
  //    alone is a styling concern; data-preview is the contractual
  //    signal). ──

  it('preview table tab exposes data-preview="true" on the tab element (AC-147-1)', () => {
    addTableTab({ title: "public.users", table: "users" });
    // addTab seeds isPreview: true, so the freshly created tab must
    // surface the contract attribute.

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    expect(tab).toHaveAttribute("data-preview", "true");
  });

  it("permanent table tab does NOT carry data-preview (AC-147-3)", () => {
    addTableTab({ title: "public.users", table: "users" });
    const tabId = getTestWorkspace().tabs[0]!.id;
    act(() => {
      useWorkspaceStore.getState().promoteTab("conn1", "db1", tabId);
    });

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    expect(tab).not.toHaveAttribute("data-preview");
  });

  it("query tab never carries data-preview (only table tabs are previewable)", () => {
    useWorkspaceStore.getState().addQueryTab("conn1", "db1");

    render(<TabBar />);
    const queryTab = getTestWorkspace().tabs.find((t) => t.type === "query")!;
    const tab = screen.getByText(queryTab.title).closest("[role='tab']")!;
    expect(tab).not.toHaveAttribute("data-preview");
  });

  // Middle-click on a dirty tab also routes through the gate so the user
  // can never lose unsaved work via a stray scroll-wheel button press.
  // Reason: Phase 13 AC-13-07 — preview tab의 접근성 속성 검증.
  //         role="tab", aria-selected, data-preview="true", italic+opacity-70
  //         클래스가 모두 올바르게 적용되는지 확인 (2026-04-28)
  it("preview tab has correct aria attributes for accessibility (AC-13-07)", () => {
    addTableTab({ title: "public.users", table: "users" });
    // New tabs are preview by default.

    render(<TabBar />);

    const tab = screen.getByText("users").closest("[role='tab']")!;
    // role="tab" is present (verified by the query selector itself).
    expect(tab).toHaveAttribute("role", "tab");
    // aria-selected is present — the tab is active because it's the only tab.
    expect(tab).toHaveAttribute("aria-selected", "true");
    // data-preview signals the preview state for e2e tests and styling hooks.
    expect(tab).toHaveAttribute("data-preview", "true");
    // The title span carries the preview visual cue (italic + opacity-70).
    const titleEl = screen.getByText("users");
    expect(titleEl.className).toContain("italic");
    expect(titleEl.className).toContain("opacity-70");
  });

  // Reason: Phase 13 AC-13-07 — permanent tab과 preview tab의 aria 속성 차이 검증.
  //         permanent tab은 data-preview가 없어야 하고, italic 스타일도 없어야 함 (2026-04-28)
  it("permanent tab does not have preview-specific attributes (AC-13-07)", () => {
    addTableTab({ title: "public.users", table: "users" });
    // Promote to permanent.
    const tabId = getTestWorkspace().tabs[0]!.id;
    act(() => {
      useWorkspaceStore.getState().promoteTab("conn1", "db1", tabId);
    });

    render(<TabBar />);

    const tab = screen.getByText("users").closest("[role='tab']")!;
    // role="tab" and aria-selected still present — core tab semantics unchanged.
    expect(tab).toHaveAttribute("role", "tab");
    expect(tab).toHaveAttribute("aria-selected", "true");
    // data-preview is absent on permanent tabs (or not "true").
    expect(tab).not.toHaveAttribute("data-preview", "true");
    expect(tab).not.toHaveAttribute("data-preview");
    // Title is NOT italic (no preview visual cue).
    const titleEl = screen.getByText("users");
    expect(titleEl.className).not.toContain("italic");
    expect(titleEl.className).not.toContain("opacity-70");
  });

  it("middle-click on dirty tab triggers the confirm gate", () => {
    addTableTab({ title: "Users", table: "users" });
    const tabId = getTestWorkspace().tabs[0]!.id;
    act(() => {
      useWorkspaceStore.getState().setTabDirty("conn1", "db1", tabId, true);
    });

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    fireAuxClick(tab, 1);

    expect(getTestWorkspace().tabs).toHaveLength(1);
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
  });

  // ── Sprint 253 (AC-253-04, AC-253-05): Tab DnD empty-area release ──
  //
  // 13-question grill Q13 결과: drag 후 strip 의 "탭이 없는 빈 영역"
  // (마지막 탭 우측 또는 두 탭 사이 시각적 gap) 에서 mouse release 시,
  // pre-2026-05-11 은 strip-level onMouseUp 이 처리. 2026-05-11 pointer
  // event 마이그레이션 후엔 `setPointerCapture` 가 pointerup 을 capturing
  // 탭으로 라우팅하므로 동일 로직이 per-tab onPointerUp 안에서 cursor X
  // 기반으로 결정한다 (strip-level handler 는 제거됨).
  //
  // jsdom 의 getBoundingClientRect 는 기본값이 0 이라 명시 mock 필수.
  // 작성 일자: 2026-05-09 (/tdd 흐름 — 본 case 들이 먼저 fail → 구현 → green).
  // 갱신 일자: 2026-05-11 (mouse → pointer 마이그레이션).

  it("drag release on empty area past the last tab moves source to the end (AC-253-04)", () => {
    setThreeTabs();
    render(<TabBar />);

    // Layout: t1 [0..100], t2 [100..200], t3 [200..300]. Cursor at 350 — past t3.right.
    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    const tabs = screen.getAllByRole("tab");
    const before = getTestWorkspace().tabs.map((t) => t.id);

    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      // Move > 8px to flip isDragging.
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 200 });
      // Release past t3's right edge. With pointer capture, pointerup
      // lands back on the originating tab regardless of cursor location.
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 350 });
    });

    const after = getTestWorkspace().tabs.map((t) => t.id);
    // t1 → end of strip → [t2, t3, t1].
    expect(after).toEqual([before[1], before[2], before[0]]);
  });

  it("drag release in a gap between two tabs inserts before the closer one (AC-253-04)", () => {
    setThreeTabs();
    render(<TabBar />);

    // Layout: t1 [0..100], t2 [100..200], t3 [200..300]. Cursor at 210 →
    // past t2 midpoint (150) but in t3's left half. Expected: insert
    // before t3.
    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    const tabs = screen.getAllByRole("tab");
    const before = getTestWorkspace().tabs.map((t) => t.id);

    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 150 });
      // Release at X=210 — t3's left half.
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 210 });
    });

    const after = getTestWorkspace().tabs.map((t) => t.id);
    // t1 inserted before t3 → [t2, t1, t3].
    expect(after).toEqual([before[1], before[0], before[2]]);
  });

  it("pointerup without a prior pointerdown is a no-op (AC-253-04)", () => {
    setThreeTabs();
    render(<TabBar />);

    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    const tabs = screen.getAllByRole("tab");
    const before = getTestWorkspace().tabs.map((t) => t.id);

    // No pointerDown → dragStateRef stays null.
    act(() => {
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 350 });
    });

    expect(getTestWorkspace().tabs.map((t) => t.id)).toEqual(before);
  });

  it("releasing on a tab's right half moves source after it (AC-253-05)", () => {
    setThreeTabs();
    render(<TabBar />);

    mockTabRects([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
      { left: 200, right: 300, width: 100 },
    ]);

    const tabs = screen.getAllByRole("tab");
    const before = getTestWorkspace().tabs.map((t) => t.id);

    act(() => {
      fireEvent.pointerDown(tabs[0]!, {
        button: 0,
        pointerId: 1,
        clientX: 50,
      });
      fireEvent.pointerMove(tabs[0]!, { pointerId: 1, clientX: 250 });
      // Release at X=270 — t3's right half → insert after t3.
      fireEvent.pointerUp(tabs[0]!, { pointerId: 1, clientX: 270 });
    });

    const after = getTestWorkspace().tabs.map((t) => t.id);
    // Single moveTab → t1 after t3 → [t2, t3, t1].
    expect(after).toEqual([before[1], before[2], before[0]]);
  });
});
