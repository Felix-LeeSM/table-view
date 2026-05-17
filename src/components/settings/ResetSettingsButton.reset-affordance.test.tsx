/**
 * 작성 2026-05-17 (Phase 6 sprint-376 Q21 affordance #1 + #3-b).
 *
 * 사유: Q21 9 affordance 중 (1) Settings panel "Reset settings" 버튼이
 * 4 setting key (theme / safe_mode / query_history_retention_days /
 * query_history_enabled) 의 `reset_setting` IPC 를 정확히 4회 발사하는지
 * lock. 추가로 (3-b) Sidebar handle 우클릭 외 두 번째 entry point —
 * "Reset sidebar width" — 같은 IPC (key="sidebar_width") 를 호출하는지
 * 단일 컴포넌트 안에서 lock.
 *
 * Lego 핵심:
 *   - Mock `@tauri-apps/api/core` 의 `invoke` — 어떤 다른 IPC 도 호출되면
 *     검사 실패 (frontend 가 confirm dialog 없이 직접 IPC 호출 contract).
 *   - 4 키의 호출 order 는 contract 가 강제하지 않음 — 호출 자체와 인자
 *     shape (`{ key: "<name>" }`) 만 확인.
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

import ResetSettingsButton, {
  RESET_SETTINGS_KEYS,
  RESET_SIDEBAR_WIDTH_KEY,
} from "./ResetSettingsButton";

describe("ResetSettingsButton (Q21 affordance #1 + #3-b)", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("Reset settings 클릭 → 4 setting key 각각 reset_setting IPC 1회씩 발사", () => {
    render(<ResetSettingsButton />);
    const btn = screen.getByRole("button", { name: /reset settings/i });
    fireEvent.click(btn);

    const resetCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === "reset_setting",
    );
    // 4 keys × 1 invocation = 4.
    expect(resetCalls).toHaveLength(RESET_SETTINGS_KEYS.length);
    const keys: Array<string | undefined> = resetCalls.map((call) => {
      const arg = call[1] as { key?: string } | undefined;
      return arg?.key;
    });
    for (const expected of RESET_SETTINGS_KEYS) {
      expect(keys).toContain(expected);
    }
    // Side invariant: no other IPCs leaked from the click.
    const otherCalls = invokeMock.mock.calls.filter(
      (call) => call[0] !== "reset_setting",
    );
    expect(otherCalls).toEqual([]);
  });

  it("Reset sidebar width 클릭 → reset_setting('sidebar_width') 정확히 1회", () => {
    render(<ResetSettingsButton />);
    const btn = screen.getByRole("button", { name: /reset sidebar width/i });
    fireEvent.click(btn);

    const calls = invokeMock.mock.calls.filter(
      (call) => call[0] === "reset_setting",
    );
    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[1]).toEqual({ key: RESET_SIDEBAR_WIDTH_KEY });
  });
});
