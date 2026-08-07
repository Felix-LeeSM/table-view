/**
 * #2118 — full-catalog gallery overlay.
 *
 * User path being locked:
 *   - user opens the picker, presses "browse all themes"
 *   - the whole catalog is there, filterable by name / id / vibe
 *   - every card previews itself in its own theme, in the mode being browsed
 *   - starring a theme puts it in the picker and writes it to SQLite
 *   - clicking a card applies that theme and closes the overlay
 *
 * `@tauri-apps/api/core` is the only mock (the settings wrapper's boundary).
 * The catalog, both stores and the picker are real, so a broken store wiring
 * fails here instead of being papered over by a component mock.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  DEFAULT_FAVORITE_THEME_IDS,
  DEFAULT_THEME_ID,
  THEME_CATALOG,
} from "@lib/themeCatalog";
import {
  THEME_FAVORITES_SETTING_KEY,
  useThemeFavoritesStore,
} from "@stores/themeFavoritesStore";
import { useThemeStore } from "@stores/themeStore";
import { invoke } from "@tauri-apps/api/core";
import ThemeGallery from "./ThemeGallery";
import ThemePicker from "./ThemePicker";

const invokeMock = vi.mocked(invoke);

interface PersistRequestBody {
  req: { key: string; valueJson: string };
}

/** Render the picker and the overlay together, then open the overlay. */
function renderWithGalleryOpen(): void {
  render(
    <>
      <ThemePicker />
      <ThemeGallery />
    </>,
  );
  act(() => {
    fireEvent.click(screen.getByTestId("theme-picker-open-gallery"));
  });
}

function galleryCards(): HTMLElement[] {
  return within(screen.getByTestId("theme-gallery-grid")).getAllByRole(
    "listitem",
  );
}

function cardIds(): (string | null)[] {
  return galleryCards().map(
    (li) =>
      li.querySelector("[data-theme-id]")?.getAttribute("data-theme-id") ??
      null,
  );
}

/**
 * Each card's preview swatch, read through the attribute under test. The
 * swatch is `aria-hidden` decoration with no role or text, so the attribute is
 * the handle — and a deleted attribute surfaces as `null` for every card
 * rather than the query quietly matching something else.
 */
function previewAttrs(attr: "data-theme" | "data-mode"): (string | null)[] {
  return galleryCards().map(
    (li) => li.querySelector(`[${attr}]`)?.getAttribute(attr) ?? null,
  );
}

function typeInSearch(value: string): void {
  const input = screen.getByRole("searchbox", { name: /filter themes/i });
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
  useThemeStore.setState({
    themeId: DEFAULT_THEME_ID,
    mode: "light",
    resolvedMode: "light",
  });
  useThemeFavoritesStore.setState({
    favoriteThemeIds: DEFAULT_FAVORITE_THEME_IDS,
    galleryOpen: false,
  });
});

describe("ThemeGallery — the whole catalog is reachable", () => {
  // 수용 기준 1 — counted against THEME_CATALOG itself so a catalog change
  // (e.g. #2117 adding entries) cannot make this test lie.
  it("renders a card for every catalog entry", () => {
    renderWithGalleryOpen();

    expect(galleryCards()).toHaveLength(THEME_CATALOG.length);
    expect(cardIds()).toEqual(THEME_CATALOG.map((entry) => entry.id));
  });

  it("includes entries the picker's seed favorites never had", () => {
    expect(DEFAULT_FAVORITE_THEME_IDS).not.toContain("linear");
    renderWithGalleryOpen();

    expect(cardIds()).toContain("linear");
  });
});

describe("ThemeGallery — search and filter", () => {
  it("filters by display name", () => {
    renderWithGalleryOpen();
    typeInSearch("GitHub Primer");
    expect(cardIds()).toEqual(["github"]);
  });

  it("filters by id", () => {
    renderWithGalleryOpen();
    typeInSearch("kraken");
    expect(cardIds()).toEqual(["kraken"]);
  });

  it("filters by vibe", () => {
    // "fintech gradient" is Stripe's vibe; the string is in no id or name.
    renderWithGalleryOpen();
    typeInSearch("fintech");
    expect(cardIds()).toEqual(["stripe"]);
  });

  it("shows an empty-state line when nothing matches", () => {
    renderWithGalleryOpen();
    typeInSearch("zzzz-no-such-theme");

    expect(screen.getByTestId("theme-gallery-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("theme-gallery-grid")).toBeNull();
  });

  it("the favorites chip narrows the grid to starred themes", () => {
    renderWithGalleryOpen();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^favorites$/i }));
    });

    expect(cardIds()).toEqual(
      THEME_CATALOG.filter((e) =>
        DEFAULT_FAVORITE_THEME_IDS.includes(e.id),
      ).map((e) => e.id),
    );
  });

  // Without this the filter is one-way: a user who narrowed to favorites can
  // never get back to the rest of the catalog, which is the exact dead end
  // #2118 exists to remove. The favorites-chip case above passes either way,
  // because it never asks the grid to widen again.
  it("the all chip widens the grid back to the whole catalog", () => {
    renderWithGalleryOpen();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^favorites$/i }));
    });
    expect(cardIds().length).toBeLessThan(THEME_CATALOG.length);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^all$/i }));
    });

    expect(cardIds()).toEqual(THEME_CATALOG.map((entry) => entry.id));
  });
});

