/**
 * #2118 — theme favorites store contract.
 *
 * User path being locked (the scenario, not the call graph):
 *   - user opens the theme gallery and stars a theme that was not in the picker
 *   - the star fills immediately and the picker gains that theme
 *   - the choice survives a restart, because it went to SQLite
 *
 * So the assertions are: the store's own `favoriteThemeIds` (what the picker
 * renders from) plus the one boundary this store owns — the `persist_setting` /
 * `reset_setting` / `get_setting` IPC. `@tauri-apps/api/core` is the only mock;
 * the store, the catalog and the parser are the real thing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { DEFAULT_FAVORITE_THEME_IDS, isThemeId } from "@lib/themeCatalog";
import { useToastStore } from "@stores/toastStore";
import { invoke } from "@tauri-apps/api/core";
import {
  parseFavoriteThemeIds,
  THEME_FAVORITES_SETTING_KEY,
  useThemeFavoritesStore,
} from "./themeFavoritesStore";

const invokeMock = vi.mocked(invoke);

interface PersistRequestBody {
  req: { key: string; valueJson: string };
}

/** The `persist_setting` payloads this test's action produced, decoded. */
function persistedFavoriteLists(): unknown[] {
  return invokeMock.mock.calls
    .filter((call) => call[0] === "persist_setting")
    .map((call) => {
      const body = call[1] as unknown as PersistRequestBody;
      expect(body.req.key).toBe(THEME_FAVORITES_SETTING_KEY);
      return JSON.parse(body.req.valueJson);
    });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  useThemeFavoritesStore.setState({
    favoriteThemeIds: DEFAULT_FAVORITE_THEME_IDS,
    galleryOpen: false,
  });
});

/**
 * What `FEATURED_THEME_IDS` held on `main` at 45dfbf40, the commit this branch
 * forked from — i.e. exactly the cards the picker offered before #2118.
 * Reproduce with:
 *   git show 45dfbf40:src/lib/themeCatalog.ts | sed -n '/FEATURED_THEME_IDS/,/^\];/p'
 */
const PICKER_IDS_BEFORE_2118 = [
  "slate",
  "github",
  "arc",
  "claude",
  "darcula",
  "posthog",
  "ibm",
  "kraken",
] as const;

describe("themeFavoritesStore — seed", () => {
  // `getInitialState()` and not `getState()`: the `beforeEach` above seeds the
  // store, so `getState()` would keep passing even if the store's own initial
  // value were emptied.
  it("starts from the catalog's default favorite ids", () => {
    expect(useThemeFavoritesStore.getInitialState().favoriteThemeIds).toEqual(
      DEFAULT_FAVORITE_THEME_IDS,
    );
  });

  it("starts with the gallery closed", () => {
    expect(useThemeFavoritesStore.getInitialState().galleryOpen).toBe(false);
  });

  // The compatibility claim of #2118 — an existing user sees no change on
  // upgrade — rests entirely on this list being the pre-#2118 one. Nothing else
  // in the suite notices if the seed is edited, because every other case reads
  // it as "whatever the store starts with" rather than as a fixed list.
  it("seeds with exactly the ids the pre-#2118 picker offered", () => {
    expect(DEFAULT_FAVORITE_THEME_IDS).toEqual(PICKER_IDS_BEFORE_2118);
  });

  it("seeds only ids the catalog still has", () => {
    // A seed id the catalog dropped would render a card with no themes.css
    // selector behind it.
    expect(DEFAULT_FAVORITE_THEME_IDS.filter((id) => !isThemeId(id))).toEqual(
      [],
    );
  });
});

describe("themeFavoritesStore — toggleFavorite", () => {
  it("adds a theme the user had not starred and persists the new list", async () => {
    // `linear` is a catalog entry outside the seed list — the exact case the
    // old picker could not reach.
    expect(DEFAULT_FAVORITE_THEME_IDS).not.toContain("linear");

    await useThemeFavoritesStore.getState().toggleFavorite("linear");

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).toContain(
      "linear",
    );
    expect(persistedFavoriteLists()).toEqual([
      [...DEFAULT_FAVORITE_THEME_IDS, "linear"],
    ]);
  });

  it("removes a starred theme and persists the shortened list", async () => {
    const [first] = DEFAULT_FAVORITE_THEME_IDS;
    expect(first).toBeDefined();

    await useThemeFavoritesStore.getState().toggleFavorite(first!);

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).not.toContain(
      first,
    );
    expect(persistedFavoriteLists()).toEqual([
      DEFAULT_FAVORITE_THEME_IDS.filter((id) => id !== first),
    ]);
  });

  it("keeps the optimistic list and does not throw when the IPC rejects", async () => {
    // #1092 — the store applies first and surfaces the failure elsewhere
    // (logger + toast); it must not roll the user's star back under them.
    invokeMock.mockRejectedValueOnce(new Error("forced fail"));

    await expect(
      useThemeFavoritesStore.getState().toggleFavorite("linear"),
    ).resolves.toBeUndefined();

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).toContain(
      "linear",
    );
    // The user has to learn the write was lost — there is no boot reconcile
    // that would repair it, so a silent swallow loses the choice at next boot.
    expect(useToastStore.getState().toasts.map((t) => t.variant)).toContain(
      "error",
    );
  });
});

