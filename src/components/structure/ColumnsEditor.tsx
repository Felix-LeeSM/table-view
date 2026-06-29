import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Key, Link2, Plus, Pencil, Trash2, X, Check, Eye } from "lucide-react";
import type { ColumnInfo, ColumnChange } from "@/types/schema";
import type { Paradigm } from "@/types/connection";
import { getParadigmVocabulary } from "@/lib/strings/paradigm-vocabulary";
import * as tauri from "@lib/tauri";
import SqlPreviewDialog from "./SqlPreviewDialog";
import { useDdlPreviewExecution } from "./useDdlPreviewExecution";
import { Button } from "@components/ui/button";
import { useConnectionStore } from "@stores/connectionStore";
import { ConfirmDestructiveDialog } from "@features/workspace";
import { AddColumnDialog, DropColumnDialog } from "@features/catalog";
import {
  StructureShell,
  StructureActionBar,
  StructureTable,
  StructureEmpty,
  STRUCTURE_THEAD,
  STRUCTURE_TH,
  STRUCTURE_TH_ACTIONS,
  STRUCTURE_TR,
  STRUCTURE_TD,
  STRUCTURE_TD_ACTIONS,
} from "./shared/structureUI";

// Sprint 237 — debounce window for the SET-NOT-NULL conflict probe. The
// user toggles the checkbox; we wait 500 ms with no further change
// before issuing `count_null_rows` to avoid hammering the backend
// while the user is still deciding.
const NULL_PROBE_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Represents a pending column change with a unique tracking id */
export interface PendingColumnChange {
  trackingId: string;
  change: ColumnChange;
  /** Original column name for modify/drop; empty for add */
  originalColumn?: string;
}

/** Tracks a new column row being edited inline */
export interface NewColumnDraft {
  trackingId: string;
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string;
}

// ---------------------------------------------------------------------------
// Editable column row
// ---------------------------------------------------------------------------

interface EditableColumnRowProps {
  col: ColumnInfo;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (change: ColumnChange) => void;
  onDelete: () => void;
  /**
   * Sprint 237 — context forwarded to the SET-NOT-NULL conflict probe.
   * The MODIFY editor calls `tauri.countNullRows` 500 ms after the user
   * toggles a nullable column to NOT NULL; the response drives the
   * inline warning text. Optional only because the inline-batched
   * MODIFY surface is the sole caller today.
   */
  connectionId?: string;
  database?: string;
  schema?: string;
  tableName?: string;
}

