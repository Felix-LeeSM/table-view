/**
 * #2118 — full-catalog theme gallery.
 *
 * The ThemePicker lives in a narrow popover (launcher footer, workspace
 * toolbar) where a two-column grid barely fits, so it can only show the user's
 * favorites. This overlay is where the whole `THEME_CATALOG` is browsable:
 * every entry gets a card that paints itself in its own tokens, the card body
 * applies the theme and closes, and the star toggles the favorite without
 * closing.
 *
 * Shape decided 2026-08-03 (issue #2118 「결정 기록」): a full-screen overlay in
 * the current window, not a new Tauri window (which would need window creation,
 * `document.title` sync and a `theme-sync` bridge seat) and not a workspace tab
 * (which the launcher cannot open, and the launcher mounts the picker too).
 *
 * Mounted by the pages, not by `ThemePicker`: the picker renders inside a Radix
 * Popover, and a popover that closes takes its subtree with it. Open state lives
 * in `themeFavoritesStore` so the picker's button can raise it from inside the
 * popover while the overlay itself stays mounted at page level.
 */

import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { Input } from "@components/ui/input";
import { THEME_CATALOG, type ThemeId } from "@lib/themeCatalog";
import { useThemeFavoritesStore } from "@stores/themeFavoritesStore";
import { useThemeStore } from "@stores/themeStore";
import { RotateCcw, Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Search haystack: id + display name + vibe, as the issue's 할 일 2 asks. */
function matches(
  entry: (typeof THEME_CATALOG)[number],
  lowerTerm: string,
): boolean {
  if (lowerTerm === "") return true;
  return `${entry.id} ${entry.name} ${entry.vibe}`
    .toLowerCase()
    .includes(lowerTerm);
}

export default function ThemeGallery() {
  const { t } = useTranslation();
  const open = useThemeFavoritesStore((s) => s.galleryOpen);
  const setGalleryOpen = useThemeFavoritesStore((s) => s.setGalleryOpen);
  const favoriteThemeIds = useThemeFavoritesStore((s) => s.favoriteThemeIds);
  const toggleFavorite = useThemeFavoritesStore((s) => s.toggleFavorite);
  const resetFavorites = useThemeFavoritesStore((s) => s.resetFavorites);
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  // Card previews follow the app's resolved mode, so a dark-mode user browses
  // the catalog in dark. `mode` may be `system`; `resolvedMode` never is.
  const resolvedMode = useThemeStore((s) => s.resolvedMode);

  const [term, setTerm] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const favoriteSet = new Set<ThemeId>(favoriteThemeIds);
  const lowerTerm = term.trim().toLowerCase();
  const visible = THEME_CATALOG.filter(
    (entry) =>
      (!favoritesOnly || favoriteSet.has(entry.id)) &&
      matches(entry, lowerTerm),
  );
  const activeEntry = THEME_CATALOG.find((entry) => entry.id === themeId);

  return (
    <Dialog open={open} onOpenChange={setGalleryOpen}>
      <DialogContent
        data-testid="theme-gallery"
        className="top-0 left-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-none"
      >
        <DialogHeader className="flex-wrap items-center gap-2 border-b border-border px-4 py-3 pr-12">
          <DialogTitle className="text-base">
            {t("theme.gallery.title")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("theme.gallery.description")}
          </DialogDescription>
          {activeEntry !== undefined && (
            <span className="text-xs text-muted-foreground">
              {t("theme.gallery.applied", { name: activeEntry.name })}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              aria-label={t("theme.gallery.searchLabel")}
              placeholder={t("theme.gallery.searchPlaceholder")}
              className="h-8 w-56"
            />
            <Button
              type="button"
              size="xs"
              variant={favoritesOnly ? "ghost" : "secondary"}
              aria-pressed={!favoritesOnly}
              onClick={() => setFavoritesOnly(false)}
            >
              {t("theme.gallery.filterAll")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant={favoritesOnly ? "secondary" : "ghost"}
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly(true)}
            >
              <Star size={12} aria-hidden="true" />
              {t("theme.gallery.filterFavorites")}
            </Button>
            {/* Reset affordance for the persisted favorites list —
                memory/product/memory.md §1 requires one in the same PR that
                adds the persistent state, and this overlay is where the user
                edits it. */}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                void resetFavorites();
              }}
              title={t("theme.gallery.resetTitle")}
            >
              <RotateCcw size={12} aria-hidden="true" />
              {t("theme.gallery.reset")}
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {visible.length === 0 ? (
            <p
              data-testid="theme-gallery-empty"
              className="py-8 text-center text-sm text-muted-foreground"
            >
              {t("theme.gallery.noMatch")}
            </p>
          ) : (
            <ul
              data-testid="theme-gallery-grid"
              className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
            >
              {visible.map((entry) => {
                const active = entry.id === themeId;
                const favorite = favoriteSet.has(entry.id);
                return (
                  <li key={entry.id} className="relative">
                    <button
                      type="button"
                      data-theme-id={entry.id}
                      data-active={active ? "true" : "false"}
                      aria-label={t("theme.gallery.apply", {
                        name: entry.name,
                      })}
                      aria-pressed={active}
                      onClick={() => {
                        void setTheme(entry.id);
                        setGalleryOpen(false);
                      }}
                      className={cn(
                        "flex w-full flex-col overflow-hidden rounded-lg border border-border text-left transition-colors",
                        "hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                        active && "ring-2 ring-primary",
                      )}
                    >
                      {/* The preview repaints itself: `themes.css` selectors are
                          `[data-theme][data-mode]` on any element, not just
                          :root, and the Tailwind colour utilities below read the
                          same `--tv-*` custom properties, which inherit into
                          this subtree. */}
                      <span
                        data-theme={entry.id}
                        data-mode={resolvedMode}
                        aria-hidden="true"
                        className="flex h-20 w-full bg-background"
                      >
                        <span className="flex w-1/4 flex-col gap-1 border-r border-border bg-muted p-1.5">
                          <span className="h-1 w-full rounded-full bg-primary" />
                          <span className="h-1 w-3/4 rounded-full bg-muted-foreground/40" />
                          <span className="h-1 w-2/3 rounded-full bg-muted-foreground/40" />
                        </span>
                        <span className="flex flex-1 flex-col gap-1 p-1.5">
                          <span className="h-1.5 w-1/3 rounded-sm bg-primary" />
                          <span className="h-1 w-full rounded-full bg-muted-foreground/50" />
                          <span className="h-1 w-5/6 rounded-full bg-muted-foreground/40" />
                          <span className="h-1 w-2/3 rounded-full bg-muted-foreground/30" />
                          <span className="h-1 w-3/4 rounded-full bg-muted-foreground/20" />
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5 bg-background px-2 py-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {entry.name}
                        </span>
                        <span className="truncate text-3xs text-muted-foreground">
                          {entry.vibe}
                        </span>
                        <span className="truncate font-mono text-3xs text-muted-foreground/70">
                          {entry.id}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      data-star-for={entry.id}
                      aria-pressed={favorite}
                      aria-label={
                        favorite
                          ? t("theme.gallery.removeFavorite", {
                              name: entry.name,
                            })
                          : t("theme.gallery.addFavorite", { name: entry.name })
                      }
                      onClick={() => {
                        void toggleFavorite(entry.id);
                      }}
                      className={cn(
                        "absolute top-1.5 right-1.5 rounded-md border border-border bg-background/90 p-1 text-muted-foreground transition-colors",
                        "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                        favorite && "text-primary",
                      )}
                    >
                      <Star
                        size={14}
                        aria-hidden="true"
                        fill={favorite ? "currentColor" : "none"}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
