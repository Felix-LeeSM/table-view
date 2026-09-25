// Verifies the ThemePicker component's click / hover / mode-toggle. Since
// `setTheme` / `setMode` are async actions that call IPC and the click handler
// does not await the promise, the tests flush microtasks with
// `Promise.resolve()` before asserting. `@tauri-apps/api/core` is mocked to
// resolve immediately.

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

  // Acceptance criterion 4 — an empty favorites list must read as guidance,
  // not as a blank rectangle the user cannot interpret.
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

  // User report: "the theme won't get selected. The preview works, but
  // selecting doesn't." The earlier click test locked only
  // `useThemeStore.getState().themeId` (store state) and never checked the
  // user-facing invariant — that the DOM `data-theme` attribute really changes
  // to the clicked id. First application of the new feedback rule
  // (feedback_test_scenarios_user_journey): follow the path to the fact the
  // user sees (the DOM attribute that drives the CSS variable) and lock that,
  // not a mock assertion.
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

    // user-facing invariant: the DOM attribute changes → the CSS
    // [data-theme="github"] selector applies in the cascade → the color the
    // user sees is the github theme.
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

  // User request: "I'd like light and dark to preview on mouse hover too."
  // Hovering a mode toggle applies only the mode temporarily → the DOM
  // `data-mode` changes to the hovered mode (the store is untouched). Same
  // preview pattern as card hover.
  it("hovering the light mode toggle previews data-mode='light' without touching the store", () => {
    // Initial: system mode (the test environment's prefers-color-scheme
    // default).
    render(<ThemePicker />);
    const initialStoreMode = useThemeStore.getState().mode;

    const lightBtn = screen.getByRole("radio", { name: /light mode/i });
    act(() => {
      fireEvent.mouseEnter(lightBtn);
    });

    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
    // The store is untouched — the preview is DOM-only.
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
    // Back to the initial store mode — system's resolved mode (jsdom
    // prefers-color-scheme).
    const resolved = useThemeStore.getState().resolvedMode;
    expect(document.documentElement.getAttribute("data-mode")).toBe(resolved);
  });
});
