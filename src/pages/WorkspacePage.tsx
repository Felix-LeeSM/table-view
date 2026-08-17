import MainArea from "@components/layout/MainArea";
import Sidebar from "@components/layout/Sidebar";
import ErrorBoundary from "@components/shared/ErrorBoundary";
import ThemeGallery from "@components/theme/ThemeGallery";
import { useAutoResolveActiveDb } from "@hooks/useAutoResolveActiveDb";
import { useCurrentWindowConnectionId } from "@hooks/useCurrentWindowConnectionId";
import { useWindowFocusHydration } from "@hooks/useWindowFocusHydration";
import { subscribeSystemModeChange } from "@lib/themeBoot";
import { useConnectionStore } from "@stores/connectionStore";
import { useLayoutStore } from "@stores/layoutStore";
import { useThemeStore } from "@stores/themeStore";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/**
 * WorkspacePage — multi-paradigm tab + sidebar work surface.
 *
 * Renders the existing `Sidebar` alongside `MainArea`. Both the route back to
 * the launcher (`BackToConnectionsButton`) and the theme / language popover
 * (`AppearanceButton`) live in `WorkspaceToolbar`, which `MainArea` mounts —
 * #2431 moved them out of a header strip stacked above the sidebar.
 *
 * Lifecycle:
 *
 *   - **No** `tauri://close-requested` listener (Wave 9.5 회귀 4,
 *     2026-05-16). OS-level close (Cmd+W, traffic light) 는 launcher 가
 *     항상 visible 이므로 default destroy 만으로 desired UX 가 자연스레
 *     성립 — workspace 사라지면 launcher 가 자동 활성. 회귀 4 의 history:
 *     이전에는 `closeCurrentWindow()` (= `win.close()`) 가 close-requested
 *     를 발사 → 리스너가 `preventDefault()` + back 핸들러 재호출 → **무한 루프**.
 *     현재는 listener 자체 제거 + `destroyCurrentWindow()` (= `win.destroy()`)
 *     로 close-requested 라이프사이클 자체를 우회한다 (두 layer 의 layered
 *     defense). 그 back 핸들러는 이제 `BackToConnectionsButton` 이 갖는다.
 *
 * Disconnect (which DOES tear down the pool) is owned by the
 * `DisconnectButton` in `WorkspaceToolbar` and is intentionally NOT a
 * window-level affordance — pool eviction must not cascade into a window
 * hide.
 */
export default function WorkspacePage() {
  const { t } = useTranslation("pages");
  const themeMode = useThemeStore((s) => s.mode);
  const handleSystemChange = useThemeStore((s) => s.handleSystemChange);

  // #1738 (2026-07-25) — the workspace window's system-mode subscription.
  // It stays on the window root even though #2431 moved the theme UI into the
  // toolbar: the subscription is per Tauri window, not per control (HomePage
  // owns the launcher window's). When mode is "system" the OS light/dark
  // switch re-resolves the theme live.
  useEffect(() => {
    if (themeMode !== "system") return;
    return subscribeSystemModeChange(handleSystemChange);
  }, [themeMode, handleSystemChange]);

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
  //
  // #2431 lifted it out of the `<nav>` to the page root. The heading names the
  // page, not the sidebar, and the collapsed workspace now hides the whole
  // `<nav>` — leaving it inside would make a window that opens collapsed mount
  // with a `display: none` heading, which is neither announced nor focusable.
  const connId = useCurrentWindowConnectionId();
  const connectionName = useConnectionStore((s) =>
    connId ? s.connections.find((c) => c.id === connId)?.name : null,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // #1734 — Layout cluster, left panel.
  //
  // #2431 — collapsing now hides the sidebar column WHOLE. It used to keep the
  // header strip above the tree alive as a narrow vertical rail, because that
  // strip held the sole route back to the launcher and the sole theme /
  // language control and dropping it stranded a collapsed user with neither.
  // Both controls moved to `WorkspaceToolbar`, which no collapse touches, so
  // the rail has nothing left to carry.
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <h1 ref={headingRef} tabIndex={-1} className="sr-only focus:outline-none">
        {connectionName ?? t("workspaceHeading")}
      </h1>
      {/* Sidebar column, a <nav> landmark (#1134) so it is reachable via
          screen-reader landmark navigation.

          #1312 — a sidebar render crash must not take down the whole
          workspace; isolate it so MainArea keeps working.

          #1734 — collapsing HIDES this column, it never unmounts it. The
          subtree owns state the user built by hand and cannot get back: the
          dragged width (`useResizablePanel` starts from `DEFAULT_WIDTH` and
          nothing reads the persisted `sidebar_width` back — see `Sidebar.tsx`
          top-of-file note), the debounced width commit still in flight, the
          schema-tree filter text and expanded categories, the Redis SCAN
          pattern/cursor, the search filters, and any dialog opened from the
          tree. The `hidden` attribute is what hides it — Tailwind's preflight
          declares `[hidden]` as `display: none !important`, so it beats the
          `flex` on the same element. `display: none` also drops the column
          from the accessibility tree and the tab order, which is what
          collapsing should mean.

          #2431 moved `hidden` from an inner `display: contents` wrapper onto
          the <nav> itself. With the header strip gone the wrapper's only
          remaining child was the sidebar, and leaving `hidden` inside would
          have published an empty navigation landmark to screen readers —
          announcing a column with nothing to navigate. */}
      <nav
        aria-label={t("workspaceSidebarAria")}
        className="flex h-full flex-col"
        hidden={sidebarCollapsed}
      >
        <ErrorBoundary variant="panel" label={t("workspaceSidebarAria")}>
          <Sidebar />
        </ErrorBoundary>
      </nav>
      <MainArea />
      {/* #2118 — mounted outside the appearance popover on purpose: the
          picker's "browse all" button raises `themeFavoritesStore.galleryOpen`,
          and a child of `PopoverContent` would unmount with the popover.
          #2431 moved that popover into `WorkspaceToolbar` and left this mount
          on the page root, which is what keeps the reason intact — "outside
          `PopoverContent`" is the constraint, not "next to the trigger". */}
      <ThemeGallery />
    </div>
  );
}
