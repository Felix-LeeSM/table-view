import { useState, useRef, useEffect } from "react";
import { ChevronRight, ChevronDown, Trash2, Pencil } from "lucide-react";
import { Input } from "@components/ui/input";
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
  const [collapsed, setCollapsed] = useState(group.collapsed);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const renameRef = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
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
            onClick={() => {
              if (!renaming) setCollapsed(!collapsed);
            }}
            onKeyDown={(e) => {
              if (renaming) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setCollapsed(!collapsed);
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
            <span className="ml-1 text-[10px]">({connections.length})</span>
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
          <ContextMenuItem danger onClick={() => removeGroup(group.id)}>
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
          />
        ))}
    </>
  );
}
