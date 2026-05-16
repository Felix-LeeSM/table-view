// AC-185-02 — safeModeStore unit tests. 5 cases per Sprint 185 contract.
// AC-186-01 — Sprint 186 extends toggle to 3-way (strict → warn → off → strict).
// 작성 2026-05-01.
//
// 2026-05-16 update (Phase 4 sprint-368, Q12) — safeModeStore actions
// became backend-first (`persist_setting("safe_mode", JSON)` IPC). Tests
// now (a) mock `@tauri-apps/api/core` so the IPC resolves immediately in
// jsdom, (b) await each action, and (c) drop the LS persistence assertion
// — the persist middleware was removed in this sprint (LS write 0 for
// safe_mode). The new AC-368-02 LS-zero invariant is locked in
// `safeModeStore.setSafeMode.test.ts`.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  useSafeModeStore,
  SAFE_MODE_STORAGE_KEY,
  SYNCED_KEYS,
} from "./safeModeStore";

const invokeMock = vi.mocked(invoke);

describe("safeModeStore", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    useSafeModeStore.setState({ mode: "strict" });
  });

  it('[AC-185-02a] default mode is "strict"', () => {
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });

  it("[AC-185-02b] setMode updates mode", async () => {
    await useSafeModeStore.getState().setMode("off");
    expect(useSafeModeStore.getState().mode).toBe("off");
    await useSafeModeStore.getState().setMode("strict");
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });

  it("[AC-185-02c] toggle is reversible — full cycle returns to start", async () => {
    expect(useSafeModeStore.getState().mode).toBe("strict");
    await useSafeModeStore.getState().toggle();
    await useSafeModeStore.getState().toggle();
    await useSafeModeStore.getState().toggle();
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });

  it("[AC-186-01a] toggle: strict → warn", async () => {
    expect(useSafeModeStore.getState().mode).toBe("strict");
    await useSafeModeStore.getState().toggle();
    expect(useSafeModeStore.getState().mode).toBe("warn");
  });

  it("[AC-186-01b] toggle: warn → off", async () => {
    useSafeModeStore.setState({ mode: "warn" });
    await useSafeModeStore.getState().toggle();
    expect(useSafeModeStore.getState().mode).toBe("off");
  });

  it("[AC-186-01c] toggle: off → strict (no skipping warn)", async () => {
    useSafeModeStore.setState({ mode: "off" });
    await useSafeModeStore.getState().toggle();
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });

  it('[AC-185-02e] SYNCED_KEYS exactly ["mode"]', () => {
    expect(SYNCED_KEYS).toEqual(["mode"]);
  });
});
