import { useCallback, useState } from "react";
import { logger } from "@/lib/logger";
import { toast } from "@/lib/toast";
import { dropCollection } from "@lib/tauri";
import { analyzeMongoOperation } from "@lib/mongo/mongoSafety";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import { recordHistoryEntry } from "@lib/history/recordHistoryEntry";

interface DropDialogState {
  database: string;
  collection: string;
}

/**
 * Drop-collection flow: Safe Mode gate → confirmation dialog → backend
 * mutation → history record. Mirrors the SchemaTree drop-table flow.
 */
export function useDocumentDatabaseDrop(connectionId: string) {
  const loadCollections = useDocumentCatalogStore((s) => s.loadCollections);
  const safeModeGate = useSafeModeGate(connectionId);

  const [dropDialog, setDropDialog] = useState<DropDialogState | null>(null);
  const [isDropping, setIsDropping] = useState(false);

  const requestDrop = useCallback(
    (database: string, collection: string) => {
      const decision = safeModeGate.decide(
        analyzeMongoOperation({ kind: "dropCollection" }),
      );
      if (decision.action === "block") {
        toast.error(decision.reason);
        return;
      }
      // `confirm` (Safe Mode warn-prod) and `allow` (non-prod) both fall
      // through to the destructive-confirm dialog.
      setDropDialog({ database, collection });
    },
    [safeModeGate],
  );

  const confirmDrop = useCallback(async () => {
    if (!dropDialog) return;
    const { database, collection } = dropDialog;
    setIsDropping(true);
    const recordedSql = `db.${collection}.drop()`;
    const startedAt = Date.now();
    try {
      await dropCollection(connectionId, database, collection, true);
      recordHistoryEntry({
        sql: recordedSql,
        executedAt: startedAt,
        duration: Date.now() - startedAt,
        status: "success",
        connectionId,
        paradigm: "document",
        queryMode: "deleteMany",
        database,
        collection,
        source: "mongo-op",
      });
      await loadCollections(connectionId, database);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to drop ${database}.${collection}: ${detail}`);
      logger.error("[DocumentDatabaseTree] dropCollection:", err);
      recordHistoryEntry({
        sql: recordedSql,
        executedAt: startedAt,
        duration: Date.now() - startedAt,
        status: "error",
        connectionId,
        paradigm: "document",
        queryMode: "deleteMany",
        database,
        collection,
        source: "mongo-op",
      });
    } finally {
      setIsDropping(false);
      setDropDialog(null);
    }
  }, [dropDialog, connectionId, loadCollections]);

  const cancelDrop = useCallback(() => setDropDialog(null), []);

  return {
    dropDialog,
    isDropping,
    requestDrop,
    confirmDrop,
    cancelDrop,
  };
}
