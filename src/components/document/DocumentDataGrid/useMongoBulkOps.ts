import { useCallback, useState } from "react";
import { toast } from "@/lib/runtime/toast";
import { recordHistoryEntry } from "@lib/runtime/history/recordHistoryEntry";
import {
  deleteMany as invokeDeleteMany,
  updateMany as invokeUpdateMany,
} from "@lib/tauri";
import { analyzeMongoOperation } from "@lib/mongo/mongoSafety";
import { safeStringifyCell } from "@lib/jsonCell";
import type { SafeModeGate } from "@hooks/useSafeModeGate";

/**
 * Mongo bulk-write decision flow for `DocumentDataGrid`. Owns:
 *   - Safe Mode gate (`analyzeMongoOperation` → `safeModeGate.decide`)
 *     for both `deleteMany` and `updateMany`,
 *   - the `updateMany` JSON patch parser (rejects non-object / array /
 *     `_id`-bearing patches with inline error copy),
 *   - `invokeDeleteMany` / `invokeUpdateMany` dispatch + toast + history,
 *   - dialog open flags and per-dialog loading flags.
 *
 * No JSX. No Tauri calls outside the two `invoke*` helpers. No store
 * mutations beyond `addHistoryEntry`.
 */

export interface UseMongoBulkOpsParams {
  connectionId: string;
  database: string;
  collection: string;
  activeFilter: Record<string, unknown>;
  safeModeGate: SafeModeGate;
  fetchData: () => Promise<void>;
}

export interface UseMongoBulkOpsResult {
  // Delete dialog state + handlers
  deleteManyDialogOpen: boolean;
  deleteManyLoading: boolean;
  deleteManyError: string | null;
  setDeleteManyDialogOpen: (open: boolean) => void;
  handleDeleteManyClick: () => void;
  handleConfirmDeleteMany: () => Promise<void>;

  // Update dialog state + handlers
  updateManyDialogOpen: boolean;
  updateManyLoading: boolean;
  updatePatchInput: string;
  updateManyError: string | null;
  setUpdateManyDialogOpen: (open: boolean) => void;
  setUpdatePatchInput: (value: string) => void;
  handleUpdateManyClick: () => void;
  handleConfirmUpdateMany: () => Promise<void>;
}

const MONGO_BULK_DELETE_PARTIAL_COMMIT_WARNING =
  "deleteMany is not wrapped in a transaction. If MongoDB reports an error after matching work starts, some matched documents may already be deleted. Retry only after reviewing the current collection state.";

const MONGO_BULK_UPDATE_PARTIAL_COMMIT_WARNING =
  "updateMany is not wrapped in a transaction. If MongoDB reports an error after matching work starts, some matched documents may already be updated. Retry only after reviewing the current collection state.";

function formatMongoBulkOpFailure(detail: string, warning: string): string {
  return `${warning} ${detail}`;
}

