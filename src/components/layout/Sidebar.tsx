import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Sun,
  Moon,
  Monitor,
  Plus,
  RotateCcw,
  FoldVertical,
  UnfoldVertical,
} from "lucide-react";
import { getSidebarObjectLabel } from "@lib/dbTypeLabels";
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
import ThemePicker from "@components/theme/ThemePicker";
import LanguageSwitcher from "@components/theme/LanguageSwitcher";
import { persistSettingValue, resetSetting } from "@lib/tauri/settings";
import { logger } from "@lib/logger";

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
  const { t } = useTranslation("layout");
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
  const setExpanded = useWorkspaceStore((s) => s.setExpanded);
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
    handleKeyDown: handleResizeKeyDown,
    min: sidebarMinWidth,
    max: sidebarMaxWidth,
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

  // Sprint 376 (Phase 6 Q21 #3-a) — Sidebar handle "Reset width". Same
  // backend IPC as the Settings panel's "Reset sidebar width" (Q21
  // #3-b) — receiver applies the frontend default. Local window's
  // useResizablePanel is not reset here; the next setting.reset event
  // arriving at this same window (self-echo) is intentionally ignored
  // because the dispatcher's self-echo skip path means the local
  // panel's width stays at the user's last drag value until they
  // explicitly drag again. Acceptable for #3-a (the cross-window
  // listeners still get the row-delete event); a future sprint can
  // wire a local "apply default width" path if user feedback demands.
  const handleResetSidebarWidth = useCallback(() => {
    void resetSetting("sidebar_width").catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e ?? "");
      logger.warn(`[Sidebar] reset_setting(sidebar_width) failed: ${message}`);
    });
  }, []);

  // Sprint 376 (Phase 6 Q21 #7) — header "Collapse all". Empties the
  // active workspace's sidebar.expanded list. The workspace persist
  // pipeline (sprint-360 SQLite write) carries the change to other
  // windows on the same connection_id.
  //
  // Sprint 379 — 단일 버튼이 DB type 별 적절한 객체 이름 (schemas /
  // tables / collections) 을 노출하고 토글된다. 모두 collapsed 상태에서는
  // "Expand all *" 라벨로 의도를 신호하지만 실제 expand path 는 후속
  // sprint-381 에서 schema/mongo store 캐시를 walk 하여 구체화한다 — 본
  // sprint 에서는 click 이 *no-op* 로 안전하게 떨어지도록 한다.
  const handleCollapseAll = useCallback(() => {
    if (!focusedConnId) return;
    const db = resolveActiveDb(focusedConnId);
    setExpanded(focusedConnId, db, []);
  }, [focusedConnId, setExpanded]);

  // Sprint 379 — sidebar.expanded 의 현 상태로 토글 라벨 / 클릭 핸들러를
  // 분기. 안전한 read path 만 사용 (focusedConnId 없으면 비어 있는 워크
  // 스페이스로 간주 → "Expand" 라벨 + disabled).
  // #1447 — select the primitive count (not the whole `workspaces` map): a
  // whole-map subscription re-rendered the entire sidebar tree on every
  // editor keystroke (`updateQuerySql` replaces the map identity).
  const expandedCount = useWorkspaceStore((s) => {
    if (!focusedConnId) return 0;
    const db = resolveActiveDb(focusedConnId);
    return s.workspaces[focusedConnId]?.[db]?.sidebar.expanded?.length ?? 0;
  });
  const focusedDbType = useMemo(() => {
    if (!focusedConnId) return null;
    return connections.find((c) => c.id === focusedConnId)?.dbType ?? null;
  }, [focusedConnId, connections]);
  const sidebarObjectPlural = useMemo(() => {
    if (!focusedDbType) return "schemas";
    return getSidebarObjectLabel(focusedDbType).plural;
  }, [focusedDbType]);
  const isAllCollapsed = expandedCount === 0;
  const toggleLabel = isAllCollapsed
    ? t("sidebar.expandAll", { objectPlural: sidebarObjectPlural })
    : t("sidebar.collapseAll", { objectPlural: sidebarObjectPlural });
  const ToggleIcon = isAllCollapsed ? UnfoldVertical : FoldVertical;
  const handleToggleExpansion = useCallback(() => {
    if (!focusedConnId) return;
    // Collapse path → empty expanded array. Expand path → no-op for now
    // (sprint-381 will walk the schema/mongo store caches).
    if (!isAllCollapsed) {
      handleCollapseAll();
    }
  }, [focusedConnId, isAllCollapsed, handleCollapseAll]);

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
        {/* Header strip — connection name + "+ Query" action. data-testid is
            kept stable for e2e tests (`sidebar-connection-header`).

            Sprint 376 (Phase 6 Q21 #7) — header "Collapse all" 가시
            버튼이 추가됨. Q21 직관적 위치 contract — 우클릭 메뉴 대신
            가시 버튼 (키보드 사용자 발견 가능). */}
        <div className="flex items-center justify-between border-b border-border py-1 pl-3 pr-1">
          <span
            data-testid="sidebar-connection-header"
            className="block truncate text-xs font-semibold text-foreground"
          >
            {focusedConnId
              ? (connections.find((c) => c.id === focusedConnId)?.name ??
                t("sidebar.schemasLabel"))
              : t("sidebar.schemasLabel")}
          </span>
          <div className="flex items-center gap-1">
            {/* Sprint 379 — DB type 별 객체 이름 + 토글. PG → schemas,
                MySQL/SQLite → tables, Mongo → collections. expanded 가
                비어 있으면 동일 버튼이 "Expand all *" 라벨로 전환된다 (실제
                expand 동작은 sprint-381 에서 schema/mongo store walk). */}
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
              aria-label={toggleLabel}
              title={toggleLabel}
              disabled={!focusedConnId}
              onClick={handleToggleExpansion}
              data-testid="sidebar-collapse-all"
            >
              <ToggleIcon />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
              aria-label={t("sidebar.newQueryTabAria")}
              title={t("sidebar.newQueryTabAria")}
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
              {t("sidebar.query")}
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
                aria-label={t("sidebar.themePickerAria", {
                  name: activeEntry.name,
                  mode: themeMode,
                })}
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
              className="w-72 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-2"
            >
              <div className="flex flex-col gap-2">
                <ThemePicker />
                <LanguageSwitcher />
              </div>
            </PopoverContent>
          </Popover>
          {/* Sprint 376 (Phase 6 Q21 #3-a) — "Reset sidebar width" 가시
              버튼. 우클릭 컨텍스트 메뉴 대신 직관적 위치 (sidebar
              하단, drag handle 과 시각 근접) 에 노출. */}
          <Button
            variant="ghost"
            size="xs"
            type="button"
            className="mt-1 w-full justify-start text-muted-foreground"
            aria-label={t("sidebar.resetWidthAria")}
            title={t("sidebar.resetWidthTitle")}
            onClick={handleResetSidebarWidth}
            data-testid="sidebar-reset-width"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            <span className="ml-1 text-3xs">{t("sidebar.resetWidth")}</span>
          </Button>
        </div>

        {/* Resize handle.
            Sprint 378 (2026-05-17) — 더블클릭 = width reset. `handleResetSidebarWidth`
            는 sprint-376 #3-a 의 IPC wrapper (`reset_setting("sidebar_width")`).
            단일 클릭/drag-start 는 mousedown 만 트리거하므로 reset 과는
            독립이다. */}
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/90 active:bg-primary/90 focus-visible:outline-1 focus-visible:outline-ring"
          onMouseDown={handleResizeMouseDown}
          onKeyDown={handleResizeKeyDown}
          onDoubleClick={handleResetSidebarWidth}
          tabIndex={0}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("sidebar.resizeAria")}
          aria-valuemin={sidebarMinWidth}
          aria-valuemax={sidebarMaxWidth}
          aria-valuenow={Math.round(sidebarWidth)}
        />
      </div>
    </>
  );
}
