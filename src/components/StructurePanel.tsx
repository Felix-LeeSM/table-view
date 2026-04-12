import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  Key,
  Link2,
  Shield,
  Plus,
  Pencil,
  Trash2,
  X,
  Eye,
  Play,
} from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import * as tauri from "../lib/tauri";
import type {
  ColumnInfo,
  IndexInfo,
  ConstraintInfo,
  ColumnChange,
  AlterTableRequest,
  ConstraintDefinition,
} from "../types/schema";

interface StructurePanelProps {
  connectionId: string;
  table: string;
  schema: string;
}

type SubTab = "columns" | "indexes" | "constraints";

/** Represents a pending column change with a unique tracking id */
interface PendingColumnChange {
  trackingId: string;
  change: ColumnChange;
  /** Original column name for modify/drop; empty for add */
  originalColumn?: string;
}

/** Tracks a new column row being edited inline */
interface NewColumnDraft {
  trackingId: string;
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string;
}

// ---------------------------------------------------------------------------
// SQL Preview Modal
// ---------------------------------------------------------------------------

interface SqlPreviewModalProps {
  sql: string;
  loading: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function SqlPreviewModal({
  sql,
  loading,
  error,
  onConfirm,
  onCancel,
}: SqlPreviewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  // Focus trap: focus the dialog on open
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Review SQL changes"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-[520px] rounded-lg bg-(--color-bg-secondary) shadow-xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--color-border) px-4 py-3">
          <h2 className="text-sm font-semibold text-(--color-text-primary)">
            Review SQL Changes
          </h2>
          <button
            className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
            onClick={onCancel}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* SQL content */}
        <div className="px-4 py-3">
          <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded border border-(--color-border) bg-(--color-bg-primary) p-3 text-xs font-mono text-(--color-text-primary)">
            {sql || "-- No changes to preview"}
          </pre>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-3 rounded bg-red-500/10 px-3 py-2 text-sm text-(--color-danger)">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-(--color-border) px-4 py-3">
          <button
            className="rounded px-3 py-1.5 text-sm text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className="flex items-center gap-1.5 rounded bg-(--color-accent) px-3 py-1.5 text-sm text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
            onClick={onConfirm}
            disabled={loading || !sql.trim()}
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            {loading ? "Executing..." : "Execute"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Index Modal
// ---------------------------------------------------------------------------

const INDEX_TYPES = ["btree", "hash", "gist", "gin", "brin"] as const;

interface CreateIndexModalProps {
  columns: ColumnInfo[];
  onSubmit: (params: {
    indexName: string;
    columns: string[];
    indexType: string;
    isUnique: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}

function CreateIndexModal({
  columns,
  onSubmit,
  onCancel,
}: CreateIndexModalProps) {
  const [indexName, setIndexName] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [indexType, setIndexType] = useState<string>("btree");
  const [isUnique, setIsUnique] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const toggleColumn = (colName: string) => {
    setSelectedColumns((prev) =>
      prev.includes(colName)
        ? prev.filter((c) => c !== colName)
        : [...prev, colName],
    );
  };

  const isValid = indexName.trim() && selectedColumns.length > 0;

  const handlePreview = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    try {
      await onSubmit({
        indexName: indexName.trim(),
        columns: selectedColumns,
        indexType,
        isUnique,
      });
      // onSubmit handles preview_only=true first; the parent sets the SQL preview state
      // We'll use a different approach: call the parent's preview handler and get SQL back
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Create index"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-[480px] rounded-lg bg-(--color-bg-secondary) shadow-xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--color-border) px-4 py-3">
          <h2 className="text-sm font-semibold text-(--color-text-primary)">
            Create Index
          </h2>
          <button
            className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
            onClick={onCancel}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="px-4 py-3 space-y-3">
          {/* Index Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-(--color-text-secondary)">
              Index Name
            </label>
            <input
              className="w-full rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1.5 text-sm text-(--color-text-primary) outline-none focus:border-(--color-accent)"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="idx_name"
              aria-label="Index name"
              autoFocus
            />
          </div>

          {/* Columns */}
          <div>
            <label className="mb-1 block text-xs font-medium text-(--color-text-secondary)">
              Columns
            </label>
            <div className="max-h-[120px] overflow-auto rounded border border-(--color-border) bg-(--color-bg-primary) p-2">
              {columns.map((col) => (
                <label
                  key={col.name}
                  className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-xs text-(--color-text-primary) hover:bg-(--color-bg-tertiary) rounded"
                >
                  <input
                    type="checkbox"
                    checked={selectedColumns.includes(col.name)}
                    onChange={() => toggleColumn(col.name)}
                    className="rounded border-(--color-border)"
                  />
                  {col.name}
                  <span className="text-(--color-text-muted)">
                    ({col.data_type})
                  </span>
                </label>
              ))}
              {columns.length === 0 && (
                <span className="text-xs text-(--color-text-muted)">
                  No columns available
                </span>
              )}
            </div>
          </div>

          {/* Index Type */}
          <div>
            <label className="mb-1 block text-xs font-medium text-(--color-text-secondary)">
              Index Type
            </label>
            <select
              className="w-full rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1.5 text-sm text-(--color-text-primary) outline-none focus:border-(--color-accent)"
              value={indexType}
              onChange={(e) => setIndexType(e.target.value)}
              aria-label="Index type"
            >
              {INDEX_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Unique */}
          <label className="flex cursor-pointer items-center gap-2 text-xs text-(--color-text-primary)">
            <input
              type="checkbox"
              checked={isUnique}
              onChange={(e) => setIsUnique(e.target.checked)}
              className="rounded border-(--color-border)"
            />
            Unique
          </label>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-3 rounded bg-red-500/10 px-3 py-2 text-sm text-(--color-danger)">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-(--color-border) px-4 py-3">
          <button
            className="rounded px-3 py-1.5 text-sm text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className="flex items-center gap-1.5 rounded bg-(--color-accent) px-3 py-1.5 text-sm text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
            onClick={handlePreview}
            disabled={loading || !isValid}
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Eye size={14} />
            )}
            {loading ? "Previewing..." : "Preview SQL"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Constraint Modal
// ---------------------------------------------------------------------------

type ConstraintType = "primary_key" | "foreign_key" | "unique" | "check";

interface AddConstraintModalProps {
  columns: ColumnInfo[];
  onSubmit: (params: {
    constraintName: string;
    definition: ConstraintDefinition;
  }) => Promise<void>;
  onCancel: () => void;
}

function AddConstraintModal({
  columns,
  onSubmit,
  onCancel,
}: AddConstraintModalProps) {
  const [constraintName, setConstraintName] = useState("");
  const [constraintType, setConstraintType] =
    useState<ConstraintType>("unique");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [referenceTable, setReferenceTable] = useState("");
  const [referenceColumns, setReferenceColumns] = useState("");
  const [checkExpression, setCheckExpression] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const toggleColumn = (colName: string) => {
    setSelectedColumns((prev) =>
      prev.includes(colName)
        ? prev.filter((c) => c !== colName)
        : [...prev, colName],
    );
  };

  const needsColumns =
    constraintType === "primary_key" ||
    constraintType === "foreign_key" ||
    constraintType === "unique";
  const needsReference = constraintType === "foreign_key";
  const needsExpression = constraintType === "check";

  const isValid =
    constraintName.trim() &&
    (needsColumns
      ? selectedColumns.length > 0
      : needsExpression
        ? checkExpression.trim().length > 0
        : false);

  const handlePreview = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);

    let definition: ConstraintDefinition;
    switch (constraintType) {
      case "primary_key":
        definition = { type: "primary_key", columns: selectedColumns };
        break;
      case "unique":
        definition = { type: "unique", columns: selectedColumns };
        break;
      case "foreign_key":
        definition = {
          type: "foreign_key",
          columns: selectedColumns,
          reference_table: referenceTable.trim(),
          reference_columns: referenceColumns
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
        break;
      case "check":
        definition = {
          type: "check",
          expression: checkExpression.trim(),
        };
        break;
    }

    try {
      await onSubmit({
        constraintName: constraintName.trim(),
        definition,
      });
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Add constraint"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-[480px] rounded-lg bg-(--color-bg-secondary) shadow-xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--color-border) px-4 py-3">
          <h2 className="text-sm font-semibold text-(--color-text-primary)">
            Add Constraint
          </h2>
          <button
            className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
            onClick={onCancel}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="px-4 py-3 space-y-3">
          {/* Constraint Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-(--color-text-secondary)">
              Constraint Name
            </label>
            <input
              className="w-full rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1.5 text-sm text-(--color-text-primary) outline-none focus:border-(--color-accent)"
              value={constraintName}
              onChange={(e) => setConstraintName(e.target.value)}
              placeholder="constraint_name"
              aria-label="Constraint name"
              autoFocus
            />
          </div>

          {/* Constraint Type */}
          <div>
            <label className="mb-1 block text-xs font-medium text-(--color-text-secondary)">
              Type
            </label>
            <select
              className="w-full rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1.5 text-sm text-(--color-text-primary) outline-none focus:border-(--color-accent)"
              value={constraintType}
              onChange={(e) => {
                setConstraintType(e.target.value as ConstraintType);
                setSelectedColumns([]);
                setReferenceTable("");
                setReferenceColumns("");
                setCheckExpression("");
              }}
              aria-label="Constraint type"
            >
              <option value="primary_key">PRIMARY KEY</option>
              <option value="unique">UNIQUE</option>
              <option value="foreign_key">FOREIGN KEY</option>
              <option value="check">CHECK</option>
            </select>
          </div>

          {/* Dynamic fields based on type */}
          {needsColumns && (
            <div>
              <label className="mb-1 block text-xs font-medium text-(--color-text-secondary)">
                Columns
              </label>
              <div className="max-h-[120px] overflow-auto rounded border border-(--color-border) bg-(--color-bg-primary) p-2">
                {columns.map((col) => (
                  <label
                    key={col.name}
                    className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-xs text-(--color-text-primary) hover:bg-(--color-bg-tertiary) rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedColumns.includes(col.name)}
                      onChange={() => toggleColumn(col.name)}
                      className="rounded border-(--color-border)"
                    />
                    {col.name}
                    <span className="text-(--color-text-muted)">
                      ({col.data_type})
                    </span>
                  </label>
                ))}
                {columns.length === 0 && (
                  <span className="text-xs text-(--color-text-muted)">
                    No columns available
                  </span>
                )}
              </div>
            </div>
          )}

          {needsReference && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-(--color-text-secondary)">
                  Reference Table
                </label>
                <input
                  className="w-full rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1.5 text-sm text-(--color-text-primary) outline-none focus:border-(--color-accent)"
                  value={referenceTable}
                  onChange={(e) => setReferenceTable(e.target.value)}
                  placeholder="reference_table"
                  aria-label="Reference table"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-(--color-text-secondary)">
                  Reference Columns (comma-separated)
                </label>
                <input
                  className="w-full rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1.5 text-sm text-(--color-text-primary) outline-none focus:border-(--color-accent)"
                  value={referenceColumns}
                  onChange={(e) => setReferenceColumns(e.target.value)}
                  placeholder="id, name"
                  aria-label="Reference columns"
                />
              </div>
            </>
          )}

          {needsExpression && (
            <div>
              <label className="mb-1 block text-xs font-medium text-(--color-text-secondary)">
                Check Expression
              </label>
              <input
                className="w-full rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1.5 text-sm text-(--color-text-primary) outline-none focus:border-(--color-accent)"
                value={checkExpression}
                onChange={(e) => setCheckExpression(e.target.value)}
                placeholder="price > 0"
                aria-label="Check expression"
              />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-3 rounded bg-red-500/10 px-3 py-2 text-sm text-(--color-danger)">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-(--color-border) px-4 py-3">
          <button
            className="rounded px-3 py-1.5 text-sm text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className="flex items-center gap-1.5 rounded bg-(--color-accent) px-3 py-1.5 text-sm text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
            onClick={handlePreview}
            disabled={loading || !isValid}
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Eye size={14} />
            )}
            {loading ? "Previewing..." : "Preview SQL"}
          </button>
        </div>
      </div>
    </div>
  );
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
    "w-full rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-0.5 text-xs text-(--color-text-primary) outline-none focus:border-(--color-accent)";

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
      className="group border-b border-(--color-border) hover:bg-(--color-bg-tertiary)"
      onKeyDown={handleKeyDown}
    >
      <td className="flex items-center gap-1.5 border-r border-(--color-border) px-3 py-1 text-xs">
        {col.is_primary_key && (
          <span title="Primary Key">
            <Key
              size={12}
              className="shrink-0 text-amber-500"
              aria-label="Primary Key"
            />
          </span>
        )}
        {col.is_foreign_key && (
          <span title="Foreign Key">
            <Link2 size={12} className="shrink-0 text-(--color-accent)" />
          </span>
        )}
        <span className="text-(--color-text-primary)">{col.name}</span>
      </td>
      <td className="border-r border-(--color-border) px-3 py-1 text-xs">
        {isEditing ? (
          <input
            className={inputClass}
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            aria-label={`Data type for ${col.name}`}
          />
        ) : (
          <span className="text-(--color-text-secondary)">{col.data_type}</span>
        )}
      </td>
      <td className="border-r border-(--color-border) px-3 py-1 text-xs">
        {isEditing ? (
          <input
            type="checkbox"
            checked={nullable}
            onChange={(e) => setNullable(e.target.checked)}
            aria-label={`Nullable for ${col.name}`}
            className="rounded border-(--color-border)"
          />
        ) : nullable ? (
          <span className="text-(--color-text-muted)">YES</span>
        ) : (
          <span className="font-medium text-(--color-text-primary)">NO</span>
        )}
      </td>
      <td className="max-w-[200px] truncate border-r border-(--color-border) px-3 py-1 text-xs">
        {isEditing ? (
          <input
            className={inputClass}
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            aria-label={`Default value for ${col.name}`}
            placeholder="NULL"
          />
        ) : (
          <span className="text-(--color-text-muted)">
            {col.default_value ?? "\u2014"}
          </span>
        )}
      </td>
      <td className="max-w-[200px] truncate border-r border-(--color-border) px-3 py-1 text-xs text-(--color-accent)">
        {col.fk_reference ?? "\u2014"}
      </td>
      <td className="max-w-[200px] truncate px-3 py-1 text-xs text-(--color-text-muted)">
        {col.comment ?? "\u2014"}
      </td>
      <td className="w-20 border-l border-(--color-border) px-1 py-1 text-center">
        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {isEditing ? (
            <>
              <button
                className="rounded p-1 text-(--color-success) hover:bg-(--color-bg-tertiary)"
                onClick={handleSave}
                aria-label={`Save changes for ${col.name}`}
                title="Save"
              >
                <Eye size={12} />
              </button>
              <button
                className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
                onClick={onCancelEdit}
                aria-label={`Cancel editing ${col.name}`}
                title="Cancel"
              >
                <X size={12} />
              </button>
            </>
          ) : (
            <>
              <button
                className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-text-primary)"
                onClick={onStartEdit}
                aria-label={`Edit column ${col.name}`}
                title="Edit"
              >
                <Pencil size={12} />
              </button>
              <button
                className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-danger)"
                onClick={onDelete}
                aria-label={`Delete column ${col.name}`}
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
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
    "w-full rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-0.5 text-xs text-(--color-text-primary) outline-none focus:border-(--color-accent)";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onConfirm();
    if (e.key === "Escape") onCancel();
  };

  return (
    <tr
      className="border-b border-(--color-border) bg-(--color-bg-tertiary)/50"
      onKeyDown={handleKeyDown}
    >
      <td className="border-r border-(--color-border) px-3 py-1 text-xs">
        <input
          className={inputClass}
          value={draft.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="column_name"
          aria-label="New column name"
          autoFocus
        />
      </td>
      <td className="border-r border-(--color-border) px-3 py-1 text-xs">
        <input
          className={inputClass}
          value={draft.data_type}
          onChange={(e) => onUpdate({ data_type: e.target.value })}
          placeholder="varchar(255)"
          aria-label="New column data type"
        />
      </td>
      <td className="border-r border-(--color-border) px-3 py-1 text-xs">
        <input
          type="checkbox"
          checked={draft.nullable}
          onChange={(e) => onUpdate({ nullable: e.target.checked })}
          aria-label="New column nullable"
          className="rounded border-(--color-border)"
        />
      </td>
      <td className="border-r border-(--color-border) px-3 py-1 text-xs">
        <input
          className={inputClass}
          value={draft.default_value}
          onChange={(e) => onUpdate({ default_value: e.target.value })}
          placeholder="NULL"
          aria-label="New column default value"
        />
      </td>
      <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-muted)">
        {"\u2014"}
      </td>
      <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-muted)">
        {"\u2014"}
      </td>
      <td className="w-20 border-l border-(--color-border) px-1 py-1 text-center">
        <div className="flex items-center justify-center gap-0.5">
          <button
            className="rounded p-1 text-(--color-success) hover:bg-(--color-bg-tertiary)"
            onClick={onConfirm}
            disabled={!draft.name.trim() || !draft.data_type.trim()}
            aria-label="Confirm add column"
            title="Confirm"
          >
            <Eye size={12} />
          </button>
          <button
            className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
            onClick={onCancel}
            aria-label="Cancel add column"
            title="Cancel"
          >
            <X size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StructurePanel({
  connectionId,
  table,
  schema,
}: StructurePanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("columns");
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

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

  // Index/Constraint modal state
  const [showCreateIndexModal, setShowCreateIndexModal] = useState(false);
  const [showAddConstraintModal, setShowAddConstraintModal] = useState(false);
  const [indexPreviewSql, setIndexPreviewSql] = useState("");
  const [indexPreviewLoading, setIndexPreviewLoading] = useState(false);
  const [indexPreviewError, setIndexPreviewError] = useState<string | null>(
    null,
  );
  const [showIndexPreviewModal, setShowIndexPreviewModal] = useState(false);
  const pendingIndexExecuteRef = useRef<(() => Promise<void>) | null>(null);

  const getTableColumns = useSchemaStore((s) => s.getTableColumns);
  const getTableIndexes = useSchemaStore((s) => s.getTableIndexes);
  const getTableConstraints = useSchemaStore((s) => s.getTableConstraints);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeSubTab === "columns") {
        const cols = await getTableColumns(connectionId, table, schema);
        setColumns(cols);
      } else if (activeSubTab === "indexes") {
        const idx = await getTableIndexes(connectionId, table, schema);
        setIndexes(idx);
      } else {
        const cons = await getTableConstraints(connectionId, table, schema);
        setConstraints(cons);
      }
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
    setHasFetched(true);
  }, [
    connectionId,
    table,
    schema,
    activeSubTab,
    getTableColumns,
    getTableIndexes,
    getTableConstraints,
  ]);

