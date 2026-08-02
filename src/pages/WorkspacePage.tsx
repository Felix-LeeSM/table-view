import MainArea from "@components/layout/MainArea";
import Sidebar from "@components/layout/Sidebar";
import ErrorBoundary from "@components/shared/ErrorBoundary";
import LanguageSwitcher from "@components/theme/LanguageSwitcher";
import ThemePicker from "@components/theme/ThemePicker";
import { Button } from "@components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import { useAutoResolveActiveDb } from "@hooks/useAutoResolveActiveDb";
import { useCurrentWindowConnectionId } from "@hooks/useCurrentWindowConnectionId";
import { useWindowFocusHydration } from "@hooks/useWindowFocusHydration";
import { logger } from "@lib/logger";
import { subscribeSystemModeChange } from "@lib/themeBoot";
import { THEME_CATALOG } from "@lib/themeCatalog";
import { destroyCurrentWindow, focusWindow } from "@lib/window-controls";
import { useConnectionStore } from "@stores/connectionStore";
import { useLayoutStore } from "@stores/layoutStore";
import { useThemeStore } from "@stores/themeStore";
import { ArrowLeft, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/**
 * WorkspacePage — multi-paradigm tab + sidebar work surface.
 *
 * Renders the existing `Sidebar` alongside `MainArea`, with a
 * `[← Connections]` button stacked above the sidebar so the user can swap
 * back to the launcher without losing tab state.
 *
 * Lifecycle:
 *
 *   - `handleBackToConnections` (toolbar back button, Wave 9.5 revision
 *     2026-05-16) — 사용자 desired UX:
 *     "< connections 누르면 connection 창이 닫히고 connections 창에
 *     focus 가 가야해". 따라서 launcher 에 focus 를 먼저 주고 현재
 *     workspace 윈도우를 close (destroy). connection pool 은 destroy 시
 *     별도 lifecycle (Back ≠ Disconnect — pool 은 process 가 살아있는
 *     동안 유지) — `close` 가 disconnect 를 cascade 하지 않는다.
 *
 *   - **No** `tauri://close-requested` listener (Wave 9.5 회귀 4,
 *     2026-05-16). OS-level close (Cmd+W, traffic light) 는 launcher 가
 *     항상 visible 이므로 default destroy 만으로 desired UX 가 자연스레
 *     성립 — workspace 사라지면 launcher 가 자동 활성. 회귀 4 의 history:
 *     이전에는 `closeCurrentWindow()` (= `win.close()`) 가 close-requested
 *     를 발사 → 리스너가 `preventDefault()` + 본 핸들러 재호출 → **무한 루프**.
 *     현재는 listener 자체 제거 + `destroyCurrentWindow()` (= `win.destroy()`)
 *     로 close-requested 라이프사이클 자체를 우회한다 (두 layer 의 layered
 *     defense).
 *
 * Disconnect (which DOES tear down the pool) is owned by the
 * `DisconnectButton` in `WorkspaceToolbar` and is intentionally NOT a
 * window-level affordance — pool eviction must not cascade into a window
 * hide.
 */
export default function WorkspacePage() {
  const { t } = useTranslation("pages");
  // Theme store — used to render the theme toggle trigger button alongside
  // the Back button in the workspace header strip. The ThemePicker popover
  // itself reads the store directly, so we only need themeId/mode for the
  // trigger's visual state.
  const themeId = useThemeStore((s) => s.themeId);
  const themeMode = useThemeStore((s) => s.mode);
  const handleSystemChange = useThemeStore((s) => s.handleSystemChange);

  const activeEntry =
    THEME_CATALOG.find((t) => t.id === themeId) ?? THEME_CATALOG[0];
  const ThemeIcon =
    themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;

  // #1738 (2026-07-25) — the workspace window's system-mode subscription moved
  // here from `Sidebar` alongside the theme UI. Each Tauri window keeps its
  // own subscription (HomePage owns the launcher window's); when mode is
  // "system" the OS light/dark switch re-resolves the theme live.
  useEffect(() => {
    if (themeMode !== "system") return;
    return subscribeSystemModeChange(handleSystemChange);
  }, [themeMode, handleSystemChange]);

  // Back-to-connections — separate handler from disconnect. Wave 9.5
  // (2026-05-16) — focus launcher 먼저 (사용자 expected: connections 창에
  // focus 가 가야해) → 현재 workspace 윈도우 destroy. `destroyCurrentWindow`
  // 가 `close()` 가 아닌 `destroy()` 를 호출하는 이유는
  // `src/lib/window-controls.ts` 의 doc 참조 (close-requested 라이프사이클
  // 우회 + 회귀 4 layered defense). backend 의 `WindowEvent::Destroyed`
  // safety net (마지막 workspace 일 때 launcher show + focus) 도 redundant
  // 하게 처리.
  const handleBackToConnections = async () => {
    try {
      await focusWindow("launcher");
      await destroyCurrentWindow();
    } catch (e) {
      logger.warn(
        "[workspace-back] window transition failed:",
        e instanceof Error ? e.message : e,
      );
    }
  };

  // Re-hydrate from session storage on mount and window focus so the
  // workspace picks up the latest connection state from the launcher.
  useWindowFocusHydration();

  // Heal a connected switch-capable RDB window that hydrated (or connected)
  // with no activeDb — auto-selects the first database so the schema tree /
  // grid stop resolving to `db=""`. State-reactive, so it also runs after a
  // webview reload. No-op for non-RDB / already-resolved windows.
  useAutoResolveActiveDb();

  // #1134 — the workspace window's landmark heading. `useCurrentWindowConnectionId`
  // derives the connection from the Tauri label; the store lookup resolves its
  // display name. The `<h1>` is visually hidden (sr-only) so the layout is
  // unchanged, and focus moves to it on mount so screen-reader users land on the
  // page name after the window opens (`document.title` is owned by AppRouter).
  const connId = useCurrentWindowConnectionId();
  const connectionName = useConnectionStore((s) =>
    connId ? s.connections.find((c) => c.id === connId)?.name : null,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // #1734 — Layout cluster, left panel. Collapsing hides the schema-tree
  // column only; the header strip above it stays as a narrow rail because
  // it holds the sole route back to the launcher and the sole theme /
  // language control (`WorkspacePage` header, #1738). Dropping the whole
  // <nav> would strand a collapsed user with neither.
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Sidebar column — back button + theme picker stacked above the
          existing Sidebar so its layout (header / mode toggle / body) stays
          unchanged from the user's perspective. The buttons get their own
          aria-labels per the sprint contract for unambiguous e2e selection.
          Promoted to a <nav> landmark (#1134) so the left column is
          reachable via screen-reader landmark navigation. */}
      <nav
        aria-label={t("workspaceSidebarAria")}
        className="flex h-full flex-col"
      >
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="sr-only focus:outline-none"
        >
          {connectionName ?? t("workspaceHeading")}
        </h1>
        <div
          className={
            sidebarCollapsed
              ? "flex flex-col items-center gap-1 border-b border-border bg-secondary px-1 py-1.5"
              : "flex items-center justify-between border-b border-border bg-secondary px-2 py-1.5"
          }
        >
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-secondary-foreground"
            aria-label={t("backToConnections")}
            title={t("backToConnections")}
            onClick={handleBackToConnections}
          >
            <ArrowLeft />
            {!sidebarCollapsed && (
              <span className="text-xs">{t("connections")}</span>
            )}
          </Button>

          {/* #1738 (2026-07-25) — single top area for appearance controls.
              This popover is now the ONLY place theme + language live (the
              duplicate sidebar-footer copy was removed); it groups
              ThemePicker + LanguageSwitcher so both settings sit together
              in the header without scrolling to the sidebar footer. */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
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
                <ThemeIcon size={12} />
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
        </div>
        {/* #1312 — a sidebar render crash must not take down the whole
            workspace; isolate it so MainArea keeps working. */}
        {!sidebarCollapsed && (
          <ErrorBoundary variant="panel" label={t("workspaceSidebarAria")}>
            <Sidebar />
          </ErrorBoundary>
        )}
      </nav>
      <MainArea />
    </div>
  );
}
