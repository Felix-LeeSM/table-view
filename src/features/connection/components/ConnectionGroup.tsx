import { useState, useRef, useEffect, type DragEvent } from "react";
import {
  ChevronRight,
  ChevronDown,
  Trash2,
  Pencil,
  Palette,
  UnfoldVertical,
} from "lucide-react";
import { Input } from "@components/ui/input";
import { Button } from "@components/ui/button";
import type {
  ConnectionConfig,
  ConnectionGroup as ConnectionGroupType,
} from "../model";
import { useConnectionStore } from "../store";
import ConnectionItem, { draggedConnectionId } from "./ConnectionItem";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@components/ui/context-menu";
import { logger } from "@lib/logger";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/ui/alert-dialog";
import { setGroupCollapsed } from "@lib/tauri/groups";
import GroupDialog from "./GroupDialog";

// ---------------------------------------------------------------------------
// Collapse-state persistence (Sprint 369 Phase 4 Q20.3)
// ---------------------------------------------------------------------------
//
// 기존 `table-view-group-collapsed` localStorage map 영속 폐기. SQLite
// `connection_groups.collapsed` 컬럼이 SOT. 본 컴포넌트는 group prop 의
// `collapsed` 값으로 mount 하고 toggle 시 `set_group_collapsed` IPC + (store
// 가 hydrate 한 다음 sprint 에서) state-changed 가 cross-window 로 전파.

interface ConnectionGroupProps {
  group: ConnectionGroupType;
  connections: ConnectionConfig[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onActivate?: (id: string) => void;
}

export default function ConnectionGroup({
  group,
  connections,
  selectedId = null,
  onSelect,
  onActivate,
}: ConnectionGroupProps) {
  const [collapsed, setCollapsed] = useState(() => group.collapsed);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const renameRef = useRef<HTMLInputElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const removeGroup = useConnectionStore((s) => s.removeGroup);
  const updateGroup = useConnectionStore((s) => s.updateGroup);
  const allGroups = useConnectionStore((s) => s.groups);
  const moveConnectionToGroup = useConnectionStore(
    (s) => s.moveConnectionToGroup,
  );
  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  const handleRenameSubmit = async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== group.name) {
      await updateGroup({ ...group, name: trimmed });
    }
    setRenaming(false);
  };

  const toggleCollapsed = () => {
    if (renaming) return;
    const next = !collapsed;
    setCollapsed(next);
    // SQLite SOT. Failure leaves the UI updated — cross-window broadcast 도
    // 실패한 셈이지만 사용자 mutate 가 다시 들어오면 retry. (best-effort.)
    void setGroupCollapsed({ groupId: group.id, collapsed: next }).catch(() => {
      /* best-effort */
    });
  };

  // Sprint 376 (Phase 6 Q21 #4) — "Reset collapse states". 모든 group
  // 을 expanded (collapsed=false) 로 set. per-group IPC 가 idempotent 라
  // bulk IPC 새로 도입하지 않음 — sprint-369 의 set_group_collapsed 가
  // group.update emit 을 발사해 cross-window converge.
  const handleResetAllCollapse = () => {
    // 현 컴포넌트가 mount 한 group 이 보유한 expanded 시각 상태도 같이
    // 갱신해 사용자 immediate feedback. 다른 group 의 collapsed UI 는
    // 각 ConnectionGroup 인스턴스의 자기 state — group.update event
    // 가 store 변경 → re-render 로 흐른다 (sprint-369 contract).
    setCollapsed(false);
    for (const g of allGroups) {
      void setGroupCollapsed({ groupId: g.id, collapsed: false }).catch(
        (e: unknown) => {
          const message = e instanceof Error ? e.message : String(e ?? "");
          logger.warn(
            `[ConnectionGroup] set_group_collapsed(${g.id}) failed: ${message}`,
          );
        },
      );
    }
  };

  // Group-wide drop target: any drop within the group's padded visual area
  // (header OR an expanded member row OR the surrounding padding) joins this
  // group. Padding gives the user a more forgiving hit area without any
  // visual indicator (per 2026-05-05 user request — "각 그룹의 영역을 넓히고
  // indicator 제거"). `e.stopPropagation()` keeps the event from also firing
  // ConnectionList's ungroup handler when both could handle the drop.
  const handleGroupDragOver = (e: DragEvent) => {
    if (!draggedConnectionId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
  };

  const handleGroupDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const connId = draggedConnectionId ?? e.dataTransfer.getData("text/plain");
    if (connId) {
      await moveConnectionToGroup(connId, group.id);
    }
  };

  return (
    <>
      <div
        data-testid="connection-group-wrapper"
        className="select-none py-1"
        onDragOver={handleGroupDragOver}
        onDrop={handleGroupDrop}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="flex cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:bg-muted"
              role="button"
              tabIndex={0}
              aria-expanded={!collapsed}
              aria-label={`${group.name} group (${connections.length} connections)`}
              onClick={toggleCollapsed}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleCollapsed();
                }
              }}
            >
              {collapsed ? (
                <ChevronRight size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
              {/* Color accent dot — Sprint 78. Legacy groups with color=null
                  fall back to a muted border-only dot so the column stays
                  balanced across the list. */}
              <span
                data-testid="group-color-accent"
                aria-hidden="true"
                className={`inline-block h-2 w-2 shrink-0 rounded-full border ${
                  group.color
                    ? "border-transparent"
                    : "border-border bg-transparent"
                }`}
                style={
                  group.color ? { backgroundColor: group.color } : undefined
                }
              />
              {renaming ? (
                <Input
                  ref={renameRef}
                  className="h-5 min-w-0 flex-1 border-primary bg-background px-1.5 py-0.5 text-xs text-foreground shadow-none focus-visible:ring-0"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRenameSubmit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit();
                    if (e.key === "Escape") {
                      setRenameValue(group.name);
                      setRenaming(false);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate">{group.name}</span>
              )}
              <span className="ml-1 text-3xs">({connections.length})</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onClick={() => {
                setRenameValue(group.name);
                setRenaming(true);
              }}
            >
              <Pencil size={14} /> Rename
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setShowEditDialog(true)}>
              <Palette size={14} /> Change Color
            </ContextMenuItem>
            <ContextMenuSeparator />
            {/* Sprint 376 (Phase 6 Q21 #4) — Reset collapse states. 모든
                group 의 collapsed=false UPDATE. Confirm dialog 없음
                (Q21 직접 IPC contract). */}
            <ContextMenuItem onClick={handleResetAllCollapse}>
              <UnfoldVertical size={14} /> Reset collapse states
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem danger onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 size={14} /> Delete Group
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {!collapsed &&
          connections.map((conn) => (
            <ConnectionItem
              key={conn.id}
              connection={conn}
              selected={selectedId === conn.id}
              onSelect={onSelect}
              onActivate={onActivate}
              inGroup
            />
          ))}
      </div>

      {showEditDialog && (
        <GroupDialog group={group} onClose={() => setShowEditDialog(false)} />
      )}

      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={(open) => !open && setShowDeleteConfirm(false)}
      >
        <AlertDialogContent
          role="alertdialog"
          aria-label={`Delete group ${group.name}`}
          className="w-96 bg-secondary p-4"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold text-foreground">
              Delete Group
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-secondary-foreground">
              Only the group &quot;{group.name}&quot; will be removed. The{" "}
              {connections.length}{" "}
              {connections.length === 1 ? "connection" : "connections"} inside
              will be moved to the ungrouped list — no connection data is
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-3 flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await removeGroup(group.id);
                  setShowDeleteConfirm(false);
                }}
              >
                Delete
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
