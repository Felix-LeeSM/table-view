import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Key, Shield, Plus, Trash2, X, Eye } from "lucide-react";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import type { ColumnInfo, IndexInfo } from "@/types/schema";
import * as tauri from "@lib/tauri";
import { useSchemaStore } from "@stores/schemaStore";
import SqlPreviewDialog from "./SqlPreviewDialog";
import { useDdlPreviewExecution } from "./useDdlPreviewExecution";
import { useConnectionStore } from "@stores/connectionStore";
import { ConfirmDestructiveDialog } from "@features/workspace";
import { OrderedColumnPicker } from "@features/catalog";
import { useSchemaGraphIntelligence } from "@/hooks/useSchemaGraphIntelligence";
import {
  selectSchemaGraphMigrationImpact,
  type SchemaGraphMigrationImpactSummary,
} from "@/lib/schemaGraphSelectors";
import { schemaGraphIndexId } from "@/lib/schemaGraphSupport";
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
  const { t } = useTranslation("structure");
  const [indexName, setIndexName] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [indexType, setIndexType] = useState<string>("btree");
  const [isUnique, setIsUnique] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        className="w-dialog-sm bg-secondary p-0"
        showCloseButton={false}
      >
        <div className="rounded-lg bg-secondary shadow-xl">
          {/* Header */}
          <DialogHeader className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogTitle className="text-sm font-semibold text-foreground">
              {t("index.createDialogTitle")}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("index.createDialogDesc")}
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onCancel}
              aria-label={t("index.closeDialogAria")}
            >
              <X />
            </Button>
          </DialogHeader>

          {/* Form */}
          <div className="space-y-3 px-4 py-3">
            {/* Index Name */}
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                {t("index.labelName")}
              </label>
              <input
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                value={indexName}
                onChange={(e) => setIndexName(e.target.value)}
                placeholder="idx_name"
                aria-label={t("index.nameAria")}
                autoFocus
              />
            </div>

            {/* Columns — ordered picker so the user sees the index column
                ordinal that will land in the CREATE INDEX statement. */}
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                {t("index.labelColumns")}
              </label>
              <OrderedColumnPicker
                available={columns.map((c) => c.name)}
                selected={selectedColumns}
                labelOf={(name) => {
                  const found = columns.find((c) => c.name === name);
                  return found ? `${found.name} (${found.data_type})` : name;
                }}
                onChange={setSelectedColumns}
                ariaLabelPrefix="Index column"
                emptyMessage="No columns available"
              />
            </div>

            {/* Index Type */}
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                {t("index.labelType")}
              </label>
              <Select value={indexType} onValueChange={(v) => setIndexType(v)}>
                <SelectTrigger
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  aria-label={t("index.typeAria")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INDEX_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Unique */}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={isUnique}
                onChange={(e) => setIsUnique(e.target.checked)}
                className="rounded border-border"
              />
              {t("index.uniqueLabel")}
            </label>
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
              {t("index.cancelBtn")}
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
              {loading ? t("index.previewingBtn") : t("index.previewSqlBtn")}
            </Button>
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
  database: string;
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
  database,
  table,
  schema,
  indexes,
  columns,
  onColumnsChange,
  onRefresh,
}: IndexesEditorProps) {
  const { t } = useTranslation("structure");
  const [showCreateIndexModal, setShowCreateIndexModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [migrationImpact, setMigrationImpact] =
    useState<SchemaGraphMigrationImpactSummary | null>(null);

  // Preview SQL state, Safe Mode gate, history record + commit closure all
  // live in `useDdlPreviewExecution`. `showPreviewModal` stays editor-local
  // because the dialog mount also gates around `handleDropIndex` (which
  // transitions through preview-fetch loading independently of the modal
  // trigger flow).
  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );
  const ddl = useDdlPreviewExecution({ connectionId, onRefresh });
  const schemaGraphIntelligence = useSchemaGraphIntelligence(
    connectionId,
    database,
  );
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);

  // -------------------------------------------------------------------------
  // Create index handlers
  // -------------------------------------------------------------------------

  const handleCreateIndexPreview = async (params: {
    indexName: string;
    columns: string[];
    indexType: string;
    isUnique: boolean;
  }) => {
    setShowCreateIndexModal(false);
    setMigrationImpact(null);
    setShowPreviewModal(true);
    await ddl.loadPreview(
      () =>
        tauri.createIndex({
          connection_id: connectionId,
          schema,
          table,
          index_name: params.indexName,
          columns: params.columns,
          index_type: params.indexType,
          is_unique: params.isUnique,
          preview_only: true,
          // Sprint 271c — opt-in DbMismatch guard. snake_case wire form.
          expected_database: database,
        }),
      () => async () => {
        await tauri.createIndex({
          connection_id: connectionId,
          schema,
          table,
          index_name: params.indexName,
          columns: params.columns,
          index_type: params.indexType,
          is_unique: params.isUnique,
          preview_only: false,
          // Sprint 271c — opt-in DbMismatch guard.
          expected_database: database,
        });
        setShowPreviewModal(false);
      },
    );
  };

  const handlePreviewCancel = () => {
    setShowPreviewModal(false);
    setMigrationImpact(null);
    ddl.cancelPreview();
  };

  // -------------------------------------------------------------------------
  // Drop index handler
  // -------------------------------------------------------------------------

  const handleDropIndex = async (indexName: string) => {
    setMigrationImpact(
      schemaGraphIntelligence
        ? selectSchemaGraphMigrationImpact(schemaGraphIntelligence, {
            kind: "index",
            indexId: schemaGraphIndexId(schema, table, indexName),
          })
        : null,
    );
    setShowPreviewModal(true);
    await ddl.loadPreview(
      () =>
        tauri.dropIndex({
          connection_id: connectionId,
          schema,
          table,
          index_name: indexName,
          preview_only: true,
          // Sprint 271c — opt-in DbMismatch guard.
          expected_database: database,
        }),
      () => async () => {
        await tauri.dropIndex(
          {
            connection_id: connectionId,
            schema,
            table,
            index_name: indexName,
            preview_only: false,
            // Sprint 271c — opt-in DbMismatch guard.
            expected_database: database,
          },
          // Issue #1112 — commit runs only after the Safe Mode gate + preview
          // confirmation; forward the proof.
          true,
        );
        setShowPreviewModal(false);
      },
    );
  };

  // -------------------------------------------------------------------------
  // Open create index modal — ensure columns are loaded
  // -------------------------------------------------------------------------

  const handleOpenCreateIndex = async () => {
    if (columns.length === 0) {
      const cols = await getTableColumns(connectionId, database, table, schema);
      onColumnsChange(cols);
    }
    setShowCreateIndexModal(true);
  };

  return (
    <StructureShell>
      <StructureActionBar
        count={`${indexes.length} ${indexes.length === 1 ? t("index.countSingular") : t("index.countPlural")}`}
        actions={
          <Button
            variant="ghost"
            size="xs"
            onClick={handleOpenCreateIndex}
            aria-label={t("index.createAria")}
          >
            <Plus />
            {t("index.createLabel")}
          </Button>
        }
      />

      {indexes.length > 0 && (
        <StructureTable>
          <thead className={STRUCTURE_THEAD}>
            <tr>
              <th className={STRUCTURE_TH}>{t("th.name")}</th>
              <th className={STRUCTURE_TH}>{t("th.columns")}</th>
              <th className={STRUCTURE_TH}>{t("th.type")}</th>
              <th className={STRUCTURE_TH}>{t("th.properties")}</th>
              <th className={STRUCTURE_TH_ACTIONS}>{t("th.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {indexes.map((idx) => (
              <tr key={idx.name} className={STRUCTURE_TR}>
                <td className={STRUCTURE_TD}>{idx.name}</td>
                <td className={`${STRUCTURE_TD} text-secondary-foreground`}>
                  {idx.columns.join(", ")}
                </td>
                <td className={`${STRUCTURE_TD} text-muted-foreground`}>
                  {idx.index_type}
                </td>
                <td className={STRUCTURE_TD}>
                  <div className="flex items-center gap-2">
                    {idx.is_primary && (
                      <span className="flex items-center gap-0.5 text-warning">
                        <Key size={10} aria-hidden="true" /> PK
                      </span>
                    )}
                    {idx.is_unique && !idx.is_primary && (
                      <span className="flex items-center gap-0.5 text-primary">
                        <Shield size={10} /> UNIQUE
                      </span>
                    )}
                    {!idx.is_primary && !idx.is_unique && (
                      <span className="text-muted-foreground">{"\u2014"}</span>
                    )}
                  </div>
                </td>
                <td className={STRUCTURE_TD_ACTIONS}>
                  <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!idx.is_primary && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="hover:text-destructive"
                        onClick={() => handleDropIndex(idx.name)}
                        aria-label={t("index.deleteAria", { name: idx.name })}
                        title={t("index.deleteTitle")}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </StructureTable>
      )}

      {indexes.length === 0 && (
        <StructureEmpty>{t("index.emptyState")}</StructureEmpty>
      )}

      {/* SQL Preview Modal */}
      {showPreviewModal && (
        <SqlPreviewDialog
          sql={ddl.previewSql}
          loading={ddl.previewLoading}
          error={ddl.previewError}
          environment={connectionEnvironment}
          migrationImpact={migrationImpact}
          onConfirm={ddl.attemptExecute}
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

      {/* Warn-tier destructive confirmation dialog (Sprint 246). */}
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
    </StructureShell>
  );
}
