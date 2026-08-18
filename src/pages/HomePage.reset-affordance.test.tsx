/**
 * 작성 2026-05-17 (Phase 6 sprint-376 Q21 affordance #2 + #8;
 * sprint-377 회귀 가드 #1+#3 추가).
 *
 * 사유: Q21 9 affordance 중
 *   (8) Home action bar "Clear recent" → clear_mru IPC 1회.
 *
 * #2433 (2026-08-18): affordance (8) 이 Recent 목록 끝으로 옮겨가 이 트리
 * 에서 사라졌다. 여기 남은 케이스는 옛 자리 부재 단언이고, 동작은
 * `src/features/connection/components/RecentConnections.test.tsx` 와
 * `src/stores/mruStore.test.ts` 가 나눠 갖는다.
 *
 * #2440 (2026-08-17): affordance (2) — Home "Recent" 헤더의 "Reset" —
 * 제거. Recent 가 footer 에서 group rail 의 view 로 옮겨져 접히는 footer
 * 자체가 없어졌고, 초기화할 접힘 상태가 남지 않았다. 해당 케이스도 같이
 * 지웠다.
 *
 * 본 spec 은 HomePage 의 사용자 entry point — 우클릭 메뉴 / 액션 바
 * 버튼 — 가 위 IPC 를 정확한 wire shape 으로 발사하는지 lock. #2433 이전
 * 에는 "confirm dialog 가 도입되면 fail" 이 여기 걸려 있었는데, 그 계약은
 * affordance (8) 과 함께 옮겨갔다 — 되돌릴 수 없는 전체 삭제라 지금은
 * 확인 창을 거치는 쪽이 계약이다.
 *
 * sprint-377 (2026-05-17): 사용자 직접 요청으로 settings panel 의
 * "Reset settings" / "Reset sidebar width" 두 버튼 제거. 본 spec 에
 * AC-377-01/02 negative-assertion 케이스 추가 — HomePage 트리에서
 * 두 버튼 부재 회귀 가드.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

// jsdom shim for localStorage so the HomePage's persistSettingValue
// + zustand persist hooks don't crash on mount. Mirrors pages/HomePage.test.tsx.
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

vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-mock" />,
}));

vi.mock("@features/connection", async () => {
  const connectionStore = await vi.importActual<
    typeof import("@stores/connectionStore")
  >("@stores/connectionStore");

  return {
    ...connectionStore,
    ConnectionBrowser: () => <div data-testid="connection-browser" />,
    ConnectionDialog: () => <div data-testid="connection-dialog" />,
    ImportExportDialog: () => <div data-testid="import-export-dialog" />,
    GroupDialog: () => <div data-testid="group-dialog" />,
  };
});

vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  destroyCurrentWindow: vi.fn(() => Promise.resolve()),
  exitApp: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));

import { useMruStore } from "@stores/mruStore";
import HomePage from "./HomePage";

describe("HomePage reset affordances (Q21 #2 + #8)", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useMruStore.setState({
      recentConnections: [
        { connectionId: "c-1", lastUsed: 1 },
        { connectionId: "c-2", lastUsed: 2 },
      ],
      lastUsedConnectionId: "c-1",
    });
  });

  // 갱신 (2026-08-18, #2433): affordance (8) 이 launcher action bar 를 떠나
  // Recent 목록 끝으로 갔다. HomePage 는 `ConnectionBrowser` 를 stub 으로
  // 갈아 끼우므로 그 버튼은 이 트리에 아예 없다. 여기 남는 것은 옛 자리에
  // 다시 mount 되는 것을 막는 부재 단언이고 — AC-377-01/02 와 같은 형태다 —
  // 실제 동작은 두 곳이 나눠 갖는다:
  //   - 버튼 · 확인 창: src/features/connection/components/RecentConnections.test.tsx
  //   - clear_mru wire shape: src/stores/mruStore.test.ts
  it("AC-376-08 (#2433 이관): 'Clear recent' 가 launcher action bar 에 없다", () => {
    render(<HomePage />);

    expect(screen.queryByRole("button", { name: /clear recent/i })).toBeNull();
    expect(screen.queryByTestId("home-clear-recent")).toBeNull();
    // 버튼이 없으니 mount 만으로 IPC 가 나가지도 않는다.
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "clear_mru"),
    ).toHaveLength(0);
    expect(useMruStore.getState().recentConnections).toHaveLength(2);
  });

  // 작성 2026-05-17 (sprint-377 회귀 가드). 사유: 사용자 직접 요청 —
  // Settings panel 의 두 reset 버튼 ("Reset settings" / "Reset sidebar
  // width") 제거. 미래에 누군가 launcher 의 settings strip 에 reset
  // 버튼을 다시 mount 하면 이 test 가 fail. sidebar handle 우클릭
  // entry (Sidebar.tsx) 와 home-recent footer 의 작은 reset 버튼은
  // 별도 affordance 로 유지되므로 본 test 는 *HomePage 트리* 안에서만
  // 두 버튼 부재를 단언 — sidebar handle 은 별 컴포넌트라 HomePage
  // 트리에 포함되지 않음.
  it("AC-377-01/02: Settings panel 'Reset settings' 와 'Reset sidebar width' 버튼이 HomePage 트리에 존재하지 않음", () => {
    render(<HomePage />);
    expect(
      screen.queryByRole("button", { name: /^reset settings$/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^reset sidebar width$/i }),
    ).toBeNull();
  });
});
