import { useState } from "react";
import { Key, Link2, Plus, Pencil, Trash2, X, Check, Eye } from "lucide-react";
import type { ColumnInfo, ColumnChange } from "@/types/schema";
import type { Paradigm } from "@/types/connection";
import { getParadigmVocabulary } from "@/lib/strings/paradigm-vocabulary";
import * as tauri from "@lib/tauri";
import SqlPreviewDialog from "./SqlPreviewDialog";
import { Button } from "@components/ui/button";

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
// New column row (inline add)
// ---------------------------------------------------------------------------

interface NewColumnRowProps {
  draft: NewColumnDraft;
  onUpdate: (updates: Partial<NewColumnDraft>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function NewColumnRow({
  draft,
  onUpdate,
  onConfirm,
  onCancel,
}: NewColumnRowProps) {
  const inputClass =
    "w-full bg-transparent px-2 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onConfirm();
    if (e.key === "Escape") onCancel();
  };

  return (
    <tr
      className="border-b border-border bg-muted/50"
      onKeyDown={handleKeyDown}
    >
      <td className="border-r border-border px-3 py-1 text-xs">
        <input
          className={inputClass}
          value={draft.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="column_name"
          aria-label="New column name"
          autoFocus
        />
      </td>
      <td className="border-r border-border px-3 py-1 text-xs">
        <input
          className={inputClass}
          value={draft.data_type}
          onChange={(e) => onUpdate({ data_type: e.target.value })}
          placeholder="varchar(255)"
          aria-label="New column data type"
        />
      </td>
      <td className="border-r border-border px-3 py-1 text-xs">
        <input
          type="checkbox"
          checked={draft.nullable}
          onChange={(e) => onUpdate({ nullable: e.target.checked })}
          aria-label="New column nullable"
          className="rounded border-border"
        />
      </td>
      <td className="border-r border-border px-3 py-1 text-xs">
        <input
          className={inputClass}
          value={draft.default_value}
          onChange={(e) => onUpdate({ default_value: e.target.value })}
          placeholder="NULL"
          aria-label="New column default value"
        />
      </td>
      <td className="border-r border-border px-3 py-1 text-xs text-muted-foreground">
        {"\u2014"}
      </td>
      <td className="border-r border-border px-3 py-1 text-xs text-muted-foreground">
        {"\u2014"}
      </td>
      <td className="w-20 border-l border-border px-1 py-1 text-center">
        <div className="flex items-center justify-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-success"
            onClick={onConfirm}
            disabled={!draft.name.trim() || !draft.data_type.trim()}
            aria-label="Confirm add column"
            title="Confirm"
          >
            <Check />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onCancel}
            aria-label="Cancel add column"
            title="Cancel"
          >
            <X />
          </Button>
        </div>
      </td>
    </tr>
  );
}

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
   * Sprint 179 — paradigm-aware button + empty-state copy. Defaults to
   * `"rdb"` so existing callers (StructurePanel without an explicit
   * paradigm) see the legacy English vocabulary unchanged. Mongo callers
   * pass `"document"` to render "Add Field" / "No fields found".
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
  // Sprint 179 (AC-179-04) — `getParadigmVocabulary` enforces the
  // `undefined → rdb` fallback in one place; component just looks up.
  const vocab = getParadigmVocabulary(paradigm);
  // Sprint 179 — accessibility-name preserves the sentence-case form the
  // legacy RDB tests assert (`"Add column"` lowercase 'c'). The visible
  // button text uses the dictionary's title-case form (`"Add Column"`).
  // For document paradigm this yields aria-label "Add field" + visible
  // "Add Field"; AC-179-02 asserts both.
  const ariaAddUnit = `Add ${vocab.unit.toLowerCase()}`;
  // Column editing state
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PendingColumnChange[]>(
    [],
  );
  const [newColumnDrafts, setNewColumnDrafts] = useState<NewColumnDraft[]>([]);
  const [droppedColumns, setDroppedColumns] = useState<Set<string>>(new Set());

  // SQL preview modal state
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [previewSql, setPreviewSql] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const pendingCount = pendingChanges.length;

  // -------------------------------------------------------------------------
  // Column editing handlers
  // -------------------------------------------------------------------------

  const handleAddColumn = () => {
    setNewColumnDrafts((prev) => [
      ...prev,
      {
        trackingId: crypto.randomUUID(),
        name: "",
        data_type: "",
        nullable: true,
        default_value: "",
      },
    ]);
  };

  const handleUpdateDraft = (
    trackingId: string,
    updates: Partial<NewColumnDraft>,
  ) => {
    setNewColumnDrafts((prev) =>
      prev.map((d) => (d.trackingId === trackingId ? { ...d, ...updates } : d)),
    );
  };