  // Listen for context-aware refresh events (Cmd+R / F5)
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("refresh-structure", handler);
    return () => window.removeEventListener("refresh-structure", handler);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setHasFetched(false);
  }, [activeSubTab]);

  // Reset editing state when columns change
  useEffect(() => {
    setEditingColumn(null);
    setPendingChanges([]);
    setNewColumnDrafts([]);
    setDroppedColumns(new Set());
    setShowSqlModal(false);
  }, [connectionId, table, schema]);

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

  const buildAlterRequest = (previewOnly: boolean): AlterTableRequest => ({
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
      await fetchData();
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
  // Index CRUD handlers
  // -------------------------------------------------------------------------

  const handleCreateIndexPreview = async (params: {
    indexName: string;
    columns: string[];
    indexType: string;
    isUnique: boolean;
  }) => {
    const result = await tauri.createIndex({
      connection_id: connectionId,
      schema,
      table,
      index_name: params.indexName,
      columns: params.columns,
      index_type: params.indexType,
      is_unique: params.isUnique,
      preview_only: true,
    });
    setIndexPreviewSql(result.sql);
    pendingIndexExecuteRef.current = async () => {
      await tauri.createIndex({
        connection_id: connectionId,
        schema,
        table,
        index_name: params.indexName,
        columns: params.columns,
        index_type: params.indexType,
        is_unique: params.isUnique,
        preview_only: false,
      });
    };
    setShowCreateIndexModal(false);
    setShowIndexPreviewModal(true);
  };

  const handleIndexPreviewConfirm = async () => {
    if (!pendingIndexExecuteRef.current) return;
    setIndexPreviewLoading(true);
    setIndexPreviewError(null);
    try {
      await pendingIndexExecuteRef.current();
      setShowIndexPreviewModal(false);
      pendingIndexExecuteRef.current = null;
      setIndexPreviewSql("");
      await fetchData();
    } catch (e) {
      setIndexPreviewError(String(e));
    }
    setIndexPreviewLoading(false);
  };

  const handleIndexPreviewCancel = () => {
    setShowIndexPreviewModal(false);
    pendingIndexExecuteRef.current = null;
    setIndexPreviewSql("");
    setIndexPreviewError(null);
  };

  const handleDropIndex = async (indexName: string) => {
    setIndexPreviewLoading(true);
    setIndexPreviewError(null);
    try {
      const result = await tauri.dropIndex({
        connection_id: connectionId,
        schema,
        index_name: indexName,
        preview_only: true,
      });
      setIndexPreviewSql(result.sql);
      pendingIndexExecuteRef.current = async () => {
        await tauri.dropIndex({
          connection_id: connectionId,
          schema,
          index_name: indexName,
          preview_only: false,
        });
      };
      setShowIndexPreviewModal(true);
    } catch (e) {
      setIndexPreviewError(String(e));
      setIndexPreviewSql("");
      setShowIndexPreviewModal(true);
    }
    setIndexPreviewLoading(false);
  };

  // -------------------------------------------------------------------------
  // Constraint CRUD handlers
  // -------------------------------------------------------------------------

  const handleAddConstraintPreview = async (params: {
    constraintName: string;
    definition: ConstraintDefinition;
  }) => {
    const result = await tauri.addConstraint({
      connection_id: connectionId,
      schema,
      table,
      constraint_name: params.constraintName,
      definition: params.definition,
      preview_only: true,
    });
    setIndexPreviewSql(result.sql);
    pendingIndexExecuteRef.current = async () => {
      await tauri.addConstraint({
        connection_id: connectionId,
        schema,
        table,
        constraint_name: params.constraintName,
        definition: params.definition,
        preview_only: false,
      });
    };
    setShowAddConstraintModal(false);
    setShowIndexPreviewModal(true);
  };

  const handleDropConstraint = async (constraintName: string) => {
    setIndexPreviewLoading(true);
    setIndexPreviewError(null);
    try {
      const result = await tauri.dropConstraint({
        connection_id: connectionId,
        schema,
        table,
        constraint_name: constraintName,
        preview_only: true,
      });
      setIndexPreviewSql(result.sql);
      pendingIndexExecuteRef.current = async () => {
        await tauri.dropConstraint({
          connection_id: connectionId,
          schema,
          table,
          constraint_name: constraintName,
          preview_only: false,
        });
      };
      setShowIndexPreviewModal(true);
    } catch (e) {
      setIndexPreviewError(String(e));
      setIndexPreviewSql("");
      setShowIndexPreviewModal(true);
    }
    setIndexPreviewLoading(false);
  };

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "columns", label: "Columns" },
    { key: "indexes", label: "Indexes" },
    { key: "constraints", label: "Constraints" },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-0 border-b border-(--color-border) bg-(--color-bg-secondary)">
        {subTabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeSubTab === tab.key}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
              activeSubTab === tab.key
                ? "border-b-2 border-(--color-accent) text-(--color-text-primary)"
                : "text-(--color-text-muted) hover:text-(--color-text-secondary)"
            }`}
            onClick={() => setActiveSubTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}

        {/* Column editing actions */}
        {activeSubTab === "columns" && (
          <div className="ml-auto flex items-center gap-1 pr-2">
            <button
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
              onClick={handleAddColumn}
              aria-label="Add column"
            >
              <Plus size={12} />
              Add Column
            </button>
            {pendingCount > 0 && (
              <button
                className="flex items-center gap-1 rounded bg-(--color-accent) px-2 py-1 text-xs text-white hover:bg-(--color-accent-hover)"
                onClick={handleReviewSql}
                aria-label={`Review SQL (${pendingCount})`}
              >
                <Eye size={12} />
                Review SQL ({pendingCount})
              </button>
            )}
          </div>
        )}

        {/* Index actions */}
        {activeSubTab === "indexes" && (
          <div className="ml-auto flex items-center gap-1 pr-2">
            <button
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
              onClick={async () => {
                if (columns.length === 0) {
                  const cols = await getTableColumns(
                    connectionId,
                    table,
                    schema,
                  );
                  setColumns(cols);
                }
                setShowCreateIndexModal(true);
              }}
              aria-label="Create index"
            >
              <Plus size={12} />
              Create Index
            </button>
          </div>
        )}

        {/* Constraint actions */}
        {activeSubTab === "constraints" && (
          <div className="ml-auto flex items-center gap-1 pr-2">
            <button
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
              onClick={async () => {
                if (columns.length === 0) {
                  const cols = await getTableColumns(
                    connectionId,
                    table,
                    schema,
                  );
                  setColumns(cols);
                }
                setShowAddConstraintModal(true);
              }}
              aria-label="Add constraint"
            >
              <Plus size={12} />
              Add Constraint
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {error && (
        <div
          role="alert"
          className="border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-(--color-danger)"
        >
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2
            className="animate-spin text-(--color-text-muted)"
            size={24}
          />
        </div>
      )}

      {!loading && activeSubTab === "columns" && columns.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-(--color-bg-secondary)">
              <tr>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Name
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Type
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Nullable
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Default
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Ref
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Comment
                </th>
                <th className="w-20 border-b border-(--color-border) px-1 py-1.5 text-center text-xs font-medium text-(--color-text-secondary)">
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
                      className="border-b border-(--color-border) bg-green-500/5"
                    >
                      <td className="flex items-center gap-1.5 border-r border-(--color-border) px-3 py-1 text-xs text-green-600">
                        {change.name}
                        <span className="rounded bg-green-500/10 px-1 py-0.5 text-[10px] font-medium">
                          new
                        </span>
                      </td>
                      <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary)">
                        {change.data_type}
                      </td>
                      <td className="border-r border-(--color-border) px-3 py-1 text-xs">
                        {change.nullable ? (
                          <span className="text-(--color-text-muted)">YES</span>
                        ) : (
                          <span className="font-medium text-(--color-text-primary)">
                            NO
                          </span>
                        )}
                      </td>
                      <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-muted)">
                        {change.default_value ?? "\u2014"}
                      </td>
                      <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-muted)">
                        {"\u2014"}
                      </td>
                      <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-muted)">
                        {"\u2014"}
                      </td>
                      <td className="w-20 border-l border-(--color-border) px-1 py-1 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <button
                            className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-danger)"
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
                            <X size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeSubTab === "indexes" && indexes.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-(--color-bg-secondary)">
              <tr>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Name
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Columns
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Type
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Properties
                </th>
                <th className="w-20 border-b border-(--color-border) px-1 py-1.5 text-center text-xs font-medium text-(--color-text-secondary)">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((idx) => (
                <tr
                  key={idx.name}
                  className="group border-b border-(--color-border) hover:bg-(--color-bg-tertiary)"
                >
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-primary)">
                    {idx.name}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary)">
                    {idx.columns.join(", ")}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-muted)">
                    {idx.index_type}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs">
                    <div className="flex items-center gap-2">
                      {idx.is_primary && (
                        <span className="flex items-center gap-0.5 text-amber-500">
                          <Key size={10} aria-hidden="true" /> PK
                        </span>
                      )}
                      {idx.is_unique && !idx.is_primary && (
                        <span className="flex items-center gap-0.5 text-(--color-accent)">
                          <Shield size={10} /> UNIQUE
                        </span>
                      )}
                      {!idx.is_primary && !idx.is_unique && (
                        <span className="text-(--color-text-muted)">
                          {"\u2014"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="w-20 border-l border-(--color-border) px-1 py-1 text-center">
                    <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!idx.is_primary && (
                        <button
                          className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-danger)"
                          onClick={() => handleDropIndex(idx.name)}
                          aria-label={`Delete index ${idx.name}`}
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeSubTab === "constraints" && constraints.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-(--color-bg-secondary)">
              <tr>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Name
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Type
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Columns
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Reference
                </th>
                <th className="w-20 border-b border-(--color-border) px-1 py-1.5 text-center text-xs font-medium text-(--color-text-secondary)">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {constraints.map((c) => (
                <tr
                  key={c.name}
                  className="group border-b border-(--color-border) hover:bg-(--color-bg-tertiary)"
                >
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-primary)">
                    {c.name}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary)">
                    {c.constraint_type}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary)">
                    {c.columns.join(", ")}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-accent)">
                    {c.reference_table
                      ? `${c.reference_table}(${(c.reference_columns ?? []).join(", ")})`
                      : "\u2014"}
                  </td>
                  <td className="w-20 border-l border-(--color-border) px-1 py-1 text-center">
                    <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-danger)"
                        onClick={() => handleDropConstraint(c.name)}
                        aria-label={`Delete constraint ${c.name}`}
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading &&
        hasFetched &&
        error === null &&
        activeSubTab === "columns" &&
        columns.length === 0 &&
        pendingChanges.length === 0 &&
        newColumnDrafts.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-(--color-text-muted)">
            No columns found
          </div>
        )}

      {!loading &&
        hasFetched &&
        error === null &&
        activeSubTab === "indexes" &&
        indexes.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-(--color-text-muted)">
            No indexes found
          </div>
        )}

      {!loading &&
        hasFetched &&
        error === null &&
        activeSubTab === "constraints" &&
        constraints.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-(--color-text-muted)">
            No constraints found
          </div>
        )}

      {/* SQL Preview Modal */}
      {showSqlModal && (
        <SqlPreviewModal
          sql={previewSql}
          loading={previewLoading}
          error={previewError}
          onConfirm={handleExecute}
          onCancel={handleCancelPending}
        />
      )}

      {/* Index/Constraint SQL Preview Modal */}
      {showIndexPreviewModal && (
        <SqlPreviewModal
          sql={indexPreviewSql}
          loading={indexPreviewLoading}
          error={indexPreviewError}
          onConfirm={handleIndexPreviewConfirm}
          onCancel={handleIndexPreviewCancel}
        />
      )}

      {/* Create Index Modal */}
      {showCreateIndexModal && (
        <CreateIndexModal
          columns={columns}
          onSubmit={handleCreateIndexPreview}
          onCancel={() => setShowCreateIndexModal(false)}
        />
      )}

      {/* Add Constraint Modal */}
      {showAddConstraintModal && (
        <AddConstraintModal
          columns={columns}
          onSubmit={handleAddConstraintPreview}
          onCancel={() => setShowAddConstraintModal(false)}
        />
      )}
    </div>
  );
}
