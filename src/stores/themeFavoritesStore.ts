/**
 * #2118 — theme favorites store.
 *
 * The ThemePicker used to filter `THEME_CATALOG` by the hard-coded
 * `FEATURED_THEME_IDS` constant, so the rest of the catalog was reachable only
 * by hand-editing SQLite. The picker now renders whatever the user starred, and
 * the full catalog is browsable in `ThemeGallery`.
 *
 * Persistence follows `themeStore.persistThemeSetting` (sprint-368): the same
 * `persist_setting` IPC via `persistSettingValue`, no new backend command. The
 * write is optimistic — mutate the store first so the star flips under the
 * user's cursor, then fire the IPC and surface a rejection as `logger.warn` +
 * error toast (#1092: there is no boot reconcile that would repair a lost
 * write, so it must be visible).
 *
 * Boot hydration is the `RowCapSetting` shape (#1231): the consumer reads the
 * key with `getSetting` on mount rather than riding the atomic boot snapshot,
 * which only carries the five boot-critical stores and is backend-owned.
 *
 * ponytail: no cross-window `state-changed` route. The favorites list is not
 * boot-critical and a second window converges on its next picker open. Add a
 * `settingsReceiver` branch for `theme_favorites` if two open windows drifting
 * for one session turns out to matter.
 */

import i18n from "@lib/i18n";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import {
  getSetting,
  persistSettingValue,
  resetSetting,
} from "@lib/tauri/settings";
import {
  DEFAULT_FAVORITE_THEME_IDS,
  isThemeId,
  type ThemeId,
} from "@lib/themeCatalog";
import { create } from "zustand";

/** SQLite `settings` key holding the user's starred theme ids (JSON array). */
export const THEME_FAVORITES_SETTING_KEY = "theme_favorites";

export interface ThemeFavoritesState {
  /** Starred ids, in the order the user starred them. */
  favoriteThemeIds: readonly ThemeId[];
  /**
   * Session-only: whether the full-catalog overlay is open. Deliberately not
   * persisted and not broadcast — an open dialog is not durable state
   * (`memory/engineering/conventions/frontend/memory.md` 「State 경계」).
   */
  galleryOpen: boolean;

  /** Star / unstar one theme. Optimistic, then persists the whole list. */
  toggleFavorite: (themeId: ThemeId) => Promise<void>;
  /** Back to `DEFAULT_FAVORITE_THEME_IDS` + delete the persisted row. */
  resetFavorites: () => Promise<void>;
  /** Read the persisted list. Missing / unreadable value keeps the current one. */
  hydrateFavorites: () => Promise<void>;
  setGalleryOpen: (open: boolean) => void;
}

/**
 * Parse the persisted value. Returns `null` when the caller should keep what it
 * has (key absent, not JSON, not an array); returns a list otherwise — and an
 * empty list is a real answer, not a fallback trigger: a user who unstarred
 * everything must get an empty picker with its guidance, not the seed list back.
 * Unknown ids are dropped so a downgrade or a hand-edited row cannot put a
 * `data-theme` with no matching `themes.css` selector into the picker.
 */
export function parseFavoriteThemeIds(raw: string): ThemeId[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const seen = new Set<ThemeId>();
  for (const entry of parsed) {
    if (isThemeId(entry)) seen.add(entry);
  }
  return [...seen];
}

async function persistFavorites(ids: readonly ThemeId[]): Promise<void> {
  try {
    await persistSettingValue(THEME_FAVORITES_SETTING_KEY, ids);
  } catch (e) {
    logger.warn(
      "[themeFavoritesStore] persist_setting failed (UI already applied):",
      e instanceof Error ? e.message : e,
    );
    toast.error(i18n.t("feedback:storageWriteFailed"));
  }
}

export const useThemeFavoritesStore = create<ThemeFavoritesState>()(
  (set, get) => ({
    favoriteThemeIds: DEFAULT_FAVORITE_THEME_IDS,
    galleryOpen: false,

    toggleFavorite: async (themeId) => {
      const current = get().favoriteThemeIds;
      const next = current.includes(themeId)
        ? current.filter((id) => id !== themeId)
        : [...current, themeId];
      set({ favoriteThemeIds: next });
      await persistFavorites(next);
    },

    resetFavorites: async () => {
      set({ favoriteThemeIds: DEFAULT_FAVORITE_THEME_IDS });
      // `resetSetting` deletes the row; pairing it with a `persistSettingValue`
      // of the defaults would write them straight back (see the contract note
      // on `resetSetting` in `src/lib/tauri/settings.ts`).
      try {
        await resetSetting(THEME_FAVORITES_SETTING_KEY);
      } catch (e) {
        logger.warn(
          "[themeFavoritesStore] reset_setting failed (UI already applied):",
          e instanceof Error ? e.message : e,
        );
        toast.error(i18n.t("feedback:storageWriteFailed"));
      }
    },

    hydrateFavorites: async () => {
      try {
        const raw: unknown = await getSetting(THEME_FAVORITES_SETTING_KEY);
        // Not `=== null`: the key may be absent, and an IPC boundary can hand
        // back any shape at runtime. Anything but a string means "no answer".
        if (typeof raw !== "string") return;
        const parsed = parseFavoriteThemeIds(raw);
        if (parsed === null) return;
        set({ favoriteThemeIds: parsed });
      } catch (e) {
        logger.warn(
          "[themeFavoritesStore] get_setting failed, keeping current favorites:",
          e instanceof Error ? e.message : e,
        );
      }
    },

    setGalleryOpen: (open) => {
      set({ galleryOpen: open });
    },
  }),
);
