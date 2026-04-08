import { useState } from "react";
import { ChevronRight, ChevronDown, Trash2, Pencil } from "lucide-react";
import type {
  ConnectionConfig,
  ConnectionGroup as ConnectionGroupType,
} from "../types/connection";
import { useConnectionStore } from "../stores/connectionStore";
import ConnectionItem from "./ConnectionItem";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

interface ConnectionGroupProps {
  group: ConnectionGroupType;
  connections: ConnectionConfig[];
}

export default function ConnectionGroup({
  group,
  connections,
}: ConnectionGroupProps) {
  const [collapsed, setCollapsed] = useState(group.collapsed);
  const removeGroup = useConnectionStore((s) => s.removeGroup);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const menuItems: ContextMenuItem[] = [
    {
      label: "Rename",
      icon: <Pencil size={14} />,
      onClick: () => {
        // TODO: rename dialog
      },
    },
    {
      label: "Delete Group",
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => {
        removeGroup(group.id);
      },
    },
  ];

  return (
    <>
      <div
        className="flex cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium uppercase tracking-wider text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={`${group.name} group (${connections.length} connections)`}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed(!collapsed);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="truncate">{group.name}</span>
        <span className="ml-1 text-[10px]">({connections.length})</span>
      </div>

      {!collapsed &&
        connections.map((conn) => (
          <ConnectionItem key={conn.id} connection={conn} />
        ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
