// AC-185-02 — safeModeStore unit tests. 작성 2026-05-01.
//
// 2026-05-16 update (Phase 4 sprint-368, Q12) — safeModeStore actions
// became backend-first (`persist_setting("safe_mode", JSON)` IPC). Tests
// now (a) mock `@tauri-apps/api/core` so the IPC resolves immediately in
// jsdom, (b) await each action, and (c) drop the LS persistence assertion
// — the persist middleware was removed in this sprint (LS write 0 for
// safe_mode). The new AC-368-02 LS-zero invariant is locked in
// `safeModeStore.setSafeMode.test.ts`.
//
// 2026-07-22 update (issue #1631 test-audit Wave 2) — toggle 의 per-step
// 전이(strict→warn / warn→off / off→strict)와 reversibility(full-cycle
// 복귀)는 `safeModeStore.setSafeMode.test.ts` 의 full-cycle SOT 로 통합됨.
// 이 파일은 default 앵커(#1113)와 setMode 기본 계약만 남긴다.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useSafeModeStore, SAFE_MODE_STORAGE_KEY } from "./safeModeStore";

const invokeMock = vi.mocked(invoke);

describe("safeModeStore", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    // #1113 — 실효 기본값을 warn 으로 정정 (backend snapshot default 와 통일).
    useSafeModeStore.setState({ mode: "warn" });
  });

  it('[AC-185-02a] default mode is "warn" (#1113)', () => {
    expect(useSafeModeStore.getState().mode).toBe("warn");
  });

  it("[AC-185-02b] setMode updates mode", async () => {
    await useSafeModeStore.getState().setMode("off");
    expect(useSafeModeStore.getState().mode).toBe("off");
    await useSafeModeStore.getState().setMode("strict");
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });

  // toggle per-step 전이 + reversibility 는 safeModeStore.setSafeMode.test.ts
  // 의 full-cycle SOT 로 이관됨 — issue #1631 (2026-07-22).
});
