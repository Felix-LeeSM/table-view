// AC-185-02 — safeModeStore unit tests. Written 2026-05-01.
//
// 2026-05-16 update (state-management-strategy Q12) — safeModeStore actions
// became backend-first (`persist_setting("safe_mode", JSON)` IPC). Tests
// now (a) mock `@tauri-apps/api/core` so the IPC resolves immediately in
// jsdom, (b) await each action, and (c) drop the LS persistence assertion
// — the persist middleware was removed (LS write 0 for safe_mode). The new
// AC-368-02 LS-zero invariant is locked in
// `safeModeStore.setSafeMode.test.ts`.
//
// 2026-07-22 update (issue #1631 test-audit) — the per-step toggle
// transitions (strict→warn / warn→off / off→strict) and reversibility
// (full-cycle return) were merged into the full-cycle SOT in
// `safeModeStore.setSafeMode.test.ts`. This file keeps only the default
// anchor (#1113) and the basic setMode contract.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { SAFE_MODE_STORAGE_KEY, useSafeModeStore } from "./safeModeStore";

const invokeMock = vi.mocked(invoke);

describe("safeModeStore", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    // #1113 — effective default corrected to warn (aligned with the backend
    // snapshot default).
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

  // Per-step toggle transitions + reversibility moved to the full-cycle SOT
  // in safeModeStore.setSafeMode.test.ts — issue #1631 (2026-07-22).
});
