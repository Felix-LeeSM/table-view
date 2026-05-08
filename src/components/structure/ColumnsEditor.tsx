import { useState } from "react";
import { Key, Link2, Plus, Pencil, Trash2, X, Check, Eye } from "lucide-react";
import type { ColumnInfo, ColumnChange } from "@/types/schema";
import type { Paradigm } from "@/types/connection";
import { getParadigmVocabulary } from "@/lib/strings/paradigm-vocabulary";
import * as tauri from "@lib/tauri";
import SqlPreviewDialog from "./SqlPreviewDialog";
import { useDdlPreviewExecution } from "./useDdlPreviewExecution";
import { Button } from "@components/ui/button";
import { useConnectionStore } from "@stores/connectionStore";
import ConfirmDestructiveDialog from "@components/workspace/ConfirmDestructiveDialog";
import AddColumnDialog from "@components/schema/AddColumnDialog";
import DropColumnDialog from "@components/schema/DropColumnDialog";

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
}

function EditableColumnRow({
  col,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: EditableColumnRowProps) {
  const [dataType, setDataType] = useState(col.data_type);
  const [nullable, setNullable] = useState(col.nullable);
  const [defaultValue, setDefaultValue] = useState(col.default_value ?? "");

  const inputClass =
    "w-full bg-transparent px-2 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary";

  const handleSave = () => {
    const hasDataTypeChange = dataType !== col.data_type;
    const hasNullableChange = nullable !== col.nullable;
    const hasDefaultChange =
      (defaultValue || null) !== (col.default_value ?? null);

    if (!hasDataTypeChange && !hasNullableChange && !hasDefaultChange) {
      onCancelEdit();
      return;
    }

    onSaveEdit({
      type: "modify",
      name: col.name,
      new_data_type: hasDataTypeChange ? dataType : null,
      new_nullable: hasNullableChange ? nullable : null,
      new_default_value: hasDefaultChange ? defaultValue || null : null,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") onCancelEdit();
  };

  return (
    <tr
      className="group border-b border-border hover:bg-muted"
      onKeyDown={handleKeyDown}
    >
      <td className="flex items-center gap-1.5 border-r border-border px-3 py-1 text-xs">
        {col.is_primary_key && (
          <span title="Primary Key">
            <Key
              size={12}
              className="shrink-0 text-warning"
              aria-label="Primary Key"
            />
          </span>
        )}
        {col.is_foreign_key && (
          <span title="Foreign Key">
            <Link2 size={12} className="shrink-0 text-primary" />
          </span>
        )}
        <span className="text-foreground">{col.name}</span>
      </td>
      <td className="border-r border-border px-3 py-1 text-xs">
        {isEditing ? (
          <input
            className={inputClass}
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            aria-label={`Data type for ${col.name}`}
          />
        ) : (
          <span className="text-secondary-foreground">{col.data_type}</span>
        )}
      </td>
      <td className="border-r border-border px-3 py-1 text-xs">
        {isEditing ? (
          <input
            type="checkbox"
            checked={nullable}
            onChange={(e) => setNullable(e.target.checked)}
            aria-label={`Nullable for ${col.name}`}
            className="rounded border-border"
          />
        ) : nullable ? (
          <span className="text-muted-foreground">YES</span>
        ) : (
          <span className="font-medium text-foreground">NO</span>
        )}
      </td>
      <td className="max-w-50 truncate border-r border-border px-3 py-1 text-xs">
        {isEditing ? (
          <input
            className={inputClass}
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            aria-label={`Default value for ${col.name}`}
            placeholder="NULL"
          />
        ) : (
          <span className="text-muted-foreground">
            {col.default_value ?? "\u2014"}
          </span>
        )}
      </td>
      <td
        className="max-w-50 truncate border-r border-border px-3 py-1 text-xs font-mono text-foreground"
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
      <td className="max-w-50 truncate border-r border-border px-3 py-1 text-xs text-primary">
        {col.fk_reference ?? "\u2014"}
      </td>
      <td className="max-w-50 truncate px-3 py-1 text-xs text-muted-foreground">
        {col.comment ?? "\u2014"}
      </td>
      <td className="w-20 border-l border-border px-1 py-1 text-center">
        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-success"
                onClick={handleSave}
                aria-label={`Save changes for ${col.name}`}
                title="Save"
              >
                <Check />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onCancelEdit}
                aria-label={`Cancel editing ${col.name}`}
                title="Cancel"
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
                aria-label={`Edit column ${col.name}`}
                title="Edit"
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="hover:text-destructive"
                onClick={onDelete}
                aria-label={`Delete column ${col.name}`}
                title="Delete"
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
  table,
  schema,
  columns,
  onRefresh,
  paradigm,
}: ColumnsEditorProps) {
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Action bar */}
      <div className="flex items-center justify-end border-b border-border bg-secondary px-2 py-1">
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
            aria-label={`Review SQL (${pendingCount})`}
          >
            <Eye />
            Review SQL ({pendingCount})
          </Button>
        )}
      </div>

      {/* Table */}
      {columns.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-secondary">
              <tr>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Name
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Type
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Nullable
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Default
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Check
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Ref
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Comment
                </th>
                <th className="w-20 border-b border-border px-1 py-1.5 text-center text-xs font-medium text-secondary-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {columns
                .filter((col) => !droppedColumns.has(col.name))
                .map((col) => (
                  <EditableColumnRow
                    key={col.name}
                    col={col}
                    isEditing={editingColumn === col.name}
                    onStartEdit={() => setEditingColumn(col.name)}
                    onCancelEdit={() => setEditingColumn(null)}
                    onSaveEdit={(change) => handleSaveEdit(col.name, change)}
                    onDelete={() => handleDeleteColumn(col.name)}
                  />
                ))}
              {/* Sprint 236 \u2014 inline `NewColumnRow` + pending-add row
                  rendering removed; `+ Column` toolbar now opens
                  `AddColumnDialog`. The inline-batched MODIFY path
                  stays \u2014 it goes through `pendingChanges` /
                  `alter_table` (Sprint 237 polish target). */}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {columns.length === 0 &&
        pendingChanges.length === 0 &&
        newColumnDrafts.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {vocab.emptyUnits}
          </div>
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
          onConfirm={() => {
            void ddl.confirmDangerous();
          }}
          onCancel={ddl.cancelDangerous}
        />
      )}

      {/* Sprint 236 — AddColumnDialog (replaces inline NewColumnDraft). */}
      <AddColumnDialog
        connectionId={connectionId}
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
          schemaName={schema}
          tableName={table}
          columnName={dropColumnTarget}
          open
          onClose={() => setDropColumnTarget(null)}
          onColumnDropped={onRefresh}
        />
      )}
    </div>
  );
}
