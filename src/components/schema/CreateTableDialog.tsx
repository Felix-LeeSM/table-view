import { useMemo, useState } from "react";
import { Plus, Minus, X, Eye, Loader2 } from "lucide-react";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@components/ui/dialog";
import * as tauri from "@lib/tauri";
import SqlPreviewDialog from "@components/structure/SqlPreviewDialog";
import { useDdlPreviewExecution } from "@components/structure/useDdlPreviewExecution";
import { useConnectionStore } from "@stores/connectionStore";
import ConfirmDangerousDialog from "@components/workspace/ConfirmDangerousDialog";
import type { ColumnDefinition } from "@/types/schema";

/**
 * `CreateTableDialog` — Sprint 226 / Phase 27 sprint 1.
 *
 * Modal that surfaces the CREATE TABLE GUI parity surface. Owns form
 * state (table name + column-row repeater + PK multi-select) and
 * delegates the preview/execute lifecycle to the Sprint 214 hook
 * `useDdlPreviewExecution`. Safe Mode gating + history record + canonical
 * warn-cancel message are inherited from the hook unchanged.
 *
 * Design notes:
 * - No anticipatory abstraction. The modal mirrors `IndexesEditor`'s
 *   `CreateIndexModal` pattern (shadcn `Dialog` + `useState` form +
 *   "Preview SQL" button) and the column-row idiom from
 *   `ColumnsEditor`'s `NewColumnRow`.
 * - Modal-local state only — no Zustand store added.
 * - Schema name is read-only (entry-point seeds it from the right-clicked
 *   schema row in `SchemaTree`).
 * - PK multi-select dereferences columns whose name is removed/renamed
 *   on every render via `validPkColumns`, so the backend's defensive
 *   "PK references undeclared column" path is unreachable from the UI
 *   in normal flow.
 */

interface ColumnDraft {
  trackingId: string;
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string;
  is_pk: boolean;
}

function newDraft(): ColumnDraft {
  return {
    trackingId:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    name: "",
    data_type: "",
    nullable: true,
    default_value: "",
    is_pk: false,
  };
}

export interface CreateTableDialogProps {
  /** Connection id used by the Safe Mode gate + history record. */
  connectionId: string;
  /** Right-clicked schema name; rendered read-only inside the modal. */
  schemaName: string;
  /** Modal closes when set false (Dialog open/close pattern). */
  open: boolean;
  /** Called on Cancel / outside-close / commit-success. */
  onClose: () => void;
  /**
   * Called once after a successful commit so the SchemaTree can
   * re-fetch the schema's table list. Awaited — failures bubble back
   * into the Sprint 214 hook's commit catch branch.
   */
  onRefresh: () => Promise<void>;
}

