import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Sun, Moon, Monitor } from "lucide-react";
import Sidebar from "@components/layout/Sidebar";
import MainArea from "@components/layout/MainArea";
import { useCurrentWindowConnectionId } from "@hooks/useCurrentWindowConnectionId";
import { useConnectionStore } from "@stores/connectionStore";
import { Button } from "@components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import ThemePicker from "@components/theme/ThemePicker";
import { useThemeStore } from "@stores/themeStore";
import { THEME_CATALOG } from "@lib/themeCatalog";
import { logger } from "@lib/logger";
import { useWindowFocusHydration } from "@hooks/useWindowFocusHydration";
import { destroyCurrentWindow, focusWindow } from "@lib/window-controls";

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

  const activeEntry =
    THEME_CATALOG.find((t) => t.id === themeId) ?? THEME_CATALOG[0];
  const ThemeIcon =
    themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;

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
        <div className="flex items-center justify-between border-b border-border bg-secondary px-2 py-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-secondary-foreground"
            aria-label={t("backToConnections")}
            title={t("backToConnections")}
            onClick={handleBackToConnections}
          >
            <ArrowLeft />
            <span className="text-xs">{t("connections")}</span>
          </Button>

          {/* Workspace-level theme toggle. Mirrors the
              Popover+ThemePicker pattern from Sidebar.tsx so users can
              change theme from the header without scrolling to the
              sidebar footer. */}
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
              className="w-72 p-2"
            >
              <ThemePicker />
            </PopoverContent>
          </Popover>
        </div>
        <Sidebar />
      </nav>
      <MainArea />
    </div>
  );
}
