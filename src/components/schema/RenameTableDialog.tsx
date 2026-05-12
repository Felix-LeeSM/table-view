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
import ConfirmDestructiveDialog from "@components/workspace/ConfirmDestructiveDialog";
import SqlSyntax from "@components/shared/SqlSyntax";
import { useSchemaTableMutations } from "@/hooks/useSchemaTableMutations";
import { useConnectionStore } from "@stores/connectionStore";

/**
 * Sprint 235 — `RenameTableDialog`. Single text input + Cancel + Show DDL +
 * Apply buttons + inline DDL preview pane. Reuses
 * `useDdlPreviewExecution` (Sprint 214) for the preview/execute lifecycle
 * and `useSchemaTableMutations` (Sprint 223) for the post-commit cache
 * refresh.
 *
 * Apply is disabled when:
 *   - input is empty / whitespace-only,
 *   - input fails the identifier regex `^[a-zA-Z_][a-zA-Z0-9_]*$`,
 *   - input length > 63 bytes (PG NAMEDATALEN limit), or
 *   - input equals the current table name byte-for-byte (rename-to-self
 *     pre-check; the backend stays permissive but the modal saves the
 *     pointless round-trip).
 *
 * Sprint 238 — preview pane updates live (debounced) while the user
 * types; the pane no longer auto-collapses on form edit and Apply no
 * longer gates on a stale flag. Show DDL is purely a visibility toggle.
 *
 * No Safe Mode UX path — `useDdlPreviewExecution` already routes preview
 * SQL through `analyzeStatement` + `useSafeModeGate`; rename SQL emits
 * `ALTER TABLE … RENAME TO …` which the analyzer classifies as `ddl-other`
 * (safe), so the gate always allows. The wiring stays uniform with the
 * rest of Phase 24-26.
 */

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const IDENTIFIER_MAX_BYTES = 63;

export interface RenameTableDialogProps {
  /** Connection id used by the Safe Mode gate + history record. */
  connectionId: string;
  /** Active database — schemaStore cache key dimension (Sprint 263). */
  database: string;
  /** Schema name (display + payload). */
  schemaName: string;
  /** Current table name (display + payload + rename-to-self check). */
  tableName: string;
  /** Modal closes when set false. */
  open: boolean;
  /** Called on Cancel / outside-close / commit-success. */
  onClose: () => void;
}

function validateIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Table name must not be empty";
  }
  // Byte length — stay UTF-8 safe by encoding before measuring.
  if (new TextEncoder().encode(trimmed).length > IDENTIFIER_MAX_BYTES) {
    return `Table name must not exceed ${IDENTIFIER_MAX_BYTES} bytes`;
  }
  if (!IDENTIFIER_RE.test(trimmed)) {
    return "Table name must start with a letter or underscore and contain only alphanumeric characters and underscores";
  }
  return null;
}

export default function RenameTableDialog({
  connectionId,
  database,
  schemaName,
  tableName,
  open,
  onClose,
}: RenameTableDialogProps) {
  const [newName, setNewName] = useState(tableName);
  // Preview pane defaults open — auto-debounced fetch fills it as the
  // user types. Hiding it by default required an extra click and made
  // users think the preview was broken.
  const [showDdl, setShowDdl] = useState(true);

  const { renameTable: renameTableMutation } = useSchemaTableMutations();
  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );

  const ddl = useDdlPreviewExecution({
    connectionId,
    onRefresh: async () => {
      // The mutation hook already wrote the optimistic patch /
      // listTables refresh; the modal just needs to close.
      onClose();
    },
  });

  // Reset form state whenever the modal (re)opens. The hook's
  // `previewSql` / `previewError` are reset via `cancelPreview` so the
  // auto-refresh effect below fetches fresh.
  useEffect(() => {
    if (open) {
      setNewName(tableName);
      setShowDdl(true);
      ddl.cancelPreview();
    }
    // Intentional narrow deps — `tableName` is the seed that drives the
    // input pre-fill on (re)open; ddl.cancelPreview is stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tableName]);

  const validationError = validateIdentifier(newName);
  const isRenameToSelf = newName === tableName;
  const canPreview = !validationError && !isRenameToSelf;
  const canApply = canPreview && !ddl.previewLoading && !!ddl.previewSql;

  // Sprint 238 — auto-refresh the preview pane (debounced 250 ms) so
  // the SQL the user sees stays in sync with the form, and the commit
  // closure registered with `loadPreview` always reflects the latest
  // form state. Without this, every keystroke either invalidated and
  // collapsed the pane (forcing the user to click Show DDL again) or
  // left a stale closure registered.
  useEffect(() => {
    if (!open) return;
    if (!canPreview) return;
    const handle = window.setTimeout(() => {
      const trimmed = newName.trim();
      void ddl.loadPreview(
        async () => {
          const result = await tauri.renameTableRequest({
            connectionId,
            schema: schemaName,
            table: tableName,
            newName: trimmed,
            previewOnly: true,
          });
          return { sql: result.sql };
        },
        () => async () => {
          await renameTableMutation(
            connectionId,
            database,
            tableName,
            schemaName,
            trimmed,
          );
        },
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // ddl.loadPreview / renameTableMutation are stable per render but
    // including them creates noise; keep deps narrow to inputs that
    // actually drive the SQL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canPreview, newName, connectionId, schemaName, tableName]);

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
                Rename Table
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {schemaName}.{tableName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-4 py-3">
              <div>
                <label
                  htmlFor="rename-table-new-name"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  New table name
                </label>
                <input
                  id="rename-table-new-name"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="new_table_name"
                  aria-label="New table name"
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canApply) {
                      e.preventDefault();
                      void handleApply();
                    }
                  }}
                />
                {validationError && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label="Identifier validation error"
                  >
                    {validationError}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-border">
              <button
                type="button"
                onClick={handleShowDdl}
                // Toggle is always enabled now; the pane shows helpful empty/loading states
                className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-secondary-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                aria-expanded={showDdl}
                aria-controls="rename-table-ddl-preview"
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
                  id="rename-table-ddl-preview"
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
                      -- Type a new name to see the generated SQL
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
                disabled={!canApply || !ddl.previewSql}
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
