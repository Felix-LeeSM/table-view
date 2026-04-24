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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          Appearance
        </span>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => {
            if (next) setMode(next as ThemeMode);
          }}
          aria-label="Appearance mode"
        >
          <ToggleGroupItem value="light" aria-label="Light mode">
            <Sun />
            Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" aria-label="Dark mode">
            <Moon />
            Dark
          </ToggleGroupItem>
          <ToggleGroupItem value="system" aria-label="System mode">
            <Monitor />
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
        className="grid max-h-[360px] grid-cols-2 gap-2 overflow-auto pr-1"
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
                  "flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active && "ring-2 ring-primary",
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: entry.swatch }}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-semibold text-foreground">
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
