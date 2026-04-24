import { Database, MousePointerClick, Plug } from "lucide-react";
import { Button } from "@components/ui/button";
import { useConnectionStore } from "@stores/connectionStore";
import DocumentDatabaseTree from "./DocumentDatabaseTree";
import SchemaTree from "./SchemaTree";

interface SchemaPanelProps {
  /** Connection whose schema tree should be displayed. Null when nothing selected. */
  selectedId: string | null;
}

/**
 * Single-connection schema browser. Renders the SchemaTree for the currently
 * selected connection only — a deliberate departure from the previous Sidebar
 * which stacked every connected schema vertically. Keeping a single tree in
 * view at a time makes the visual hierarchy (connection vs. schema/table)
 * unmistakable and matches the TablePlus mental model where you "open" a
 * connection and explore inside it.
 */
export default function SchemaPanel({ selectedId }: SchemaPanelProps) {
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const connectToDatabase = useConnectionStore((s) => s.connectToDatabase);

  if (connections.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center select-none"
        role="status"
      >
        <Database size={36} className="mb-3 text-muted-foreground" />
        <p className="text-sm font-medium text-secondary-foreground">
          No connections yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Switch to the Connections tab and add your first database
        </p>
      </div>
    );
  }

  if (!selectedId) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center select-none"
        role="status"
      >
        <MousePointerClick size={28} className="mb-2 text-muted-foreground" />
        <p className="text-sm font-medium text-secondary-foreground">
          Select a connection
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a connection from the Connections tab to view its schemas
        </p>
      </div>
    );
  }

  const selected = connections.find((c) => c.id === selectedId);
  if (!selected) {
    return null;
  }

  const status = activeStatuses[selectedId];
  const isConnected = status?.type === "connected";
  const isConnecting = status?.type === "connecting";
  const isError = status?.type === "error";

  if (!isConnected) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center select-none"
        role="status"
      >
        <Plug size={28} className="mb-2 text-muted-foreground" />
        <p className="text-sm font-medium text-secondary-foreground">
          {selected.name}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {isConnecting ? (
            "Connecting…"
          ) : isError ? (
            `Failed to connect: ${status?.type === "error" ? status.message : ""}`
          ) : (
            <>
              Double-click in the Connections tab to connect, or{" "}
              <Button
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => connectToDatabase(selectedId)}
              >
                connect now
              </Button>
            </>
          )}
        </p>
      </div>
    );
  }

  // Sprint 66: document-paradigm connections (MongoDB) branch to the
  // dedicated databases/collections tree instead of the RDB SchemaTree so
  // the sidebar always shows the idioms of the underlying store.
  const isDocument = selected.paradigm === "document";

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {isDocument ? (
        <DocumentDatabaseTree connectionId={selectedId} />
      ) : (
        <SchemaTree connectionId={selectedId} />
      )}
    </div>
  );
}
