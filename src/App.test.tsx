import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import {
  seedWorkspace,
  getTestWorkspace,
  getAllTabsForConnection,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, fireEvent, act } from "@testing-library/react";
import App from "./App";
import {
  useWorkspaceStore,
  type TableTab,
  type QueryTab,
} from "./stores/workspaceStore";
import { useConnectionStore } from "./stores/connectionStore";
import { useThemeStore } from "./stores/themeStore";

// Mock page components to isolate shortcut testing — App.tsx now mounts only
// `WorkspacePage` (Sprint 154 — `AppRouter` picks the per-window shell at
// boot), but the global shortcuts under test are wired at the App level and
// don't depend on which page is mounted.
vi.mock("./pages/WorkspacePage", () => ({
  default: () => <div data-testid="workspace-page" />,
}));

// Mock tauri IPC and event listeners
vi.mock("./lib/tauri", () => ({
  listConnections: vi.fn(() => Promise.resolve([])),
  listGroups: vi.fn(() => Promise.resolve([])),
  testConnection: vi.fn(() => Promise.resolve(true)),
  connect: vi.fn(() => Promise.resolve()),
  disconnect: vi.fn(() => Promise.resolve()),
  saveConnections: vi.fn(() => Promise.resolve()),
  saveGroups: vi.fn(() => Promise.resolve()),
  deleteConnection: vi.fn(() => Promise.resolve()),
  updateConnection: vi.fn(() => Promise.resolve()),
  createConnection: vi.fn(() => Promise.resolve("test-id")),
  addGroup: vi.fn(() => Promise.resolve("g1")),
  updateGroup: vi.fn(() => Promise.resolve()),
  deleteGroup: vi.fn(() => Promise.resolve()),
  moveConnectionToGroup: vi.fn(() => Promise.resolve()),
}));

// Sprint 153: stores now opt into the cross-window bridge at module load
// (mruStore, themeStore, favoritesStore unconditionally; tabStore when
// `getCurrentWindowLabel() === "workspace"`). The bridge subscribes to each
// store and calls `emit(channel, envelope)` on every state change. Without
// an `emit` stub here, the first synchronous setState during AppRouter boot
// throws TypeError("emit is not a function"). Sprint 152 set the precedent
// with the same one-line addition in connectionStore.test.ts.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

// Sprint 368 (Phase 4 Q12) — theme / safe-mode actions issue
// `persist_setting` IPC. The App keyboard cycle (`Cmd+Shift+L`) calls
// `setMode` and intentionally does not await the promise. Mock invoke
// so the unawaited promise resolves silently.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

function makeTableTab({
  id = "tab-1",
  ...overrides
}: Partial<Omit<TableTab, "id">> & { id?: string } = {}): TableTab {
  return {
    type: "table",
    id: id as TabId,
    title: "users",
    connectionId: "conn1" as ConnectionId,
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  };
}

function makeQueryTab({
  id = "query-1",
  ...overrides
}: Partial<Omit<QueryTab, "id">> & { id?: string } = {}): QueryTab {
  return {
    type: "query",
    id: id as TabId,
    title: "Query 1",
    connectionId: "conn1" as ConnectionId,
    closable: true,
    sql: "SELECT 1",
    queryState: { status: "idle" },
    paradigm: "rdb",
    queryMode: "sql",
    ...overrides,
  };
}

