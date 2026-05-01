import { useCallback, useEffect, useState } from "react";
import { X, Save, Trash2, Maximize2, Pencil } from "lucide-react";
import { Button } from "@components/ui/button";
import type { QueryResult } from "@/types/query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@components/shared/ContextMenu";
import CellDetailDialog from "@components/datagrid/CellDetailDialog";
import ConfirmDangerousDialog from "@components/workspace/ConfirmDangerousDialog";
import {
  cellToEditString,
  editKey,
  getInputTypeForColumn,
} from "@components/datagrid/useDataGridEdit";
import { buildRawEditSql, type RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";
import { executeQueryBatch } from "@lib/tauri";
import { analyzeStatement } from "@lib/sql/sqlSafety";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeGate } from "@/hooks/useSafeModeGate";
import { ENVIRONMENT_META, type EnvironmentTag } from "@/types/connection";
import { toast } from "@lib/toast";
import PendingChangesTray from "./PendingChangesTray";

export interface EditableQueryResultGridProps {
  result: QueryResult;
  connectionId: string;
  plan: RawEditPlan;
  /** Called after a successful commit so the parent can re-run the query. */
  onAfterCommit?: () => void;
}

function formatCellDisplay(cell: unknown): string {
  if (cell == null) return "NULL";
  if (typeof cell === "object") return JSON.stringify(cell, null, 2);
  return String(cell);
}

/**
 * Editable grid for raw query results that mapped to a single table with
 * a primary key. Supports inline cell editing and per-row deletion via the
 * context menu, plus a SQL preview before any change is executed.
 *
 * INSERT is intentionally unsupported here — there is no canonical "row
 * shape" for raw query results, so adding rows belongs in the structured
 * table view instead.
 */
