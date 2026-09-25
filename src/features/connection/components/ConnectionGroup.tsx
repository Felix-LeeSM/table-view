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
import { Button } from "@components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@components/ui/context-menu";
import { Input } from "@components/ui/input";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import { setGroupCollapsed } from "@lib/tauri/groups";
import {
  ChevronDown,
  ChevronRight,
  Palette,
  Pencil,
  Trash2,
  UnfoldVertical,
} from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ConnectionConfig,
  ConnectionGroup as ConnectionGroupType,
} from "../model";
import { useConnectionStore } from "../store";
import ConnectionItem, { draggedConnectionId } from "./ConnectionItem";
import GroupColorDot from "./GroupColorDot";
import GroupDialog from "./GroupDialog";

// ---------------------------------------------------------------------------
// Collapse-state persistence (Q20.3)
// ---------------------------------------------------------------------------
//
// Persistence in the old `table-view-group-collapsed` localStorage map is
// retired; the SQLite `connection_groups.collapsed` column is the SOT. This
// component mounts with the group prop's `collapsed` value and calls the
// `set_group_collapsed` IPC on toggle. Cross-window propagation through
// state-changed is not wired yet.

interface ConnectionGroupProps {
  group: ConnectionGroupType;
  connections: ConnectionConfig[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onActivate?: (id: string) => void;
  /** True while a dragged connection hovers this group — highlights the drop target. */
  isDropTarget?: boolean;
  /** Fired on dragover so the parent can track which group is the current drop target. */
  onDragOverGroup?: (groupId: string) => void;
}

export default function ConnectionGroup({
  group,
  connections,
  selectedId = null,
  onSelect,
  onActivate,
  isDropTarget = false,
  onDragOverGroup,
}: ConnectionGroupProps) {
  const { t } = useTranslation("featuresConnection");
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
      try {
        await updateGroup({ ...group, name: trimmed });
      } catch {
        toast.error(t("errors.groupRenameFailed"));
      }
    }
    setRenaming(false);
  };

  const toggleCollapsed = () => {
    if (renaming) return;
    const next = !collapsed;
    setCollapsed(next);
    // SQLite SOT. Failure leaves the UI updated; the next user mutation
    // retries. (best-effort.)
    void setGroupCollapsed({ groupId: group.id, collapsed: next }).catch(() => {
      /* best-effort */
    });
  };

  // Q21 #4 — "Reset collapse states". Sets every group to expanded
  // (collapsed=false). The per-group IPC is idempotent, so no new bulk IPC
  // is introduced.
  const handleResetAllCollapse = () => {
    // Also update the expanded visual state of the group this component
    // mounted, for immediate user feedback. Other groups' collapsed UI is
    // each ConnectionGroup instance's own state; no group.update event
    // reaches them.
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
  // visual indicator (per 2026-05-05 user request — "widen each group's area
  // and remove the indicator"). `e.stopPropagation()` keeps the event from
  // also firing ConnectionList's ungroup handler when both could handle the
  // drop.
  const handleGroupDragOver = (e: DragEvent) => {
    if (!draggedConnectionId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    // Drop-location preview: tell the parent this group is the current drop
    // target so it renders the group-wide highlight. This is the *whole group*
    // affordance only — NOT the per-item insertion line that was intentionally
    // removed on 2026-05-05 (see the drop-target comment above).
    onDragOverGroup?.(group.id);
  };

  const handleGroupDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const connId = draggedConnectionId ?? e.dataTransfer.getData("text/plain");
    if (connId) {
      try {
        await moveConnectionToGroup(connId, group.id);
      } catch {
        toast.error(t("errors.groupMoveFailed"));
      }
    }
  };

  return (
    <>
      <div
        data-testid="connection-group-wrapper"
        data-drop-target={isDropTarget ? "true" : undefined}
        className={`select-none py-1${
          isDropTarget
            ? " rounded-md bg-primary/10 ring-1 ring-inset ring-primary/40"
            : ""
        }`}
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
              aria-label={t("group.ariaLabel", {
                name: group.name,
                count: connections.length,
              })}
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
              {/* Color accent dot. Shared with the GroupDialog preview via
                  `GroupColorDot` so both render a color the same way. */}
              <GroupColorDot color={group.color} />
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
              <Pencil size={14} /> {t("group.rename")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setShowEditDialog(true)}>
              <Palette size={14} /> {t("group.changeColor")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            {/* Q21 #4 — Reset collapse states. Sets collapsed=false on every
                group. No confirm dialog (the Q21 direct IPC contract). */}
            <ContextMenuItem onClick={handleResetAllCollapse}>
              <UnfoldVertical size={14} /> {t("group.resetCollapseStates")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem danger onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 size={14} /> {t("group.deleteGroup")}
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
        <GroupDialog
          group={group}
          memberCount={connections.length}
          onClose={() => setShowEditDialog(false)}
        />
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
              {t("group.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-secondary-foreground">
              {t("group.deleteDescription", {
                name: group.name,
                count: connections.length,
                connections:
                  connections.length === 1
                    ? t("group.connectionSingular")
                    : t("group.connectionPlural"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-3 flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="ghost" size="sm">
                {t("group.cancel")}
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  try {
                    await removeGroup(group.id);
                    setShowDeleteConfirm(false);
                  } catch {
                    toast.error(t("errors.groupRemoveFailed"));
                  }
                }}
              >
                {t("group.delete")}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
