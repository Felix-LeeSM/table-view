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
});