export default function EditableQueryResultGrid({
  result,
  connectionId,
  plan,
  onAfterCommit,
}: EditableQueryResultGridProps) {
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
  // Sprint 186 — warn-tier handoff. Set when warn mode + production +
  // dangerous statement; consumed by <ConfirmDangerousDialog>.
  const [pendingConfirm, setPendingConfirm] = useState<{
    reason: string;
    sql: string;
  } | null>(null);

  // Sprint 189 (AC-189-02) — Safe Mode gate via shared hook. Environment
  // is still selected separately for the production stripe banner below
  // (paradigm-agnostic UI hint, not part of the gate matrix).
  const safeModeGate = useSafeModeGate(connectionId);
  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowIdx: number;
    colIdx: number;
  } | null>(null);
  const [cellDetail, setCellDetail] = useState<{
    data: unknown;
    columnName: string;
    dataType: string;
  } | null>(null);

  const rowKeyFn = useCallback((rowIdx: number) => `row-1-${rowIdx}`, []);

  // Defense-in-depth: `analyzeResultEditability` already routes PK-less
  // results to the read-only `<ResultTable>`, so this guard only fires if
  // some future caller mounts us directly. Without it, `buildPkWhere`
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

  const deleteRow = useCallback(
    (rowIdx: number) => {
      setPendingDeletedRowKeys((prev) => {
        const next = new Set(prev);
        next.add(rowKeyFn(rowIdx));
        return next;
      });
    },
    [rowKeyFn],
  );

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

  // Sprint 186 — extracted batch runner so warn-tier confirmDangerous
  // can reuse the same try/catch + cleanup without duplicating the body.
  const runBatch = useCallback(
    async (sqls: string[]) => {
      setExecuting(true);
      setExecuteError(null);
      try {
        await executeQueryBatch(connectionId, sqls, `raw-edit-${Date.now()}`);
        setSqlPreview(null);
        setPendingEdits(new Map());
        setPendingDeletedRowKeys(new Set());
        onAfterCommit?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setExecuteError(`Commit failed — all changes rolled back: ${message}`);
      } finally {
        setExecuting(false);
      }
    },
    [connectionId, onAfterCommit],
  );

  const handleExecute = useCallback(async () => {
    if (!sqlPreview) return;
    // Sprint 189 (AC-189-02) — gate every preview statement through the
    // shared decision matrix (`decideSafeModeAction`). block → setExecuteError
    // + toast; confirm → pendingConfirm (dialog handoff); allow → fall through.
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

  const contextMenuItems: ContextMenuItem[] = contextMenu
    ? [
        {
          label: "Show Cell Details",
          icon: <Maximize2 size={14} />,
          onClick: () => {
            const cell = result.rows[contextMenu.rowIdx]?.[contextMenu.colIdx];
            const col = result.columns[contextMenu.colIdx];
            if (col) {
              setCellDetail({
                data: cell,
                columnName: col.name,
                dataType: col.data_type,
              });
            }
          },
        },
        {
          label: "Edit Cell",
          icon: <Pencil size={14} />,
          disabled: noPk,
          onClick: () => startEdit(contextMenu.rowIdx, contextMenu.colIdx),
        },
        {
          label: "Delete Row",
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: noPk,
          onClick: () => deleteRow(contextMenu.rowIdx),
        },
      ]
    : [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {noPk && (
        <div
          role="status"
          className="border-b border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
        >
          Read-only — primary key required to edit
        </div>
      )}
      {/* Edit toolbar — only visible when there are pending changes. */}
      {hasPendingChanges && (
        <div className="flex items-center justify-between border-b border-border bg-warning/10 px-3 py-1.5 text-xs">
          <span className="text-foreground">
            {pendingEdits.size} edit{pendingEdits.size !== 1 ? "s" : ""},{" "}
            {pendingDeletedRowKeys.size} delete
            {pendingDeletedRowKeys.size !== 1 ? "s" : ""} pending
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="xs"
              onClick={handleDiscard}
              aria-label="Discard pending changes"
            >
              <X size={12} />
              Discard
            </Button>
            <Button
              size="xs"
              onClick={handleCommit}
              aria-label="Commit pending changes"
            >
              <Save size={12} />
              Commit
            </Button>
          </div>
        </div>
      )}

      <PendingChangesTray
        result={result}
        pendingEdits={pendingEdits}
        pendingDeletedRowKeys={pendingDeletedRowKeys}
        plan={plan}
        onRevertEdit={handleRevertEdit}
        onRevertDelete={handleRevertDelete}
      />

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-secondary">
            <tr>
              {result.columns.map((col) => {
                const isPk = plan.pkColumns.includes(col.name);
                return (
                  <th
                    key={col.name}
                    scope="col"
                    className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground"
                  >
                    <div className="flex items-center gap-1">
                      {isPk && (
                        <span
                          title="Primary Key"
                          className="text-warning"
                          aria-label="Primary key"
                        >
                          🔑
                        </span>
                      )}
                      <span>{col.name}</span>
                    </div>
                    <div className="mt-0.5 text-3xs text-muted-foreground">
                      {col.data_type}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIdx) => {
              const rk = rowKeyFn(rowIdx);
              const isDeleted = pendingDeletedRowKeys.has(rk);
              return (
                <tr
                  key={rk}
                  className={`border-b border-border hover:bg-muted${
                    isDeleted ? " line-through opacity-50" : ""
                  }`}
                >
                  {row.map((cell, colIdx) => {
                    const col = result.columns[colIdx]!;
                    const key = editKey(rowIdx, colIdx);
                    const isEditing =
                      editingCell?.row === rowIdx &&
                      editingCell?.col === colIdx;
                    const hasPendingEdit = pendingEdits.has(key);
                    const cellStr = cellToEditString(cell);
                    const displayValue = hasPendingEdit
                      ? pendingEdits.get(key)!
                      : cellStr;

                    return (
                      <td
                        key={colIdx}
                        data-editing={isEditing ? "true" : undefined}
                        className={`overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground ${
                          isEditing
                            ? "bg-primary/10 ring-2 ring-inset ring-primary"
                            : hasPendingEdit
                              ? "bg-highlight/20"
                              : ""
                        }`}
                        title={formatCellDisplay(cell)}
                        onDoubleClick={() => startEdit(rowIdx, colIdx)}
                        onClick={() => {
                          if (editingCell && !isEditing) {
                            saveCurrentEdit();
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            rowIdx,
                            colIdx,
                          });
                        }}
                      >
                        {isEditing ? (
                          <input
                            type={getInputTypeForColumn(col.data_type)}
                            className="w-full rounded-sm border-none bg-background px-1 py-0 text-xs text-foreground shadow-sm outline-none"
                            value={editValue}
                            autoFocus
                            aria-label={`Editing ${col.name}`}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                saveCurrentEdit();
                              } else if (e.key === "Escape") {
                                e.stopPropagation();
                                cancelEdit();
                              }
                            }}
                          />
                        ) : hasPendingEdit ? (
                          <span className="line-clamp-3">{displayValue}</span>
                        ) : cell == null ? (
                          <span className="italic text-muted-foreground">
                            NULL
                          </span>
                        ) : (
                          <span className="line-clamp-3">{displayValue}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {result.rows.length === 0 && (
              <tr>
                <td
                  colSpan={result.columns.length || 1}
                  className="px-3 py-4 text-center text-xs text-muted-foreground"
                >
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={() => setContextMenu(null)}
          />
        )}
        {cellDetail && (
          <CellDetailDialog
            open={cellDetail !== null}
            onOpenChange={(open) => {
              if (!open) setCellDetail(null);
            }}
            data={cellDetail.data}
            columnName={cellDetail.columnName}
            dataType={cellDetail.dataType}
          />
        )}
      </div>

      {/* SQL Preview modal — same shape as DataGrid's preview. */}
      <Dialog
        open={!!sqlPreview}
        onOpenChange={(open) => {
          if (!open) {
            setSqlPreview(null);
            setExecuteError(null);
          }
        }}
      >
        <DialogContent
          className="w-dialog-xl max-h-[80vh] bg-background p-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>SQL Preview</DialogTitle>
            <DialogDescription>
              Preview SQL for raw query edits before executing
            </DialogDescription>
          </DialogHeader>
          <div
            className="flex max-h-[80vh] flex-col rounded-lg border border-border bg-background shadow-xl"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleExecute();
              }
            }}
          >
            {connectionEnvironment &&
              connectionEnvironment in ENVIRONMENT_META && (
                <div
                  className="h-1"
                  style={{
                    background:
                      ENVIRONMENT_META[connectionEnvironment as EnvironmentTag]
                        .color,
                  }}
                  data-environment-stripe={connectionEnvironment}
                  aria-hidden="true"
                />
              )}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                SQL Preview
              </h3>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSqlPreview(null)}
                aria-label="Close SQL preview"
              >
                <X size={14} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {sqlPreview?.map((sql, i) => (
                <pre
                  key={i}
                  className="mb-2 whitespace-pre-wrap break-all rounded bg-secondary p-2 text-xs text-secondary-foreground"
                >
                  {sql}
                </pre>
              ))}
              {executeError && (
                <div
                  role="alert"
                  className="mt-2 rounded bg-destructive/10 p-2 text-xs text-destructive"
                >
                  {executeError}
                </div>
              )}
            </div>
            <DialogFooter className="border-t border-border px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSqlPreview(null)}
                disabled={executing}
              >
                Cancel
              </Button>
              <Button
                autoFocus
                size="sm"
                className="bg-success hover:bg-success/90"
                onClick={handleExecute}
                aria-label="Execute SQL"
                disabled={executing}
              >
                {executing ? "Executing…" : "Execute"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      {pendingConfirm && (
        <ConfirmDangerousDialog
          open={true}
          reason={pendingConfirm.reason}
          sqlPreview={pendingConfirm.sql}
          onConfirm={() => {
            void confirmDangerous();
          }}
          onCancel={cancelDangerous}
        />
      )}
    </div>
  );
}
