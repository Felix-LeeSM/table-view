/**
 * Written 2026-05-17 (Wave 9.5 regression 7) — user journey lock.
 *
 * User report: "My friend's theme seems to apply per window. All windows
 * should share it". First application of the Wave 9.5 memory rule
 * (feedback_test_scenarios_user_journey) — lock by following the
 * user-visible invariant (DOM `data-theme` / `data-mode`, LS FOUC cache)
 * all the way through, not mock-call assertions.
 *
 * User journey:
 *   1. Clicking the ThemePicker in Window A → Window A broadcasts (frontend
 *      bridge `theme-sync` channel, or backend `state-changed` setting domain)
 *   2. Window B receives the inbound event
 *   3. Window B's zustand store mutates (themeId + mode kept in sync)
 *   4. Window B's subscriber runs `applyTheme()` → the DOM `data-theme` /
 *      `data-mode` attributes match the other window's choice
 *   5. Window B's subscriber runs `writeStoredState()` → the next boot's
 *      FOUC cache matches the other window's choice
 *
 * Self-echo must not be received (the loop guard).
 *
 * On regression (e.g. bridge listen not registered, subscriber skipping the
 * LS write, attach race), a broken step makes the user in the other window
 * see "my window's theme color is different". Unit mock assertions (e.g.
 * invoke call counts) cannot catch this kind — only following the
 * end-to-end DOM + LS invariant can.
 *
 * jsdom limitation: two real webview processes cannot be simulated. This
 * test mocks `@tauri-apps/api/event` with an in-memory bus in a single
 * process to fake "an emit from an external origin". The Tauri-side
 * transport of a real cross-webview broadcast is covered by e2e + backend
 * integration tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory bus mock — fakes `@tauri-apps/api/event` spanning the process.
// The `vi.mock` factory is hoisted and runs before themeStore.ts's
// module-load, so capturing an outer `const` would hit the TDZ. `vi.hoisted`
// keeps the bus itself in the same hoist stage, and the mock factory only
// references those helpers.
const { busEmit, busListen, bus } = vi.hoisted(() => {
  type Env = { event: string; payload: unknown };
  const bus = new Map<string, Set<(env: Env) => void>>();
  function busEmit(event: string, payload: unknown): void {
    const listeners = bus.get(event);
    if (!listeners) return;
    for (const l of [...listeners]) l({ event, payload });
  }
  function busListen(event: string, l: (env: Env) => void): () => void {
    let set = bus.get(event);
    if (!set) {
      set = new Set();
      bus.set(event, set);
    }
    set.add(l);
    return () => {
      set?.delete(l);
    };
  }
  return { busEmit, busListen, bus };
});

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async (event: string, payload?: unknown) => {
    busEmit(event, payload);
  }),
  listen: vi.fn(
    async (
      event: string,
      handler: (e: { event: string; payload: unknown }) => void,
    ) => busListen(event, handler),
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

// This test must fake inbound events with a value different from the originId
// its own window's attach used. The `getCurrentWindowLabel() ?? "unknown"`
// value used by the attach at themeStore.ts module-load is the self id, so
// that slot is mocked explicitly to make the self/other split deterministic.
vi.mock("@lib/window-label", () => ({
  getCurrentWindowLabel: () => "test-self",
  parseWorkspaceLabel: () => null,
}));

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

import { DEFAULT_THEME_ID, THEME_STORAGE_KEY } from "@lib/themeBoot";
import { useThemeStore } from "./themeStore";

// `attachZustandIpcBridge` registers its listen asynchronously, fire-and-
// forget at module-load. Verify the listener is on the bus before the first
// fake inbound emit. An explicit failure if not registered in time —
// immediate exposure on regression instead of a silent timeout.
async function waitForBridgeAttach(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    if ((bus.get("theme-sync")?.size ?? 0) > 0) return;
  }
  throw new Error("theme-sync bridge attach did not register a listener");
}

beforeEach(async () => {
  await waitForBridgeAttach();
  localStorageMock.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
  useThemeStore.setState({ themeId: DEFAULT_THEME_ID, mode: "system" });
  // The reset's subscriber calls may trigger an LS write, so flush before clearing.
  await Promise.resolve();
  await Promise.resolve();
  localStorageMock.setItem.mockClear();
});

describe("Wave 9.5 회귀 7 — cross-window 테마 sync (theme-sync inbound user journey)", () => {
  it("외부 창의 theme-sync inbound → 본 창 store.themeId / mode 가 같이 mutate", async () => {
    busEmit("theme-sync", {
      origin: "other-window",
      state: { themeId: "github", mode: "dark" },
    });
    // attachZustandIpcBridge's inbound apply → subscriber → applyTheme +
    // writeStoredState are all microtasks. Flush.
    await Promise.resolve();
    await Promise.resolve();

    const state = useThemeStore.getState();
    expect(state.themeId).toBe("github");
    expect(state.mode).toBe("dark");
  });

  it("외부 창의 theme-sync inbound → 본 창 DOM data-theme / data-mode 가 외부 선택과 일치", async () => {
    busEmit("theme-sync", {
      origin: "other-window",
      state: { themeId: "github", mode: "dark" },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
  });

  it("외부 창의 theme-sync inbound → 본 창 LS (FOUC cache) 가 외부 선택과 일치", async () => {
    busEmit("theme-sync", {
      origin: "other-window",
      state: { themeId: "linear", mode: "light" },
    });
    await Promise.resolve();
    await Promise.resolve();

    const themeWrites = localStorageMock.setItem.mock.calls.filter(
      (c) => c[0] === THEME_STORAGE_KEY,
    );
    expect(themeWrites.length).toBeGreaterThanOrEqual(1);
    const last = themeWrites[themeWrites.length - 1]!;
    expect(JSON.parse(last[1])).toEqual({ themeId: "linear", mode: "light" });
  });

  it("self-echo (origin === 본 창의 id) 는 inbound apply 안 됨 — loop guard", async () => {
    busEmit("theme-sync", {
      origin: "test-self",
      state: { themeId: "github", mode: "dark" },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);
    expect(useThemeStore.getState().mode).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).not.toBe(
      "github",
    );
  });

  it("inbound apply 후 다른 외부 창에서 다시 inbound → 그 값으로 최신화", async () => {
    busEmit("theme-sync", {
      origin: "other-window-a",
      state: { themeId: "github", mode: "dark" },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(useThemeStore.getState().themeId).toBe("github");

    busEmit("theme-sync", {
      origin: "other-window-b",
      state: { themeId: "vercel", mode: "light" },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(useThemeStore.getState().themeId).toBe("vercel");
    expect(useThemeStore.getState().mode).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("vercel");
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
  });
});
