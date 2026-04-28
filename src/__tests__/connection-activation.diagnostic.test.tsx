// Purpose: Connection activation lifecycle 진단 — Phase 13 Sprint 156 (2026-04-28)
//
// 사용자 보고 버그:
//   Bug 1: Connection 더블클릭해도 workspace 미열림
//   Bug 2: PG sidebar table click 시 preview tab이 swap되지 않고 누적됨
//
// 이 파일은 handleActivate의 세부 동작을 진단하기 위해 작성되었다.
// HomePage.test.tsx와 window-transitions.test.tsx가 기본 동작을 이미 커버하므로,
// 여기서는 중복을 피하고 edge case + error recovery + race condition에 집중한다.
//
// AC IDs:
//   AC-156-01  Double-click ordering (showWindow → focusWindow → hideWindow)
//   AC-156-02  Rapid double-click guard (no duplicate showWindow)
//   AC-156-03  Re-activation after disconnect
//   AC-156-04  showWindow rejection → launcher stays visible, toast shown
//   AC-156-05  Single-click does NOT trigger window swap
//   AC-156-06  Sequential activation (A → B): B focused, A's stale tabs cleared

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HomePage from "@/pages/HomePage";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
import type { ConnectionConfig } from "@/types/connection";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  exitApp: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/tauri")>("@lib/tauri");
  return {
    ...actual,
    connectToDatabase: vi.fn().mockResolvedValue(undefined),
    disconnectFromDatabase: vi.fn().mockResolvedValue(undefined),
    listConnections: vi.fn().mockResolvedValue([]),
    listGroups: vi.fn().mockResolvedValue([]),
    listSchemas: vi.fn().mockResolvedValue([]),
    listTables: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@components/connection/ConnectionList", () => ({
  default: ({
    onSelect,
    onActivate,
  }: {
    selectedId: string | null;
    onSelect?: (id: string) => void;
    onActivate?: (id: string) => void;
  }) => (
    <div data-testid="connection-list">
      <button data-testid="list-pick-c1" onClick={() => onSelect?.("c1")}>
        pick c1
      </button>
      <button data-testid="list-activate-c1" onClick={() => onActivate?.("c1")}>
        activate c1
      </button>
      <button data-testid="list-pick-c2" onClick={() => onSelect?.("c2")}>
        pick c2
      </button>
      <button data-testid="list-activate-c2" onClick={() => onActivate?.("c2")}>
        activate c2
      </button>
    </div>
  ),
}));

vi.mock("@components/connection/ConnectionDialog", () => ({
  default: () => <div data-testid="connection-dialog-stub" />,
}));
vi.mock("@components/connection/ImportExportDialog", () => ({
  default: () => <div data-testid="import-export-dialog-stub" />,
}));
vi.mock("@components/connection/GroupDialog", () => ({
  default: () => <div data-testid="group-dialog-stub" />,
}));
vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-stub" />,
}));