describe("themeFavoritesStore — resetFavorites", () => {
  it("returns to the defaults and deletes the persisted row", async () => {
    useThemeFavoritesStore.setState({ favoriteThemeIds: ["linear"] });

    await useThemeFavoritesStore.getState().resetFavorites();

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).toEqual(
      DEFAULT_FAVORITE_THEME_IDS,
    );
    const resetCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === "reset_setting",
    );
    expect(resetCalls).toEqual([
      ["reset_setting", { key: THEME_FAVORITES_SETTING_KEY }],
    ]);
    // Writing the defaults back would defeat the row-delete contract
    // documented on `resetSetting` in src/lib/tauri/settings.ts.
    expect(persistedFavoriteLists()).toEqual([]);
  });

  // The reset button's click handler is a fire-and-forget `void
  // resetFavorites()`, so a rejection that escapes this action becomes an
  // unhandled promise: the user is told nothing while the row survives on disk.
  // Only the toast makes that visible, so the toast is what gets asserted.
  it("surfaces a failed reset instead of letting the rejection escape", async () => {
    useThemeFavoritesStore.setState({ favoriteThemeIds: ["linear"] });
    invokeMock.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      useThemeFavoritesStore.getState().resetFavorites(),
    ).resolves.toBeUndefined();

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).toEqual(
      DEFAULT_FAVORITE_THEME_IDS,
    );
    expect(useToastStore.getState().toasts.map((t) => t.variant)).toContain(
      "error",
    );
  });
});

describe("themeFavoritesStore — hydrateFavorites", () => {
  it("adopts the persisted list", async () => {
    invokeMock.mockResolvedValue(JSON.stringify(["linear", "figma"]));

    await useThemeFavoritesStore.getState().hydrateFavorites();

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).toEqual([
      "linear",
      "figma",
    ]);
  });

  it("adopts an empty persisted list — the user who unstarred everything keeps an empty picker", async () => {
    invokeMock.mockResolvedValue("[]");

    await useThemeFavoritesStore.getState().hydrateFavorites();

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).toEqual([]);
  });

  it("drops ids that are not in the catalog", async () => {
    // A downgrade or a hand-edited SQLite row can name a theme this build has
    // no `themes.css` selector for; rendering it would paint an unstyled card.
    invokeMock.mockResolvedValue(JSON.stringify(["linear", "not-a-theme"]));

    await useThemeFavoritesStore.getState().hydrateFavorites();

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).toEqual([
      "linear",
    ]);
  });

  it.each([
    ["missing key", null],
    ["not JSON", "{oops"],
    ["JSON that is not an array", '{"themeId":"linear"}'],
  ])("keeps the current list when the stored value is %s", async (_l, raw) => {
    invokeMock.mockResolvedValue(raw);

    await useThemeFavoritesStore.getState().hydrateFavorites();

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).toEqual(
      DEFAULT_FAVORITE_THEME_IDS,
    );
  });

  it("keeps the current list when the read itself rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no backend"));

    await expect(
      useThemeFavoritesStore.getState().hydrateFavorites(),
    ).resolves.toBeUndefined();

    expect(useThemeFavoritesStore.getState().favoriteThemeIds).toEqual(
      DEFAULT_FAVORITE_THEME_IDS,
    );
  });
});

describe("parseFavoriteThemeIds", () => {
  it("de-duplicates repeated ids", () => {
    expect(parseFavoriteThemeIds('["linear","linear","figma"]')).toEqual([
      "linear",
      "figma",
    ]);
  });

  it("returns null for a non-array so callers can tell it from an empty list", () => {
    expect(parseFavoriteThemeIds('"linear"')).toBeNull();
    expect(parseFavoriteThemeIds("[]")).toEqual([]);
  });
});
