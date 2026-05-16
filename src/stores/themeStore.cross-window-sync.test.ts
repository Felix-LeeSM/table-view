/**
 * 작성 2026-05-17 (Wave 9.5 회귀 7) — user journey lock.
 *
 * 사용자 보고: "친구 테마가 창 단위로 적용되는 것 같아. 모든 창이 공유해야 하는데".
 * Wave 9.5 의 메모리 규칙 (feedback_test_scenarios_user_journey) 1차 적용 —
 * mock 호출 단언이 아니라, 사용자가 보는 invariant (DOM `data-theme` /
 * `data-mode`, LS FOUC cache) 끝까지 따라가서 lock 한다.
 *
 * User journey:
 *   1. Window A 의 ThemePicker 클릭 → Window A 가 broadcast (frontend bridge
 *      `theme-sync` 채널 또는 backend `state-changed` setting 도메인)
 *   2. Window B 가 inbound 이벤트 수신
 *   3. Window B 의 zustand store 가 mutate (themeId + mode 동기화)
 *   4. Window B 의 subscriber 가 `applyTheme()` → DOM `data-theme` / `data-mode`
 *      attribute 가 외부 창의 선택과 일치
 *   5. Window B 의 subscriber 가 `writeStoredState()` → 다음 boot 의 FOUC
 *      cache 가 외부 창의 선택과 일치
 *
 * Self-echo 는 받지 않아야 한다 (sprint-153 의 loop guard).
 *
 * 회귀 시 (예: bridge listen 미등록, subscriber 의 LS write 누락, attach
 * race 등) 어느 step 이라도 깨지면 다른 창의 사용자가 "내 창만 테마가
 * 다른 색깔" 로 본다. 이건 unit mock 단언 (예: invoke 호출 횟수) 으로는
 * 잡을 수 없는 종류 — DOM + LS 의 끝-끝 invariant 까지 따라가야 잡힌다.
 *
 * jsdom 한계: 실제 두 webview process 시뮬레이션 불가. 본 테스트는 한
 * process 안에서 `@tauri-apps/api/event` 를 in-memory bus 로 mock 하여
 * "외부 origin 의 emit" 을 흉내낸다. 진짜 cross-webview broadcast 의
 * Tauri 측 transport 검증은 e2e + backend integration test 가 담당.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory bus mock — `@tauri-apps/api/event` 가 process-spanning 인 척.
// `vi.mock` factory 는 hoist 되어 themeStore.ts 의 module-load 보다 먼저
// 실행되므로 외부 `const` 캡쳐는 TDZ 에 걸린다. `vi.hoisted` 로 bus 의
// 본체도 같은 hoist 단계에 두고, mock factory 는 그 helper 들만 참조.
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

// 본 테스트는 "자기 window 의 attach 가 사용한 originId" 와 다른 값으로
// inbound 흉내내야 한다. themeStore.ts 의 module-load 시 attach 가 사용한
// `getCurrentWindowLabel() ?? "unknown"` 값이 self id 이므로 그 자리는
// 명시적으로 mock 해서 self/other 의 분리를 결정적으로 한다.
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

import { useThemeStore } from "./themeStore";
import { THEME_STORAGE_KEY, DEFAULT_THEME_ID } from "@lib/themeBoot";

// `attachZustandIpcBridge` 의 listen 등록은 비동기. module-load 시 fire-and-
// forget 으로 시작되므로, 첫 inbound emit 흉내 전에 listener 가 bus 에
// 등록되었음을 확인한다. 50ms 안에 등록 안 되면 명시적 실패 — 회귀 시
// silent timeout 대신 즉각 노출.
async function waitForBridgeAttach(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if ((bus.get("theme-sync")?.size ?? 0) > 0) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(
    "theme-sync bridge attach did not register a listener within 50ms",
  );
}

beforeEach(async () => {
  await waitForBridgeAttach();
  localStorageMock.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
  useThemeStore.setState({ themeId: DEFAULT_THEME_ID, mode: "system" });
  // reset 의 subscriber 호출이 LS write 발생시킬 수 있으니 flush 후 clear.
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
    // attachZustandIpcBridge 의 inbound apply → subscriber → applyTheme +
    // writeStoredState 가 모두 microtask. flush.
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
