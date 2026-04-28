import { useState, useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Trash2,
  Pencil,
  Palette,
} from "lucide-react";
import { Input } from "@components/ui/input";
import { Button } from "@components/ui/button";
import type {
  ConnectionConfig,
  ConnectionGroup as ConnectionGroupType,
} from "@/types/connection";
import { useConnectionStore } from "@stores/connectionStore";
import ConnectionItem, { draggedConnectionId } from "./ConnectionItem";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@components/ui/context-menu";
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
import GroupDialog from "./GroupDialog";

// ---------------------------------------------------------------------------
// Collapse-state persistence (localStorage)
// ---------------------------------------------------------------------------

const COLLAPSE_KEY = "table-view-group-collapsed";

function loadCollapsedState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCollapsedState(groupId: string, collapsed: boolean) {
  const state = loadCollapsedState();
  state[groupId] = collapsed;
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
}

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
  const [collapsed, setCollapsed] = useState(() => {
    const stored = loadCollapsedState();
    return stored[group.id] ?? group.collapsed;
  });
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const renameRef = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const removeGroup = useConnectionStore((s) => s.removeGroup);
  const updateGroup = useConnectionStore((s) => s.updateGroup);
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
    saveCollapsedState(group.id, next);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`flex cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:bg-muted select-none ${
              dropActive
                ? "bg-primary/10 outline outline-1 outline-primary"
                : ""
            }`}
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
            onDragOver={(e) => {
              if (draggedConnectionId) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropActive(true);
              }
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDropActive(false);
              const connId =
                draggedConnectionId ?? e.dataTransfer.getData("text/plain");
              if (connId) {
                await moveConnectionToGroup(connId, group.id);
              }
            }}
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
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
              style={group.color ? { backgroundColor: group.color } : undefined}
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
