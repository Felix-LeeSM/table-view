import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import * as tauri from "@lib/tauri";
import { useDdlPreviewExecution } from "@components/structure/useDdlPreviewExecution";
import ConfirmDangerousDialog from "@components/workspace/ConfirmDangerousDialog";
import SqlSyntax from "@components/shared/SqlSyntax";
import CreateTableTypeCombobox from "./CreateTableTypeCombobox";
import { usePostgresTypes } from "@hooks/usePostgresTypes";
import type { ColumnInfo } from "@/types/schema";

/**
 * Sprint 236 — `AddColumnDialog`. Modal that mirrors the Sprint 235
 * `RenameTableDialog` shell shape but with the column-add field set:
 * column name input + type combobox (`<CreateTableTypeCombobox>`
 * reused with `typesSource` + `typeKindMap` from
 * `usePostgresTypes(connectionId)`) + NOT NULL toggle (default OFF —
 * nullable is the default per locked decision) + DEFAULT free-text +
 * CHECK free-text + collapsible Show DDL pane (default collapsed,
 * mirror Sprint 226 `CreateTableDialog`).
 *
 * Apply is `disabled` when:
 *   - name fails identifier validation
 *     (`^[a-zA-Z_][a-zA-Z0-9_]*$`, ≤ 63 bytes),
 *   - type combobox value is empty / whitespace,
 *   - preview SQL has not been fetched OR the preview is stale,
 *   - name collides with an existing column from the loaded `columns`
 *     prop (collision pre-check renders an inline hint; backend stays
 *     permissive — PG surfaces the verbatim error if the user hits the
 *     IPC directly).
 *
 * `useDdlPreviewExecution` (Sprint 214) owns the preview/execute
 * lifecycle including Safe Mode gate dispatch. ADD COLUMN is
 * classified `ddl-other`/safe so the gate is a no-op-equivalent — but
 * the `pendingConfirm` mount stays in place for the warn-tier case
 * (defense-in-depth, mirrors Sprint 235 dialogs).
 *
 * On commit success the dialog calls `onColumnAdded()` which the
 * parent `ColumnsEditor` wires to `onRefresh` → `getTableColumns`
 * (writes through the `tableColumnsCache`). NO direct
 * `useSchemaTableMutations` call (Sprint 223 hook is table-scoped, see
 * Sprint 236 contract Decisions §Cache invalidation path).
 */

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const IDENTIFIER_MAX_BYTES = 63;

export interface AddColumnDialogProps {
  /** Connection id used by Safe Mode + `usePostgresTypes`. */
  connectionId: string;
  /** Schema name (display + payload). */
  schemaName: string;
  /** Target table name (display + payload). */
  tableName: string;
  /** Loaded column list — used for the collision pre-check. */
  columns: ColumnInfo[];
  /** Modal closes when set false. */
  open: boolean;
  /** Called on Cancel / outside-close / commit-success. */
  onClose: () => void;
  /**
   * Called once after a successful commit so the parent can re-fetch
   * its column slice. Awaited inside `useDdlPreviewExecution.runCommit`
   * via the `onRefresh` prop of the hook.
   */
  onColumnAdded: () => Promise<void>;
}

function validateIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Column name must not be empty";
  }
  if (new TextEncoder().encode(trimmed).length > IDENTIFIER_MAX_BYTES) {
    return `Column name must not exceed ${IDENTIFIER_MAX_BYTES} bytes`;
  }
  if (!IDENTIFIER_RE.test(trimmed)) {
    return "Column name must start with a letter or underscore and contain only alphanumeric characters and underscores";
  }
  return null;
}