describe("ThemeGallery — starring", () => {
  // 수용 기준 2.
  it("starring a theme in the gallery puts it in the picker", async () => {
    expect(DEFAULT_FAVORITE_THEME_IDS).not.toContain("linear");
    renderWithGalleryOpen();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Add Linear to favorites" }),
      );
      await Promise.resolve();
    });

    // The user closes the overlay and looks at the picker.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    });

    const grid = screen.getByTestId("theme-picker-grid");
    const pickerIds = within(grid)
      .getAllByRole("button")
      .map((el) => el.getAttribute("data-theme-id"));
    expect(pickerIds).toContain("linear");
  });

  // 수용 기준 3.
  it("starring persists the new list through the persist_setting IPC", async () => {
    renderWithGalleryOpen();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Add Linear to favorites" }),
      );
      await Promise.resolve();
    });

    const persistCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === "persist_setting",
    );
    expect(persistCalls).toHaveLength(1);
    const body = persistCalls[0]![1] as unknown as PersistRequestBody;
    expect(body.req.key).toBe(THEME_FAVORITES_SETTING_KEY);
    expect(JSON.parse(body.req.valueJson)).toEqual([
      ...DEFAULT_FAVORITE_THEME_IDS,
      "linear",
    ]);
  });

  it("unstarring a seed favorite removes it from the picker", async () => {
    renderWithGalleryOpen();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Remove GitHub Primer from favorites",
        }),
      );
      await Promise.resolve();
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    });

    const grid = screen.getByTestId("theme-picker-grid");
    const pickerIds = within(grid)
      .getAllByRole("button")
      .map((el) => el.getAttribute("data-theme-id"));
    expect(pickerIds).not.toContain("github");
  });

  it("starring does not close the overlay", async () => {
    renderWithGalleryOpen();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Add Linear to favorites" }),
      );
      await Promise.resolve();
    });

    expect(screen.getByTestId("theme-gallery")).toBeInTheDocument();
    expect(useThemeFavoritesStore.getState().galleryOpen).toBe(true);
  });

  it("the reset button puts the favorites back to the catalog defaults", async () => {
    useThemeFavoritesStore.setState({ favoriteThemeIds: ["linear"] });
    renderWithGalleryOpen();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reset favorites/i }));
      await Promise.resolve();
    });

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).toEqual(
      DEFAULT_FAVORITE_THEME_IDS,
    );
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "reset_setting"),
    ).toHaveLength(1);
  });
});

describe("ThemeGallery — applying", () => {
  it("clicking a card applies that theme to the document and closes the overlay", async () => {
    renderWithGalleryOpen();
    expect(document.documentElement.getAttribute("data-theme")).not.toBe(
      "linear",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply Linear" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // user-facing invariant: the DOM attribute the themes.css selectors key on.
    expect(document.documentElement.getAttribute("data-theme")).toBe("linear");
    expect(useThemeStore.getState().themeId).toBe("linear");
    expect(useThemeFavoritesStore.getState().galleryOpen).toBe(false);
    expect(screen.queryByTestId("theme-gallery")).toBeNull();
  });

  it("applying a theme does not star it", async () => {
    renderWithGalleryOpen();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply Linear" }));
      await Promise.resolve();
    });

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).not.toContain(
      "linear",
    );
  });
});

/**
 * #2200 — the preview swatch is the gallery's whole point. `src/themes.css`
 * keys on `[data-theme][data-mode]` on any element, not just `:root`, and the
 * Tailwind colour utilities in the card read the `--tv-*` custom properties
 * those selectors set, which inherit into the subtree. Drop either attribute
 * and the gallery still renders, still filters, still applies — every card
 * just paints in the app's current theme, so "see it before you pick it"
 * silently stops working. The issue carries the command showing that nothing
 * asserted them.
 */
describe("ThemeGallery — each card previews its own theme", () => {
  it("carries that card's theme id on its preview", () => {
    renderWithGalleryOpen();

    expect(previewAttrs("data-theme")).toEqual(
      THEME_CATALOG.map((entry) => entry.id),
    );
  });

  // Both modes, because the property is "follows the app's resolved mode":
  // asserting one mode alone is also satisfied by a hardcoded literal.
  it("follows the app's resolved mode on its preview", () => {
    renderWithGalleryOpen();

    expect(previewAttrs("data-mode")).toEqual(THEME_CATALOG.map(() => "light"));

    act(() => {
      useThemeStore.setState({ mode: "dark", resolvedMode: "dark" });
    });

    expect(previewAttrs("data-mode")).toEqual(THEME_CATALOG.map(() => "dark"));
  });
});
