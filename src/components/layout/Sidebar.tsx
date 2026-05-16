import { useEffect, useRef } from "react";
import { Sun, Moon, Monitor, Plus } from "lucide-react";
import { useConnectionStore } from "@stores/connectionStore";
import { resolveActiveDb, useWorkspaceStore } from "@stores/workspaceStore";
import { useMruStore } from "@stores/mruStore";
import { useThemeStore } from "@stores/themeStore";
import { useResizablePanel } from "@hooks/useResizablePanel";
import { useCurrentWindowConnectionId } from "@hooks/useCurrentWindowConnectionId";
import { THEME_CATALOG } from "@lib/themeCatalog";
import { subscribeSystemModeChange } from "@lib/themeBoot";
import { Button } from "@components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import WorkspaceSidebar from "@components/workspace/WorkspaceSidebar";
import { LogoWordmark } from "@components/shared/Logo";
import ThemePicker from "@components/theme/ThemePicker";
import { persistSettingValue } from "@lib/tauri/settings";

// Sprint 369 (Phase 4, Q20.2) — `table-view.sidebar.width` localStorage 영속
// 폐기. boot snapshot 이 차후 sprint 에서 `settings.sidebar_width` 를 hydrate
// 하면 그 값을 초기로 사용. 본 sprint 는 default 시작 + drag mouseup 500ms
// debounce 후 IPC commit 만 책임.
const MIN_WIDTH = 220;
const MAX_WIDTH = 540;
const DEFAULT_WIDTH = 280;
const PERSIST_DEBOUNCE_MS = 500;

/**
 * Workspace Sidebar — schema/work surface column shown on `WorkspacePage`.
 * Connection management lives on the dedicated `HomePage` / launcher window.
 *
 * Sprint 291 — workspace 윈도우의 Cmd+N 은 raw query tab 을 여는 것으로
 * 의미가 바뀌어 본 컴포넌트의 `new-connection` listener + 임베디드
 * `ConnectionDialog` mount 는 제거되었다. 새 연결을 만들고 싶은 사용자는
 * launcher 윈도우 (Cmd+, 또는 dock 아이콘 reopen) 에서 진행한다.
 */
