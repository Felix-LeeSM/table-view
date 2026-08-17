import LanguageSwitcher from "@components/theme/LanguageSwitcher";
import ThemePicker from "@components/theme/ThemePicker";
import { Button } from "@components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import { THEME_CATALOG } from "@lib/themeCatalog";
import { useThemeStore } from "@stores/themeStore";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Theme + language popover for the workspace window.
 *
 * #1738 made this the ONLY place the workspace exposes either setting (the
 * duplicate sidebar-footer copy was deleted then), and #2431 moved it here
 * from the sidebar column's header strip — that strip only outlived a sidebar
 * collapse because losing it would have stranded the user with no theme or
 * language control at all.
 *
 * Trigger shape: swatch + mode icon, so the button itself reports the active
 * theme and mode. The swatch is why this one is `size="sm"` (auto width) while
 * the toolbar's other icon controls are square.
 *
 * Roving tabindex: the trigger is a plain `<button>`, so `useToolbarRoving`
 * picks it up as one more toolbar stop with no wiring. Radix portals
 * `PopoverContent` to `<body>`, so the popover's own key handling never
 * bubbles into the toolbar's `onKeyDown` — `RowCapSetting` is the same shape
 * and that hook's doc names it.
 *
 * `ThemeGallery` is deliberately NOT rendered here. `ThemePicker`'s "browse
 * all" button raises `themeFavoritesStore.galleryOpen`, and a gallery mounted
 * under `PopoverContent` would unmount the instant the popover closed (#2118);
 * `WorkspacePage` owns that mount.
 *
 * i18n: the `pages` namespace, matching `BackToConnectionsButton` — the keys
 * are already workspace-specific (`workspaceThemeAria`) and copying them into
 * `workspace` would leave two strings to keep in step.
 */
export default function AppearanceButton() {
  const { t } = useTranslation("pages");
  const themeId = useThemeStore((s) => s.themeId);
  const themeMode = useThemeStore((s) => s.mode);

  const activeEntry =
    THEME_CATALOG.find((entry) => entry.id === themeId) ?? THEME_CATALOG[0];
  const ThemeIcon =
    themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="text-muted-foreground hover:text-secondary-foreground"
          aria-label={t("workspaceThemeAria", {
            name: activeEntry.name,
            mode: themeMode,
          })}
          title={t("changeTheme")}
        >
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: activeEntry.swatch }}
          />
          <ThemeIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={4}
        collisionPadding={8}
        className="w-72 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-2"
      >
        <div className="flex flex-col gap-2">
          <ThemePicker />
          <LanguageSwitcher />
        </div>
      </PopoverContent>
    </Popover>
  );
}
