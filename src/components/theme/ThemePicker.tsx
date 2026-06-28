import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const themeId = useThemeStore((s) => s.themeId);
  const mode = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setMode = useThemeStore((s) => s.setMode);
  const [previewId, setPreviewId] = useState<ThemeId | null>(null);
  // 2026-05-16 — light/dark/system 토글 hover 시 DOM 의 `data-mode` 만
  // 일시 변경 (store 는 그대로). 카드 hover preview 와 동일 패턴이지만
  // mode 축으로 분리된 state — preview 두 축 (theme/mode) 이 독립적으로
  // overlay 될 수 있도록.
  const [previewMode, setPreviewMode] = useState<ThemeMode | null>(null);

  // Preview wins over the stored theme — applyTheme only touches DOM attrs,
  // so hovering never pollutes the store or localStorage.
  useEffect(() => {
    applyTheme(previewId ?? themeId, previewMode ?? mode);
  }, [previewId, themeId, previewMode, mode]);

  // If the picker unmounts mid-preview (e.g. dropdown closes while hovering),
  // snap the DOM back to the persisted theme. Ref mirrors the latest selector
  // value so the unmount cleanup reads the most recent commit instead of
  // closing over a stale mount-time snapshot.
  const themeRef = useRef({ themeId, mode });
  themeRef.current = { themeId, mode };
  useEffect(() => {
    return () => {
      applyTheme(themeRef.current.themeId, themeRef.current.mode);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("appearance")}
        </span>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => {
            if (next) setMode(next as ThemeMode);
          }}
          onMouseLeave={() => setPreviewMode(null)}
          aria-label={t("mode.ariaGroup")}
          className="w-full justify-between"
        >
          <ToggleGroupItem
            value="light"
            aria-label={t("mode.lightAria")}
            className="flex-1"
            onMouseEnter={() => setPreviewMode("light")}
          >
            <Sun size={12} />
            {t("mode.light")}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="dark"
            aria-label={t("mode.darkAria")}
            className="flex-1"
            onMouseEnter={() => setPreviewMode("dark")}
          >
            <Moon size={12} />
            {t("mode.dark")}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="system"
            aria-label={t("mode.systemAria")}
            className="flex-1"
            onMouseEnter={() => setPreviewMode("system")}
          >
            <Monitor size={12} />
            {t("mode.system")}
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
              aria-label={t("theme.aria", { name: entry.name })}
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
