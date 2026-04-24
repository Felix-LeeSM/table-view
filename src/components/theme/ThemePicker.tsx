import { useMemo, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useThemeStore } from "@stores/themeStore";
import { THEME_CATALOG, type ThemeId } from "@lib/themeCatalog";
import type { ThemeMode } from "@lib/themeBoot";
import { Input } from "@components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { cn } from "@/lib/utils";

export default function ThemePicker() {
  const themeId = useThemeStore((s) => s.themeId);
  const mode = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setMode = useThemeStore((s) => s.setMode);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!query) return THEME_CATALOG;
    return THEME_CATALOG.filter(
      (entry) =>
        entry.id.toLowerCase().includes(query) ||
        entry.name.toLowerCase().includes(query) ||
        entry.vibe.toLowerCase().includes(query),
    );
  }, [query]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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

      <Input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search themes..."
        aria-label="Search themes"
        className="h-8 text-xs"
      />

      <div
        data-testid="theme-picker-grid"
        className="grid max-h-[320px] grid-cols-2 gap-1.5 overflow-y-auto overflow-x-hidden p-0.5"
      >
        {visible.length === 0 ? (
          <div className="col-span-2 py-8 text-center text-xs text-muted-foreground">
            No themes match
          </div>
        ) : (
          visible.map((entry) => {
            const active = entry.id === themeId;
            return (
              <button
                key={entry.id}
                type="button"
                data-active={active ? "true" : "false"}
                data-theme-id={entry.id}
                aria-label={`Theme ${entry.name}`}
                aria-pressed={active}
                onClick={() => setTheme(entry.id as ThemeId)}
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
                  <span className="truncate text-[11px] font-semibold text-foreground">
                    {entry.name}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {entry.vibe}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
