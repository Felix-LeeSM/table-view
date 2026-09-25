/**
 * Written 2026-05-16 (AC-368-03)
 *
 * Reason: state-management-strategy Q12 moves Theme/SafeMode to a SQLite
 * SOT — on a `state-changed` event (setting domain, op=update,
 * entityId=theme|safe_mode) the receiver refetches with the
 * `get_setting(key)` IPC and then mutates the store.
 * `dispatchStateChangedPayload` already skips self-echo, so the cases below
 * assert the non-self-echo path, plus one case that checks a self-echo
 * triggers no refetch.
 *
 *   1. dispatcher → calls setting.onUpdated
 *   2. handler → `invoke("get_setting", { key })` once
 *   3. store mutate after the response + LS sync (theme only)
 *
 * On regression: (a) no mutate on event receipt → another window's
 * theme/safeMode change never reaches this window, (b) a self-echo reaches
 * the handler and mutates twice (UI flicker / infinite loop), (c) safeMode
 * starts syncing LS again.
 *
 * The `setting.onUpdated` handler comes from `registerSettingReceiver()`
 * (`src/lib/runtime/settings/settingsReceiver.ts`); `beforeEach` resets the
 * `state-changed` registry and registers the receiver again.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
  type StateChangedPayload,
} from "@lib/events/stateChanged";
import {
  registerSettingReceiver,
  resetSettingReceiverForTests,
} from "@lib/runtime/settings/settingsReceiver";
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY } from "@lib/themeBoot";
import { invoke } from "@tauri-apps/api/core";
import { useSafeModeStore } from "./safeModeStore";
import { useThemeStore } from "./themeStore";

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
