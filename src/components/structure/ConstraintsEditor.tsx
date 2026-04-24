import { useState, useRef } from "react";
import { Loader2, Plus, Trash2, X, Eye } from "lucide-react";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@components/ui/dialog";
import type {
  ColumnInfo,
  ConstraintInfo,
  ConstraintDefinition,
} from "@/types/schema";
import * as tauri from "@lib/tauri";
import SqlPreviewDialog from "./SqlPreviewDialog";

// ---------------------------------------------------------------------------
// Constraint type
// ---------------------------------------------------------------------------

type ConstraintType = "primary_key" | "foreign_key" | "unique" | "check";

// ---------------------------------------------------------------------------
// Add Constraint Modal
// ---------------------------------------------------------------------------

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
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="w-dialog-sm bg-secondary p-0"
        showCloseButton={false}
      >
        <div className="rounded-lg bg-secondary shadow-xl">
          {/* Header */}
          <DialogHeader className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogTitle className="text-sm font-semibold text-foreground">
              Add Constraint
            </DialogTitle>
            <DialogDescription className="sr-only">
              Add a new constraint to this table
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onCancel}
              aria-label="Close dialog"
            >
              <X />
            </Button>
          </DialogHeader>

          {/* Form */}
          <div className="space-y-3 px-4 py-3">
            {/* Constraint Name */}
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                Constraint Name
              </label>
              <input
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                value={constraintName}
                onChange={(e) => setConstraintName(e.target.value)}
                placeholder="constraint_name"
                aria-label="Constraint name"
                autoFocus
              />
            </div>

            {/* Constraint Type */}
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                Type
              </label>
              <select
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
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
                <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                  Columns
                </label>
                <div className="max-h-scroll-sm overflow-auto rounded border border-border bg-background p-2">
                  {columns.map((col) => (
                    <label
                      key={col.name}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-foreground hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={selectedColumns.includes(col.name)}
                        onChange={() => toggleColumn(col.name)}
                        className="rounded border-border"
                      />
                      {col.name}
                      <span className="text-muted-foreground">
                        ({col.data_type})
                      </span>
                    </label>
                  ))}
                  {columns.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      No columns available
                    </span>
                  )}
                </div>
              </div>
            )}

            {needsReference && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                    Reference Table
                  </label>
                  <input
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                    value={referenceTable}
                    onChange={(e) => setReferenceTable(e.target.value)}
                    placeholder="reference_table"
                    aria-label="Reference table"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                    Reference Columns (comma-separated)
                  </label>
                  <input
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
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
                <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                  Check Expression
                </label>
                <input
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
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
            <div className="mx-4 mb-3 rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Footer */}
          <DialogFooter className="border-t border-border px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handlePreview}
              disabled={loading || !isValid}
            >
              {loading ? (
                <Loader2 className="animate-spin size-3.5" />
              ) : (
                <Eye />
              )}
              {loading ? "Previewing..." : "Preview SQL"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ConstraintsEditor
// ---------------------------------------------------------------------------

interface ConstraintsEditorProps {
  connectionId: string;
  table: string;
  schema: string;
  constraints: ConstraintInfo[];
  columns: ColumnInfo[];
  onColumnsChange: (columns: ColumnInfo[]) => void;
  /** Called after a successful execute to trigger data refresh */
  onRefresh: () => Promise<void>;
}

export default function ConstraintsEditor({
  connectionId,
  table,
  schema,
  constraints,
  columns,
  onColumnsChange,
  onRefresh,
}: ConstraintsEditorProps) {
  const [showAddConstraintModal, setShowAddConstraintModal] = useState(false);
  const [previewSql, setPreviewSql] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const pendingExecuteRef = useRef<(() => Promise<void>) | null>(null);

  // -------------------------------------------------------------------------
  // Add constraint handler
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
    setPreviewSql(result.sql);
    pendingExecuteRef.current = async () => {
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
    setShowPreviewModal(true);
  };

  // -------------------------------------------------------------------------
  // Drop constraint handler
  // -------------------------------------------------------------------------

  const handleDropConstraint = async (constraintName: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await tauri.dropConstraint({
        connection_id: connectionId,
        schema,
        table,
        constraint_name: constraintName,
        preview_only: true,
      });
      setPreviewSql(result.sql);
      pendingExecuteRef.current = async () => {
        await tauri.dropConstraint({
          connection_id: connectionId,
          schema,
          table,
          constraint_name: constraintName,
          preview_only: false,
        });
      };
      setShowPreviewModal(true);
    } catch (e) {
      setPreviewError(String(e));
      setPreviewSql("");
      setShowPreviewModal(true);
    }
    setPreviewLoading(false);
  };

  // -------------------------------------------------------------------------
  // Preview confirm/cancel
  // -------------------------------------------------------------------------

  const handlePreviewConfirm = async () => {
    if (!pendingExecuteRef.current) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      await pendingExecuteRef.current();
      setShowPreviewModal(false);
      pendingExecuteRef.current = null;
      setPreviewSql("");
      await onRefresh();
    } catch (e) {
      setPreviewError(String(e));
    }
    setPreviewLoading(false);
  };

  const handlePreviewCancel = () => {
    setShowPreviewModal(false);
    pendingExecuteRef.current = null;
    setPreviewSql("");
    setPreviewError(null);
  };

  // -------------------------------------------------------------------------
  // Open add constraint modal — ensure columns are loaded
  // -------------------------------------------------------------------------

  const handleOpenAddConstraint = async () => {
    if (columns.length === 0) {
      const { useSchemaStore } = await import("@stores/schemaStore");
      const { getTableColumns } = useSchemaStore.getState();
      const cols = await getTableColumns(connectionId, table, schema);
      onColumnsChange(cols);
    }
    setShowAddConstraintModal(true);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Action bar */}
      <div className="flex items-center justify-end border-b border-border bg-secondary px-2 py-1">
        <Button
          variant="ghost"
          size="xs"
          onClick={handleOpenAddConstraint}
          aria-label="Add constraint"
        >
          <Plus />
          Add Constraint
        </Button>
      </div>

      {/* Constraint table */}
      {constraints.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-secondary">
              <tr>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Name
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Type
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Columns
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Reference
                </th>
                <th className="w-20 border-b border-border px-1 py-1.5 text-center text-xs font-medium text-secondary-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {constraints.map((c) => (
                <tr
                  key={c.name}
                  className="group border-b border-border hover:bg-muted"
                >
                  <td className="border-r border-border px-3 py-1 text-xs text-foreground">
                    {c.name}
                  </td>
                  <td className="border-r border-border px-3 py-1 text-xs text-secondary-foreground">
                    {c.constraint_type}
                  </td>
                  <td className="border-r border-border px-3 py-1 text-xs text-secondary-foreground">
                    {c.columns.join(", ")}
                  </td>
                  <td className="border-r border-border px-3 py-1 text-xs text-primary">
                    {c.reference_table
                      ? `${c.reference_table}(${(c.reference_columns ?? []).join(", ")})`
                      : "\u2014"}
                  </td>
                  <td className="w-20 border-l border-border px-1 py-1 text-center">
                    <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="hover:text-destructive"
                        onClick={() => handleDropConstraint(c.name)}
                        aria-label={`Delete constraint ${c.name}`}
                        title="Delete"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {constraints.length === 0 && (
        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
          No constraints found
        </div>
      )}

      {/* SQL Preview Modal */}
      {showPreviewModal && (
        <SqlPreviewDialog
          sql={previewSql}
          loading={previewLoading}
          error={previewError}
          onConfirm={handlePreviewConfirm}
          onCancel={handlePreviewCancel}
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
