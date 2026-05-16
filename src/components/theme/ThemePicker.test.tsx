// 작성 (legacy) — ThemePicker 컴포넌트의 click / hover / mode-toggle 검증.
// 2026-05-16 update (Phase 4 sprint-368) — `setTheme` / `setMode` 가 IPC 를
// 호출하는 async 액션이 된 뒤, 클릭 핸들러는 promise 를 await 하지 않으므로
// 테스트는 `Promise.resolve()` flush 로 microtask 를 비운 뒤 단언한다.
// `@tauri-apps/api/core` 는 mock 으로 즉시 resolve.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import ThemePicker from "./ThemePicker";
import { useThemeStore } from "@stores/themeStore";
import { DEFAULT_THEME_ID, FEATURED_THEME_IDS } from "@lib/themeCatalog";
import { THEME_STORAGE_KEY } from "@lib/themeBoot";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("ThemePicker", () => {
  beforeEach(() => {
    localStorageMock.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mode");
    useThemeStore.getState().hydrate();
  });

  it("renders a card for every featured theme id", () => {
    render(<ThemePicker />);
    const grid = screen.getByTestId("theme-picker-grid");
    const cards = within(grid).getAllByRole("button");
    expect(cards).toHaveLength(FEATURED_THEME_IDS.length);
    // Sanity: every rendered card's id is in the featured set.
    const ids = cards.map((el) => el.getAttribute("data-theme-id"));
    for (const id of ids) {
      expect(FEATURED_THEME_IDS).toContain(id);
    }
  });

  it("marks the currently selected themeId as active", () => {
    localStorageMock.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ themeId: "github", mode: "light" }),
    );
    useThemeStore.getState().hydrate();
    render(<ThemePicker />);

    const active = screen
      .getByTestId("theme-picker-grid")
      .querySelector('[data-active="true"]');
    expect(active).not.toBeNull();
    expect(active?.getAttribute("data-theme-id")).toBe("github");
  });

  it("clicking a card calls setTheme without closing (store themeId updates)", async () => {
    render(<ThemePicker />);
    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);

    const card = screen.getByRole("button", { name: /theme github primer/i });
    await act(async () => {
      fireEvent.click(card);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useThemeStore.getState().themeId).toBe("github");
    // Picker itself is still mounted — clicking a card must not unmount.
    expect(screen.getByTestId("theme-picker-grid")).toBeInTheDocument();
  });

  // Wave 9.5 회귀 6 (2026-05-16) — 사용자 보고: "테마가 선택이 안돼.
  // 미리보기는 되는데, 선택이 안돼". 이전 click test 는 `useThemeStore.getState()
  // .themeId` (store state) 만 lock 했고, user-facing invariant — DOM 의
  // `data-theme` attribute 가 클릭한 id 로 실제 변경됨 — 은 검증 안 했다.
  // 새 feedback rule (feedback_test_scenarios_user_journey) 의 첫 적용:
  // mock 단언이 아니라 user 가 보는 사실 (CSS variable 을 발동시키는 DOM
  // attribute) 까지 path 를 따라가 lock.
  it("Wave 9.5 회귀 6 — 카드 클릭 후 document.documentElement[data-theme] 가 클릭한 id 로 변경된다", async () => {
    render(<ThemePicker />);
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      DEFAULT_THEME_ID,
    );

    const card = screen.getByRole("button", { name: /theme github primer/i });
    await act(async () => {
      fireEvent.click(card);
      await Promise.resolve();
      await Promise.resolve();
    });

    // user-facing invariant: DOM attribute 가 변경 → CSS [data-theme="github"]
    // 셀렉터가 cascade 에서 적용됨 → user 가 보는 색깔이 github 테마.
    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
  });

  it("mode toggle buttons change the store mode", async () => {
    render(<ThemePicker />);
    expect(useThemeStore.getState().mode).toBe("system");

    const lightBtn = screen.getByRole("radio", { name: /light mode/i });
    await act(async () => {
      fireEvent.click(lightBtn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useThemeStore.getState().mode).toBe("light");

    const darkBtn = screen.getByRole("radio", { name: /dark mode/i });
    await act(async () => {
      fireEvent.click(darkBtn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useThemeStore.getState().mode).toBe("dark");
  });

  it("hovering a card previews that theme on the DOM without touching the store", () => {
    render(<ThemePicker />);
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      DEFAULT_THEME_ID,
    );

    const card = screen.getByRole("button", { name: /theme github primer/i });
    act(() => {
      fireEvent.mouseEnter(card);
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
    // Store stays untouched — preview is DOM-only.
    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);
  });

  it("leaving the grid clears the preview and restores the stored theme", () => {
    render(<ThemePicker />);
    const grid = screen.getByTestId("theme-picker-grid");

    const card = screen.getByRole("button", { name: /theme github primer/i });
    act(() => {
      fireEvent.mouseEnter(card);
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("github");

    act(() => {
      fireEvent.mouseLeave(grid);
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      DEFAULT_THEME_ID,
    );
  });

  // 2026-05-16 사용자 요구: "light, dark 도 마우스 호버링하면 미리보기
  // 해줬으면 좋겠어". 모드 toggle 의 hover 가 mode 만 일시 적용 → DOM 의
  // `data-mode` 가 hover 된 mode 로 변경 (store 는 그대로). 카드 hover 와
  // 동일한 preview pattern.
  it("hovering the light mode toggle previews data-mode='light' without touching the store", () => {
    // 초기: system mode (테스트 환경의 prefers-color-scheme 기본).
    render(<ThemePicker />);
    const initialStoreMode = useThemeStore.getState().mode;

    const lightBtn = screen.getByRole("radio", { name: /light mode/i });
    act(() => {
      fireEvent.mouseEnter(lightBtn);
    });

    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
    // Store 는 그대로 — preview 는 DOM-only.
    expect(useThemeStore.getState().mode).toBe(initialStoreMode);
  });

  it("hovering the dark mode toggle previews data-mode='dark' without touching the store", () => {
    render(<ThemePicker />);
    const initialStoreMode = useThemeStore.getState().mode;

    const darkBtn = screen.getByRole("radio", { name: /dark mode/i });
    act(() => {
      fireEvent.mouseEnter(darkBtn);
    });

    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    expect(useThemeStore.getState().mode).toBe(initialStoreMode);
  });

  it("leaving the appearance toggle group restores the stored mode", () => {
    render(<ThemePicker />);
    const lightBtn = screen.getByRole("radio", { name: /light mode/i });
    const toggleGroup = lightBtn.closest('[role="group"]')!;

    act(() => {
      fireEvent.mouseEnter(lightBtn);
    });
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");

    act(() => {
      fireEvent.mouseLeave(toggleGroup);
    });
    // 초기 store mode 로 복귀 — system 의 resolved mode (jsdom prefers-color-scheme).
    const resolved = useThemeStore.getState().resolvedMode;
    expect(document.documentElement.getAttribute("data-mode")).toBe(resolved);
  });
});
