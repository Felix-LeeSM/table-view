import { useCallback, useState } from "react";
import { toast } from "@/lib/toast";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import {
  deleteMany as invokeDeleteMany,
  updateMany as invokeUpdateMany,
} from "@lib/tauri";
import { analyzeMongoOperation } from "@lib/mongo/mongoSafety";
import type { SafeModeGate } from "@hooks/useSafeModeGate";

/**
 * Sprint 210 — `useMongoBulkOps` extracts the Mongo bulk-write decision
 * flow (Sprint 198) from `DocumentDataGrid`:
 *
 *   - encapsulates the Safe Mode gate (`safeModeGate.decide(analyzeMongoOperation(...))`)
 *     for both `deleteMany` and `updateMany`,
 *   - parses + validates the `updateMany` JSON patch (rejects empty / non-object /
 *     array / `_id`-bearing patches with the existing inline error copy),
 *   - dispatches `invokeDeleteMany(connectionId, database, collection, activeFilter)` /
 *     `invokeUpdateMany(connectionId, database, collection, activeFilter, patch)`,
 *   - emits the same success/error toasts (`Deleted/Updated {N} document(s)` /
 *     `Failed to delete: {detail}` / inline alert for update),
 *   - records the matching `addHistoryEntry` payload in the same order as
 *     before (`source: "mongo-op"`, `paradigm: "document"`, `queryMode: "find"`),
 *   - triggers `fetchData` after a successful write to repaint the grid.
 *
 * The hook owns dialog open flags + per-dialog loading flags so the entry
 * file only wires presentational dialog components. No JSX, no Tauri calls
 * outside the two `invoke*` helpers, no store mutations beyond
 * `addHistoryEntry`.
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

export function useMongoBulkOps({
  connectionId,
  database,
  collection,
  activeFilter,
  safeModeGate,
  fetchData,
}: UseMongoBulkOpsParams): UseMongoBulkOpsResult {
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);

  // Sprint 198 — bulk-write dialogs. Both share the current `activeFilter`
  // as their target predicate; an empty filter ⇒ "whole collection" which
  // the Safe Mode gate classifies as `danger`.
  const [deleteManyDialogOpen, setDeleteManyDialogOpen] = useState(false);
  const [deleteManyLoading, setDeleteManyLoading] = useState(false);
  const [updateManyDialogOpen, setUpdateManyDialogOpen] = useState(false);
  const [updateManyLoading, setUpdateManyLoading] = useState(false);
  const [updatePatchInput, setUpdatePatchInput] = useState("");
  const [updateManyError, setUpdateManyError] = useState<string | null>(null);

  // Sprint 198 — Delete matching. Uses the current `activeFilter` as the
  // predicate. Safe Mode gate runs before opening the dialog so the user
  // never sees a confirm modal that's about to be blocked anyway.
  const handleDeleteManyClick = useCallback(() => {
    const decision = safeModeGate.decide(
      analyzeMongoOperation({ kind: "deleteMany", filter: activeFilter }),
    );
    if (decision.action === "block") {
      toast.error(decision.reason);
      return;
    }
    setDeleteManyDialogOpen(true);
  }, [safeModeGate, activeFilter]);

  const handleConfirmDeleteMany = useCallback(async () => {
    setDeleteManyLoading(true);
    const startedAt = Date.now();
    const filterJson = JSON.stringify(activeFilter);
    const recordedSql = `db.${collection}.deleteMany(${filterJson})`;
    try {
      const deletedCount = await invokeDeleteMany(
        connectionId,
        database,
        collection,
        activeFilter,
      );
      toast.success(`Deleted ${deletedCount} document(s)`);
      setDeleteManyDialogOpen(false);
      await fetchData();
      addHistoryEntry({
        sql: recordedSql,
        executedAt: startedAt,
        duration: Date.now() - startedAt,
        status: "success",
        connectionId,
        paradigm: "document",
        queryMode: "find",
        database,
        collection,
        source: "mongo-op",
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to delete: ${detail}`);
      addHistoryEntry({
        sql: recordedSql,
        executedAt: startedAt,
        duration: Date.now() - startedAt,
        status: "error",
        connectionId,
        paradigm: "document",
        queryMode: "find",
        database,
        collection,
        source: "mongo-op",
      });
    } finally {
      setDeleteManyLoading(false);
    }
  }, [
    activeFilter,
    connectionId,
    database,
    collection,
    fetchData,
    addHistoryEntry,
  ]);

  // Sprint 198 — Update matching. Opens patch-input dialog; Safe Mode gate
  // runs again on submit (filter-state could change between open + submit).
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
    const filterJson = JSON.stringify(activeFilter);
    const patchJson = JSON.stringify(patch);
    const recordedSql = `db.${collection}.updateMany(${filterJson}, { $set: ${patchJson} })`;
    try {
      const modifiedCount = await invokeUpdateMany(
        connectionId,
        database,
        collection,
        activeFilter,
        patch,
      );
      toast.success(`Updated ${modifiedCount} document(s)`);
      setUpdateManyDialogOpen(false);
      await fetchData();
      addHistoryEntry({
        sql: recordedSql,
        executedAt: startedAt,
        duration: Date.now() - startedAt,
        status: "success",
        connectionId,
        paradigm: "document",
        queryMode: "find",
        database,
        collection,
        source: "mongo-op",
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setUpdateManyError(detail);
      addHistoryEntry({
        sql: recordedSql,
        executedAt: startedAt,
        duration: Date.now() - startedAt,
        status: "error",
        connectionId,
        paradigm: "document",
        queryMode: "find",
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
    addHistoryEntry,
  ]);

  return {
    deleteManyDialogOpen,
    deleteManyLoading,
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
