import { useState, useRef } from "react";
import type { ConnectionConfig, ConnectionStatus } from "../types/connection";
import { useConnectionStore } from "../stores/connectionStore";
import { useTabStore } from "../stores/tabStore";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import ConnectionDialog from "./ConnectionDialog";
import { Database, Plug, Unplug, Pencil, Trash2 } from "lucide-react";

/** Module-level drag state shared between ConnectionItem, ConnectionGroup, ConnectionList */
export let draggedConnectionId: string | null = null;

interface ConnectionItemProps {
  connection: ConnectionConfig;
}

function StatusIndicator({ status }: { status: ConnectionStatus }) {
  if (status.type === "connected") {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full bg-(--color-success)"
        aria-label="Connected"
      />
    );
  }
  if (status.type === "error") {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full bg-(--color-danger)"
        title={status.message}
        aria-label={`Error: ${status.message}`}
      />
    );
  }
  return (
    <span
      className="inline-block h-2 w-2 rounded-full bg-(--color-text-muted)"
      aria-label="Disconnected"
    />
  );
}

export default function ConnectionItem({ connection }: ConnectionItemProps) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const connectToDatabase = useConnectionStore((s) => s.connectToDatabase);
  const disconnectFromDatabase = useConnectionStore(
    (s) => s.disconnectFromDatabase,
  );
  const removeConnection = useConnectionStore((s) => s.removeConnection);
  const addTab = useTabStore((s) => s.addTab);

  const status = activeStatuses[connection.id] ?? { type: "disconnected" };
  const isConnected = status.type === "connected";

  const handleDoubleClick = async () => {
    if (isConnected) {
      addTab({
        id: "",
        title: connection.name,
        connectionId: connection.id,
        type: "query",
        closable: true,
      });
    } else {
      try {
        await connectToDatabase(connection.id);
        addTab({
          id: "",
          title: connection.name,
          connectionId: connection.id,
          type: "query",
          closable: true,
        });
      } catch {
        // Error shown via store
      }
    }
  };

  const menuItems: ContextMenuItem[] = [
    {
      label: isConnected ? "Disconnect" : "Connect",
      icon: isConnected ? <Unplug size={14} /> : <Plug size={14} />,
      onClick: async () => {
        if (isConnected) {
          await disconnectFromDatabase(connection.id);
        } else {
          await connectToDatabase(connection.id);
        }
      },
    },
    {
      label: "Edit",
      icon: <Pencil size={14} />,
      onClick: () => setShowEditDialog(true),
    },
    {
      label: "Delete",
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => setShowDeleteConfirm(true),
    },
  ];

  return (
    <>
      <div
        ref={dragRef}
        className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-(--color-bg-tertiary) ${
          dragging ? "opacity-40" : ""
        }`}
        role="button"
        tabIndex={0}
        draggable
        aria-label={`${connection.name} — ${status.type === "connected" ? "connected" : status.type === "error" ? "error" : "disconnected"}`}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleDoubleClick();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        onDragStart={(e) => {
          draggedConnectionId = connection.id;
          setDragging(true);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", connection.id);
        }}
        onDragEnd={() => {
          draggedConnectionId = null;
          setDragging(false);
        }}
      >
        <StatusIndicator status={status} />
        <Database
          size={14}
          className="flex-shrink-0 text-(--color-text-muted)"
        />
        <span className="truncate text-sm text-(--color-text-primary)">
          {connection.name}
        </span>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {showEditDialog && (
        <ConnectionDialog
          connection={connection}
          onClose={() => setShowEditDialog(false)}
        />
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
        >
          <div className="w-80 rounded-lg bg-(--color-bg-secondary) p-4 shadow-xl">
            <h3
              id="delete-dialog-title"
              className="text-sm font-semibold text-(--color-text-primary)"
            >
              Delete Connection
            </h3>
            <p className="mt-2 text-sm text-(--color-text-secondary)">
              Are you sure you want to delete &quot;{connection.name}&quot;?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded px-3 py-1.5 text-sm text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="rounded bg-(--color-danger) px-3 py-1.5 text-sm text-white hover:bg-(--color-danger-hover)"
                onClick={async () => {
                  await removeConnection(connection.id);
                  setShowDeleteConfirm(false);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
