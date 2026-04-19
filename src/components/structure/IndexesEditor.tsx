import { useState, useRef } from "react";
import { Loader2, Key, Shield, Plus, Trash2, X, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@components/ui/dialog";
import type { ColumnInfo, IndexInfo } from "@/types/schema";
import * as tauri from "@lib/tauri";
import { useSchemaStore } from "@stores/schemaStore";
import SqlPreviewDialog from "./SqlPreviewDialog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEX_TYPES = ["btree", "hash", "gist", "gin", "brin"] as const;

// ---------------------------------------------------------------------------
// Create Index Modal
// ---------------------------------------------------------------------------

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
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="w-[480px] bg-secondary p-0"
        showCloseButton={false}
      >
        <div className="rounded-lg bg-secondary shadow-xl">
          {/* Header */}
          <DialogHeader className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogTitle className="text-sm font-semibold text-foreground">
              Create Index
            </DialogTitle>
            <DialogDescription className="sr-only">
              Create a new index on this table
            </DialogDescription>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              onClick={onCancel}
              aria-label="Close dialog"
            >
              <X size={16} />
            </button>
          </DialogHeader>

          {/* Form */}
          <div className="space-y-3 px-4 py-3">
            {/* Index Name */}
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                Index Name
              </label>
              <input
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                value={indexName}
                onChange={(e) => setIndexName(e.target.value)}
                placeholder="idx_name"
                aria-label="Index name"
                autoFocus
              />
            </div>

            {/* Columns */}
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                Columns
              </label>
              <div className="max-h-[120px] overflow-auto rounded border border-border bg-background p-2">
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

            {/* Index Type */}
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                Index Type
              </label>
              <select
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
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
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={isUnique}
                onChange={(e) => setIsUnique(e.target.checked)}
                className="rounded border-border"
              />
              Unique
            </label>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mb-3 rounded bg-red-500/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Footer */}
          <DialogFooter className="border-t border-border px-4 py-3">
            <button
              className="rounded px-3 py-1.5 text-sm text-secondary-foreground hover:bg-muted"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
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
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// IndexesEditor
// ---------------------------------------------------------------------------

interface IndexesEditorProps {
  connectionId: string;
  table: string;
  schema: string;
  indexes: IndexInfo[];
  columns: ColumnInfo[];
  onColumnsChange: (columns: ColumnInfo[]) => void;
  /** Called after a successful execute to trigger data refresh */
  onRefresh: () => Promise<void>;
}

export default function IndexesEditor({
  connectionId,
  table,
  schema,
  indexes,
  columns,
  onColumnsChange,
  onRefresh,
}: IndexesEditorProps) {
  const [showCreateIndexModal, setShowCreateIndexModal] = useState(false);
  const [previewSql, setPreviewSql] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const pendingExecuteRef = useRef<(() => Promise<void>) | null>(null);

  // -------------------------------------------------------------------------
  // Create index handlers
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
    setPreviewSql(result.sql);
    pendingExecuteRef.current = async () => {
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
    setShowPreviewModal(true);
  };

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
  // Drop index handler
  // -------------------------------------------------------------------------

  const handleDropIndex = async (indexName: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await tauri.dropIndex({
        connection_id: connectionId,
        schema,
        index_name: indexName,
        preview_only: true,
      });
      setPreviewSql(result.sql);
      pendingExecuteRef.current = async () => {
        await tauri.dropIndex({
          connection_id: connectionId,
          schema,
          index_name: indexName,
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
  // Open create index modal — ensure columns are loaded
  // -------------------------------------------------------------------------

  const handleOpenCreateIndex = async () => {
    if (columns.length === 0) {
      const { getTableColumns } = useSchemaStore.getState();
      const cols = await getTableColumns(connectionId, table, schema);
      onColumnsChange(cols);
    }
    setShowCreateIndexModal(true);
  };

  return (
    <>
      {/* Action bar */}
      <div className="ml-auto flex items-center gap-1 pr-2">
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-secondary-foreground hover:bg-muted"
          onClick={handleOpenCreateIndex}
          aria-label="Create index"
        >
          <Plus size={12} />
          Create Index
        </button>
      </div>

      {/* Index table */}
      {indexes.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-secondary">
              <tr>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Name
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Columns
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Type
                </th>
                <th className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground">
                  Properties
                </th>
                <th className="w-20 border-b border-border px-1 py-1.5 text-center text-xs font-medium text-secondary-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((idx) => (
                <tr
                  key={idx.name}
                  className="group border-b border-border hover:bg-muted"
                >
                  <td className="border-r border-border px-3 py-1 text-xs text-foreground">
                    {idx.name}
                  </td>
                  <td className="border-r border-border px-3 py-1 text-xs text-secondary-foreground">
                    {idx.columns.join(", ")}
                  </td>
                  <td className="border-r border-border px-3 py-1 text-xs text-muted-foreground">
                    {idx.index_type}
                  </td>
                  <td className="border-r border-border px-3 py-1 text-xs">
                    <div className="flex items-center gap-2">
                      {idx.is_primary && (
                        <span className="flex items-center gap-0.5 text-amber-500">
                          <Key size={10} aria-hidden="true" /> PK
                        </span>
                      )}
                      {idx.is_unique && !idx.is_primary && (
                        <span className="flex items-center gap-0.5 text-primary">
                          <Shield size={10} /> UNIQUE
                        </span>
                      )}
                      {!idx.is_primary && !idx.is_unique && (
                        <span className="text-muted-foreground">
                          {"\u2014"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="w-20 border-l border-border px-1 py-1 text-center">
                    <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!idx.is_primary && (
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
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

      {/* Empty state */}
      {indexes.length === 0 && (
        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
          No indexes found
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

      {/* Create Index Modal */}
      {showCreateIndexModal && (
        <CreateIndexModal
          columns={columns}
          onSubmit={handleCreateIndexPreview}
          onCancel={() => setShowCreateIndexModal(false)}
        />
      )}
    </>
  );
}