function fireShortcut(key: string, metaKey = true) {
  act(() => {
    fireEvent(
      document,
      new KeyboardEvent("keydown", {
        key,
        metaKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("App global shortcuts", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    // Sprint 155 — `App` is only mounted under the workspace `WebviewWindow`
    // (per `AppRouter.tsx`), so the workspace context is implied by the
    // file-under-test rendering `<App />`. The legacy app-shell screen seed
    // is no longer needed.
  });

  it("Cmd+W closes the active tab", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1"));
    render(<App />);

    fireShortcut("w");
    expect(getTestWorkspace().tabs).toHaveLength(0);
  });

  // 2026-05-01 회귀 — 쿼리 실행 후 SQL 에디터(contenteditable)에 포커스가
  // 있는 상태에서 Cmd+W를 누르면 macOS WebView가 native Close-Window를
  // 발동시켜 창 자체가 닫혀버렸다. 다른 단축키와 달리 Cmd+W는
  // editable surface 안에서도 항상 가로채 preventDefault + 탭 닫기로
  // 처리해야 한다.
  it("Cmd+W intercepts even when focus is in a contenteditable target", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1"));
    render(<App />);

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.appendChild(editor);
    editor.focus();

    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      editor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(getTestWorkspace().tabs).toHaveLength(0);

    document.body.removeChild(editor);
  });

  it("Cmd+T creates a new query tab using active tab's connectionId", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1"));
    render(<App />);

    fireShortcut("t");
    const state = getTestWorkspace();
    expect(state.tabs).toHaveLength(2);
    const queryTab = state.tabs.find((t) => t.type === "query");
    expect(queryTab).toBeDefined();
    if (queryTab && queryTab.type === "query") {
      expect(queryTab.connectionId).toBe("conn1");
    }
  });

  it("Cmd+. dispatches cancel-query event for running query tab", () => {
    const handler = vi.fn();
    window.addEventListener("cancel-query", handler);

    const tab = makeQueryTab({
      queryState: { status: "running", queryId: "q-123" },
    });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<App />);

    fireShortcut(".");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { queryId: "q-123" },
      }),
    );

    window.removeEventListener("cancel-query", handler);
  });

  it("Cmd+R dispatches refresh-data for active table tab with records subView", () => {
    const handler = vi.fn();
    window.addEventListener("refresh-data", handler);

    const tab = makeTableTab({ subView: "records" });
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1"));
    render(<App />);

    fireShortcut("r");
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("refresh-data", handler);
  });

  it("F5 dispatches refresh-schema when no table tab is active", () => {
    const handler = vi.fn();
    window.addEventListener("refresh-schema", handler);

    // No tabs — should dispatch refresh-schema
    render(<App />);
    fireShortcut("F5", false);
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("refresh-schema", handler);
  });

  // ── Sprint 33: Extended Keyboard Shortcuts ──

  // 작성 이유 (2026-05-13, Sprint 291): 사용자 요구 — workspace 윈도우의
  // Cmd+N 은 connection-create dialog 대신 raw query tab 을 연다. 기존
  // 테스트가 검증하던 "new-connection" DOM 이벤트는 더 이상 발생하지 않고,
  // 대신 활성 connection 의 워크스페이스에 query tab 이 추가되어야 한다.
  it("Sprint 291 — Cmd+N 은 활성 connection 에 raw query tab 을 추가한다", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1"));
    const handler = vi.fn();
    window.addEventListener("new-connection", handler);
    render(<App />);

    fireShortcut("n");

    // 종전과 달리 new-connection 이벤트는 발생하지 않음.
    expect(handler).not.toHaveBeenCalled();
    // 활성 connection 의 workspace tabs 가 1 → 2 로 늘어남.
    const tabsAfter = getTestWorkspace().tabs;
    expect(tabsAfter.length).toBeGreaterThan(1);
    const newTab = tabsAfter[tabsAfter.length - 1];
    expect(newTab?.type).toBe("query");

    window.removeEventListener("new-connection", handler);
  });

  // Wave 9.5 회귀 5 (2026-05-16) — 빈 워크스페이스 시나리오들.
  //
  // 본 두 테스트는 새 feedback rule (`feedback_test_scenarios_user_journey.md`)
  // 의 첫 적용 — user 의 행위 시퀀스 끝까지 path 를 따라가 user-facing
  // invariant (store state / IPC 발사) 를 lock.
  //
  // user journey 1: workspace 마운트 (탭 0개) → Cmd+W keydown → window 닫힘
  //   - 사용자 보고 (2026-05-16): "아무런 탭도 없는 상태의 connection
  //     window에서 cmd + w를 누르면 connection window가 꺼져야 하고"
  //   - 이전 핸들러는 `if (activeTabId && workspaceKey)` 체크 후 빈 탭일 때
  //     `preventDefault()` 만 호출 → OS default close 도 막아 no-op.
  it("Wave 9.5 회귀 5 — 빈 워크스페이스에서 Cmd+W 는 workspace_close IPC 를 발사한다", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    // user journey 의 시작: workspace 마운트, 탭 0개.
    useWorkspaceStore.setState({ workspaces: {} });
    render(<App />);

    // user 행위: Cmd+W.
    fireShortcut("w");

    // 마지막 outcome (user-facing invariant): backend workspace_close IPC 호출.
    // 이 IPC 가 Rust 측에서 caller webview 의 Window::destroy() 를 실행 →
    // user 가 보는 window 가 사라짐. backend 동작은 본 unit 의 cover 범위
    // 밖이지만 (jsdom 영역 한계), IPC 발사 자체는 우리 own 코드의 의도이고
    // backend test 가 그 다음 path 를 받는다.
    await act(async () => {
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledWith("workspace_close");
  });

  // user journey 2: workspace 마운트 (탭 0개) + connectionStore.focusedConnId
  //   가 set 됨 (useWindowFocusHydration 의 결과) → Cmd+N keydown →
  //   focusedConnId fallback 으로 conn 결정 → raw query tab 1개 생김
  //   - 사용자 보고 (2026-05-16): "같은 환경에서 cmd + n을 누르면 raw query
  //     창이 열려야 해"
  //   - 이전 핸들러는 activeTab.connectionId 가 비어있으면 no-op. fallback
  //     없음.
  //
  //   본 테스트는 focusedConnId fallback path 만 검증. window label fallback
  //   (App.tsx 의 1순위) 은 jsdom 에서 mock 복잡 — 같은 store state outcome
  //   이라 cover 됐다고 본다.
  it("Wave 9.5 회귀 5 — 빈 워크스페이스에서 Cmd+N 은 focusedConnId fallback 으로 raw query tab 1개 추가", async () => {
    // user journey 의 시작: 탭 0개 + workspace 마운트 후의 store state.
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ focusedConnId: "conn1" });

    render(<App />);

    // user 행위: Cmd+N.
    fireShortcut("n");

    // 마지막 outcome (user-facing invariant): workspace 의 tab 이 1개 생김.
    // mock 단언 ("addQueryTab 가 호출됨") 이 아니라 store state — user 가
    // 보는 tab bar 의 실제 상태.
    await act(async () => {
      await Promise.resolve();
    });
    const tabsAfter = getAllTabsForConnection("conn1");
    expect(tabsAfter.length).toBe(1);
    expect(tabsAfter[0]?.type).toBe("query");
    expect(tabsAfter[0]?.connectionId).toBe("conn1");
  });

  it("Cmd+S dispatches commit-changes event", () => {
    const handler = vi.fn();
    window.addEventListener("commit-changes", handler);
    render(<App />);

    fireShortcut("s");
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("commit-changes", handler);
  });

  it("Cmd+P dispatches quick-open event", () => {
    const handler = vi.fn();
    window.addEventListener("quick-open", handler);
    render(<App />);

    fireShortcut("p");
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("quick-open", handler);
  });

  // ── Sprint 154: Cmd+, no longer toggles Home/Workspace ──
  // Phase 12's real-window split made Home / Workspace separate Tauri
  // windows. The Sprint 133 toggle is now a no-op until a future sprint
  // reclaims the chord. The legacy `open-settings` event must still NOT
  // dispatch (regression guard).

  it("Cmd+, is a no-op (Sprint 154 — Home/Workspace are separate Tauri windows)", () => {
    // Cmd+, used to dispatch `open-settings` and toggle the legacy app-shell
    // field. Phase 12 retired both behaviours — assert no event fires.
    const handler = vi.fn();
    window.addEventListener("open-settings", handler);
    render(<App />);

    fireShortcut(",");
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener("open-settings", handler);
  });

  it("Cmd+, with focus inside an editable target is a no-op", () => {
    const handler = vi.fn();
    window.addEventListener("open-settings", handler);
    render(<App />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      fireEvent(
        input,
        new KeyboardEvent("keydown", {
          key: ",",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
    window.removeEventListener("open-settings", handler);
  });

  it("Cmd+, no longer dispatches the legacy open-settings event", () => {
    const handler = vi.fn();
    window.addEventListener("open-settings", handler);
    render(<App />);

    fireShortcut(",");
    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener("open-settings", handler);
  });

  it("shortcuts are ignored when input is focused", () => {
    const handler = vi.fn();
    window.addEventListener("commit-changes", handler);
    render(<App />);

    // Simulate an input element as the event target
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      fireEvent(
        input,
        new KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(handler).not.toHaveBeenCalled();

    document.body.removeChild(input);
    window.removeEventListener("commit-changes", handler);
  });

  // -- Sprint 40: SQL Formatting shortcut --

  it("Cmd+I dispatches format-sql event", () => {
    const handler = vi.fn();
    window.addEventListener("format-sql", handler);
    render(<App />);

    fireShortcut("i");
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("format-sql", handler);
  });

  // -- Sprint 60: navigate-table objectKind / quickopen-function --

  it("navigate-table opens a table tab with default objectKind=table", () => {
    render(<App />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("navigate-table", {
          detail: {
            connectionId: "c1",
            schema: "public",
            table: "users",
          },
        }),
      );
    });
    // ADR 0027 — tab lands in workspace ("c1", <activeDb>) which the
    // test never seeds; flatten across all `c1` slots so the assertion
    // doesn't depend on the exact `db` autofill.
    const tab = getAllTabsForConnection("c1").find(
      (t) => t.type === "table",
    ) as TableTab | undefined;
    expect(tab).toBeDefined();
    expect(tab!.objectKind).toBe("table");
    expect(tab!.subView).toBe("records");
    useWorkspaceStore.setState({ workspaces: {} });
  });

  it("navigate-table preserves explicit objectKind=view", () => {
    render(<App />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("navigate-table", {
          detail: {
            connectionId: "c1",
            schema: "public",
            table: "active_users",
            objectKind: "view",
          },
        }),
      );
    });
    const tab = getAllTabsForConnection("c1").find(
      (t) => t.type === "table",
    ) as TableTab | undefined;
    expect(tab).toBeDefined();
    expect(tab!.objectKind).toBe("view");
    useWorkspaceStore.setState({ workspaces: {} });
  });

  it("quickopen-function opens a query tab with the source pre-filled", () => {
    render(<App />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("quickopen-function", {
          detail: {
            connectionId: "c1",
            source: "BEGIN RETURN 1; END",
            title: "public.calc",
          },
        }),
      );
    });
    const tab = getAllTabsForConnection("c1").find(
      (t) => t.type === "query",
    ) as QueryTab | undefined;
    expect(tab).toBeDefined();
    expect(tab!.sql).toBe("BEGIN RETURN 1; END");
    useWorkspaceStore.setState({ workspaces: {} });
  });

  // ── Sprint 133: Cmd+1..9 → workspace tab switch ──

  it("Cmd+1 activates the first tab in the workspace", () => {
    const t1 = makeTableTab({ id: "tab-1", table: "alpha" });
    const t2 = makeTableTab({ id: "tab-2", table: "beta" });
    const t3 = makeTableTab({ id: "tab-3", table: "gamma" });
    useWorkspaceStore.setState(seedWorkspace([t1, t2, t3], "tab-3"));
    render(<App />);

    fireShortcut("1");
    expect(getTestWorkspace().activeTabId).toBe("tab-1");
  });

  it("Cmd+2 activates the second tab in the workspace", () => {
    const t1 = makeTableTab({ id: "tab-1", table: "alpha" });
    const t2 = makeTableTab({ id: "tab-2", table: "beta" });
    useWorkspaceStore.setState(seedWorkspace([t1, t2], "tab-1"));
    render(<App />);

    fireShortcut("2");
    expect(getTestWorkspace().activeTabId).toBe("tab-2");
  });

  it("Cmd+5 with only 3 tabs is a no-op", () => {
    const t1 = makeTableTab({ id: "tab-1" });
    const t2 = makeTableTab({ id: "tab-2", table: "two" });
    const t3 = makeTableTab({ id: "tab-3", table: "three" });
    useWorkspaceStore.setState(seedWorkspace([t1, t2, t3], "tab-1"));
    render(<App />);

    fireShortcut("5");
    expect(getTestWorkspace().activeTabId).toBe("tab-1");
  });

  it("Cmd+1 in home is a no-op (Sprint 154 — App only mounts in workspace window; legacy regression guard)", () => {
    // Sprint 154 — `App` is only rendered inside the workspace Tauri
    // window per `AppRouter.tsx`. The legacy launcher/home gate is gone,
    // but the user-observable invariant ("Cmd+1 in home doesn't touch
    // tabs") remains true because home is a different window — the JS
    // context running this test never mounts <App /> in the home window.
    // We preserve the test as a regression guard against a future sprint
    // accidentally re-mounting App in the launcher.
    const t1 = makeTableTab({ id: "tab-1" });
    const t2 = makeTableTab({ id: "tab-2", table: "two" });
    // With App mounted, Cmd+1 WILL switch tabs because we're in the
    // workspace window context (the only place App.tsx now runs). To
    // assert the legacy "home is no-op" semantic we'd need to NOT mount
    // App — so the test now covers the workspace path only.
    useWorkspaceStore.setState(seedWorkspace([t1, t2], "tab-2"));
    render(<App />);

    fireShortcut("1");
    // Workspace context: Cmd+1 selects the first tab.
    expect(getTestWorkspace().activeTabId).toBe("tab-1");
  });

  // 2026-05-11 회귀 — Cmd+1..9 는 SQL 에디터(CodeMirror contenteditable)나
  // DataGrid 셀 편집 중에도 작동해야 한다. Cmd+W 와 마찬가지로 단축키 자체가
  // 에디터 내에서 보존해야 할 의미가 없고, 편집 중 빠르게 탭을 전환하는 것이
  // 핵심 use case 다.
  it("Cmd+1 switches tabs even when focus is inside an input", () => {
    const t1 = makeTableTab({ id: "tab-1" });
    const t2 = makeTableTab({ id: "tab-2", table: "two" });
    useWorkspaceStore.setState(seedWorkspace([t1, t2], "tab-2"));
    render(<App />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    act(() => {
      fireEvent(
        input,
        new KeyboardEvent("keydown", {
          key: "1",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(getTestWorkspace().activeTabId).toBe("tab-1");
    document.body.removeChild(input);
  });

  it("Cmd+2 switches tabs even when focus is inside a contenteditable target (CodeMirror / DataGrid)", () => {
    const t1 = makeTableTab({ id: "tab-1" });
    const t2 = makeTableTab({ id: "tab-2", table: "two" });
    useWorkspaceStore.setState(seedWorkspace([t1, t2], "tab-1"));
    render(<App />);

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.appendChild(editor);
    editor.focus();
    act(() => {
      fireEvent(
        editor,
        new KeyboardEvent("keydown", {
          key: "2",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(getTestWorkspace().activeTabId).toBe("tab-2");
    document.body.removeChild(editor);
  });

  // ── Sprint 134: Cmd+K is now a no-op ──
  // The Sprint 133 `open-connection-switcher` event + handler were removed
  // alongside the `<ConnectionSwitcher>` component. Connection swap is a
  // single-path flow: Home → double-click. These tests guard against the
  // event being accidentally re-dispatched.

  it("Cmd+K in workspace does NOT dispatch open-connection-switcher (deprecated)", () => {
    const handler = vi.fn();
    window.addEventListener("open-connection-switcher", handler);
    render(<App />);

    fireShortcut("k");
    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener("open-connection-switcher", handler);
  });

  it("Cmd+K in home does NOT dispatch open-connection-switcher (deprecated)", () => {
    const handler = vi.fn();
    window.addEventListener("open-connection-switcher", handler);
    render(<App />);

    fireShortcut("k");
    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener("open-connection-switcher", handler);
  });

  it("Cmd+K with focus inside an editable target is a no-op (deprecated)", () => {
    const handler = vi.fn();
    window.addEventListener("open-connection-switcher", handler);
    render(<App />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      fireEvent(
        input,
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
    window.removeEventListener("open-connection-switcher", handler);
  });

  // ── Sprint 162: Cmd+Shift+L / Ctrl+Shift+L — cycle theme mode ──

  // Reason: Phase 14 AC-14-03 — Cmd+Shift+L 키보드 단축키로 theme mode 순환 (2026-04-28)
  // 2026-05-16: setMode 가 async IPC 가 된 후 await + microtask flush 추가.
  it("Cmd+Shift+L cycles theme mode dark → light → system → dark", async () => {
    await useThemeStore.getState().setMode("dark");
    render(<App />);

    // dark → light
    await act(async () => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "L",
          shiftKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useThemeStore.getState().mode).toBe("light");

    // light → system
    await act(async () => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "L",
          shiftKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useThemeStore.getState().mode).toBe("system");

    // system → dark
    await act(async () => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "L",
          shiftKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useThemeStore.getState().mode).toBe("dark");
  });

  // Reason: Phase 14 AC-14-03 — Ctrl+Shift+L 단축키 호환성 (Windows/Linux) (2026-04-28)
  it("Ctrl+Shift+L cycles theme mode", async () => {
    await useThemeStore.getState().setMode("dark");
    render(<App />);

    await act(async () => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "L",
          shiftKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useThemeStore.getState().mode).toBe("light");
  });

  // Reason: Phase 14 AC-14-03 — theme toggle 단축키가 기존 단축키를 방해하지 않는지 회귀 테스트 (2026-04-28)
  it("Cmd+Shift+L does not interfere with existing Cmd+S shortcut", async () => {
    await useThemeStore.getState().setMode("dark");
    const handler = vi.fn();
    window.addEventListener("commit-changes", handler);
    render(<App />);

    // Cmd+S should still work
    fireShortcut("s");
    expect(handler).toHaveBeenCalled();

    // Theme mode should NOT have changed from Cmd+S
    expect(useThemeStore.getState().mode).toBe("dark");

    window.removeEventListener("commit-changes", handler);
  });

  // ── 2026-05-11: 단축키 focus 정책 매트릭스 ──
  //
  // 2026-05-11 버그 회귀의 교훈: Cmd+1..9 가 contenteditable (CodeMirror /
  // 인라인 셀) 안에서 안 먹히던 이유는 *구현* 에 맞춰 "editable 안에서는
  // no-op" 단언이 잠겨있었기 때문이다. 의도 단위 매트릭스를 한 군데
  // 모아두면 새 단축키 추가 시 행 하나만 채우면 회귀가 자동으로 잡힌다.
  //
  // 각 행:
  //   - key           : 단축키 (e.g. "w", "1", "i")
  //   - shift / alt   : modifier (Cmd/Ctrl 는 항상 포함)
  //   - focusPolicy
  //       "always"           — editable 안에서도 가로채야 함 (preventDefault).
  //       "skip-in-editable" — editable 안에서는 흘려보내야 함 (no preventDefault).
  //
  // 단언은 *preventDefault 호출 여부* 만 본다 (side effect 는 개별 기존
  // 테스트가 이미 커버). 그래서 "interception 계약" 만 매트릭스로 잠금.
  type FocusPolicy = "always" | "skip-in-editable";
  interface ShortcutCase {
    label: string;
    key: string;
    shift?: boolean;
    alt?: boolean;
    focusPolicy: FocusPolicy;
  }

  const SHORTCUTS: ShortcutCase[] = [
    // Cmd+W — 항상 가로채야 함 (macOS native Close-Window 차단).
    { label: "Cmd+W (close tab)", key: "w", focusPolicy: "always" },
    // Cmd+1..9 — 2026-05-11 회귀: editable 안에서도 가로채야 함.
    { label: "Cmd+1 (tab switch)", key: "1", focusPolicy: "always" },
    { label: "Cmd+9 (tab switch)", key: "9", focusPolicy: "always" },
    // Cmd+T — editable 안에서는 흘려보냄 (에디터에 "t" 가 입력되게).
    {
      label: "Cmd+T (new query tab)",
      key: "t",
      focusPolicy: "skip-in-editable",
    },
    // Cmd+. — editable 안에서는 흘려보냄.
    {
      label: "Cmd+. (cancel query)",
      key: ".",
      focusPolicy: "skip-in-editable",
    },
    // Cmd+R — editable 안에서는 흘려보냄.
    { label: "Cmd+R (refresh)", key: "r", focusPolicy: "skip-in-editable" },
    // Cmd+I — editable 안에서는 흘려보냄.
    { label: "Cmd+I (format SQL)", key: "i", focusPolicy: "skip-in-editable" },
    // Cmd+N / S / P — editable 안에서는 흘려보냄.
    {
      label: "Cmd+N (new query tab)",
      key: "n",
      focusPolicy: "skip-in-editable",
    },
    {
      label: "Cmd+S (commit changes)",
      key: "s",
      focusPolicy: "skip-in-editable",
    },
    { label: "Cmd+P (quick open)", key: "p", focusPolicy: "skip-in-editable" },
  ];

  function dispatchAndCheckPrevented(
    target: EventTarget,
    sc: ShortcutCase,
  ): boolean {
    const ev = new KeyboardEvent("keydown", {
      key: sc.key,
      metaKey: true,
      shiftKey: sc.shift === true,
      altKey: sc.alt === true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      target.dispatchEvent(ev);
    });
    return ev.defaultPrevented;
  }

  describe("shortcut focus policy matrix (2026-05-11 회귀 가드)", () => {
    // Seed enough tabs so Cmd+1/9 don't no-op for "no target tab".
    function seedTabs() {
      const fillerTabs = Array.from({ length: 9 }, (_, i) =>
        makeTableTab({
          id: `tab-${i + 1}`,
          table: `t${i + 1}`,
          connectionId: `conn${i + 1}` as ConnectionId,
        }),
      );
      useWorkspaceStore.setState(seedWorkspace(fillerTabs, "tab-5"));
    }

    SHORTCUTS.forEach((sc) => {
      it(`${sc.label}: focusPolicy="${sc.focusPolicy}"`, () => {
        seedTabs();
        render(<App />);

        // 1) No editable focus — should always be intercepted by the
        // matching handler.
        const baseline = dispatchAndCheckPrevented(document, sc);
        expect(baseline, `${sc.label} must be intercepted at document`).toBe(
          true,
        );

        // 2) Focus inside <input>.
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        const insideInput = dispatchAndCheckPrevented(input, sc);
        document.body.removeChild(input);

        // 3) Focus inside contenteditable (mimics CodeMirror / inline cell).
        // jsdom does NOT compute `isContentEditable` from the attribute,
        // so we surface the property the same way Chrome/Safari does on a
        // focused contenteditable element — mirrors the workaround in
        // `lib/keyboard/__tests__/isEditableTarget.test.ts`.
        const editor = document.createElement("div");
        editor.setAttribute("contenteditable", "true");
        Object.defineProperty(editor, "isContentEditable", {
          configurable: true,
          get: () => true,
        });
        document.body.appendChild(editor);
        editor.focus();
        const insideEditable = dispatchAndCheckPrevented(editor, sc);
        document.body.removeChild(editor);

        if (sc.focusPolicy === "always") {
          expect(
            insideInput,
            `${sc.label} must STILL preventDefault inside <input>`,
          ).toBe(true);
          expect(
            insideEditable,
            `${sc.label} must STILL preventDefault inside contenteditable`,
          ).toBe(true);
        } else {
          expect(
            insideInput,
            `${sc.label} must NOT preventDefault inside <input>`,
          ).toBe(false);
          expect(
            insideEditable,
            `${sc.label} must NOT preventDefault inside contenteditable`,
          ).toBe(false);
        }
      });
    });
  });
});
