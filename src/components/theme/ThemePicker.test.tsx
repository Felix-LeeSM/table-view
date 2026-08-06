// 작성 (legacy) — ThemePicker 컴포넌트의 click / hover / mode-toggle 검증.
// 2026-05-16 update (Phase 4 sprint-368) — `setTheme` / `setMode` 가 IPC 를
// 호출하는 async 액션이 된 뒤, 클릭 핸들러는 promise 를 await 하지 않으므로
// 테스트는 `Promise.resolve()` flush 로 microtask 를 비운 뒤 단언한다.
// `@tauri-apps/api/core` 는 mock 으로 즉시 resolve.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { THEME_STORAGE_KEY } from "@lib/themeBoot";
import {
  DEFAULT_FAVORITE_THEME_IDS,
  DEFAULT_THEME_ID,
} from "@lib/themeCatalog";
import {
  THEME_FAVORITES_SETTING_KEY,
  useThemeFavoritesStore,
} from "@stores/themeFavoritesStore";
import { useThemeStore } from "@stores/themeStore";
import { invoke } from "@tauri-apps/api/core";
import ThemePicker from "./ThemePicker";

const invokeMock = vi.mocked(invoke);

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
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    localStorageMock.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mode");
    useThemeStore.getState().hydrate();
    // #2118 — the grid follows the favorites store now, so each case starts
    // from the seed list instead of the retired module-scope constant.
    useThemeFavoritesStore.setState({
      favoriteThemeIds: DEFAULT_FAVORITE_THEME_IDS,
      galleryOpen: false,
    });
  });

  it("renders a card for every favorite theme", () => {
    render(<ThemePicker />);
    const grid = screen.getByTestId("theme-picker-grid");
    const cards = within(grid).getAllByRole("button");
    expect(cards).toHaveLength(DEFAULT_FAVORITE_THEME_IDS.length);
    // Sanity: every rendered card's id is a favorite.
    const ids = cards.map((el) => el.getAttribute("data-theme-id"));
    for (const id of ids) {
      expect(DEFAULT_FAVORITE_THEME_IDS).toContain(id);
    }
  });

  // #2118 — the picker is driven by the store, not by a constant: a theme the
  // seed list never had shows up as soon as it is a favorite.
  it("renders a theme that is not in the seed list once it is a favorite", () => {
    expect(DEFAULT_FAVORITE_THEME_IDS).not.toContain("linear");
    useThemeFavoritesStore.setState({ favoriteThemeIds: ["linear"] });

    render(<ThemePicker />);

    const grid = screen.getByTestId("theme-picker-grid");
    const cards = within(grid).getAllByRole("button");
    expect(cards.map((el) => el.getAttribute("data-theme-id"))).toEqual([
      "linear",
    ]);
  });

  // #2118 read path. This picker's mount effect is the only production caller
  // of `hydrateFavorites`, so it is the whole of "the favorites I chose survive
  // a restart" — delete it and that guarantee dies silently. The assertion is
  // therefore what the user sees (cards in the grid) driven from the boundary
  // (the `get_setting` IPC), never a direct call into the store: calling the
  // store would keep passing with the effect gone. Same failure shape as
  // docs/archives/incidents/ui-patterns/2026-05-16-theme-selection-silent-fail.
  it("shows the persisted favorites after mount, not the seed list", async () => {
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      const key = (args as { key?: string } | undefined)?.key;
      if (cmd === "get_setting" && key === THEME_FAVORITES_SETTING_KEY) {
        return Promise.resolve(JSON.stringify(["linear", "figma"]));
      }
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<ThemePicker />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const grid = screen.getByTestId("theme-picker-grid");
    const ids = within(grid)
      .getAllByRole("button")
      .map((el) => el.getAttribute("data-theme-id"));
    // Rendered in catalog order, so `linear` precedes `figma`.
    expect(ids).toEqual(["linear", "figma"]);
    // The seed list is gone from the grid — the persisted value replaced it
    // rather than merging into it.
    for (const seeded of DEFAULT_FAVORITE_THEME_IDS) {
      expect(ids).not.toContain(seeded);
    }
  });

  // 수용 기준 4 — an empty favorites list must read as guidance, not as a
  // blank rectangle the user cannot interpret.
  it("shows guidance instead of a bare empty grid when nothing is starred", () => {
    useThemeFavoritesStore.setState({ favoriteThemeIds: [] });

    render(<ThemePicker />);

    expect(screen.getByTestId("theme-picker-empty")).toBeInTheDocument();
    const grid = screen.getByTestId("theme-picker-grid");
    expect(within(grid).queryAllByRole("button")).toHaveLength(0);
  });

  it("the browse-all button opens the gallery", () => {
    render(<ThemePicker />);
    expect(useThemeFavoritesStore.getState().galleryOpen).toBe(false);

    act(() => {
      fireEvent.click(screen.getByTestId("theme-picker-open-gallery"));
    });

    expect(useThemeFavoritesStore.getState().galleryOpen).toBe(true);
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
