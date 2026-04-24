import { useState, useRef } from "react";
import type {
  ConnectionConfig,
  ConnectionStatus,
  EnvironmentTag,
} from "@/types/connection";
import { Button } from "@components/ui/button";
import { ENVIRONMENT_META } from "@/types/connection";
import { useConnectionStore } from "@stores/connectionStore";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@components/ui/context-menu";
import ConnectionDialog from "./ConnectionDialog";
import { DB_TYPE_META } from "@lib/db-meta";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@components/ui/dialog";
import {
  Database,
  Plug,
  Unplug,
  Pencil,
  Trash2,
  Loader2,
  X,
} from "lucide-react";

/** Module-level drag state shared between ConnectionItem, ConnectionGroup, ConnectionList */
export let draggedConnectionId: string | null = null;

interface ConnectionItemProps {
  connection: ConnectionConfig;
  /** When true, shows a selected ring around the row. */
  selected?: boolean;
  /** Single-click handler — used by the Sidebar to set the focused connection. */
  onSelect?: (id: string) => void;
  /** Fired after a successful double-click connect, so the parent can switch panes. */
  onActivate?: (id: string) => void;
}

function StatusIndicator({ status }: { status: ConnectionStatus }) {
  if (status.type === "connecting") {
    return (
      <Loader2
        size={10}
        className="shrink-0 animate-spin text-muted-foreground"
        aria-label="Connecting"
      />
    );
  }
  if (status.type === "connected") {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full bg-success"
        aria-label="Connected"
      />
    );
  }
  if (status.type === "error") {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full bg-destructive"
        title={status.message}
        aria-label={`Error: ${status.message}`}
      />
    );
  }
  return (
    <span
      className="inline-block h-2 w-2 rounded-full bg-muted-foreground"
      aria-label="Disconnected"
    />
  );
}

export default function ConnectionItem({
  connection,
  selected = false,
  onSelect,
  onActivate,
}: ConnectionItemProps) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const connectToDatabase = useConnectionStore((s) => s.connectToDatabase);
  const disconnectFromDatabase = useConnectionStore(
    (s) => s.disconnectFromDatabase,
  );
  const removeConnection = useConnectionStore((s) => s.removeConnection);

  const status = activeStatuses[connection.id] ?? { type: "disconnected" };
  const isConnected = status.type === "connected";
  const isConnecting = status.type === "connecting";
  const errorMessage = status.type === "error" ? status.message : null;
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  const handleSingleClick = () => {
    onSelect?.(connection.id);
  };

  const handleDoubleClick = async () => {
    if (!isConnected && !isConnecting) {
      await connectToDatabase(connection.id);
      const status =
        useConnectionStore.getState().activeStatuses[connection.id];
      if (status?.type === "connected") {
        onActivate?.(connection.id);
      }
    } else if (isConnected) {
      // Already connected — treat double-click as "activate" so the sidebar
      // jumps straight to the schema view.
      onActivate?.(connection.id);
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={dragRef}
            className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted select-none ${
              dragging ? "opacity-40" : ""
            } ${selected ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            draggable
            aria-label={`${connection.name} — ${status.type === "connected" ? "connected" : status.type === "connecting" ? "connecting" : status.type === "error" ? "error" : "disconnected"}`}
            onClick={handleSingleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleDoubleClick();
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
            <Database size={14} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-sm text-foreground">
              {connection.name}
            </span>
            {connection.environment &&
              connection.environment in ENVIRONMENT_META && (
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none"
                  style={{
                    backgroundColor: `${ENVIRONMENT_META[connection.environment as EnvironmentTag].color}20`,
                    color:
                      ENVIRONMENT_META[connection.environment as EnvironmentTag]
                        .color,
                  }}
                  title={
                    ENVIRONMENT_META[connection.environment as EnvironmentTag]
                      .label
                  }
                >
                  {
                    ENVIRONMENT_META[connection.environment as EnvironmentTag]
                      .label
                  }
                </span>
              )}
            <span
              className="ml-auto shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold leading-none"
              style={{
                backgroundColor: `${DB_TYPE_META[connection.db_type].color}20`,
                color: DB_TYPE_META[connection.db_type].color,
              }}
              title={connection.db_type}
            >
              {DB_TYPE_META[connection.db_type].short}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={isConnecting}
            onClick={async () => {
              if (isConnected) {
                await disconnectFromDatabase(connection.id);
              } else {
                await connectToDatabase(connection.id);
              }
            }}
          >
            {isConnected ? <Unplug size={14} /> : <Plug size={14} />}
            {isConnected ? "Disconnect" : "Connect"}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setShowEditDialog(true)}>
            <Pencil size={14} /> Edit
          </ContextMenuItem>
          <ContextMenuItem danger onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 size={14} /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {errorMessage && !showErrorDetail && (
        <Button
          variant="ghost"
          size="xs"
          className="h-auto w-full justify-start px-3 py-0 text-left"
          onClick={() => setShowErrorDetail(true)}
          aria-label="Show error details"
        >
          <span className="shrink-0 w-2" />
          <span className="truncate text-[10px] text-destructive">
            {errorMessage}
          </span>
        </Button>
      )}
      {errorMessage && showErrorDetail && (
        <div className="flex w-full items-start gap-2 px-3 py-0">
          <span className="shrink-0 w-2" />
          <span className="break-all text-[10px] text-destructive">
            {errorMessage}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setShowErrorDetail(false)}
            aria-label="Hide error details"
          >
            <X />
          </Button>
        </div>
      )}

      {showEditDialog && (
        <ConnectionDialog
          connection={connection}
          onClose={() => setShowEditDialog(false)}
        />
      )}

      {showDeleteConfirm && (
        <Dialog
          open={showDeleteConfirm}
          onOpenChange={(open) => !open && setShowDeleteConfirm(false)}
        >
          <DialogContent
            className="w-80 bg-secondary p-4"
            showCloseButton={false}
          >
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold text-foreground">
                Delete Connection
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm text-secondary-foreground">
                Are you sure you want to delete &quot;{connection.name}&quot;?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await removeConnection(connection.id);
                  setShowDeleteConfirm(false);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
