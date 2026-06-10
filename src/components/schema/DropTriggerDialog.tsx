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
import { ConfirmDestructiveDialog } from "@features/workspace";
import SqlSyntax from "@components/shared/SqlSyntax";
import { useConnectionStore } from "@stores/connectionStore";
import type { DropTriggerRequest } from "@/types/schema";

/**
 * Sprint 274 — `DropTriggerDialog`. Typing-confirm input + CASCADE
 * checkbox + inline DDL preview pane + Cancel + Apply buttons.
 *
 * Structural parity target: Sprint 235 `DropTableDialog`. The only
 * differences are the SQL target (DROP TRIGGER vs DROP TABLE) and the
 * typing-confirm target (trigger name vs table name).
 *
 * Apply is `disabled` UNTIL the typing-confirm input matches the
 * current trigger name byte-for-byte (case-sensitive — `Audit` ≠
 * `audit`). Per Sprint 235 contract: NO `onChange` debounce, NO trim
 * (whitespace-only matches stay invalid), every keystroke re-evaluates.
 *
 * CASCADE checkbox defaults to OFF — user opts INTO the more dangerous
 * `DROP TRIGGER … CASCADE` form explicitly. Toggling it invalidates the
 * cached preview so the next debounced auto-refresh re-fetches with the
 * new SQL.
 *
 * Safe Mode dispatch is provided by `useDdlPreviewExecution` — `DROP
 * TRIGGER` is classified as `ddl-drop` / danger by the analyzer, so the
 * production-strict tier blocks, the production-warn tier escalates to
 * `pendingConfirm` (additional `ConfirmDestructiveDialog` mounts on top
 * of the typing-confirm gate), and non-production / mode=off allows.
 *
 * Sequence:
 *   1. user types name → typing match enables Apply → click Apply.
 *   2. preview SQL fetched (or returned from cache) → `attemptExecute`.
 *   3. Safe Mode gate decides → block (previewError) | warn-confirm
 *      (pendingConfirm dialog) | safe (commit).
 *   4. on warn-confirm, user types analyzer reason → commit runs.
 *   5. on commit success, `onRefresh` invalidates the
 *      `schemaStore.triggers[connId][db][schema][table]` cache entry
 *      so the dropped trigger disappears from the SchemaTree Triggers
 *      child group + StructurePanel Triggers tab. Modal closes.
 */

export interface DropTriggerDialogProps {
  /** Connection id used by the Safe Mode gate + history record. */
  connectionId: string;
  /** Active database — schemaStore cache key dimension (Sprint 263). */
  database: string;
  /** Schema name (display + payload). */
  schemaName: string;
  /** Parent table name (display + payload). */
  tableName: string;
  /** Target trigger name (typing-confirm target + payload). */
  triggerName: string;
  /** Modal closes when set false. */
  open: boolean;
  /** Called on Cancel / outside-close / commit-success. */
  onClose: () => void;
  /**
   * Called once after a successful commit so the SchemaTree can
   * re-fetch the parent table's trigger slice. Awaited inside
   * `useDdlPreviewExecution.runCommit` via the hook's `onRefresh` prop.
   */
  onRefresh: () => Promise<void>;
}

export default function DropTriggerDialog({
  connectionId,
  database,
  schemaName,
  tableName,
  triggerName,
  open,
  onClose,
  onRefresh,
}: DropTriggerDialogProps) {
  const [typingConfirm, setTypingConfirm] = useState("");
  const [cascade, setCascade] = useState(false);
  // Preview pane defaults open — auto-debounced fetch fills it as the
  // user types. Hiding it by default required an extra click and made
  // users think the preview was broken (mirrors Sprint 235).
  const [showDdl, setShowDdl] = useState(true);

  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );

  const ddl = useDdlPreviewExecution({
    connectionId,
    onRefresh: async () => {
      await onRefresh();
      onClose();
    },
  });

  // Reset form state on (re)open. Same pattern as DropTableDialog.
  useEffect(() => {
    if (open) {
      setTypingConfirm("");
      setCascade(false);
      setShowDdl(true);
      ddl.cancelPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, triggerName, tableName, schemaName]);

  // Sprint 274 — typing-confirm match is case-sensitive byte-for-byte.
  // No trim, no debounce — every keystroke re-evaluates. Mirrors
  // DropTableDialog line 105 contract.
  const typingMatches = typingConfirm === triggerName;
  const canPreview = typingMatches;
  const canApply = canPreview && !ddl.previewLoading && !!ddl.previewSql;

  // Sprint 274 — 250ms debounced auto-refresh on every form edit
  // (typing-confirm match → canPreview flips → effect fires; CASCADE
  // toggle re-fires the preview with the new SQL). Mirrors Sprint 235
  // `DropTableDialog`.
  useEffect(() => {
    if (!open) return;
    if (!canPreview) return;
    const handle = window.setTimeout(() => {
      const buildRequest = (previewOnly: boolean): DropTriggerRequest => ({
        connectionId,
        schema: schemaName,
        table: tableName,
        triggerName,
        cascade,
        previewOnly,
        // Sprint 271c — opt-in DbMismatch guard. Forward the
        // workspace `(connId, db)` coordinate so a swapped pool
        // rejects with `AppError::DbMismatch` before the trigger is
        // dropped against the wrong database.
        expectedDatabase: database,
      });
      void ddl.loadPreview(
        async () => {
          const result = await tauri.dropTrigger(buildRequest(true));
          return { sql: result.sql };
        },
        () => async () => {
          await tauri.dropTrigger(buildRequest(false));
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
    triggerName,
    database,
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
                Drop Trigger
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {triggerName} on {schemaName}.{tableName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                This action cannot be undone. Type the trigger name to confirm.
              </p>
              <div>
                <label
                  htmlFor="drop-trigger-typing-confirm"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  Type the trigger name to confirm
                </label>
                <input
                  id="drop-trigger-typing-confirm"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={typingConfirm}
                  onChange={(e) => setTypingConfirm(e.target.value)}
                  placeholder={triggerName}
                  aria-label="Type the trigger name to confirm"
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
                CASCADE — drop dependent objects (default: off)
              </label>
            </div>

            <div className="border-t border-border">
              <button
                type="button"
                onClick={handleShowDdl}
                className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-secondary-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                aria-expanded={showDdl}
                aria-controls="drop-trigger-ddl-preview"
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
                  id="drop-trigger-ddl-preview"
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
                      -- Type the trigger name to see the generated SQL
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
        <ConfirmDestructiveDialog
          open
          reason={ddl.pendingConfirm.reason}
          sqlPreview={ddl.pendingConfirm.sql}
          environment={
            connectionEnvironment === "production"
              ? "production"
              : "non-production"
          }
          connectionId={connectionId}
          statements={[ddl.pendingConfirm.sql]}
          paradigm="rdb"
          onConfirm={() => {
            void ddl.confirmDangerous();
          }}
          onCancel={ddl.cancelDangerous}
        />
      )}
    </>
  );
}