  const handleConfirmDraft = (trackingId: string) => {
    const draft = newColumnDrafts.find((d) => d.trackingId === trackingId);
    if (!draft || !draft.name.trim() || !draft.data_type.trim()) return;

    const change: ColumnChange = {
      type: "add",
      name: draft.name.trim(),
      data_type: draft.data_type.trim(),
      nullable: draft.nullable,
      default_value: draft.default_value.trim() || null,
    };

    setPendingChanges((prev) => [
      ...prev,
      { trackingId: draft.trackingId, change },
    ]);
    setNewColumnDrafts((prev) =>
      prev.filter((d) => d.trackingId !== trackingId),
    );
  };

  const handleCancelDraft = (trackingId: string) => {
    setNewColumnDrafts((prev) =>
      prev.filter((d) => d.trackingId !== trackingId),
    );
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

  const handleDeleteColumn = (columnName: string) => {
    setDroppedColumns((prev) => new Set(prev).add(columnName));
    setPendingChanges((prev) => {
      // Remove any pending add/modify for the same column
      const filtered = prev.filter(
        (p) =>
          !(
            p.originalColumn === columnName ||
            (p.change.type === "add" && p.change.name === columnName)
          ),
      );
      return [
        ...filtered,
        {
          trackingId: crypto.randomUUID(),
          change: { type: "drop", name: columnName },
          originalColumn: columnName,
        },
      ];
    });
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
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewSql("");
    try {
      const result = await tauri.alterTable(buildAlterRequest(true));
      setPreviewSql(result.sql);
    } catch (e) {
      setPreviewError(String(e));
      setPreviewSql("");
    }
    setPreviewLoading(false);
  };

  const handleExecute = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      await tauri.alterTable(buildAlterRequest(false));
      setShowSqlModal(false);
      setPendingChanges([]);
      setDroppedColumns(new Set());
      setNewColumnDrafts([]);
      setEditingColumn(null);
      // Refresh column data after successful execution
      await onRefresh();
    } catch (e) {
      setPreviewError(String(e));
    }
    setPreviewLoading(false);
  };

  const handleCancelPending = () => {
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
              {newColumnDrafts.map((draft) => (
                <NewColumnRow
                  key={draft.trackingId}
                  draft={draft}
                  onUpdate={(updates) =>
                    handleUpdateDraft(draft.trackingId, updates)
                  }
                  onConfirm={() => handleConfirmDraft(draft.trackingId)}
                  onCancel={() => handleCancelDraft(draft.trackingId)}
                />
              ))}
              {/* Show pending add rows (confirmed but not yet executed) */}
              {pendingChanges
                .filter((p) => p.change.type === "add")
                .map((p) => {
                  const change = p.change;
                  if (change.type !== "add") return null;
                  return (
                    <tr
                      key={p.trackingId}
                      className="border-b border-border bg-success/5"
                    >
                      <td className="flex items-center gap-1.5 border-r border-border px-3 py-1 text-xs text-success">
                        {change.name}
                        <span className="rounded bg-success/10 px-1 py-0.5 text-3xs font-medium">
                          new
                        </span>
                      </td>
                      <td className="border-r border-border px-3 py-1 text-xs text-secondary-foreground">
                        {change.data_type}
                      </td>
                      <td className="border-r border-border px-3 py-1 text-xs">
                        {change.nullable ? (
                          <span className="text-muted-foreground">YES</span>
                        ) : (
                          <span className="font-medium text-foreground">
                            NO
                          </span>
                        )}
                      </td>
                      <td className="border-r border-border px-3 py-1 text-xs text-muted-foreground">
                        {change.default_value ?? "\u2014"}
                      </td>
                      <td className="border-r border-border px-3 py-1 text-xs text-muted-foreground">
                        {"\u2014"}
                      </td>
                      <td className="border-r border-border px-3 py-1 text-xs text-muted-foreground">
                        {"\u2014"}
                      </td>
                      <td className="w-20 border-l border-border px-1 py-1 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="hover:text-destructive"
                            onClick={() => {
                              setPendingChanges((prev) =>
                                prev.filter(
                                  (pc) => pc.trackingId !== p.trackingId,
                                ),
                              );
                            }}
                            aria-label={`Remove pending column ${change.name}`}
                            title="Remove"
                          >
                            <X />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
          sql={previewSql}
          loading={previewLoading}
          error={previewError}
          onConfirm={handleExecute}
          onCancel={handleCancelPending}
        />
      )}
    </div>
  );
}
