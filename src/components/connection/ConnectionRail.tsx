import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import type {
  ConnectionConfig,
  ConnectionStatus,
  EnvironmentTag,
} from "@/types/connection";
import { ENVIRONMENT_META } from "@/types/connection";
import { DB_TYPE_META } from "@lib/db-meta";
import { useConnectionStore } from "@stores/connectionStore";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@components/shared/ContextMenu";
import ConnectionDialog from "./ConnectionDialog";

interface ConnectionRailProps {
  /** Currently selected connection (the one whose schema is shown). */
  selectedId: string | null;
  /** Called when the user picks a connection in the rail. */
  onSelect: (id: string) => void;
  /** Optional new-connection click handler (defaults to opening the dialog). */
  onNewConnection?: () => void;
}

/**
 * Vertical rail of connection icons (VS Code activity-bar style).
 *
 * The rail is the primary entry point for switching between connections — a
 * single click selects which connection's schema is displayed in the adjacent
 * SchemaPanel, a double-click toggles the live database connection, and a
 * right-click opens the management context menu.
 */
export default function ConnectionRail({
  selectedId,
  onSelect,
  onNewConnection,
}: ConnectionRailProps) {
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const connectToDatabase = useConnectionStore((s) => s.connectToDatabase);
  const disconnectFromDatabase = useConnectionStore(
    (s) => s.disconnectFromDatabase,
  );
  const removeConnection = useConnectionStore((s) => s.removeConnection);

  const [contextMenu, setContextMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [editing, setEditing] = useState<ConnectionConfig | null>(null);
  const [showNew, setShowNew] = useState(false);

  const handleNew = () => {
    if (onNewConnection) onNewConnection();
    else setShowNew(true);
  };

  const handleDoubleClick = async (conn: ConnectionConfig) => {
    const status = activeStatuses[conn.id];
    if (status?.type === "connected") {
      try {
        await disconnectFromDatabase(conn.id);
      } catch {
        /* ignored — surfaced via store error state */
      }
    } else {
      try {
        await connectToDatabase(conn.id);
        onSelect(conn.id);
      } catch {
        /* ignored — surfaced via store error state */
      }
    }
  };

  const buildContextMenu = (
    conn: ConnectionConfig,
    status: ConnectionStatus | undefined,
  ): ContextMenuItem[] => {
    const isConnected = status?.type === "connected";
    return [
      {
        label: isConnected ? "Disconnect" : "Connect",
        onClick: () => handleDoubleClick(conn),
      },
      {
        label: "Edit",
        onClick: () => setEditing(conn),
      },
      {
        label: "Delete",
        danger: true,
        onClick: async () => {
          try {
            await removeConnection(conn.id);
          } catch {
            /* ignored */
          }
        },
      },
    ];
  };

  return (
    <>
      <div
        className="relative flex h-full w-12 shrink-0 flex-col items-center border-r border-border bg-secondary py-2 select-none"
        role="toolbar"
        aria-label="Connections"
      >
        {connections.map((conn) => {
          const status = activeStatuses[conn.id];
          const isConnected = status?.type === "connected";
          const isConnecting = status?.type === "connecting";
          const isError = status?.type === "error";
          const isSelected = selectedId === conn.id;
          const dbColor = DB_TYPE_META[conn.db_type]?.color ?? "#888";
          const envColor = conn.environment
            ? ENVIRONMENT_META[conn.environment as EnvironmentTag]?.color
            : null;
          const short = DB_TYPE_META[conn.db_type]?.short ?? "DB";
          return (
            <button
              key={conn.id}
              type="button"
              aria-label={`${conn.name} (${conn.db_type})`}
              aria-pressed={isSelected}
              title={conn.name}
              onClick={() => onSelect(conn.id)}
              onDoubleClick={() => handleDoubleClick(conn)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect(conn.id);
                setContextMenu({ id: conn.id, x: e.clientX, y: e.clientY });
              }}
              className={`relative my-0.5 flex h-9 w-9 items-center justify-center rounded-md text-[10px] font-bold ${
                isSelected
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-secondary"
                  : "hover:opacity-90"
              } ${isConnected ? "" : "opacity-60 grayscale"}`}
              style={{
                backgroundColor: `${dbColor}22`,
                color: dbColor,
                border: `1px solid ${dbColor}66`,
              }}
            >
              {isConnecting ? (
                <Loader2
                  size={14}
                  className="animate-spin"
                  aria-label="Connecting"
                />
              ) : (
                short
              )}
              {/* Connection status dot (top-right) */}
              <span
                className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${
                  isConnected
                    ? "bg-emerald-500"
                    : isError
                      ? "bg-destructive"
                      : "bg-muted-foreground"
                }`}
                aria-hidden
              />
              {/* Environment badge (bottom-left) */}
              {envColor && (
                <span
                  className="absolute -bottom-0.5 -left-0.5 h-2 w-2 rounded-full"
                  style={{ backgroundColor: envColor }}
                  aria-hidden
                />
              )}
            </button>
          );
        })}

        <div className="mt-auto" />
        <button
          type="button"
          onClick={handleNew}
          className="my-1 flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted hover:text-secondary-foreground"
          aria-label="New Connection"
          title="New Connection"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Per-item context menu */}
      {contextMenu &&
        (() => {
          const conn = connections.find((c) => c.id === contextMenu.id);
          if (!conn) return null;
          const items = buildContextMenu(conn, activeStatuses[conn.id]);
          return (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              items={items}
              onClose={() => setContextMenu(null)}
            />
          );
        })()}

      {/* Edit dialog */}
      {editing && (
        <ConnectionDialog
          connection={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {/* Local "new" dialog when no parent handler supplied */}
      {showNew && <ConnectionDialog onClose={() => setShowNew(false)} />}
    </>
  );
}
