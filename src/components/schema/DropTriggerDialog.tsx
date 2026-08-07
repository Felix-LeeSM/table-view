import SqlSyntax from "@components/shared/SqlSyntax";
import { useDdlPreviewExecution } from "@components/structure/useDdlPreviewExecution";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { ConfirmDestructiveDialog } from "@features/workspace";
import * as tauri from "@lib/tauri";
import { useConnectionStore } from "@stores/connectionStore";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DropTriggerRequest } from "@/types/schema";

/**
 * Sprint 274 — `DropTriggerDialog`. Typing-confirm input + CASCADE
 * checkbox + inline DDL preview pane + Cancel + Apply buttons.
 *
 * Structural parity target: Sprint 235 `DropTableDialog`. The only
 * differences are the SQL target (DROP TRIGGER vs DROP TABLE) and the
 * typing-confirm target (trigger name vs table name).
 *
 * Issue #2191 (the split issue #2157 made in `DropColumnDialog`) — the
 * preview gate and the execution gate are separate. The DDL preview loads
 * as soon as the dialog opens so the user reads the exact DROP statement
 * first; the typing-confirm input only decides whether it may run.
 *
 * Apply is `disabled` UNTIL the typing-confirm input matches the
 * current trigger name byte-for-byte (case-sensitive — `Audit` ≠
 * `audit`). Per Sprint 235 contract: NO `onChange` debounce, NO trim
 * (whitespace-only matches stay invalid), every keystroke re-evaluates.
 *
 * CASCADE checkbox defaults to OFF — user opts INTO the more dangerous
 * `DROP TRIGGER … CASCADE` form explicitly. Toggling it re-fetches the
 * preview by itself through the debounced auto-refresh.
 *
 * Safe Mode dispatch is provided by `useDdlPreviewExecution` — `DROP
 * TRIGGER` is classified as `ddl-drop` / danger by the analyzer. Under
 * the Sprint 245 destructive-only policy (ADR 0022 Phase 1; canonical
 * matrix in `src/lib/safeMode.ts`) every production tier and
 * non-production strict escalate to `pendingConfirm`, mounting an
 * additional `ConfirmDestructiveDialog` on top of the typing-confirm
 * gate. Non-production warn / off allow. `decideSafeModeAction` never
 * returns `block` for this path.
 *
 * Sequence:
 *   1. dialog opens → debounced preview fetch renders the DROP statement.
 *   2. user types the trigger name → typing match enables Apply → click
 *      Apply → `attemptExecute`.
 *   3. Safe Mode gate decides → confirm (pendingConfirm dialog) | allow
 *      (commit).
 *   4. on confirm, the user answers the single-click Yes/No dialog
 *      (Sprint 246 replaced the earlier type-to-confirm gate) → commit
 *      runs.
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
  const { t } = useTranslation("schemaDialogs");
  const [typingConfirm, setTypingConfirm] = useState("");
  const [cascade, setCascade] = useState(false);
  // Preview pane defaults open — the auto-debounced fetch fills it as
  // soon as the dialog opens, with no typing involved (issue #2191).
  // Hiding it by default required an extra click and made users think
  // the preview was broken (mirrors Sprint 235).
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
    // Intentional narrow deps — the open flag + name seeds re-run the form
    // reset on (re)open; the setters + ddl.cancelPreview are stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, triggerName, tableName, schemaName]);

  // Sprint 274 — typing-confirm match is case-sensitive byte-for-byte.
  // No trim, no debounce — every keystroke re-evaluates. Mirrors the
  // `DropTableDialog` contract.
  const typingMatches = typingConfirm === triggerName;
  // Issue #2191 — the preview has no gate. `previewOnly: true` never
  // executes anything (`gate_destructive_ddl` and `run_schema_change` in
  // `src-tauri/src/commands/rdb/ddl.rs` both exempt it, and each adapter
  // returns the SQL before touching a pool), so withholding it only hid
  // what the user is about to destroy. `typingMatches` now gates
  // execution alone.
  const canApply = typingMatches && !ddl.previewLoading && !!ddl.previewSql;

  // Sprint 274 — 250ms debounced auto-refresh: the preview SQL rebuilds
  // on open and on every CASCADE toggle. Mirrors Sprint 235
  // `DropTableDialog`.
  useEffect(() => {
    if (!open) return;
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
          // Issue #1112 — commit runs only after this dialog's confirmation;
          // forward the Safe Mode proof.
          await tauri.dropTrigger(buildRequest(false), true);
        },
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // ddl.loadPreview + the tauri request builder are stable per render; keep
    // deps to the inputs that actually drive the previewed SQL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
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
    // Issue #2191 — the execution gate has to be re-checked here, not just
    // reflected in the button's `disabled`. Before the split, a non-empty
    // `previewSql` proved the user had typed the trigger name; now the
    // preview loads without any confirmation, so `previewSql` alone would
    // let a DROP through if the `disabled` binding ever regressed.
    if (!canApply) return;
    await ddl.attemptExecute();
  };

  const handleCancel = () => {
    ddl.cancelPreview();
    onClose();
  };

  const ddlButtonLabel = showDdl ? t("hideDdl") : t("showDdl");

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
                {t("dropTrigger.title")}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {triggerName} on {schemaName}.{tableName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {t("dropTrigger.warningText")}
              </p>
              <div>
                <label
                  htmlFor="drop-trigger-typing-confirm"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("dropTrigger.typingConfirmLabel")}
                </label>
                <input
                  id="drop-trigger-typing-confirm"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={typingConfirm}
                  onChange={(e) => setTypingConfirm(e.target.value)}
                  placeholder={triggerName}
                  aria-label={t("dropTrigger.typingConfirmAria")}
                  autoFocus
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={cascade}
                  onChange={(e) => setCascade(e.target.checked)}
                  className="rounded border-border"
                  aria-label={t("dropTrigger.cascadeAria")}
                />
                {t("dropTrigger.cascadeLabel")}
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
                  {/* Issue #2191 — the empty pane is now only the debounce
                      window before the first fetch, so it reads as loading.
                      The old hint told the user to type to see the SQL, which
                      is exactly what stopped being true. */}
                  {ddl.previewLoading ||
                  (!ddl.previewError && !ddl.previewSql) ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      {t("generatingPreview")}
                    </div>
                  ) : ddl.previewError ? (
                    <pre
                      className="max-h-scroll-md overflow-auto whitespace-pre-wrap rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
                      role="alert"
                    >
                      {ddl.previewError}
                    </pre>
                  ) : (
                    <pre className="max-h-scroll-md overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs font-mono text-foreground">
                      <SqlSyntax sql={ddl.previewSql} />
                    </pre>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleApply}
                disabled={!canApply}
                aria-label={t("apply")}
              >
                {ddl.previewLoading ? (
                  <Loader2 className="animate-spin size-3.5" />
                ) : null}
                {t("apply")}
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
