import { useCallback, useState } from "react";
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
import ConfirmDestructiveDialog from "@components/workspace/ConfirmDestructiveDialog";
import {
  cellToEditString,
  editKey,
  getInputTypeForColumn,
} from "@components/datagrid/useDataGridEdit";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";
import { useConnectionStore } from "@stores/connectionStore";
import { ENVIRONMENT_META, type EnvironmentTag } from "@/types/connection";
import PendingChangesTray from "./PendingChangesTray";
import { useRawQueryGridEdit } from "./useRawQueryGridEdit";

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
 *
 * All edit state, commit lifecycle, Safe Mode gate, history recording,
 * and the Cmd+S listener live inside `useRawQueryGridEdit`. The component
 * owns only UI-local state (context menu / cell detail dialog), the
 * production stripe selector, and JSX rendering.
 */
export default function EditableQueryResultGrid({
  result,
  connectionId,
  plan,
  onAfterCommit,
}: EditableQueryResultGridProps) {
  const grid = useRawQueryGridEdit({
    result,
    connectionId,
    plan,
    onAfterCommit,
  });

  // UI-only environment selector for the production stripe banner. The
  // Safe Mode gate is wired through the hook above; this is purely a
  // visual hint over the SQL preview header.
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
          disabled: grid.noPk,
          onClick: () => grid.startEdit(contextMenu.rowIdx, contextMenu.colIdx),
        },
        {
          label: "Delete Row",
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: grid.noPk,
          onClick: () => grid.deleteRow(contextMenu.rowIdx),
        },
      ]
    : [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {grid.noPk && (
        <div
          role="status"
          className="border-b border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
        >
          Read-only — primary key required to edit
        </div>
      )}
      {/* Edit toolbar — only visible when there are pending changes. */}
      {grid.hasPendingChanges && (
        <div className="flex items-center justify-between border-b border-border bg-warning/10 px-3 py-1.5 text-xs">
          <span className="text-foreground">
            {grid.pendingEdits.size} edit
            {grid.pendingEdits.size !== 1 ? "s" : ""},{" "}
            {grid.pendingDeletedRowKeys.size} delete
            {grid.pendingDeletedRowKeys.size !== 1 ? "s" : ""} pending
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="xs"
              onClick={grid.handleDiscard}
              aria-label="Discard pending changes"
            >
              <X size={12} />
              Discard
            </Button>
            <Button
              size="xs"
              onClick={grid.handleCommit}
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
        pendingEdits={grid.pendingEdits}
        pendingDeletedRowKeys={grid.pendingDeletedRowKeys}
        plan={plan}
        onRevertEdit={grid.handleRevertEdit}
        onRevertDelete={grid.handleRevertDelete}
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
              const isDeleted = grid.pendingDeletedRowKeys.has(rk);
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
                      grid.editingCell?.row === rowIdx &&
                      grid.editingCell?.col === colIdx;
                    const hasPendingEdit = grid.pendingEdits.has(key);
                    const cellStr = cellToEditString(cell);
                    const displayValue = hasPendingEdit
                      ? grid.pendingEdits.get(key)!
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
                        onDoubleClick={() => grid.startEdit(rowIdx, colIdx)}
                        onClick={() => {
                          if (grid.editingCell && !isEditing) {
                            grid.saveCurrentEdit();
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
                            value={grid.editValue}
                            autoFocus
                            aria-label={`Editing ${col.name}`}
                            onChange={(e) => grid.setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                grid.saveCurrentEdit();
                              } else if (e.key === "Escape") {
                                e.stopPropagation();
                                grid.cancelEdit();
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
        open={!!grid.sqlPreview}
        onOpenChange={(open) => {
          if (!open) {
            grid.dismissPreview();
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
                grid.handleExecute();
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
                onClick={grid.dismissPreview}
                aria-label="Close SQL preview"
              >
                <X size={14} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {grid.sqlPreview?.map((sql, i) => (
                <pre
                  key={i}
                  className="mb-2 whitespace-pre-wrap break-all rounded bg-secondary p-2 text-xs text-secondary-foreground"
                >
                  {sql}
                </pre>
              ))}
              {grid.executeError && (
                <div
                  role="alert"
                  className="mt-2 rounded bg-destructive/10 p-2 text-xs text-destructive"
                >
                  {grid.executeError}
                </div>
              )}
            </div>
            <DialogFooter className="border-t border-border px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={grid.dismissPreview}
                disabled={grid.executing}
              >
                Cancel
              </Button>
              <Button
                autoFocus
                size="sm"
                className="bg-success hover:bg-success/90"
                onClick={grid.handleExecute}
                aria-label="Execute SQL"
                disabled={grid.executing}
              >
                {grid.executing ? "Executing…" : "Execute"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      {grid.pendingConfirm && (
        <ConfirmDestructiveDialog
          open={true}
          reason={grid.pendingConfirm.reason}
          sqlPreview={grid.pendingConfirm.sql}
          environment={
            connectionEnvironment === "production"
              ? "production"
              : "non-production"
          }
          onConfirm={() => {
            void grid.confirmDangerous();
          }}
          onCancel={grid.cancelDangerous}
        />
      )}
    </div>
  );
}
