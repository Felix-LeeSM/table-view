import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useThemeStore } from "@stores/themeStore";
import {
  FEATURED_THEME_IDS,
  THEME_CATALOG,
  type ThemeId,
} from "@lib/themeCatalog";
import { applyTheme, type ThemeMode } from "@lib/themeBoot";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { cn } from "@/lib/utils";

const FEATURED_ID_SET = new Set<ThemeId>(FEATURED_THEME_IDS);
const VISIBLE_THEMES = THEME_CATALOG.filter((entry) =>
  FEATURED_ID_SET.has(entry.id),
);

export default function ThemePicker() {
  const themeId = useThemeStore((s) => s.themeId);
  const mode = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setMode = useThemeStore((s) => s.setMode);
  const [previewId, setPreviewId] = useState<ThemeId | null>(null);

  // Preview wins over the stored theme — applyTheme only touches DOM attrs,
  // so hovering never pollutes the store or localStorage.
  useEffect(() => {
    applyTheme(previewId ?? themeId, mode);
  }, [previewId, themeId, mode]);

  // If the picker unmounts mid-preview (e.g. dropdown closes while hovering),
  // snap the DOM back to the persisted theme. Reads the live store so we
  // don't restore to a stale mount-time snapshot.
  useEffect(() => {
    return () => {
      const state = useThemeStore.getState();
      applyTheme(state.themeId, state.mode);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Appearance
        </span>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => {
            if (next) setMode(next as ThemeMode);
          }}
          aria-label="Appearance mode"
          className="w-full justify-between"
        >
          <ToggleGroupItem
            value="light"
            aria-label="Light mode"
            className="flex-1"
          >
            <Sun size={12} />
            Light
          </ToggleGroupItem>
          <ToggleGroupItem
            value="dark"
            aria-label="Dark mode"
            className="flex-1"
          >
            <Moon size={12} />
            Dark
          </ToggleGroupItem>
          <ToggleGroupItem
            value="system"
            aria-label="System mode"
            className="flex-1"
          >
            <Monitor size={12} />
            System
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div
        data-testid="theme-picker-grid"
        className="grid grid-cols-2 gap-1.5 p-0.5"
        onMouseLeave={() => setPreviewId(null)}
      >
        {VISIBLE_THEMES.map((entry) => {
          const active = entry.id === themeId;
          return (
            <button
              key={entry.id}
              type="button"
              data-active={active ? "true" : "false"}
              data-theme-id={entry.id}
              aria-label={`Theme ${entry.name}`}
              aria-pressed={active}
              onClick={() => setTheme(entry.id)}
              onMouseEnter={() => setPreviewId(entry.id)}
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-1 text-left transition-colors",
                "hover:bg-muted",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
                active && "ring-2 ring-inset ring-primary",
              )}
            >
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: entry.swatch }}
              />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-2xs font-semibold text-foreground">
                  {entry.name}
                </span>
                <span className="truncate text-3xs text-muted-foreground">
                  {entry.vibe}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
