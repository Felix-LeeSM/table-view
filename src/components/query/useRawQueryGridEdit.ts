import { useCallback, useEffect, useState } from "react";
import {
  cellToEditString,
  editKey,
} from "@components/datagrid/useDataGridEdit";
import { buildRawEditSql, type RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";
import { executeQueryBatch } from "@lib/tauri";
import { analyzeStatement } from "@lib/sql/sqlSafety";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSafeModeGate } from "@/hooks/useSafeModeGate";
import { toast } from "@lib/toast";
import type { QueryResult } from "@/types/query";

/**
 * Raw-query result grid edit state machine + commit lifecycle hook. 8
 * responsibilities live here:
 *   1. PK-based cell-edit state machine (`editingCell` / `editValue` /
 *      `pendingEdits` Map / `pendingDeletedRowKeys` Set / unchanged-skip).
 *   2. `noPk` guard (defense-in-depth start-edit + context-menu + banner).
 *   3. SQL preview lifecycle (`buildRawEditSql` → `sqlPreview`).
 *   4. Safe Mode gate (`useSafeModeGate` + `analyzeStatement` decide loop).
 *   5. Warn-tier handoff (`pendingConfirm`; verbatim cancel message
 *      `"Safe Mode (warn): confirmation cancelled — no changes committed"`).
 *   6. Execute batch (`executeQueryBatch` + `executing` / `executeError`
 *      lifecycle + `onAfterCommit`).
 *   7. Query history (`addHistoryEntry` with `source: "grid-edit"`,
 *      `paradigm: "rdb"`, `queryMode: "sql"`; failure prefix
 *      `"Commit failed — all changes rolled back: ${msg}"` verbatim).
 *   8. Cmd+S `commit-changes` window event listener + guard.
 *
 * Behaviour change is 0 — 2 regression tests stay byte-identical. P8
 * second step (cross-component DRY with the structured-grid commit
 * runner) is deferred to a follow-up sprint; this hook stays internal
 * to `src/components/query/`.
 */

export interface UseRawQueryGridEditOptions {
  result: QueryResult;
  connectionId: string;
  plan: RawEditPlan;
  /** Called after a successful commit so the parent can re-run the query. */
  onAfterCommit?: () => void;
}

export interface UseRawQueryGridEditResult {
  // Read-only flags
  noPk: boolean;
  hasPendingChanges: boolean;
  // Cell editing state
  editingCell: { row: number; col: number } | null;
  editValue: string;
  setEditValue: (v: string) => void;
  // Pending changes
  pendingEdits: Map<string, string>;
  pendingDeletedRowKeys: Set<string>;
  // SQL preview / executor lifecycle
  sqlPreview: string[] | null;
  executing: boolean;
  executeError: string | null;
  /** Warn-tier handoff — non-null while ConfirmDestructiveDialog is mounted. */
  pendingConfirm: { reason: string; sql: string } | null;
  // Edit handlers
  startEdit: (rowIdx: number, colIdx: number) => void;
  cancelEdit: () => void;
  saveCurrentEdit: () => void;
  deleteRow: (rowIdx: number) => void;
  // Pending revert / discard
  handleRevertEdit: (key: string) => void;
  handleRevertDelete: (rowKey: string) => void;
  handleDiscard: () => void;
  // Commit lifecycle
  handleCommit: () => void;
  handleExecute: () => Promise<void>;
  confirmDangerous: () => Promise<void>;
  cancelDangerous: () => void;
  /** Reset SQL preview + executeError together (Cancel / X click). */
  dismissPreview: () => void;
}

const rowKeyFn = (rowIdx: number): string => `row-1-${rowIdx}`;