function EditableColumnRow({
  col,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  connectionId,
  database,
  schema,
  tableName,
}: EditableColumnRowProps) {
  const { t } = useTranslation("structure");
  const [dataType, setDataType] = useState(col.data_type);
  const [nullable, setNullable] = useState(col.nullable);
  const [defaultValue, setDefaultValue] = useState(col.default_value ?? "");
  // Sprint 237 — free-text USING cast expression. Rendered only when the
  // user has chosen a NEW data type (i.e. `dataType !== col.data_type`).
  // Cleared when the user reverts to the original type so a stale value
  // doesn't leak into the eventual `alterTable` payload.
  const [usingExpression, setUsingExpression] = useState("");
  // Sprint 237 — pre-execution NULL-rows warning. `null` = no probe has
  // resolved yet (or the toggle is in its default position). `0` is a
  // valid resolution and renders no warning. `>0` renders the inline
  // copy.
  const [nullRowCount, setNullRowCount] = useState<number | null>(null);

  const hasDataTypeChange = dataType !== col.data_type;
  // Sprint 237 — SET-NOT-NULL is only meaningful when the column is
  // currently nullable; we never probe DROP-NOT-NULL or no-change.
  const willSetNotNull = col.nullable && !nullable;

  // Sprint 237 — when the user clears the new data type, the USING
  // input is hidden; drop any pending value so a re-toggle of the type
  // doesn't repopulate stale text.
  useEffect(() => {
    if (!hasDataTypeChange && usingExpression.length > 0) {
      setUsingExpression("");
    }
  }, [hasDataTypeChange, usingExpression.length]);

  // Sprint 237 — debounced `count_null_rows` probe. Fires only when the
  // user toggles SET NOT NULL on a column that is currently nullable.
  // Re-runs on every state flip; the timer is cleared on unmount /
  // re-toggle so an in-flight debounce is cancelled. Probe errors are
  // swallowed (best-effort advisory — never blocks preview / commit).
  useEffect(() => {
    if (!isEditing) {
      setNullRowCount(null);
      return;
    }
    if (!willSetNotNull) {
      // Toggle off / DROP-NOT-NULL path → clear any prior warning.
      setNullRowCount(null);
      return;
    }
    if (!connectionId || !schema || !tableName) {
      // No coordinates forwarded → skip the probe. Mirrors the legacy
      // call site shape; the modal-add / drop paths don't need it.
      return;
    }
    // Sprint 237 Attempt 2 — stale-warning hygiene. When a dep (e.g.
    // `col.name`, `database`, `tableName`) changes while `willSetNotNull`
    // stays true, the previously-resolved `nullRowCount` would keep
    // rendering until the next 500 ms debounce resolves. Clear it now so
    // the warning vanishes immediately and reappears only when the
    // fresh probe lands.
    setNullRowCount(null);
    let cancelled = false;
    const handle = window.setTimeout(() => {
      tauri
        .countNullRows(connectionId, schema, tableName, col.name, database)
        .then((count) => {
          if (!cancelled) setNullRowCount(count);
        })
        .catch(() => {
          // Probe is advisory; PG surfaces the real error on commit if the
          // user proceeds. Silent swallow is intentional — see Sprint 237
          // contract § Design Bar / Quality Bar.
        });
    }, NULL_PROBE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    isEditing,
    willSetNotNull,
    connectionId,
    schema,
    tableName,
    col.name,
    database,
  ]);

  const inputClass =
    "w-full bg-transparent px-2 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary";

  const handleSave = () => {
    const hasNullableChange = nullable !== col.nullable;
    const hasDefaultChange =
      (defaultValue || null) !== (col.default_value ?? null);

    if (!hasDataTypeChange && !hasNullableChange && !hasDefaultChange) {
      onCancelEdit();
      return;
    }

    // Sprint 237 — only emit `using_expression` when a non-empty value is
    // present alongside a type change. Empty / whitespace-only inputs
    // pass through as `null` so the backend keeps emitting the pre-
    // Sprint-237 `ALTER COLUMN "x" TYPE <t>` byte-for-byte.
    const trimmedUsing = usingExpression.trim();
    const usingPayload: string | null =
      hasDataTypeChange && trimmedUsing.length > 0 ? trimmedUsing : null;

    onSaveEdit({
      type: "modify",
      name: col.name,
      new_data_type: hasDataTypeChange ? dataType : null,
      new_nullable: hasNullableChange ? nullable : null,
      new_default_value: hasDefaultChange ? defaultValue || null : null,
      using_expression: usingPayload,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") onCancelEdit();
  };

  return (
    <tr className={STRUCTURE_TR} onKeyDown={handleKeyDown}>
      <td className={STRUCTURE_TD}>
        <div className="flex items-center gap-1.5">
          {col.is_primary_key && (
            <span title={t("col.primaryKey")}>
              <Key
                size={12}
                className="shrink-0 text-warning"
                aria-label={t("col.primaryKey")}
              />
            </span>
          )}
          {col.is_foreign_key && (
            <span title={t("col.foreignKey")}>
              <Link2 size={12} className="shrink-0 text-primary" />
            </span>
          )}
          <span className="text-foreground">{col.name}</span>
        </div>
      </td>
      <td className={STRUCTURE_TD}>
        {isEditing ? (
          <div className="flex flex-col gap-1">
            <input
              className={inputClass}
              value={dataType}
              onChange={(e) => setDataType(e.target.value)}
              aria-label={t("col.dataTypeAria", { name: col.name })}
            />
            {/* Sprint 237 — USING cast expression. Conditionally
                rendered ONLY when the user has chosen a new type so
                pre-Sprint-237 type-only flow stays diff=0. Free-text
                input; PG surfaces its parse error if invalid. */}
            {hasDataTypeChange && (
              <input
                className={inputClass}
                value={usingExpression}
                onChange={(e) => setUsingExpression(e.target.value)}
                aria-label={t("col.usingExprAria", { name: col.name })}
                placeholder={t("col.usingExprPlaceholder")}
                title={t("col.usingExprTitle")}
              />
            )}
          </div>
        ) : (
          <span className="text-secondary-foreground">{col.data_type}</span>
        )}
      </td>
      <td className={STRUCTURE_TD}>
        {isEditing ? (
          <div className="flex flex-col gap-1">
            <input
              type="checkbox"
              checked={nullable}
              onChange={(e) => setNullable(e.target.checked)}
              aria-label={t("col.nullableAria", { name: col.name })}
              className="rounded border-border"
            />
            {/* Sprint 237 — pre-execution conflict warning. Renders
                only when the user is flipping nullable→NOT NULL AND
                the debounced probe returned a non-zero count. Purely
                advisory — preview / commit are not blocked. */}
            {willSetNotNull && nullRowCount !== null && nullRowCount > 0 && (
              <span
                role="alert"
                className="text-xs text-warning"
                aria-label={t("col.nullRowsWarningAria", { name: col.name })}
              >
                {t("col.nullRowsWarning", { count: nullRowCount })}
              </span>
            )}
          </div>
        ) : nullable ? (
          <span className="text-muted-foreground">{t("col.nullableYes")}</span>
        ) : (
          <span className="font-medium text-foreground">
            {t("col.nullableNo")}
          </span>
        )}
      </td>
      <td className={`${STRUCTURE_TD} max-w-50 truncate`}>
        {isEditing ? (
          <input
            className={inputClass}
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            aria-label={t("col.defaultValueAria", { name: col.name })}
            placeholder={t("col.defaultValuePlaceholder")}
          />
        ) : (
          <span className="text-muted-foreground">
            {col.default_value ?? "\u2014"}
          </span>
        )}
      </td>
      <td
        className={`${STRUCTURE_TD} max-w-50 truncate font-mono`}
        title={(col.check_clauses ?? []).join("\n")}
      >
        {(() => {
          const clauses = col.check_clauses ?? [];
          if (clauses.length === 0) return "\u2014";
          // Strip the redundant `CHECK ` prefix that `pg_get_constraintdef`
          // emits \u2014 the column header already says "Check", so showing
          // `((age >= 0))` is denser without losing meaning. Multiple
          // expressions join with `; ` to fit the single-row layout
          // (full text is in the title tooltip).
          return clauses.map((c) => c.replace(/^CHECK\s*/, "")).join("; ");
        })()}
      </td>
      <td className={`${STRUCTURE_TD} max-w-50 truncate text-primary`}>
        {col.fk_reference ?? "\u2014"}
      </td>
      <td
        className={`${STRUCTURE_TD} max-w-50 truncate text-muted-foreground !border-r-0`}
      >
        {col.comment ?? "\u2014"}
      </td>
      <td className={STRUCTURE_TD_ACTIONS}>
        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-success"
                onClick={handleSave}
                aria-label={t("col.saveAria", { name: col.name })}
                title={t("col.saveTitle")}
              >
                <Check />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onCancelEdit}
                aria-label={t("col.cancelEditAria", { name: col.name })}
                title={t("col.cancelTitle")}
              >
                <X />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onStartEdit}
                aria-label={t("col.editAria", { name: col.name })}
                title={t("col.editTitle")}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="hover:text-destructive"
                onClick={onDelete}
                aria-label={t("col.deleteAria", { name: col.name })}
                title={t("col.deleteTitle")}
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Sprint 236 \u2014 `NewColumnRow` (inline add) component removed.
// `+ Column` toolbar button now opens `<AddColumnDialog>`. The inline
// `NewColumnDraft` interface above is retained as a re-exportable type
// (zero external callers; kept as historical surface).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ColumnsEditor
// ---------------------------------------------------------------------------

interface ColumnsEditorProps {
  connectionId: string;
  /**
   * Sprint 271c — active database (workspace `(connId, db)` coordinate).
   * Forwarded to `tauri.alterTable` / `addColumnRequest` /
   * `dropColumnRequest` as `expectedDatabase` so a swapped backend pool
   * rejects with `AppError::DbMismatch` before any column mutation
   * lands. Optional only so legacy callers compile unchanged; new
   * callers should pass the workspace db.
   */
  database?: string;
  table: string;
  schema: string;
  columns: ColumnInfo[];
  /** Called after a successful execute to trigger data refresh */
  onRefresh: () => Promise<void>;
  /**
   * Paradigm-aware button + empty-state copy. Defaults to `"rdb"` so
   * existing callers (StructurePanel without an explicit paradigm) see
   * the RDB vocabulary unchanged. Mongo callers pass `"document"` to
   * render "Add Field" / "No fields found".
   */
  paradigm?: Paradigm;
}

export default function ColumnsEditor({
  connectionId,
  database,
  table,
  schema,
  columns,
  onRefresh,
  paradigm,
}: ColumnsEditorProps) {
  const { t } = useTranslation("structure");
  // `getParadigmVocabulary` enforces the `undefined → rdb` fallback in
  // one place; component just looks up.
  const vocab = getParadigmVocabulary(paradigm);
  // Accessibility-name preserves sentence-case (`"Add column"` lowercase
  // 'c'); visible button text uses the dictionary's title-case form
  // (`"Add Column"`). Document paradigm yields aria-label "Add field" +
  // visible "Add Field".
  const ariaAddUnit = `Add ${vocab.unit.toLowerCase()}`;
  // Column editing state
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PendingColumnChange[]>(
    [],
  );
  // Sprint 236 — `newColumnDrafts` retained because the inline-add path
  // is REMOVED but the `NewColumnDraft` type is still re-exported for
  // back-compat of any external import. Empty array is the locked
  // surface; `+ Column` toolbar button now opens `AddColumnDialog`.
  const [newColumnDrafts, setNewColumnDrafts] = useState<NewColumnDraft[]>([]);
  const [droppedColumns, setDroppedColumns] = useState<Set<string>>(new Set());

  // Sprint 236 — modal slots replacing the inline NewColumnDraft +
  // per-row trash `pendingChanges` drop entries. Both flow through
  // `onRefresh()` on commit-success (cache invalidation path; see
  // Sprint 236 contract Decisions §Cache invalidation path).
  const [showAddColumnDialog, setShowAddColumnDialog] = useState(false);
  const [dropColumnTarget, setDropColumnTarget] = useState<string | null>(null);

  // SQL preview modal state — `showSqlModal` stays editor-local because the
  // Review SQL button + dialog mount are domain-specific (other editors
  // mount the dialog directly off `previewSql`). The four lifecycle states
  // (`previewSql` / `previewLoading` / `previewError` / `pendingConfirm`)
  // and the `;`-split + decide loop now live in `useDdlPreviewExecution`.
  const [showSqlModal, setShowSqlModal] = useState(false);

  // `connectionEnvironment` stays for the production-tier color stripe
  // banner (UI hint, separate from the Safe Mode decision matrix).
  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );
  const ddl = useDdlPreviewExecution({ connectionId, onRefresh });

  const pendingCount = pendingChanges.length;

  // -------------------------------------------------------------------------
  // Column editing handlers
  // -------------------------------------------------------------------------

  // Sprint 236 — `+ Column` toolbar button now opens `AddColumnDialog`
  // instead of pushing an inline `NewColumnDraft` row. The inline-add
  // path is REMOVED; the modal becomes the sole add-column surface.
  // The inline-batched MODIFY path (Edit pencil → save → review SQL →
  // batched `alter_table`) stays UNCHANGED — Sprint 237 polish target.
  const handleAddColumn = () => {
    setShowAddColumnDialog(true);
  };

  const handleSaveEdit = (columnName: string, change: ColumnChange) => {
    setPendingChanges((prev) => {
      // Replace any existing pending modify for the same column
      const filtered = prev.filter(
        (p) => !(p.originalColumn === columnName && p.change.type === "modify"),
      );
      return [
        ...filtered,
        { trackingId: crypto.randomUUID(), change, originalColumn: columnName },
      ];
    });
    setEditingColumn(null);
  };

  // Sprint 236 — per-row trash icon now opens `DropColumnDialog`
  // pre-filled with the column name instead of pushing a pending drop
  // entry into `pendingChanges`. The inline-batched MODIFY path stays
  // intact; the trash icon used to be the only entrypoint to the
  // batched DROP path, which is now replaced by the dedicated modal.
  const handleDeleteColumn = (columnName: string) => {
    setDropColumnTarget(columnName);
  };

  // -------------------------------------------------------------------------
  // SQL preview & execute
  // -------------------------------------------------------------------------

  const buildAlterRequest = (previewOnly: boolean) => ({
    connection_id: connectionId,
    schema,
    table,
    changes: pendingChanges.map((p) => p.change),
    preview_only: previewOnly,
    // Sprint 271c — opt-in DbMismatch guard. Wire format is snake_case
    // (matches Rust struct field name).
    expected_database: database,
  });

  const handleReviewSql = async () => {
    if (pendingCount === 0) return;
    setShowSqlModal(true);
    // Preview fetch + commit closure registration both flow through the
    // shared hook. The closure factory bakes in the editor's domain
    // cleanup (pendingChanges / drafts / drops / inline editing /
    // showSqlModal) so the hook stays free of structure-specific state.
    await ddl.loadPreview(
      () => tauri.alterTable(buildAlterRequest(true)),
      () => async () => {
        await tauri.alterTable(buildAlterRequest(false));
        setShowSqlModal(false);
        setPendingChanges([]);
        setDroppedColumns(new Set());
        setNewColumnDrafts([]);
        setEditingColumn(null);
      },
    );
  };

  const handleCancelPending = () => {
    // Domain reset stays in the editor; lifecycle reset delegates to the
    // hook so `previewSql` / `previewError` / `pendingConfirm` / commit
    // closure all clear together.
    ddl.cancelPreview();
    setPendingChanges([]);
    setDroppedColumns(new Set());
    setNewColumnDrafts([]);
    setEditingColumn(null);
    setShowSqlModal(false);
  };

  // -------------------------------------------------------------------------
  // Reset editing state — exposed for parent to call on table change
  // -------------------------------------------------------------------------

  // Parent can call resetEditingState via ref or just remount.
  // We use the columns prop change to detect reset needs internally.
  // The parent controls reset by changing connectionId/table/schema key.

  const visibleColumns = columns.filter((col) => !droppedColumns.has(col.name));

  return (
    <StructureShell>
      <StructureActionBar
        count={`${visibleColumns.length} ${vocab.units.toLowerCase()}`}
        actions={
          <>
            <Button
              variant="ghost"
              size="xs"
              onClick={handleAddColumn}
              aria-label={ariaAddUnit}
            >
              <Plus />
              {vocab.addUnit}
            </Button>
            {pendingCount > 0 && (
              <Button
                size="xs"
                onClick={handleReviewSql}
                aria-label={t("col.reviewSqlAria", { count: pendingCount })}
              >
                <Eye />
                {t("col.reviewSqlLabel", { count: pendingCount })}
              </Button>
            )}
          </>
        }
      />

      {columns.length > 0 && (
        <StructureTable fixed>
          <thead className={STRUCTURE_THEAD}>
            <tr>
              <th className={STRUCTURE_TH}>{t("th.name")}</th>
              <th className={STRUCTURE_TH}>{t("th.type")}</th>
              <th className={STRUCTURE_TH}>{t("th.nullable")}</th>
              <th className={STRUCTURE_TH}>{t("th.default")}</th>
              <th className={STRUCTURE_TH}>{t("th.check")}</th>
              <th className={STRUCTURE_TH}>{t("th.ref")}</th>
              <th className={STRUCTURE_TH}>{t("th.comment")}</th>
              <th className={STRUCTURE_TH_ACTIONS}>{t("th.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleColumns.map((col) => (
              <EditableColumnRow
                key={col.name}
                col={col}
                isEditing={editingColumn === col.name}
                onStartEdit={() => setEditingColumn(col.name)}
                onCancelEdit={() => setEditingColumn(null)}
                onSaveEdit={(change) => handleSaveEdit(col.name, change)}
                onDelete={() => handleDeleteColumn(col.name)}
                connectionId={connectionId}
                database={database}
                schema={schema}
                tableName={table}
              />
            ))}
            {/* Sprint 236 \u2014 inline `NewColumnRow` + pending-add row
                rendering removed; `+ Column` toolbar now opens
                `AddColumnDialog`. The inline-batched MODIFY path
                stays \u2014 it goes through `pendingChanges` /
                `alter_table` (Sprint 237 polish target). */}
          </tbody>
        </StructureTable>
      )}

      {columns.length === 0 &&
        pendingChanges.length === 0 &&
        newColumnDrafts.length === 0 && (
          <StructureEmpty>{vocab.emptyUnits}</StructureEmpty>
        )}

      {/* SQL Preview Modal */}
      {showSqlModal && (
        <SqlPreviewDialog
          sql={ddl.previewSql}
          loading={ddl.previewLoading}
          error={ddl.previewError}
          environment={connectionEnvironment}
          onConfirm={ddl.attemptExecute}
          onCancel={handleCancelPending}
        />
      )}

      {/* Warn-tier confirmation. Mounted as a sibling so it stacks above
          the SQL preview dialog. */}
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

      {/* Sprint 236 — AddColumnDialog (replaces inline NewColumnDraft). */}
      <AddColumnDialog
        connectionId={connectionId}
        database={database}
        schemaName={schema}
        tableName={table}
        columns={columns}
        open={showAddColumnDialog}
        onClose={() => setShowAddColumnDialog(false)}
        onColumnAdded={onRefresh}
      />

      {/* Sprint 236 — DropColumnDialog (replaces per-row trash pending-drop). */}
      {dropColumnTarget !== null && (
        <DropColumnDialog
          connectionId={connectionId}
          database={database}
          schemaName={schema}
          tableName={table}
          columnName={dropColumnTarget}
          open
          onClose={() => setDropColumnTarget(null)}
          onColumnDropped={onRefresh}
        />
      )}
    </StructureShell>
  );
}
