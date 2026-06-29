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
import CreateTableTypeCombobox from "./CreateTableTypeCombobox";
import { usePostgresTypes } from "@hooks/usePostgresTypes";
import { useConnectionStore } from "@stores/connectionStore";
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
  /**
   * Sprint 271c — workspace active database. Forwarded as
   * `expectedDatabase` on the ADD COLUMN request so a swapped pool
   * rejects with `AppError::DbMismatch` before mutation. Optional only
   * for back-compat; new callers pass the workspace db.
   */
  database?: string;
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
  database,
  schemaName,
  tableName,
  columns,
  open,
  onClose,
  onColumnAdded,
}: AddColumnDialogProps) {
  const { t } = useTranslation("schemaDialogs");
  const [columnName, setColumnName] = useState("");
  const [dataType, setDataType] = useState("");
  const [notNull, setNotNull] = useState(false);
  const [defaultExpr, setDefaultExpr] = useState("");
  const [checkExpr, setCheckExpr] = useState("");
  // Sprint 242 — IDENTITY toggle. When on, the backend forces NOT NULL
  // and ignores `default_value`; the dialog mirrors that by disabling
  // both fields visually.
  const [isIdentity, setIsIdentity] = useState(false);
  // Preview pane defaults open — auto-debounced fetch fills it as the
  // user types. Hiding it by default required an extra click and made
  // users think the preview was broken.
  const [showDdl, setShowDdl] = useState(true);

  const { types, typesByName } = usePostgresTypes(connectionId);
  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );

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
      setIsIdentity(false);
      setShowDdl(true);
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
  const canApply = canPreview && !ddl.previewLoading && !!ddl.previewSql;

  // Sprint 238 — auto-refresh debounced. 5 form 필드(이름/타입/NOT NULL/
  // DEFAULT/CHECK) 중 어느 하나라도 변하면 250 ms 후 preview 를 재빌드.
  // 사용자는 form 을 채우는 동안 SQL 이 라이브로 업데이트되는 것을 보고,
  // Apply 는 stale 게이트 없이 preview 가 존재하기만 하면 활성화.
  useEffect(() => {
    if (!open) return;
    if (!canPreview) return;
    const handle = window.setTimeout(() => {
      const trimmedDefault = defaultExpr.trim();
      const trimmedCheck = checkExpr.trim();
      // Sprint 242 — `is_identity` only attached when true so the
      // wire payload stays byte-equivalent to pre-Sprint-242 callers
      // (backend `#[serde(default)]` accepts both omitted and `false`).
      // When identity is on the backend forces NOT NULL and drops the
      // user `default_value`; emit the field for clarity but the
      // backend is the single source of truth.
      const buildRequest = (previewOnly: boolean) => ({
        connectionId,
        schema: schemaName,
        table: tableName,
        column: {
          name: trimmedName,
          data_type: trimmedType,
          nullable: !notNull && !isIdentity,
          default_value:
            !isIdentity && trimmedDefault.length > 0 ? defaultExpr : null,
          ...(isIdentity ? { is_identity: true } : {}),
        },
        checkExpression: trimmedCheck.length > 0 ? checkExpr : null,
        previewOnly,
        // Sprint 271c — opt-in DbMismatch guard. Forward workspace db.
        expectedDatabase: database,
      });
      void ddl.loadPreview(
        async () => {
          const result = await tauri.addColumnRequest(buildRequest(true));
          return { sql: result.sql };
        },
        () => async () => {
          await tauri.addColumnRequest(buildRequest(false));
        },
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    canPreview,
    trimmedName,
    trimmedType,
    notNull,
    defaultExpr,
    checkExpr,
    isIdentity,
    connectionId,
    schemaName,
    tableName,
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
                {t("addColumn.title")}
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
                  {t("addColumn.columnNameLabel")}
                </label>
                <input
                  id="add-column-name"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={columnName}
                  onChange={(e) => setColumnName(e.target.value)}
                  placeholder={t("addColumn.columnNamePlaceholder")}
                  aria-label={t("addColumn.columnNameAria")}
                  autoFocus
                />
                {validationError && columnName.length > 0 && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label={t("addColumn.identifierErrorAria")}
                  >
                    {validationError}
                  </p>
                )}
                {!validationError && collision && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label={t("addColumn.columnCollisionAria")}
                  >
                    {t("addColumn.columnAlreadyExists", { name: trimmedName })}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="add-column-type"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("addColumn.typeLabel")}
                </label>
                <CreateTableTypeCombobox
                  value={dataType}
                  typesSource={types}
                  typeKindMap={typesByName}
                  onChange={setDataType}
                  ariaLabel={t("addColumn.typeAria")}
                />
              </div>

              <div className="flex items-center gap-3">
                {/* Sprint 242 — IDENTITY columns are SQL-standard
                    NOT NULL and use the sequence as the default;
                    NOT NULL + DEFAULT inputs disable while on. */}
                <label
                  className={`flex cursor-pointer items-center gap-2 text-xs text-foreground ${isIdentity ? "opacity-50" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={notNull || isIdentity}
                    onChange={(e) => setNotNull(e.target.checked)}
                    disabled={isIdentity}
                    className="rounded border-border"
                    aria-label={t("addColumn.notNullAria")}
                  />
                  {t("addColumn.notNullLabel")}
                </label>
                <label
                  className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                  title={t("addColumn.identityTitle")}
                >
                  <input
                    type="checkbox"
                    checked={isIdentity}
                    onChange={(e) => setIsIdentity(e.target.checked)}
                    className="rounded border-border"
                    aria-label={t("addColumn.identityAria")}
                  />
                  {t("addColumn.identityLabel")}
                </label>
              </div>

              <div>
                <label
                  htmlFor="add-column-default"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("addColumn.defaultLabel")}
                </label>
                <input
                  id="add-column-default"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
                  value={isIdentity ? "" : defaultExpr}
                  onChange={(e) => setDefaultExpr(e.target.value)}
                  disabled={isIdentity}
                  placeholder={
                    isIdentity
                      ? t("addColumn.defaultIdentityPlaceholder")
                      : t("addColumn.defaultPlaceholder")
                  }
                  aria-label={t("addColumn.defaultAria")}
                />
              </div>

              <div>
                <label
                  htmlFor="add-column-check"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("addColumn.checkLabel")}
                </label>
                <input
                  id="add-column-check"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={checkExpr}
                  onChange={(e) => setCheckExpr(e.target.value)}
                  placeholder={t("addColumn.checkPlaceholder")}
                  aria-label={t("addColumn.checkAria")}
                />
              </div>
            </div>

            <div className="border-t border-border">
              <button
                type="button"
                onClick={handleShowDdl}
                // Toggle is always enabled now; the pane shows helpful empty/loading states
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
                      {t("ddlHintFillNameType")}
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
                onClick={handleApply}
                disabled={!canApply}
                aria-label={t("addColumn.applyAria")}
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
