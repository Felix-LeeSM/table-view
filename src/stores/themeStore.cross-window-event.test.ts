/**
 * 작성 2026-05-16 (Phase 4 sprint-368, AC-368-03)
 *
 * 사유: Q12 Theme/SafeMode SQLite SOT 전환 — `state-changed` event (setting
 * domain, op=update, entityId=theme|safe_mode) 수신 시 receiver 는
 * `get_setting(key)` IPC 로 refetch 한 뒤 store 를 mutate 한다. Self-echo 는
 * sprint-365 의 dispatcher 가 이미 skip 하므로 본 테스트는 non-self-echo
 * 경로만 단언.
 *
 *   1. dispatcher → setting.onUpdated 호출
 *   2. handler → `invoke("get_setting", { key })` 1회
 *   3. 응답 후 store mutate + (theme 만) LS sync
 *
 * 회귀 시: (a) event 수신 시 mutate 0 → 다른 window 의 theme/safeMode 변경이
 * 본 window 에 안 전파, (b) self-echo 가 handler 까지 도달해 두 번 mutate
 * (UI flicker / 무한 loop), (c) safeMode 가 LS sync 를 도로 시작.
 *
 * 본 테스트는 module-load 시점에 themeStore / safeModeStore 가 등록한
 * `setting.onUpdated` 핸들러를 그대로 사용한다 — registry reset 후 다시
 * import 해도 module side-effect 가 한 번 더 안 돌기 때문에 (vitest 의
 * module cache), 테스트 사이에 registry 를 reset 하지 않고 self-echo 와
 * non-self-echo 의 origin 만 바꿔 검증한다.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
  type StateChangedPayload,
} from "@lib/events/stateChanged";
import {
  registerSettingReceiver,
  resetSettingReceiverForTests,
} from "@lib/runtime/settings/settingsReceiver";
import { THEME_STORAGE_KEY, DEFAULT_THEME_ID } from "@lib/themeBoot";
import { useThemeStore } from "./themeStore";
import { useSafeModeStore } from "./safeModeStore";

const invokeMock = vi.mocked(invoke);

async function flushSettingReceiver(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

let payloadVersion = 100;
function settingPayload(
  entityId: "theme" | "safe_mode",
  originWindow: string | null,
): StateChangedPayload {
  payloadVersion += 1;
  return {
    domain: "setting",
    op: "update",
    entityId,
    version: payloadVersion,
    snapshotVersion: 0,
    originWindow,
    emittedAt: 1700000000000,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  localStorageMock.clear();
  useThemeStore.setState({ themeId: DEFAULT_THEME_ID, mode: "system" });
  useSafeModeStore.setState({ mode: "strict" });
  // Reset registry so prior test's lastApplied watermark doesn't dedup
  // the new payload; re-register the receiver fresh.
  resetStateChangedRegistryForTests();
  resetSettingReceiverForTests();
  registerSettingReceiver();
  localStorageMock.setItem.mockClear();
});

describe("AC-368-03 cross-window state-changed setting receiver", () => {
  it("non-self-echo theme update → invokes get_setting('theme') exactly once", async () => {
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ themeId: "github", mode: "dark" }),
    );

    dispatchStateChangedPayload(
      "workspace-conn-1",
      settingPayload("theme", "launcher"),
    );

    // Allow the async receiver chain to flush.
    await flushSettingReceiver();

    const getCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "get_setting",
    );
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0]![1]).toEqual({ key: "theme" });
  });

  it("non-self-echo theme update → store mutates to refetched value", async () => {
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ themeId: "linear", mode: "light" }),
    );

    dispatchStateChangedPayload(
      "workspace-conn-1",
      settingPayload("theme", "launcher"),
    );
    await flushSettingReceiver();

    const state = useThemeStore.getState();
    expect(state.themeId).toBe("linear");
    expect(state.mode).toBe("light");
  });

  it("non-self-echo theme update → LS sync write 1 (FOUC cache)", async () => {
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ themeId: "vercel", mode: "dark" }),
    );

    dispatchStateChangedPayload(
      "workspace-conn-1",
      settingPayload("theme", "launcher"),
    );
    await flushSettingReceiver();

    const themeLsWrites = localStorageMock.setItem.mock.calls.filter(
      (c) => c[0] === THEME_STORAGE_KEY,
    );
    expect(themeLsWrites).toHaveLength(1);
    expect(JSON.parse(themeLsWrites[0]![1])).toEqual({
      themeId: "vercel",
      mode: "dark",
    });
  });

  it("self-echo theme update → no get_setting refetch, no mutate", async () => {
    dispatchStateChangedPayload(
      "workspace-conn-1",
      settingPayload("theme", "workspace-conn-1"),
    );
    await flushSettingReceiver();

    const getCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "get_setting",
    );
    expect(getCalls).toHaveLength(0);
  });

  it("non-self-echo safe_mode update → invokes get_setting('safe_mode'), mutates store, NO LS", async () => {
    invokeMock.mockResolvedValueOnce(JSON.stringify("warn"));

    dispatchStateChangedPayload(
      "workspace-conn-1",
      settingPayload("safe_mode", "launcher"),
    );
    await flushSettingReceiver();

    const getCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "get_setting",
    );
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0]![1]).toEqual({ key: "safe_mode" });

    expect(useSafeModeStore.getState().mode).toBe("warn");

    // No LS writes — safeMode never touches LS.
    expect(localStorageMock.setItem.mock.calls).toHaveLength(0);
  });

  it("get_setting returns null → store stays at previous value (best-effort)", async () => {
    invokeMock.mockResolvedValueOnce(null);

    const before = useThemeStore.getState().themeId;

    dispatchStateChangedPayload(
      "workspace-conn-1",
      settingPayload("theme", "launcher"),
    );
    await flushSettingReceiver();

    expect(useThemeStore.getState().themeId).toBe(before);
  });
});
