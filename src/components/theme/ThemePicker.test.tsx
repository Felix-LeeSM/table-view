import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import ThemePicker from "./ThemePicker";
import { useThemeStore } from "@stores/themeStore";
import { THEME_CATALOG, DEFAULT_THEME_ID } from "@lib/themeCatalog";
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

  it("renders a card for every entry in THEME_CATALOG", () => {
    render(<ThemePicker />);
    const grid = screen.getByTestId("theme-picker-grid");
    const cards = within(grid).getAllByRole("button");
    expect(cards).toHaveLength(THEME_CATALOG.length);
    expect(THEME_CATALOG.length).toBe(72);
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

  it("clicking a card calls setTheme without closing (store themeId updates)", () => {
    render(<ThemePicker />);
    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);

    const card = screen.getByRole("button", { name: /theme github primer/i });
    act(() => {
      fireEvent.click(card);
    });

    expect(useThemeStore.getState().themeId).toBe("github");
    // Picker itself is still mounted — clicking a card must not unmount.
    expect(screen.getByTestId("theme-picker-grid")).toBeInTheDocument();
  });

  it("mode toggle buttons change the store mode", () => {
    render(<ThemePicker />);
    expect(useThemeStore.getState().mode).toBe("system");

    const lightBtn = screen.getByRole("radio", { name: /light mode/i });
    act(() => {
      fireEvent.click(lightBtn);
    });
    expect(useThemeStore.getState().mode).toBe("light");

    const darkBtn = screen.getByRole("radio", { name: /dark mode/i });
    act(() => {
      fireEvent.click(darkBtn);
    });
    expect(useThemeStore.getState().mode).toBe("dark");
  });

  it("search filters out non-matching cards", () => {
    render(<ThemePicker />);
    const grid = screen.getByTestId("theme-picker-grid");
    expect(within(grid).getAllByRole("button")).toHaveLength(
      THEME_CATALOG.length,
    );

    const input = screen.getByLabelText(/search themes/i);
    act(() => {
      fireEvent.change(input, { target: { value: "mong" } });
    });

    const remaining = within(grid).getAllByRole("button");
    expect(remaining.length).toBeLessThan(THEME_CATALOG.length);
    // MongoDB must survive the "mong" filter.
    expect(
      remaining.some((el) => el.getAttribute("data-theme-id") === "mongodb"),
    ).toBe(true);
  });

  it("search is case-insensitive and matches id / name / vibe", () => {
    render(<ThemePicker />);
    const input = screen.getByLabelText(/search themes/i);
    const grid = screen.getByTestId("theme-picker-grid");

    // Matches name ("GitHub Primer")
    act(() => {
      fireEvent.change(input, { target: { value: "GITHUB" } });
    });
    const githubHits = within(grid).getAllByRole("button");
    expect(
      githubHits.some((el) => el.getAttribute("data-theme-id") === "github"),
    ).toBe(true);

    // Matches vibe ("enterprise")
    act(() => {
      fireEvent.change(input, { target: { value: "enterprise" } });
    });
    const vibeHits = within(grid).getAllByRole("button");
    expect(
      vibeHits.some((el) => el.getAttribute("data-theme-id") === "ibm"),
    ).toBe(true);
  });

  it("shows the 'No themes match' placeholder when search has no results", () => {
    render(<ThemePicker />);
    const input = screen.getByLabelText(/search themes/i);
    act(() => {
      fireEvent.change(input, { target: { value: "zzzz-never-matches" } });
    });

    expect(screen.getByText(/no themes match/i)).toBeInTheDocument();
    const grid = screen.getByTestId("theme-picker-grid");
    expect(within(grid).queryAllByRole("button")).toHaveLength(0);
  });
});