export default function Sidebar() {
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  // sprint-366 (Phase 4, Q15) — Sidebar lives in the workspace window only
  // (see top-of-file docstring). The window's connection identity is
  // derived from its Tauri label (`workspace-{connection_id}`) rather than
  // from the cross-window `focusedConnId` slot, which is now launcher-only.
  // `useCurrentWindowConnectionId()` returns `null` when the hook runs
  // outside a workspace window (jsdom tests, or theoretical launcher
  // mount) — the rest of the component already handles that null case.
  const focusedConnId = useCurrentWindowConnectionId();
  const addQueryTab = useWorkspaceStore((s) => s.addQueryTab);
  // MRU marking lives on each caller (not inside tabStore.addQueryTab) —
  // the "+ Query" button explicitly marks the focused connection used so
  // the launcher Recent rail / EmptyState CTA reflect the user's continued
  // engagement with the connection.
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);

  const themeId = useThemeStore((s) => s.themeId);
  const themeMode = useThemeStore((s) => s.mode);
  const handleSystemChange = useThemeStore((s) => s.handleSystemChange);

  useEffect(() => {
    if (themeMode !== "system") return;
    return subscribeSystemModeChange(handleSystemChange);
  }, [themeMode, handleSystemChange]);

  // sprint-366 (Phase 4, Q15) — Removed the two `setFocusedConn` effects
  // ("focus active tab's conn" + "heal vanished focus") that previously
  // wrote to the cross-window `focusedConnId` slot from a workspace
  // window. Both are now incoherent: each workspace window is pinned to
  // one connection via its Tauri label (sprint-361), so (a) the active
  // tab's conn always matches the window's by construction, and (b) a
  // vanished connection means the window itself should close — not a
  // silent reassignment to a sibling connection (which would surprise
  // the user). Strategy doc line 1656 requires "workspace 에서 set
  // 호출 0건"; keeping these as dead writes propagates to the launcher
  // slot via the cross-window IPC bridge and races with the user's own
  // launcher selection.

  const {
    size: sidebarWidth,
    panelRef: sidebarRef,
    handleMouseDown: handleResizeMouseDown,
  } = useResizablePanel({
    axis: "horizontal",
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    initial: DEFAULT_WIDTH,
  });

  // Sprint 369 (Phase 4, Q20.2) — drag mouseup 후 500ms debounce 로
  // `set_setting("sidebar_width", N)` IPC commit. drag 중 mousemove 는
  // useResizablePanel 의 hot path 에서 DOM-only 업데이트라 본 effect 는
  // commit (mouseup → state set) 직후에만 fire — 즉, "drag 종료 후 500ms 안에
  // 또 다른 drag 가 일어나면 IPC 1회로 합쳐진다" 는 의미. AC-369-12.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPersistSkippedRef = useRef(false);
  useEffect(() => {
    // Skip the very first effect run (mount with the default width) — IPC
    // shouldn't fire just because the component mounted. Subsequent updates
    // (mouseup commit) trigger the debounced persist.
    if (!initialPersistSkippedRef.current) {
      initialPersistSkippedRef.current = true;
      return;
    }
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      void persistSettingValue("sidebar_width", sidebarWidth).catch(() => {
        /* best-effort — next drag retries */
      });
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [sidebarWidth]);

  const activeEntry =
    THEME_CATALOG.find((t) => t.id === themeId) ?? THEME_CATALOG[0];
  const ThemeIcon =
    themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;

  // New-connection creation happens on the launcher window (HomePage);
  // the `connections` effect above heals focus when the new connection
  // lands in the store.

  const selectedConnected =
    !!focusedConnId && activeStatuses[focusedConnId]?.type === "connected";

  return (
    <>
      <div
        ref={sidebarRef}
        className="relative flex h-full shrink-0 select-none flex-col border-r border-border bg-secondary"
        style={{ width: sidebarWidth }}
      >
        {/* Brand header */}
        <div className="flex items-center justify-center border-b border-border px-3 py-2">
          <LogoWordmark className="h-7 w-auto" />
        </div>

        {/* Header strip — connection name + "+ Query" action. data-testid is
            kept stable for e2e tests (`sidebar-connection-header`). */}
        <div className="flex items-center justify-between border-b border-border py-1 pl-3 pr-1">
          <span
            data-testid="sidebar-connection-header"
            className="block truncate text-xs font-semibold text-foreground"
          >
            {focusedConnId
              ? (connections.find((c) => c.id === focusedConnId)?.name ??
                "Schemas")
              : "Schemas"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
              aria-label="New Query Tab"
              title="New Query Tab"
              disabled={!selectedConnected}
              onClick={() => {
                if (selectedConnected && focusedConnId) {
                  const db = resolveActiveDb(focusedConnId);
                  addQueryTab(focusedConnId, db);
                  markConnectionUsed(focusedConnId);
                }
              }}
            >
              <Plus />
              Query
            </Button>
          </div>
        </div>

        {/* Body — paradigm-aware sidebar slot. `WorkspaceSidebar` resolves
            the driving connection with active-tab priority and falls back
            to `focusedConnId`. */}
        <div className="flex flex-1 flex-col overflow-auto">
          <WorkspaceSidebar selectedId={focusedConnId} />
        </div>

        {/* Theme picker footer */}
        <div className="border-t border-border px-3 py-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="w-full justify-start text-muted-foreground"
                aria-label={`Theme picker: currently ${activeEntry.name} (${themeMode})`}
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: activeEntry.swatch }}
                />
                <span className="truncate">{activeEntry.name}</span>
                <ThemeIcon className="ml-auto" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              sideOffset={8}
              collisionPadding={8}
              className="w-72 p-2"
            >
              <ThemePicker />
            </PopoverContent>
          </Popover>
        </div>

        {/* Resize handle */}
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/90 active:bg-primary/90"
          onMouseDown={handleResizeMouseDown}
        />
      </div>
    </>
  );
}