export default function CreateTableDialog({
  connectionId,
  schemaName,
  open,
  onClose,
  onRefresh,
}: CreateTableDialogProps) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([newDraft()]);

  // Read environment off the store so the SqlPreviewDialog renders the
  // production stripe identically to sibling editors.
  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );

  const ddl = useDdlPreviewExecution({
    connectionId,
    onRefresh: async () => {
      await onRefresh();
      // Successful commit closes the modal. Form reset is safe here
      // because the hook's `runCommit` already cleared `previewSql`
      // before `onRefresh` ran, and the Dialog `onOpenChange` path
      // would otherwise leave stale state on the next open.
      resetForm();
      onClose();
    },
  });

  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const resetForm = () => {
    setTableName("");
    setColumns([newDraft()]);
  };

  // Live PK candidate list — derived from the current column rows so
  // removing a column row cascades into the PK selection on the next
  // render. Empty / whitespace names are excluded.
  const validPkColumns = useMemo(() => {
    return columns
      .filter((c) => c.name.trim().length > 0)
      .map((c) => c.name.trim());
  }, [columns]);

  // Preview SQL button gating: at least one valid (name + type) column row
  // and a non-empty table name.
  const hasValidColumn = columns.some(
    (c) => c.name.trim().length > 0 && c.data_type.trim().length > 0,
  );
  const canPreview = tableName.trim().length > 0 && hasValidColumn;

  const handleAddColumn = () => {
    setColumns((prev) => [...prev, newDraft()]);
  };

  const handleRemoveColumn = (trackingId: string) => {
    setColumns((prev) => {
      // Block removing the last row — at least one column row is part
      // of the form contract (matches the backend "must have at least
      // one column" validator + the disabled state of "Preview SQL").
      if (prev.length <= 1) return prev;
      return prev.filter((c) => c.trackingId !== trackingId);
    });
  };

  const handleUpdateColumn = (
    trackingId: string,
    updates: Partial<ColumnDraft>,
  ) => {
    setColumns((prev) =>
      prev.map((c) => (c.trackingId === trackingId ? { ...c, ...updates } : c)),
    );
  };

  const buildRequest = (previewOnly: boolean) => {
    const pkColumns = columns
      .filter((c) => c.is_pk && c.name.trim().length > 0)
      .map((c) => c.name.trim());
    const columnDefs: ColumnDefinition[] = columns
      .filter((c) => c.name.trim().length > 0 && c.data_type.trim().length > 0)
      .map((c) => ({
        name: c.name.trim(),
        data_type: c.data_type.trim(),
        nullable: c.nullable,
        default_value: c.default_value.trim() ? c.default_value.trim() : null,
      }));
    return {
      connection_id: connectionId,
      schema: schemaName,
      name: tableName.trim(),
      columns: columnDefs,
      primary_key: pkColumns.length > 0 ? pkColumns : null,
      preview_only: previewOnly,
    };
  };

  const handlePreview = async () => {
    if (!canPreview) return;
    setShowPreviewModal(true);
    await ddl.loadPreview(
      () => tauri.createTable(buildRequest(true)),
      () => async () => {
        await tauri.createTable(buildRequest(false));
        setShowPreviewModal(false);
      },
    );
  };

  const handlePreviewCancel = () => {
    setShowPreviewModal(false);
    ddl.cancelPreview();
  };

  const handleCancel = () => {
    ddl.cancelPreview();
    resetForm();
    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) handleCancel();
        }}
      >
        <DialogContent
          className="w-dialog-md bg-secondary p-0"
          showCloseButton={false}
        >
          <div className="rounded-lg bg-secondary shadow-xl">
            {/* Header */}
            <DialogHeader className="flex items-center justify-between border-b border-border px-4 py-3">
              <DialogTitle className="text-sm font-semibold text-foreground">
                Create Table
              </DialogTitle>
              <DialogDescription className="sr-only">
                Create a new table in {schemaName}
              </DialogDescription>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleCancel}
                aria-label="Close dialog"
              >
                <X />
              </Button>
            </DialogHeader>

            {/* Form */}
            <div className="space-y-3 px-4 py-3">
              {/* Schema (read-only) */}
              <div>
                <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                  Schema
                </label>
                <input
                  className="w-full rounded border border-border bg-muted px-2 py-1.5 text-sm text-muted-foreground outline-none"
                  value={schemaName}
                  readOnly
                  aria-label="Schema name"
                  aria-readonly="true"
                />
              </div>

              {/* Table name */}
              <div>
                <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                  Table name
                </label>
                <input
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="my_new_table"
                  aria-label="Table name"
                  autoFocus
                />
              </div>

              {/* Column rows */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-secondary-foreground">
                    Columns
                  </label>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleAddColumn}
                    aria-label="Add column"
                  >
                    <Plus />
                    Column
                  </Button>
                </div>
                <div className="space-y-1">
                  {columns.map((col) => (
                    <div
                      key={col.trackingId}
                      className="flex items-start gap-1.5 rounded border border-border bg-background p-2"
                    >
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex gap-1.5">
                          <input
                            className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                            value={col.name}
                            onChange={(e) =>
                              handleUpdateColumn(col.trackingId, {
                                name: e.target.value,
                              })
                            }
                            placeholder="column_name"
                            aria-label="Column name"
                          />
                          <input
                            className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                            value={col.data_type}
                            onChange={(e) =>
                              handleUpdateColumn(col.trackingId, {
                                data_type: e.target.value,
                              })
                            }
                            placeholder="varchar(255)"
                            aria-label="Column data type"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex cursor-pointer items-center gap-1 text-xs text-foreground">
                            <input
                              type="checkbox"
                              checked={col.nullable}
                              onChange={(e) =>
                                handleUpdateColumn(col.trackingId, {
                                  nullable: e.target.checked,
                                })
                              }
                              className="rounded border-border"
                              aria-label="Column nullable"
                            />
                            Nullable
                          </label>
                          <input
                            className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                            value={col.default_value}
                            onChange={(e) =>
                              handleUpdateColumn(col.trackingId, {
                                default_value: e.target.value,
                              })
                            }
                            placeholder="default value (optional)"
                            aria-label="Column default value"
                          />
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleRemoveColumn(col.trackingId)}
                        disabled={columns.length <= 1}
                        aria-label="Remove column"
                        title={
                          columns.length <= 1
                            ? "At least one column required"
                            : "Remove column"
                        }
                      >
                        <Minus />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Primary key multi-select */}
              <div>
                <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                  Primary key
                </label>
                <div
                  className="max-h-scroll-sm overflow-auto rounded border border-border bg-background p-2"
                  aria-label="Primary key columns"
                >
                  {validPkColumns.length === 0 ? (
                    <span className="text-xs italic text-muted-foreground">
                      Add a column with a name to choose primary key columns
                    </span>
                  ) : (
                    validPkColumns.map((colName) => {
                      const draft = columns.find(
                        (c) => c.name.trim() === colName,
                      );
                      const checked = !!draft?.is_pk;
                      return (
                        <label
                          key={colName}
                          className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-foreground hover:bg-muted"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (!draft) return;
                              handleUpdateColumn(draft.trackingId, {
                                is_pk: e.target.checked,
                              });
                            }}
                            className="rounded border-border"
                            aria-label={`Primary key: ${colName}`}
                          />
                          {colName}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <DialogFooter className="border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handlePreview}
                disabled={!canPreview || ddl.previewLoading}
                aria-label="Preview SQL"
              >
                {ddl.previewLoading ? (
                  <Loader2 className="animate-spin size-3.5" />
                ) : (
                  <Eye />
                )}
                Preview SQL
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* SQL Preview Modal — mounted as a sibling so it stacks above the
          create-table form. Reuses Sprint 214's `useDdlPreviewExecution`
          state for sql / loading / error / commit closure. */}
      {showPreviewModal && (
        <SqlPreviewDialog
          sql={ddl.previewSql}
          loading={ddl.previewLoading}
          error={ddl.previewError}
          environment={connectionEnvironment}
          onConfirm={ddl.attemptExecute}
          onCancel={handlePreviewCancel}
        />
      )}

      {/* Warn-tier confirmation dialog. Stacks above the SQL preview. */}
      {ddl.pendingConfirm && (
        <ConfirmDangerousDialog
          open
          reason={ddl.pendingConfirm.reason}
          sqlPreview={ddl.pendingConfirm.sql}
          onConfirm={() => {
            void ddl.confirmDangerous();
          }}
          onCancel={ddl.cancelDangerous}
        />
      )}
    </>
  );
}
