import { logger } from "@lib/logger";
import { openWorkspaceWindow } from "@lib/tauri/window";
import { Database, GripVertical } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnectionStore } from "../store";
import ConnectionGroup from "./ConnectionGroup";
import ConnectionItem, { draggedConnectionId } from "./ConnectionItem";

/**
 * Which destination the dragged connection is currently over. The drag only
 * ever moves a connection between groups — there is no reorder path — so the
 * drop preview is a destination highlight, not an insertion line (#2434).
 */
type DropZone = { kind: "root" } | { kind: "group"; id: string };

interface ConnectionListProps {
  environmentFilter?: string | null;
  /**
   * #2440 — when the launcher rail has a group selected, render only that
   * group's members: no header (the rail already names it) and no ungroup
   * drop target.
   */
  groupFilter?: string | null;
  /** Currently focused connection. Drives the selected ring on items. */
  selectedId?: string | null;
  /** Single-click selects a connection without connecting. */
  onSelect?: (id: string) => void;
  /** Fired after a successful double-click connect, so the parent can react. */
  onActivate?: (id: string) => void;
}

export default function ConnectionList({
  environmentFilter = null,
  groupFilter = null,
  selectedId = null,
  onSelect,
  onActivate,
}: ConnectionListProps) {
  const { t } = useTranslation("featuresConnection");
  const allConnections = useConnectionStore((s) => s.connections);
  const groups = useConnectionStore((s) => s.groups);
  const moveConnectionToGroup = useConnectionStore(
    (s) => s.moveConnectionToGroup,
  );

  // Drop-location preview: which destination the dragged connection is
  // currently hovering. Owned here (not per-group) so a single `dragend`/`drop`
  // on this root — which bubbles up from the dragged ConnectionItem, including
  // on an Esc cancel — clears the highlight with no per-group state to leak.
  // #2434 — the root (ungroup) area is a destination too, and it was the one
  // of the three targets with no affordance at all.
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const overRoot = dropZone?.kind === "root";

  // Sprint 363 (Phase 3, Q13) — connection double-click 시 per-conn
  // workspace window 를 open/focus 한다. 같은 conn 두 번째 클릭은
  // backend (`open_workspace_window_inner`) 가 idempotent 하게 처리해서
  // 기존 `workspace-{conn_id}` 윈도우만 focus 한다 (sprint-361 잠금).
  // IPC 실패 시 toast 가 아닌 console.warn — 상위 onActivate 가 별도로
  // store/UI 처리를 수행한다.
  const handleActivate = useCallback(
    (id: string) => {
      // Fire-and-forget: window open IPC. The parent's `onActivate` is
      // invoked synchronously so store-side state (focused conn, stale
      // tab cleanup) lands without waiting for the OS-level window
      // creation.
      void openWorkspaceWindow(id).catch((e) => {
        logger.warn(
          `[connection-list] openWorkspaceWindow(${id}) failed:`,
          e instanceof Error ? e.message : e,
        );
      });
      onActivate?.(id);
    },
    [onActivate],
  );

  const connections = environmentFilter
    ? allConnections.filter((c) => c.environment === environmentFilter)
    : allConnections;

  // Filtered to one group: its members take the header-less slot that the
  // ungrouped connections normally occupy, and no group blocks are rendered.
  const filtered = groupFilter != null;
  const rootConnections = filtered
    ? connections.filter((c) => c.groupId === groupFilter)
    : connections.filter((c) => !c.groupId);
  const groupedConnections = filtered
    ? []
    : groups.map((group) => ({
        group,
        connections: connections.filter((c) => c.groupId === group.id),
      }));

  return (
    <div
      data-testid="connection-list-root"
      aria-label={filtered ? t("list.groupAriaLabel") : t("list.ariaLabel")}
      data-drop-target={overRoot ? "true" : undefined}
      className={`flex min-h-full flex-col py-1 select-none${
        overRoot
          ? " rounded-md bg-primary/10 ring-1 ring-inset ring-primary/40"
          : ""
      }`}
      onDragOver={(e) => {
        // A group's own pane is not an ungroup target — a stray drop inside it
        // must not silently pull the connection out of the group being viewed.
        if (filtered) return;
        if (!draggedConnectionId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        // Over the root (ungroup) area — no group is the drop target. Groups
        // stopPropagation their own dragover, so this only fires outside them.
        setDropZone({ kind: "root" });
      }}
      // dragend bubbles up from the dragged ConnectionItem on both drop and
      // Esc cancel, so this is the single cleanup point for the highlight.
      onDragEnd={() => setDropZone(null)}
      onDrop={async (e) => {
        if (filtered) return;
        e.preventDefault();
        setDropZone(null);
        const connId =
          draggedConnectionId ?? e.dataTransfer.getData("text/plain");
        if (connId) {
          await moveConnectionToGroup(connId, null);
        }
      }}
    >
      {/* Root-level connections */}
      {rootConnections.map((conn) => (
        <ConnectionItem
          key={conn.id}
          connection={conn}
          selected={selectedId === conn.id}
          onSelect={onSelect}
          onActivate={handleActivate}
        />
      ))}

      {/* Grouped connections */}
      {groupedConnections.map(({ group, connections: groupConns }) => (
        <ConnectionGroup
          key={group.id}
          group={group}
          connections={groupConns}
          selectedId={selectedId}
          onSelect={onSelect}
          onActivate={handleActivate}
          isDropTarget={dropZone?.kind === "group" && dropZone.id === group.id}
          onDragOverGroup={(id) => setDropZone({ kind: "group", id })}
        />
      ))}

      {/* Group hint — show only when there are connections but no groups */}
      {allConnections.length > 0 && groups.length === 0 && (
        <div className="flex items-center gap-1.5 px-3 py-2 text-3xs text-muted-foreground opacity-60">
          <GripVertical size={10} />
          <span>{t("list.dragHint")}</span>
        </div>
      )}

      {/* Empty group — the rail can select a group nothing lives in yet. */}
      {filtered && rootConnections.length === 0 && (
        <div
          className="px-3 py-2 text-xs text-muted-foreground italic"
          role="status"
        >
          {t("list.emptyGroup")}
        </div>
      )}

      {/* Empty state — visible only when there are no connections at all */}
      {!filtered && allConnections.length === 0 && (
        <div
          className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center"
          role="status"
        >
          <Database size={32} className="mb-3 text-muted-foreground" />
          <p className="text-sm font-medium text-secondary-foreground">
            {t("list.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("list.emptySubtitle")}
          </p>
        </div>
      )}
    </div>
  );
}