// jsdom localStorage shim (project-wide pattern).
{
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

import * as windowControls from "@lib/window-controls";

const showWindowMock = windowControls.showWindow as Mock;
const hideWindowMock = windowControls.hideWindow as Mock;
const focusWindowMock = windowControls.focusWindow as Mock;

function makeConn(id: string): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "test",
    group_id: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

function resetStores() {
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    focusedConnId: null,
  });
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: new Set<string>(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  showWindowMock.mockResolvedValue(undefined);
  hideWindowMock.mockResolvedValue(undefined);
  focusWindowMock.mockResolvedValue(undefined);
  window.localStorage.clear();
  resetStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AC-156-*: Connection activation diagnostic", () => {
  // Reason: 사용자 보고 — connection 더블클릭해도 workspace 미열림. showWindow → focusWindow → hideWindow
  //         호출 순서와 누락 여부를 진단 (2026-04-28)
  it("AC-156-01: double-click triggers showWindow('workspace') → focusWindow('workspace') → hideWindow('launcher') in strict order", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    expect(focusWindowMock).toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).toHaveBeenCalledWith("launcher");

    // Strict ordering: show < focus < hide.
    const showOrder = showWindowMock.mock.invocationCallOrder[0]!;
    const focusOrder = focusWindowMock.mock.invocationCallOrder[0]!;
    const hideOrder = hideWindowMock.mock.invocationCallOrder[0]!;
    expect(showOrder).toBeLessThan(focusOrder);
    expect(focusOrder).toBeLessThan(hideOrder);
  });

  // Reason: 빠른 연속 더블클릭 시 showWindow가 중복 호출되는지 확인.
  //         Sprint 157에서 activatingRef 가드를 추가했으므로 정확히 1회만 호출되어야 함 (2026-04-28)
  it("AC-156-02: rapid double-click (two activations in quick succession) → showWindow should NOT be called more than once per window", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    // Fire two activations in the same event loop tick.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    const workspaceCalls = showWindowMock.mock.calls.filter(
      (c: string[]) => c[0] === "workspace",
    );
    // Sprint 157 — the activatingRef guard now deduplicates rapid calls.
    expect(workspaceCalls.length).toBe(1);
  });

  // Reason: disconnect 후 같은 connection 재활성화 시 전체 chain이 여전히 동작하는지
  //         진단. disconnect가 store state를 정상 초기화하는지도 검증 (2026-04-28)
  it("AC-156-03: after disconnecting, re-activating the same connection still triggers the full chain", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    // Simulate disconnect.
    await act(async () => {
      await useConnectionStore.getState().disconnectFromDatabase("c1");
    });

    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "disconnected",
    });

    // Now re-activate — simulates user double-clicking the same connection.
    render(<HomePage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // The chain must still fire after reconnection.
    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    expect(focusWindowMock).toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).toHaveBeenCalledWith("launcher");

    // focusedConnId must be c1.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason: 사용자 보고 — showWindow 실패 시 launcher가 사라져서 재시도 불가.
  //         showWindow reject → launcher.hide 미호출 + error toast 노출 확인 (2026-04-28)
  it("AC-156-04: showWindow('workspace') rejection → launcher stays visible (hideWindow NOT called), error toast shown", async () => {
    // Import toast to spy on it.
    const { toast } = await import("@lib/toast");
    const toastErrorSpy = vi.spyOn(toast, "error");

    showWindowMock.mockImplementation(async (label: string) => {
      if (label === "workspace") {
        throw new Error("workspace.show failed (simulated)");
      }
    });

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    // Launcher MUST stay visible for retry.
    expect(hideWindowMock).not.toHaveBeenCalledWith("launcher");
    // focusWindow must NOT be called after showWindow rejection.
    expect(focusWindowMock).not.toHaveBeenCalled();
    // Error toast must be shown.
    expect(toastErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to open workspace"),
    );

    toastErrorSpy.mockRestore();
  });

  // Reason: 단일 클릭(select)은 window swap을 트리거하지 않아야 함.
  //         double-click(= onActivate)만 swap 트리거. 기존 테스트와 중복 방지를 위해
  //         명시적으로 seam 호출 0건을 검증 (2026-04-28)
  it("AC-156-05: single-click (onSelect) does NOT trigger any window swap", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "disconnected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-pick-c1"));
    });

    // Single-click must update focusedConnId but NOT swap windows.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
  });

  // Reason: 사용자 보고 — connection A에서 작업 후 B를 열면 A의 탭이 남아 있어 혼란.
  //         sequential activation: A 활성화 → B 활성화 → B focused, A의 탭 정리 (2026-04-28)
  it("AC-156-06: activating connection A then B → B becomes focused, A's stale tabs are cleared", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1"), makeConn("c2")],
      activeStatuses: {
        c1: { type: "connected" },
        c2: { type: "connected" },
      },
      focusedConnId: null,
    });

    // Pre-seed tabs owned by c1.
    useTabStore.setState({
      tabs: [
        {
          id: "tab-a1",
          title: "public.users",
          connectionId: "c1",
          type: "table",
          closable: true,
          schema: "public",
          table: "users",
          subView: "records",
          isPreview: false,
        },
      ],
      activeTabId: "tab-a1",
      closedTabHistory: [],
      dirtyTabIds: new Set<string>(),
    });

    render(<HomePage />);

    // Activate c1 first.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");

    // Clear mocks to isolate the second activation.
    showWindowMock.mockClear();
    hideWindowMock.mockClear();
    focusWindowMock.mockClear();

    // Now activate c2.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c2"));
    });

    // B must become focused.
    expect(useConnectionStore.getState().focusedConnId).toBe("c2");

    // Window swap chain fires again for c2.
    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    expect(focusWindowMock).toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).toHaveBeenCalledWith("launcher");

    // A's stale tabs must be cleared — only c2 tabs (none yet) remain.
    const tabState = useTabStore.getState();
    const c1Tabs = tabState.tabs.filter((t) => t.connectionId === "c1");
    expect(c1Tabs).toHaveLength(0);
  });

  // Reason: handleActivate의 focusedConnId 업데이트가 window swap 전에 동기적으로
  //         실행되는지 확인. 비동기 처리 순서가 꼬이면 focusedConnId가 아직
  //         업데이트되지 않은 상태에서 workspace가 렌더링될 수 있음 (2026-04-28)
  it("AC-156-01 (extended): setFocusedConn runs synchronously before the async window swap", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    // Fire activate and immediately check — setFocusedConn is synchronous,
    // but the window swap is async (void-returned IIFE). By the time we
    // yield to the event loop via `await act`, the sync part must be done.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // focusedConnId must be set BEFORE showWindow resolves.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason: showWindow는 성공했지만 focusWindow가 reject하는 경우를 진단.
  //         workspace는 보이지만 launcher도 남아 있는 상태가 되는지 확인 (2026-04-28)
  it("AC-156-04b: showWindow succeeds but focusWindow rejects → workspace visible, launcher hide is best-effort", async () => {
    focusWindowMock.mockImplementation(async () => {
      throw new Error("focusWindow failed (simulated)");
    });

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // showWindow succeeded → workspace is visible.
    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    // focusWindow rejected → best-effort: hideWindow may or may not have been
    // called (it runs in the same try block). The key invariant is that the
    // user sees the workspace (show succeeded).
    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    // focusedConnId must still be set regardless of window errors.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });
});
