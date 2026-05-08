import { useEffect, useState } from "react";
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

/**
 * Sprint 236 — `DropColumnDialog`. Mirrors the Sprint 235
 * `DropTableDialog` shell shape with the column-drop field set:
 * typing-confirm input ("Type the column name to confirm") + CASCADE
 * checkbox (default OFF, label `"Drop dependent objects (CASCADE)"`
 * per Sprint 236 user spec — DIVERGES from Sprint 235's CASCADE label)
 * + inline DDL preview pane + Cancel + Show DDL + Apply
 * (variant=destructive) buttons.
 *
 * Apply is `disabled` UNTIL the typing-confirm input matches the
 * column name byte-for-byte (case-sensitive — `Email` ≠ `email`). NO
 * trim, NO debounce, every keystroke re-evaluates (mirror Sprint 235
 * `DropTableDialog`).
 *
 * Toggling CASCADE invalidates the cached preview so the next Show
 * DDL click re-fetches with the new SQL.
 *
 * Safe Mode dispatch is provided by `useDdlPreviewExecution` —
 * `ALTER TABLE … DROP COLUMN` is classified as `ddl-drop`/danger by
 * `analyzeStatement`, so the production-strict tier blocks, the
 * production-warn tier escalates to `pendingConfirm` (additional
 * `ConfirmDangerousDialog` mounts on top of the typing-confirm gate),
 * and non-production / mode=off allows.
 *
 * On commit success the dialog calls `onColumnDropped()` which the
 * parent `ColumnsEditor` wires to `onRefresh` → `getTableColumns`
 * (writes through the `tableColumnsCache`).
 */

export interface DropColumnDialogProps {
  /** Connection id used by the Safe Mode gate + history record. */
  connectionId: string;
  /** Schema name (display + payload). */
  schemaName: string;
  /** Target table name (display + payload). */
  tableName: string;
  /** Column name to drop (typing-confirm target + payload). */
  columnName: string;
  /** Modal closes when set false. */
  open: boolean;
  /** Called on Cancel / outside-close / commit-success. */
  onClose: () => void;
  /**
   * Called once after a successful commit so the parent can re-fetch
   * its column slice. Awaited inside `useDdlPreviewExecution.runCommit`
   * via the `onRefresh` prop of the hook.
   */
  onColumnDropped: () => Promise<void>;
}

export default function DropColumnDialog({
  connectionId,
  schemaName,
  tableName,
  columnName,
  open,
  onClose,
  onColumnDropped,
}: DropColumnDialogProps) {
  const [typingConfirm, setTypingConfirm] = useState("");
  const [cascade, setCascade] = useState(false);
  // Preview pane defaults open — auto-debounced fetch fills it as the
  // user types. Hiding it by default required an extra click and made
  // users think the preview was broken.
  const [showDdl, setShowDdl] = useState(true);

  const ddl = useDdlPreviewExecution({
    connectionId,
    onRefresh: async () => {
      await onColumnDropped();
      onClose();
    },
  });

  // Reset form state on (re)open.
  useEffect(() => {
    if (open) {
      setTypingConfirm("");
      setCascade(false);
      setShowDdl(true);
      ddl.cancelPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, columnName, tableName, schemaName]);

  // Sprint 236 — typing-confirm match is case-sensitive byte-for-byte.
  // No trim, no debounce — every keystroke re-evaluates (mirror Sprint
  // 235 `DropTableDialog`).
  const typingMatches = typingConfirm === columnName;
  const canPreview = typingMatches;
  const canApply = canPreview && !ddl.previewLoading && !!ddl.previewSql;

  // Sprint 238 — auto-refresh debounced. CASCADE 토글 + typing-confirm
  // 매치 시 자동으로 preview SQL 을 다시 빌드. Apply 버튼은 stale 게이트
  // 없이 preview 가 존재하기만 하면 활성화.
  useEffect(() => {
    if (!open) return;
    if (!canPreview) return;
    const handle = window.setTimeout(() => {
      void ddl.loadPreview(
        async () => {
          const result = await tauri.dropColumnRequest({
            connectionId,
            schema: schemaName,
            table: tableName,
            columnName,
            cascade,
            previewOnly: true,
          });
          return { sql: result.sql };
        },
        () => async () => {
          await tauri.dropColumnRequest({
            connectionId,
            schema: schemaName,
            table: tableName,
            columnName,
            cascade,
            previewOnly: false,
          });
        },
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    canPreview,
    cascade,
    connectionId,
    schemaName,
    tableName,
    columnName,
  ]);

  const handleShowDdl = () => {
    setShowDdl((s) => !s);
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
                Drop Column
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {schemaName}.{tableName}.{columnName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                This action cannot be undone. Type the column name to confirm.
              </p>
              <div>
                <label
                  htmlFor="drop-column-typing-confirm"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  Type the column name to confirm
                </label>
                <input
                  id="drop-column-typing-confirm"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={typingConfirm}
                  onChange={(e) => setTypingConfirm(e.target.value)}
                  placeholder={columnName}
                  aria-label="Type the column name to confirm"
                  autoFocus
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={cascade}
                  onChange={(e) => setCascade(e.target.checked)}
                  className="rounded border-border"
                  aria-label="CASCADE"
                />
                Drop dependent objects (CASCADE)
              </label>
            </div>

            <div className="border-t border-border">
              <button
                type="button"
                onClick={handleShowDdl}
                // Toggle is always enabled now; the pane shows helpful empty/loading states
                className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-secondary-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                aria-expanded={showDdl}
                aria-controls="drop-column-ddl-preview"
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
                  id="drop-column-ddl-preview"
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
                      -- Type the column name to see the generated SQL
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
                variant="destructive"
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
