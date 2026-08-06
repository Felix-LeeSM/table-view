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
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSchemaGraphIntelligence } from "@/hooks/useSchemaGraphIntelligence";
import { selectSchemaGraphMigrationImpact } from "@/lib/schemaGraphSelectors";
import { schemaGraphColumnId } from "@/lib/schemaGraphSupport";
import type { SchemaName, TableName } from "@/types/branded";
import SchemaGraphMigrationImpactSummary from "./SchemaGraphMigrationImpactSummary";

/**
 * Sprint 236 — `DropColumnDialog`. Mirrors the Sprint 235
 * `DropTableDialog` shell shape with the column-drop field set:
 * typing-confirm input ("Type the column name to confirm") + CASCADE
 * checkbox (default OFF, label `"Drop dependent objects (CASCADE)"`
 * per Sprint 236 user spec — DIVERGES from Sprint 235's CASCADE label)
 * + inline DDL preview pane + Cancel + Show DDL + Apply
 * (variant=destructive) buttons.
 *
 * Issue #2157 — the preview gate and the execution gate are separate.
 * The DDL preview loads as soon as the dialog opens so the user reads
 * the exact DROP statement first; the typing-confirm input only decides
 * whether it may run.
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
 * `ConfirmDestructiveDialog` mounts on top of the typing-confirm gate),
 * and non-production / mode=off allows.
 *
 * On commit success the dialog calls `onColumnDropped()` which the
 * parent `ColumnsEditor` wires to `onRefresh` → `getTableColumns`
 * (writes through the `tableColumnsCache`).
 */

export interface DropColumnDialogProps {
  /** Connection id used by the Safe Mode gate + history record. */
  connectionId: string;
  /**
   * Sprint 271c — workspace active database. Forwarded as
   * `expectedDatabase` on the DROP COLUMN request. Optional for
   * back-compat; new callers pass the workspace db.
   */
  database?: string;
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
  database,
  schemaName,
  tableName,
  columnName,
  open,
  onClose,
  onColumnDropped,
}: DropColumnDialogProps) {
  const { t } = useTranslation("schemaDialogs");
  const [typingConfirm, setTypingConfirm] = useState("");
  const [cascade, setCascade] = useState(false);
  // Preview pane defaults open — auto-debounced fetch fills it as the
  // user types. Hiding it by default required an extra click and made
  // users think the preview was broken.
  const [showDdl, setShowDdl] = useState(true);

  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );
  const schemaGraphIntelligence = useSchemaGraphIntelligence(
    connectionId,
    database ?? "",
  );
  const migrationImpact = useMemo(
    () =>
      database && schemaGraphIntelligence
        ? selectSchemaGraphMigrationImpact(schemaGraphIntelligence, {
            kind: "column",
            columnId: schemaGraphColumnId(
              schemaName as SchemaName,
              tableName as TableName,
              columnName,
            ),
          })
        : null,
    [columnName, database, schemaGraphIntelligence, schemaName, tableName],
  );

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
    // Intentional narrow deps — the open flag + name seeds re-run the form
    // reset on (re)open; the setters + ddl.cancelPreview are stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, columnName, tableName, schemaName]);

  // Sprint 236 — typing-confirm match is case-sensitive byte-for-byte.
  // No trim, no debounce — every keystroke re-evaluates (mirror Sprint
  // 235 `DropTableDialog`).
  const typingMatches = typingConfirm === columnName;
  // Issue #2157 — the preview has no gate. `previewOnly: true` never
  // executes anything (`gate_destructive_ddl` and `run_schema_change` in
  // `src-tauri/src/commands/rdb/ddl.rs` both exempt it, and each adapter
  // returns the SQL before touching a pool), so withholding it only hid
  // what the user is about to destroy. `typingMatches` now gates
  // execution alone.
  const canApply = typingMatches && !ddl.previewLoading && !!ddl.previewSql;

  // Sprint 238 — auto-refresh debounced: the preview SQL rebuilds on open
  // and on every CASCADE toggle. Apply stays gated on `canApply`.
  useEffect(() => {
    if (!open) return;
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
            // Sprint 271c — opt-in DbMismatch guard.
            expectedDatabase: database,
          });
          return { sql: result.sql };
        },
        () => async () => {
          await tauri.dropColumnRequest(
            {
              connectionId,
              schema: schemaName,
              table: tableName,
              columnName,
              cascade,
              previewOnly: false,
              // Sprint 271c — opt-in DbMismatch guard.
              expectedDatabase: database,
            },
            // Issue #1112 — commit runs only after the Safe Mode gate + this
            // dialog's confirmation; forward the proof.
            true,
          );
        },
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // ddl.loadPreview + the tauri request builder are stable per render; keep
    // deps to the inputs that actually drive the previewed SQL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cascade, connectionId, schemaName, tableName, columnName]);

  const handleShowDdl = () => {
    setShowDdl((s) => !s);
  };

  const handleApply = async () => {
    // Issue #2157 — the execution gate has to be re-checked here, not just
    // reflected in the button's `disabled`. Before the split, a non-empty
    // `previewSql` proved the user had typed the column name; now the
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
                {t("dropColumn.title")}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {schemaName}.{tableName}.{columnName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {t("dropColumn.warningText")}
              </p>
              <div>
                <label
                  htmlFor="drop-column-typing-confirm"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("dropColumn.typingConfirmLabel")}
                </label>
                <input
                  id="drop-column-typing-confirm"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={typingConfirm}
                  onChange={(e) => setTypingConfirm(e.target.value)}
                  placeholder={columnName}
                  aria-label={t("dropColumn.typingConfirmAria")}
                  autoFocus
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={cascade}
                  onChange={(e) => setCascade(e.target.checked)}
                  className="rounded border-border"
                  aria-label={t("dropColumn.cascadeAria")}
                />
                {t("dropColumn.cascadeLabel")}
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
                  className="space-y-2 border-t border-border bg-background px-4 py-2"
                >
                  <SchemaGraphMigrationImpactSummary impact={migrationImpact} />
                  {/* Issue #2157 — the empty pane is now only the debounce
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