export default function AddColumnDialog({
  connectionId,
  schemaName,
  tableName,
  columns,
  open,
  onClose,
  onColumnAdded,
}: AddColumnDialogProps) {
  const [columnName, setColumnName] = useState("");
  const [dataType, setDataType] = useState("");
  const [notNull, setNotNull] = useState(false);
  const [defaultExpr, setDefaultExpr] = useState("");
  const [checkExpr, setCheckExpr] = useState("");
  const [showDdl, setShowDdl] = useState(false);
  const [previewStale, setPreviewStale] = useState(false);

  const { types, typesByName } = usePostgresTypes(connectionId);

  const ddl = useDdlPreviewExecution({
    connectionId,
    onRefresh: async () => {
      // The parent (`ColumnsEditor`) is responsible for refetching
      // columns; the hook awaits this so a refresh failure surfaces as
      // a commit-error history entry (Sprint 187/196 parity).
      await onColumnAdded();
      onClose();
    },
  });

  // Reset form state on (re)open. Same pattern as Sprint 235 dialogs.
  useEffect(() => {
    if (open) {
      setColumnName("");
      setDataType("");
      setNotNull(false);
      setDefaultExpr("");
      setCheckExpr("");
      setShowDdl(false);
      setPreviewStale(false);
      ddl.cancelPreview();
    }
    // Intentional narrow deps — `tableName` / `schemaName` are the
    // seeds that drive identity reset on retarget; `ddl.cancelPreview`
    // is stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tableName, schemaName]);

  const validationError = validateIdentifier(columnName);
  const trimmedType = dataType.trim();
  const trimmedName = columnName.trim();
  const collision = useMemo(
    () => columns.some((c) => c.name === trimmedName),
    [columns, trimmedName],
  );

  const canPreview = !validationError && trimmedType.length > 0 && !collision;
  const canApply =
    canPreview && !ddl.previewLoading && !previewStale && !!ddl.previewSql;

  const invalidatePreview = () => {
    if (ddl.previewSql) {
      setPreviewStale(true);
      setShowDdl(false);
      ddl.cancelPreview();
    }
  };

  const handleNameChange = (value: string) => {
    setColumnName(value);
    invalidatePreview();
  };
  const handleTypeChange = (value: string) => {
    setDataType(value);
    invalidatePreview();
  };
  const handleNotNullChange = (next: boolean) => {
    setNotNull(next);
    invalidatePreview();
  };
  const handleDefaultChange = (value: string) => {
    setDefaultExpr(value);
    invalidatePreview();
  };
  const handleCheckChange = (value: string) => {
    setCheckExpr(value);
    invalidatePreview();
  };

  const buildRequest = (previewOnly: boolean) => ({
    connectionId,
    schema: schemaName,
    table: tableName,
    column: {
      name: trimmedName,
      data_type: trimmedType,
      nullable: !notNull,
      default_value: defaultExpr.trim().length > 0 ? defaultExpr : null,
    },
    checkExpression: checkExpr.trim().length > 0 ? checkExpr : null,
    previewOnly,
  });

  const handleShowDdl = async () => {
    if (showDdl && !previewStale) {
      setShowDdl(false);
      return;
    }
    setShowDdl(true);
    setPreviewStale(false);
    if (!canPreview) return;
    await ddl.loadPreview(
      async () => {
        const result = await tauri.addColumnRequest(buildRequest(true));
        return { sql: result.sql };
      },
      // Commit closure — re-issue the request with previewOnly:false.
      // The hook's `onRefresh` (above) calls `onColumnAdded` +
      // `onClose` in sequence.
      () => async () => {
        await tauri.addColumnRequest(buildRequest(false));
      },
    );
  };

  const handleApply = async () => {
    if (!ddl.previewSql) return;
    await ddl.attemptExecute();
  };

  const handleCancel = () => {
    ddl.cancelPreview();
    onClose();
  };

  const ddlButtonLabel = showDdl ? "Hide DDL" : "Show DDL";

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
            <DialogHeader className="border-b border-border px-4 py-3">
              <DialogTitle className="text-sm font-semibold text-foreground">
                Add Column
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {schemaName}.{tableName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-4 py-3">
              <div>
                <label
                  htmlFor="add-column-name"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  Column name
                </label>
                <input
                  id="add-column-name"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={columnName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="column_name"
                  aria-label="Column name"
                  autoFocus
                />
                {validationError && columnName.length > 0 && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label="Identifier validation error"
                  >
                    {validationError}
                  </p>
                )}
                {!validationError && collision && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label="Column name collision"
                  >
                    Column &quot;{trimmedName}&quot; already exists
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="add-column-type"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  Type
                </label>
                <CreateTableTypeCombobox
                  value={dataType}
                  typesSource={types}
                  typeKindMap={typesByName}
                  onChange={handleTypeChange}
                  ariaLabel="Column data type"
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={notNull}
                    onChange={(e) => handleNotNullChange(e.target.checked)}
                    className="rounded border-border"
                    aria-label="NOT NULL"
                  />
                  NOT NULL
                </label>
              </div>

              <div>
                <label
                  htmlFor="add-column-default"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  DEFAULT (optional)
                </label>
                <input
                  id="add-column-default"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={defaultExpr}
                  onChange={(e) => handleDefaultChange(e.target.value)}
                  placeholder="e.g. 0, now(), 'pending'"
                  aria-label="DEFAULT expression"
                />
              </div>

              <div>
                <label
                  htmlFor="add-column-check"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  CHECK (optional)
                </label>
                <input
                  id="add-column-check"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={checkExpr}
                  onChange={(e) => handleCheckChange(e.target.value)}
                  placeholder="e.g. age >= 0"
                  aria-label="CHECK expression"
                />
              </div>
            </div>

            <div className="border-t border-border">
              <button
                type="button"
                onClick={handleShowDdl}
                disabled={!canPreview && !showDdl}
                className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-secondary-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                aria-expanded={showDdl}
                aria-controls="add-column-ddl-preview"
                aria-label={ddlButtonLabel}
              >
                <span>{ddlButtonLabel}</span>
                {showDdl ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
              </button>
              {showDdl && (
                <div
                  id="add-column-ddl-preview"
                  className="border-t border-border bg-background px-4 py-2"
                >
                  {ddl.previewLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      Generating preview…
                    </div>
                  ) : ddl.previewError ? (
                    <pre
                      className="max-h-scroll-md overflow-auto whitespace-pre-wrap rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
                      role="alert"
                    >
                      {ddl.previewError}
                    </pre>
                  ) : ddl.previewSql ? (
                    <pre className="max-h-scroll-md overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs font-mono text-foreground">
                      <SqlSyntax sql={ddl.previewSql} />
                    </pre>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">
                      -- Fill in name + type to see the generated SQL
                    </span>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleApply}
                disabled={!canApply}
                aria-label="Apply"
              >
                {ddl.previewLoading ? (
                  <Loader2 className="animate-spin size-3.5" />
                ) : null}
                Apply
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

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
