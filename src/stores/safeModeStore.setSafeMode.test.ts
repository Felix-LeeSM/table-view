/**
 * 작성 2026-05-16 (Phase 4 sprint-368, AC-368-02 + AC-368-06)
 *
 * 사유: Q12 Theme/SafeMode SQLite SOT 전환 — safeMode 는 boot FOUC critical
 * 이 아니므로 LS read/write 0. `setMode` / `toggle` 액션은 IPC
 * `persist_setting("safe_mode", JSON)` 만 호출하고 LS 는 손대지 않는다.
 *
 *   1. IPC `persist_setting({key:"safe_mode", valueJson: …})` 1회
 *   2. 응답 후 store mutate
 *   3. LS write 0 (`view-table.safeMode` key retire)
 *
 * 회귀 시: (a) persist middleware 가 다시 활성화돼 LS 에 stale 값이 박힘,
 * (b) IPC reject 시 store 가 optimistic 으로 갱신돼 SQLite 와 불일치.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useSafeModeStore, SAFE_MODE_STORAGE_KEY } from "./safeModeStore";

const invokeMock = vi.mocked(invoke);

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  localStorageMock.clear();
  useSafeModeStore.setState({ mode: "strict" });
  localStorageMock.setItem.mockClear();
});

describe("AC-368-02 setSafeMode backend-first, LS 0", () => {
  it("setMode invokes persist_setting IPC with safe_mode key", async () => {
    await useSafeModeStore.getState().setMode("off");

    const calls = invokeMock.mock.calls.filter(
      (c) => c[0] === "persist_setting",
    );
    expect(calls).toHaveLength(1);
    const req = calls[0]![1] as { req: { key: string; valueJson: string } };
    expect(req.req.key).toBe("safe_mode");
    expect(JSON.parse(req.req.valueJson)).toBe("off");
  });

  it("setMode mutates store after IPC resolves", async () => {
    await useSafeModeStore.getState().setMode("warn");
    expect(useSafeModeStore.getState().mode).toBe("warn");
  });

  it("setMode does NOT write to localStorage (view-table.safeMode retired)", async () => {
    await useSafeModeStore.getState().setMode("off");

    const safeModeWrites = localStorageMock.setItem.mock.calls.filter(
      (c) => c[0] === SAFE_MODE_STORAGE_KEY,
    );
    expect(safeModeWrites).toHaveLength(0);

    // No write anywhere — safeMode never touches LS.
    expect(localStorageMock.setItem.mock.calls).toHaveLength(0);
  });

  it("toggle invokes persist_setting and cycles strict → warn", async () => {
    await useSafeModeStore.getState().toggle();
    expect(useSafeModeStore.getState().mode).toBe("warn");

    const calls = invokeMock.mock.calls.filter(
      (c) => c[0] === "persist_setting",
    );
    expect(calls).toHaveLength(1);
    const req = calls[0]![1] as { req: { key: string; valueJson: string } };
    expect(JSON.parse(req.req.valueJson)).toBe("warn");
  });

  it("toggle cycles full strict → warn → off → strict via three IPC calls", async () => {
    await useSafeModeStore.getState().toggle();
    await useSafeModeStore.getState().toggle();
    await useSafeModeStore.getState().toggle();

    expect(useSafeModeStore.getState().mode).toBe("strict");

    const calls = invokeMock.mock.calls.filter(
      (c) => c[0] === "persist_setting",
    );
    expect(calls).toHaveLength(3);
    expect(
      calls.map((c) => {
        const req = c[1] as { req: { valueJson: string } };
        return JSON.parse(req.req.valueJson);
      }),
    ).toEqual(["warn", "off", "strict"]);
  });

  it("IPC reject does NOT mutate store nor write LS", async () => {
    invokeMock.mockRejectedValueOnce(new Error("forced fail"));

    await expect(useSafeModeStore.getState().setMode("off")).rejects.toThrow(
      "forced fail",
    );

    expect(useSafeModeStore.getState().mode).toBe("strict");
    expect(localStorageMock.setItem.mock.calls).toHaveLength(0);
  });
});
