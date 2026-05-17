/**
 * 작성 2026-05-17 (Phase 6 sprint-376 Q21 affordance #2 + #8).
 *
 * 사유: Q21 9 affordance 중
 *   (2) Home "Recent" 헤더 우클릭 "Reset" → reset_setting("home_recent_collapsed") 1회.
 *   (8) Home action bar "Clear recent" → clear_mru IPC 1회.
 *
 * 본 spec 은 HomePage 의 사용자 entry point — 우클릭 메뉴 / 액션 바
 * 버튼 — 가 위 IPC 를 정확한 wire shape 으로 발사하는지 lock. Confirm
 * dialog 가 도입되면 test 가 fail 해야 함 (Q21 contract — 직접 IPC).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

vi.mock("@components/connection/ConnectionList", () => ({
  default: () => <div data-testid="connection-list" />,
}));

vi.mock("@components/connection/ConnectionDialog", () => ({
  default: () => <div data-testid="connection-dialog" />,
}));

vi.mock("@components/connection/ImportExportDialog", () => ({
  default: () => <div data-testid="import-export-dialog" />,
}));

vi.mock("@components/connection/GroupDialog", () => ({
  default: () => <div data-testid="group-dialog" />,
}));

vi.mock("@components/connection/RecentConnections", () => ({
  default: () => <div data-testid="recent-connections-mock" />,
}));

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

import HomePage from "./HomePage";
import { useMruStore } from "@stores/mruStore";

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

  it("AC-376-08: Home action-bar 'Clear recent' 클릭 → clear_mru IPC 1회 + store empty", () => {
    render(<HomePage />);
    const btn = screen.getByRole("button", { name: /clear recent/i });
    fireEvent.click(btn);

    const calls = invokeMock.mock.calls.filter(
      (call) => call[0] === "clear_mru",
    );
    expect(calls).toHaveLength(1);
    // store also reset locally (optimistic) — the backend emit handles
    // the other window.
    expect(useMruStore.getState().recentConnections).toEqual([]);
    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
  });

  it("AC-376-02: Recent 'Reset' 버튼 클릭 → reset_setting('home_recent_collapsed') 1회", () => {
    render(<HomePage />);
    // The Reset button lives alongside the chevron toggle on the home-
    // recent footer. It's a flat button rather than a context-menu item
    // so keyboard users can find it (Q21 — 직관적 위치 contract; the
    // home-recent footer is a small surface where a context-menu would
    // be discoverable only via right-click).
    const btn = screen.getByRole("button", { name: /reset recent collapse/i });
    fireEvent.click(btn);

    const calls = invokeMock.mock.calls.filter(
      (call) => call[0] === "reset_setting",
    );
    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[1]).toEqual({ key: "home_recent_collapsed" });
  });

  it("Settings section mounts ResetSettingsButton so audit #1 reaches the user", () => {
    // 사유: audit invariant — HomePage 가 launcher 의 settings surface.
    // ResetSettingsButton 이 mount 됐는지 곧 사용자가 4 key reset 을
    // 실제 발견 가능한지 검사. 컴포넌트 안 contract 는 자체 test 가
    // 책임 (ResetSettingsButton.reset-affordance.test.tsx).
    render(<HomePage />);
    expect(
      screen.getByRole("button", { name: /^reset settings$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^reset sidebar width$/i }),
    ).toBeInTheDocument();
  });
});