export function useRawQueryGridEdit({
  result,
  connectionId,
  plan,
  onAfterCommit,
}: UseRawQueryGridEditOptions): UseRawQueryGridEditResult {
  const [editingCell, setEditingCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pendingEdits, setPendingEdits] = useState<Map<string, string>>(
    new Map(),
  );
  const [pendingDeletedRowKeys, setPendingDeletedRowKeys] = useState<
    Set<string>
  >(new Set());
  const [sqlPreview, setSqlPreview] = useState<string[] | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  // Warn-tier handoff: populated when warn mode + production +
  // dangerous statement, consumed by `<ConfirmDestructiveDialog>`.
  const [pendingConfirm, setPendingConfirm] = useState<{
    reason: string;
    sql: string;
  } | null>(null);

  // Safe Mode gate. Environment selection for the production stripe is
  // intentionally *not* owned by the hook — that stripe is UI-only and
  // remains in the component.
  const safeModeGate = useSafeModeGate(connectionId);
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);

  // Defense-in-depth: `analyzeResultEditability` already routes PK-less
  // results to the read-only `<ResultTable>`, so this guard only fires
  // if some future caller mounts us directly. Without it, `buildPkWhere`
  // would emit `WHERE ;` and the DB would reject with a syntax error.
  const noPk = plan.pkColumns.length === 0;

  const hasPendingChanges =
    pendingEdits.size > 0 || pendingDeletedRowKeys.size > 0;

  const persistInflightEdit = useCallback(
    (prev: Map<string, string>): Map<string, string> => {
      if (!editingCell) return prev;
      const key = editKey(editingCell.row, editingCell.col);
      const original = result.rows[editingCell.row]?.[editingCell.col];
      const originalStr = cellToEditString(original);
      if (editValue === originalStr) {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      }
      const next = new Map(prev);
      next.set(key, editValue);
      return next;
    },
    [editingCell, editValue, result.rows],
  );

  const startEdit = useCallback(
    (rowIdx: number, colIdx: number) => {
      if (noPk) return;
      // Persist the previous in-flight edit (with the unchanged-skip rule)
      // before opening a new editor.
      setPendingEdits(persistInflightEdit);
      const cell = result.rows[rowIdx]?.[colIdx];
      const key = editKey(rowIdx, colIdx);
      const pending = pendingEdits.get(key);
      setEditingCell({ row: rowIdx, col: colIdx });
      setEditValue(pending ?? cellToEditString(cell));
    },
    [noPk, pendingEdits, persistInflightEdit, result.rows],
  );

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  const saveCurrentEdit = useCallback(() => {
    setPendingEdits(persistInflightEdit);
    setEditingCell(null);
    setEditValue("");
  }, [persistInflightEdit]);

  const deleteRow = useCallback((rowIdx: number) => {
    setPendingDeletedRowKeys((prev) => {
      const next = new Set(prev);
      next.add(rowKeyFn(rowIdx));
      return next;
    });
  }, []);

  const handleCommit = useCallback(() => {
    // Fold the in-flight edit (if any) into pendingEdits before previewing.
    const merged = persistInflightEdit(pendingEdits);
    const sqls = buildRawEditSql(
      result.rows,
      merged,
      pendingDeletedRowKeys,
      plan,
    );
    if (sqls.length === 0) return;
    setPendingEdits(merged);
    setEditingCell(null);
    setEditValue("");
    setSqlPreview(sqls);
  }, [
    pendingEdits,
    pendingDeletedRowKeys,
    plan,
    result.rows,
    persistInflightEdit,
  ]);

  const handleRevertEdit = useCallback((key: string) => {
    setPendingEdits((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const handleRevertDelete = useCallback((rowKey: string) => {
    setPendingDeletedRowKeys((prev) => {
      if (!prev.has(rowKey)) return prev;
      const next = new Set(prev);
      next.delete(rowKey);
      return next;
    });
  }, []);

  const handleDiscard = useCallback(() => {
    setPendingEdits(new Map());
    setPendingDeletedRowKeys(new Set());
    setEditingCell(null);
    setEditValue("");
    setSqlPreview(null);
    setExecuteError(null);
  }, []);

  const dismissPreview = useCallback(() => {
    setSqlPreview(null);
    setExecuteError(null);
  }, []);

  // Extracted so the warn-tier `confirmDangerous` path reuses the same
  // try/catch + cleanup without duplicating the body.
  const runBatch = useCallback(
    async (sqls: string[]) => {
      setExecuting(true);
      setExecuteError(null);
      const startedAt = Date.now();
      const joinedSql = sqls.join(";\n");
      try {
        await executeQueryBatch(connectionId, sqls, `raw-edit-${Date.now()}`);
        setSqlPreview(null);
        setPendingEdits(new Map());
        setPendingDeletedRowKeys(new Set());
        onAfterCommit?.();
        addHistoryEntry({
          sql: joinedSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "success",
          connectionId,
          paradigm: "rdb",
          queryMode: "sql",
          source: "grid-edit",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setExecuteError(`Commit failed — all changes rolled back: ${message}`);
        addHistoryEntry({
          sql: joinedSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "error",
          connectionId,
          paradigm: "rdb",
          queryMode: "sql",
          source: "grid-edit",
        });
      } finally {
        setExecuting(false);
      }
    },
    [connectionId, onAfterCommit, addHistoryEntry],
  );

  const handleExecute = useCallback(async () => {
    if (!sqlPreview) return;
    // Run every preview statement through the Safe Mode gate.
    // block → setExecuteError + toast; confirm → pendingConfirm (dialog
    // handoff); allow → fall through.
    for (const sql of sqlPreview) {
      const analysis = analyzeStatement(sql);
      const decision = safeModeGate.decide(analysis);
      if (decision.action === "block") {
        setExecuteError(decision.reason);
        toast.error(decision.reason);
        return;
      }
      if (decision.action === "confirm") {
        setPendingConfirm({ reason: decision.reason, sql });
        return;
      }
    }
    await runBatch(sqlPreview);
  }, [sqlPreview, safeModeGate, runBatch]);

  const confirmDangerous = useCallback(async () => {
    if (!pendingConfirm || !sqlPreview) return;
    setPendingConfirm(null);
    await runBatch(sqlPreview);
  }, [pendingConfirm, sqlPreview, runBatch]);

  const cancelDangerous = useCallback(() => {
    if (!pendingConfirm) return;
    const message =
      "Safe Mode (warn): confirmation cancelled — no changes committed";
    setExecuteError(message);
    setPendingConfirm(null);
    toast.info(message);
  }, [pendingConfirm]);

  // Cmd+S → commit. We listen on window so the global App-level dispatch
  // (already wired up for Cmd+S) reaches us when this grid is on screen.
  useEffect(() => {
    const handler = () => {
      if (!hasPendingChanges && !editingCell) return;
      handleCommit();
    };
    window.addEventListener("commit-changes", handler);
    return () => window.removeEventListener("commit-changes", handler);
  }, [hasPendingChanges, editingCell, handleCommit]);

  return {
    noPk,
    hasPendingChanges,
    editingCell,
    editValue,
    setEditValue,
    pendingEdits,
    pendingDeletedRowKeys,
    sqlPreview,
    executing,
    executeError,
    pendingConfirm,
    startEdit,
    cancelEdit,
    saveCurrentEdit,
    deleteRow,
    handleRevertEdit,
    handleRevertDelete,
    handleDiscard,
    handleCommit,
    handleExecute,
    confirmDangerous,
    cancelDangerous,
    dismissPreview,
  };
}
