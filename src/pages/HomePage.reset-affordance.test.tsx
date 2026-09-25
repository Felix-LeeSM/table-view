/**
 * Written 2026-05-17 (state-management-strategy Q21 affordances #2 + #8;
 * Q21 #1 + #3 regression guards added).
 *
 * Reason: of the nine Q21 affordances,
 *   (8) Home action bar "Clear recent" → one clear_mru IPC.
 *
 * #2433 (2026-08-18): affordance (8) moved to the foot of the Recent list
 * and left this tree. The case left here asserts its absence from the old
 * spot; the behavior is split between
 * `src/features/connection/components/RecentConnections.test.tsx` and
 * `src/stores/mruStore.test.ts`.
 *
 * #2440 (2026-08-17): affordance (2) — the "Reset" on Home's "Recent"
 * header — was removed. Recent moved from the footer to a group-rail view,
 * so the collapsible footer itself is gone and no collapsed state is left
 * to reset. Its case was deleted too.
 *
 * This spec used to lock that HomePage's user entry points — right-click
 * menu / action-bar button — fire the IPC above with the exact wire shape.
 * Before #2433, "fail if a confirm dialog is introduced" was pinned here;
 * that contract moved with affordance (8) — clearing everything cannot be
 * undone, so going through a confirm dialog is the contract now.
 *
 * 2026-05-17: the Settings panel's two buttons, "Reset settings" / "Reset
 * sidebar width", were removed. AC-377-01/02 negative-assertion case added
 * to this spec — a regression guard for the two buttons' absence from the
 * HomePage tree.
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

  // Updated (2026-08-18, #2433): affordance (8) left the launcher action bar
  // for the foot of the Recent list. This spec swaps `ConnectionBrowser` for
  // a stub, so that button is not in this tree at all. What remains here is
  // an absence assertion that keeps it from being mounted at the old spot
  // again — the same shape as AC-377-01/02 — and the real behavior is split
  // between two places:
  //   - button · confirm dialog: src/features/connection/components/RecentConnections.test.tsx
  //   - clear_mru wire shape: src/stores/mruStore.test.ts
  it("AC-376-08 (#2433 이관): 'Clear recent' 가 launcher action bar 에 없다", () => {
    render(<HomePage />);

    expect(screen.queryByRole("button", { name: /clear recent/i })).toBeNull();
    expect(screen.queryByTestId("home-clear-recent")).toBeNull();
    // With no button, mounting alone sends no IPC either.
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "clear_mru"),
    ).toHaveLength(0);
    expect(useMruStore.getState().recentConnections).toHaveLength(2);
  });

  // Written 2026-05-17 (regression guard). Reason: the Settings panel's two
  // reset buttons ("Reset settings" / "Reset sidebar width") were removed.
  // If someone mounts a reset button in the launcher's settings strip again,
  // this test fails. The sidebar's "Reset width" entry (Sidebar.tsx) stays
  // as a separate affordance, so this test asserts the two buttons' absence
  // only inside the *HomePage tree* — the sidebar handle belongs to a
  // separate component, outside the HomePage tree.
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
