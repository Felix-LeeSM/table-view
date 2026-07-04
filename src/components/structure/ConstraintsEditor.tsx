import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import type {
  ColumnInfo,
  ConstraintInfo,
  ConstraintDefinition,
} from "@/types/schema";
import * as tauri from "@lib/tauri";
import SqlPreviewDialog from "./SqlPreviewDialog";
import { useDdlPreviewExecution } from "./useDdlPreviewExecution";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { ConfirmDestructiveDialog } from "@features/workspace";
import { useSchemaGraphIntelligence } from "@/hooks/useSchemaGraphIntelligence";
import {
  selectSchemaGraphMigrationImpact,
  type SchemaGraphMigrationImpactSummary,
} from "@/lib/schemaGraphSelectors";
import { schemaGraphConstraintId } from "@/lib/schemaGraphSupport";
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
  const { t } = useTranslation("structure");
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
              {t("constraint.addDialogTitle")}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("constraint.addDialogDesc")}
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onCancel}
              aria-label={t("constraint.closeDialogAria")}
            >
              <X />
            </Button>
          </DialogHeader>

          {/* Form */}
          <div className="space-y-3 px-4 py-3">
            {/* Constraint Name */}
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                {t("constraint.labelName")}
              </label>
              <input
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                value={constraintName}
                onChange={(e) => setConstraintName(e.target.value)}
                placeholder="constraint_name"
                aria-label={t("constraint.nameAria")}
                autoFocus
              />
            </div>

            {/* Constraint Type */}
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                {t("constraint.labelType")}
              </label>
              <Select
                value={constraintType}
                onValueChange={(v) => {
                  setConstraintType(v as ConstraintType);
                  setSelectedColumns([]);
                  setReferenceTable("");
                  setReferenceColumns("");
                  setCheckExpression("");
                }}
              >
                <SelectTrigger
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  aria-label={t("constraint.typeAria")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary_key">PRIMARY KEY</SelectItem>
                  <SelectItem value="unique">UNIQUE</SelectItem>
                  <SelectItem value="foreign_key">FOREIGN KEY</SelectItem>
                  <SelectItem value="check">CHECK</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Dynamic fields based on type */}
            {needsColumns && (
              <div>
                <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                  {t("constraint.labelColumns")}
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
                      {t("constraint.noColumnsAvailable")}
                    </span>
                  )}
                </div>
              </div>
            )}

            {needsReference && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                    {t("constraint.labelRefTable")}
                  </label>
                  <input
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                    value={referenceTable}
                    onChange={(e) => setReferenceTable(e.target.value)}
                    placeholder="reference_table"
                    aria-label={t("constraint.refTableAria")}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                    {t("constraint.labelRefColumns")}
                  </label>
                  <input
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                    value={referenceColumns}
                    onChange={(e) => setReferenceColumns(e.target.value)}
                    placeholder="id, name"
                    aria-label={t("constraint.refColumnsAria")}
                  />
                </div>
              </>
            )}

            {needsExpression && (
              <div>
                <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                  {t("constraint.labelCheckExpr")}
                </label>
                <input
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={checkExpression}
                  onChange={(e) => setCheckExpression(e.target.value)}
                  placeholder="price > 0"
                  aria-label={t("constraint.checkExprAria")}
                />
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="mx-4 mb-3 rounded bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
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
              {t("constraint.cancelBtn")}
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
              {loading
                ? t("constraint.previewingBtn")
                : t("constraint.previewSqlBtn")}
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
  database: string;
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
  database,
  table,
  schema,
  constraints,
  columns,
  onColumnsChange,
  onRefresh,
}: ConstraintsEditorProps) {
  const { t } = useTranslation("structure");
  const [showAddConstraintModal, setShowAddConstraintModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [migrationImpact, setMigrationImpact] =
    useState<SchemaGraphMigrationImpactSummary | null>(null);

  // Preview SQL state, Safe Mode gate, history record + commit closure
  // live in `useDdlPreviewExecution`. `showPreviewModal` stays editor-local
  // so `handleDropConstraint` can mount the dialog before the preview
  // fetch resolves (preserving the loading state UX).
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
  // Add constraint handler
  // -------------------------------------------------------------------------

  const handleAddConstraintPreview = async (params: {
    constraintName: string;
    definition: ConstraintDefinition;
  }) => {
    setShowAddConstraintModal(false);
    setMigrationImpact(null);
    setShowPreviewModal(true);
    await ddl.loadPreview(
      () =>
        tauri.addConstraint({
          connection_id: connectionId,
          schema,
          table,
          constraint_name: params.constraintName,
          definition: params.definition,
          preview_only: true,
          // Sprint 271c — opt-in DbMismatch guard.
          expected_database: database,
        }),
      () => async () => {
        await tauri.addConstraint({
          connection_id: connectionId,
          schema,
          table,
          constraint_name: params.constraintName,
          definition: params.definition,
          preview_only: false,
          // Sprint 271c — opt-in DbMismatch guard.
          expected_database: database,
        });
        setShowPreviewModal(false);
      },
    );
  };

  // -------------------------------------------------------------------------
  // Drop constraint handler
  // -------------------------------------------------------------------------

  const handleDropConstraint = async (constraintName: string) => {
    setMigrationImpact(
      schemaGraphIntelligence
        ? selectSchemaGraphMigrationImpact(schemaGraphIntelligence, {
            kind: "constraint",
            constraintId: schemaGraphConstraintId(
              schema,
              table,
              constraintName,
            ),
          })
        : null,
    );
    setShowPreviewModal(true);
    await ddl.loadPreview(
      () =>
        tauri.dropConstraint({
          connection_id: connectionId,
          schema,
          table,
          constraint_name: constraintName,
          preview_only: true,
          // Sprint 271c — opt-in DbMismatch guard.
          expected_database: database,
        }),
      () => async () => {
        await tauri.dropConstraint(
          {
            connection_id: connectionId,
            schema,
            table,
            constraint_name: constraintName,
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
  // Preview cancel
  // -------------------------------------------------------------------------

  const handlePreviewCancel = () => {
    setShowPreviewModal(false);
    setMigrationImpact(null);
    ddl.cancelPreview();
  };

  // -------------------------------------------------------------------------
  // Open add constraint modal — ensure columns are loaded
  // -------------------------------------------------------------------------

  const handleOpenAddConstraint = async () => {
    if (columns.length === 0) {
      const cols = await getTableColumns(connectionId, database, table, schema);
      onColumnsChange(cols);
    }
    setShowAddConstraintModal(true);
  };

  return (
    <StructureShell>
      <StructureActionBar
        count={`${constraints.length} ${constraints.length === 1 ? t("constraint.countSingular") : t("constraint.countPlural")}`}
        actions={
          <Button
            variant="ghost"
            size="xs"
            onClick={handleOpenAddConstraint}
            aria-label={t("constraint.addAria")}
          >
            <Plus />
            {t("constraint.addLabel")}
          </Button>
        }
      />

      {constraints.length > 0 && (
        <StructureTable>
          <thead className={STRUCTURE_THEAD}>
            <tr>
              <th scope="col" className={STRUCTURE_TH}>
                {t("th.name")}
              </th>
              <th scope="col" className={STRUCTURE_TH}>
                {t("th.type")}
              </th>
              <th scope="col" className={STRUCTURE_TH}>
                {t("th.columns")}
              </th>
              <th scope="col" className={STRUCTURE_TH}>
                {t("th.reference")}
              </th>
              <th scope="col" className={STRUCTURE_TH_ACTIONS}>
                {t("th.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {constraints.map((c) => (
              <tr key={c.name} className={STRUCTURE_TR}>
                <td className={STRUCTURE_TD}>{c.name}</td>
                <td className={`${STRUCTURE_TD} text-secondary-foreground`}>
                  {c.constraint_type}
                </td>
                <td className={`${STRUCTURE_TD} text-secondary-foreground`}>
                  {c.columns.join(", ")}
                </td>
                <td className={`${STRUCTURE_TD} text-primary`}>
                  {c.reference_table
                    ? `${c.reference_table}(${(c.reference_columns ?? []).join(", ")})`
                    : "\u2014"}
                </td>
                <td className={STRUCTURE_TD_ACTIONS}>
                  <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="hover:text-destructive"
                      onClick={() => handleDropConstraint(c.name)}
                      aria-label={t("constraint.deleteAria", { name: c.name })}
                      title={t("constraint.deleteTitle")}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </StructureTable>
      )}

      {constraints.length === 0 && (
        <StructureEmpty>{t("constraint.emptyState")}</StructureEmpty>
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

      {/* Add Constraint Modal */}
      {showAddConstraintModal && (
        <AddConstraintModal
          columns={columns}
          onSubmit={handleAddConstraintPreview}
          onCancel={() => setShowAddConstraintModal(false)}
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
