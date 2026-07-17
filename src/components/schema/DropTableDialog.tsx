import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useSchemaTableMutations } from "@/hooks/useSchemaTableMutations";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaGraphIntelligence } from "@/hooks/useSchemaGraphIntelligence";
import { selectSchemaGraphMigrationImpact } from "@/lib/schemaGraphSelectors";
import { schemaGraphTableId } from "@/lib/schemaGraphSupport";
import SchemaGraphMigrationImpactSummary from "./SchemaGraphMigrationImpactSummary";

/**
 * Sprint 235 — `DropTableDialog`. Typing-confirm input + CASCADE
 * checkbox + inline DDL preview pane + Cancel + Show DDL + Apply
 * buttons.
 *
 * Apply is `disabled` UNTIL the typing-confirm input matches the current
 * table name byte-for-byte (case-sensitive — `Users` ≠ `users`). The
 * typing-confirm pattern is NEW in Sprint 235 (no prior occurrence in
 * the codebase — Mongo `useDocumentDatabaseDrop` uses a regular confirm
 * dialog). Per Sprint 235 contract: NO `onChange` debounce, NO trim
 * (whitespace-only matches stay invalid), every keystroke re-evaluates.
 *
 * CASCADE checkbox defaults to OFF — user opts INTO the more dangerous
 * `DROP TABLE … CASCADE` form explicitly. Toggling it invalidates the
 * cached preview so the next `Show DDL` click re-fetches with the new
 * SQL.
 *
 * Safe Mode dispatch is provided by `useDdlPreviewExecution` — `DROP
 * TABLE` is classified as `ddl-drop` / danger by the analyzer, so the
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
 *   5. on commit success, modal closes.
 */

export interface DropTableDialogProps {
  /** Connection id used by the Safe Mode gate + history record. */
  connectionId: string;
  /** Active database — schemaStore cache key dimension (Sprint 263). */
  database: string;
  /** Schema name (display + payload). */
  schemaName: string;
  /** Current table name (typing-confirm target + payload). */
  tableName: string;
  /** Modal closes when set false. */
  open: boolean;
  /** Called on Cancel / outside-close / commit-success. */
  onClose: () => void;
}

export default function DropTableDialog({
  connectionId,
  database,
  schemaName,
  tableName,
  open,
  onClose,
}: DropTableDialogProps) {
  const { t } = useTranslation("schemaDialogs");
  const [typingConfirm, setTypingConfirm] = useState("");
  const [cascade, setCascade] = useState(false);
  // Preview pane defaults open — auto-debounced fetch fills it as the
  // user types. Hiding it by default required an extra click and made
  // users think the preview was broken.
  const [showDdl, setShowDdl] = useState(true);

  const { dropTable: dropTableMutation } = useSchemaTableMutations();
  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );
  const schemaGraphIntelligence = useSchemaGraphIntelligence(
    connectionId,
    database,
  );
  const migrationImpact = useMemo(
    () =>
      schemaGraphIntelligence
        ? selectSchemaGraphMigrationImpact(schemaGraphIntelligence, {
            kind: "table",
            tableId: schemaGraphTableId(schemaName, tableName),
          })
        : null,
    [schemaGraphIntelligence, schemaName, tableName],
  );

  const ddl = useDdlPreviewExecution({
    connectionId,
    onRefresh: async () => {
      onClose();
    },
  });

  // Reset form state on (re)open. Same pattern as RenameTableDialog.
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
  }, [open, tableName, schemaName]);

  // Sprint 235 — typing-confirm match is case-sensitive byte-for-byte.
  // No trim, no debounce — every keystroke re-evaluates.
  const typingMatches = typingConfirm === tableName;
  const canPreview = typingMatches;
  const canApply = canPreview && !ddl.previewLoading && !!ddl.previewSql;

  // Sprint 238 — auto-refresh the preview pane on every form edit so
  // Apply stays enabled and the registered commit closure reflects the
  // latest CASCADE choice. The pane no longer auto-collapses.
  useEffect(() => {
    if (!open) return;
    if (!canPreview) return;
    const handle = window.setTimeout(() => {
      void ddl.loadPreview(
        async () => {
          const result = await tauri.dropTableRequest({
            connectionId,
            schema: schemaName,
            table: tableName,
            cascade,
            previewOnly: true,
            // Sprint 271c — opt-in DbMismatch guard. Forward the
            // workspace `(connId, db)` coordinate so a swapped pool
            // rejects with `AppError::DbMismatch` before the table is
            // dropped against the wrong database.
            expectedDatabase: database,
          });
          return { sql: result.sql };
        },
        () => async () => {
          await dropTableMutation(
            connectionId,
            database,
            tableName,
            schemaName,
          );
        },
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // ddl.loadPreview + the tauri request builder are stable per render; keep
    // deps to the inputs that actually drive the previewed SQL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canPreview, cascade, connectionId, schemaName, tableName]);

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
                {t("dropTable.title")}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {schemaName}.{tableName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {t("dropTable.warningText")}
              </p>
              <div>
                <label
                  htmlFor="drop-table-typing-confirm"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("dropTable.typingConfirmLabel")}
                </label>
                <input
                  id="drop-table-typing-confirm"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={typingConfirm}
                  onChange={(e) => setTypingConfirm(e.target.value)}
                  placeholder={tableName}
                  aria-label={t("dropTable.typingConfirmAria")}
                  autoFocus
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={cascade}
                  onChange={(e) => setCascade(e.target.checked)}
                  className="rounded border-border"
                  aria-label={t("dropTable.cascadeAria")}
                />
                {t("dropTable.cascadeLabel")}
              </label>
            </div>

            <div className="border-t border-border">
              <button
                type="button"
                onClick={handleShowDdl}
                // Toggle is always enabled now; the pane shows helpful empty/loading states
                className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-secondary-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                aria-expanded={showDdl}
                aria-controls="drop-table-ddl-preview"
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
                  id="drop-table-ddl-preview"
                  className="space-y-2 border-t border-border bg-background px-4 py-2"
                >
                  <SchemaGraphMigrationImpactSummary impact={migrationImpact} />
                  {ddl.previewLoading ? (
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
                  ) : ddl.previewSql ? (
                    <pre className="max-h-scroll-md overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs font-mono text-foreground">
                      <SqlSyntax sql={ddl.previewSql} />
                    </pre>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">
                      {t("ddlHintTypeTableName")}
                    </span>
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