export function useMongoBulkOps({
  connectionId,
  database,
  collection,
  activeFilter,
  safeModeGate,
  fetchData,
}: UseMongoBulkOpsParams): UseMongoBulkOpsResult {
  // sprint-373 — `recordHistoryEntry` 가 disable gate + wire shape normalise.
  // Both dialogs share the current `activeFilter` as their predicate; an
  // empty filter ⇒ "whole collection", which the Safe Mode gate classifies
  // as `danger`.
  const [deleteManyDialogOpen, setDeleteManyDialogOpen] = useState(false);
  const [deleteManyLoading, setDeleteManyLoading] = useState(false);
  const [deleteManyError, setDeleteManyError] = useState<string | null>(null);
  const [updateManyDialogOpen, setUpdateManyDialogOpen] = useState(false);
  const [updateManyLoading, setUpdateManyLoading] = useState(false);
  const [updatePatchInput, setUpdatePatchInput] = useState("");
  const [updateManyError, setUpdateManyError] = useState<string | null>(null);

  // Safe Mode gate runs before opening the dialog so the user never sees
  // a confirm modal that's about to be blocked anyway.
  const handleDeleteManyClick = useCallback(() => {
    const decision = safeModeGate.decide(
      analyzeMongoOperation({ kind: "deleteMany", filter: activeFilter }),
    );
    if (decision.action === "block") {
      toast.error(decision.reason);
      return;
    }
    setDeleteManyError(null);
    setDeleteManyDialogOpen(true);
  }, [safeModeGate, activeFilter]);

  const handleConfirmDeleteMany = useCallback(async () => {
    setDeleteManyLoading(true);
    const startedAt = Date.now();
    const filterJson = safeStringifyCell(activeFilter);
    const recordedSql = `db.${collection}.deleteMany(${filterJson})`;
    try {
      const deletedCount = await invokeDeleteMany(
        connectionId,
        database,
        collection,
        activeFilter,
        true,
      );
      toast.success(`Deleted ${deletedCount} document(s)`);
      setDeleteManyDialogOpen(false);
      await fetchData();
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
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const message = formatMongoBulkOpFailure(
        detail,
        MONGO_BULK_DELETE_PARTIAL_COMMIT_WARNING,
      );
      setDeleteManyError(message);
      toast.error(`Failed to delete: ${message}`);
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
      setDeleteManyLoading(false);
    }
  }, [activeFilter, connectionId, database, collection, fetchData]);

  // Re-runs the Safe Mode gate on submit too — filter state can change
  // between dialog open and submit.
  const handleUpdateManyClick = useCallback(() => {
    const decision = safeModeGate.decide(
      analyzeMongoOperation({
        kind: "updateMany",
        filter: activeFilter,
        patch: {},
      }),
    );
    if (decision.action === "block") {
      toast.error(decision.reason);
      return;
    }
    setUpdatePatchInput("");
    setUpdateManyError(null);
    setUpdateManyDialogOpen(true);
  }, [safeModeGate, activeFilter]);

  const handleConfirmUpdateMany = useCallback(async () => {
    let patch: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(updatePatchInput);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setUpdateManyError("Patch must be a JSON object");
        return;
      }
      patch = parsed as Record<string, unknown>;
    } catch (e) {
      setUpdateManyError(
        `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if ("_id" in patch) {
      setUpdateManyError("Patch must not contain _id");
      return;
    }
    setUpdateManyLoading(true);
    const startedAt = Date.now();
    const filterJson = safeStringifyCell(activeFilter);
    const patchJson = safeStringifyCell(patch);
    const recordedSql = `db.${collection}.updateMany(${filterJson}, { $set: ${patchJson} })`;
    try {
      const modifiedCount = await invokeUpdateMany(
        connectionId,
        database,
        collection,
        activeFilter,
        patch,
        true,
      );
      toast.success(`Updated ${modifiedCount} document(s)`);
      setUpdateManyDialogOpen(false);
      await fetchData();
      recordHistoryEntry({
        sql: recordedSql,
        executedAt: startedAt,
        duration: Date.now() - startedAt,
        status: "success",
        connectionId,
        paradigm: "document",
        queryMode: "updateMany",
        database,
        collection,
        source: "mongo-op",
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setUpdateManyError(
        formatMongoBulkOpFailure(
          detail,
          MONGO_BULK_UPDATE_PARTIAL_COMMIT_WARNING,
        ),
      );
      recordHistoryEntry({
        sql: recordedSql,
        executedAt: startedAt,
        duration: Date.now() - startedAt,
        status: "error",
        connectionId,
        paradigm: "document",
        queryMode: "updateMany",
        database,
        collection,
        source: "mongo-op",
      });
    } finally {
      setUpdateManyLoading(false);
    }
  }, [
    updatePatchInput,
    activeFilter,
    connectionId,
    database,
    collection,
    fetchData,
  ]);

  return {
    deleteManyDialogOpen,
    deleteManyLoading,
    deleteManyError,
    setDeleteManyDialogOpen,
    handleDeleteManyClick,
    handleConfirmDeleteMany,

    updateManyDialogOpen,
    updateManyLoading,
    updatePatchInput,
    updateManyError,
    setUpdateManyDialogOpen,
    setUpdatePatchInput,
    handleUpdateManyClick,
    handleConfirmUpdateMany,
  };
}
