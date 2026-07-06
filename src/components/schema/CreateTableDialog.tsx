import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "@components/ui/button";
import { Dialog, DialogFooter } from "@components/ui/dialog";
import { DialogShell } from "@components/ui/dialog-shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import { ConfirmDestructiveDialog } from "@features/workspace";
import SqlSyntax from "@components/shared/SqlSyntax";
import CreateTableDialogHeader from "./CreateTableDialog/Header";
import IndexesTabBody from "./CreateTableDialog/IndexesTabBody";
import ForeignKeysTabBody from "./CreateTableDialog/ForeignKeysTabBody";
import ColumnsTabBody from "./CreateTableDialog/ColumnsTabBody";
import KeysTabBody from "./CreateTableDialog/KeysTabBody";
import { indexMatchesPk } from "./CreateTableDialog/types";
import {
  useCreateTableForm,
  type UseCreateTableFormArgs,
} from "./CreateTableDialog/useCreateTableForm";

/**
 * `CreateTableDialog` — DataGrip-parity table creation modal. Tabs
 * (Columns / Keys / Indexes / Foreign Keys) over a shared draft form.
 *
 * All form state, handlers, and the single-IPC `createTablePlan`
 * preview/commit chain live in `useCreateTableForm`; each tab body is a
 * presentational sub-component. The modal owns only the 3-region compound
 * layout (Header / scrolling Body / pinned Footer with the inline DDL
 * preview + Execute button). Commit follows partial-atomic policy C: index
 * / constraint failures do not roll back the CREATE TABLE.
 */
export type CreateTableDialogProps = UseCreateTableFormArgs;

export default function CreateTableDialog(props: CreateTableDialogProps) {
  const { t } = useTranslation("schemaDialogs");
  const {
    tableName,
    handleTableNameChange,
    tableComment,
    handleTableCommentChange,
    selectedSchema,
    handleSchemaChange,
    schemaOptions,
    activeTab,
    setActiveTab,
    canPreview,
    showDdl,
    handleShowDdl,
    columns,
    validPkColumns,
    declaredPk,
    handleAddColumn,
    handleRemoveColumn,
    handleUpdateColumn,
    handleMoveColumn,
    indexes,
    declaredIndexesForChain,
    handleAddIndex,
    handleRemoveIndex,
    handleUpdateIndex,
    handleToggleIndexColumn,
    handleMoveIndex,
    fks,
    checks,
    uniques,
    declaredConstraintsForChain,
    fkRefColumnsLoadingByTrackingId,
    refTablesByKey,
    refColumnsByKey,
    fkPicker,
    handleAddFk,
    handleRemoveFk,
    handleUpdateFk,
    handleToggleFkLocalColumn,
    handleToggleFkRefColumn,
    handleAddCheck,
    handleRemoveCheck,
    handleUpdateCheck,
    handleAddUnique,
    handleRemoveUnique,
    handleUpdateUnique,
    handleToggleUniqueColumn,
    handleMoveFk,
    handleMoveCheck,
    handleMoveUnique,
    pgTypes,
    pgTypesByName,
    ddl,
    connectionEnvironment,
    handleExecute,
    handleCancel,
  } = useCreateTableForm(props);
  const { connectionId, open } = props;

  const ddlButtonLabel = showDdl ? t("hideDdl") : t("showDdl");

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) handleCancel();
        }}
      >
        <DialogShell className="w-dialog-md" showCloseButton={false}>
          {/* 3-region compound layout (Header / Body / Footer). Header +
              Footer are pinned (flex-shrink-0); only the middle Body scrolls
              so the user always sees the title bar above and the DDL preview
              / Execute button below while a long column / index / constraint
              list scrolls between them. */}
          <DialogShell.Header>
            <CreateTableDialogHeader
              selectedSchema={selectedSchema}
              onClose={handleCancel}
            />
          </DialogShell.Header>

          <DialogShell.Body>
            <div className="space-y-3">
              {/* Schema picker. Renders ABOVE the Table name input so the
                  layout reads top-to-bottom: schema -> table name -> table
                  comment -> tabs. Hidden when schemaOptions is empty
                  (MySQL/MariaDB capability guard). */}
              {schemaOptions.length > 0 && (
                <div>
                  <label
                    htmlFor="create-table-target-schema"
                    className="mb-1 block text-xs font-medium text-secondary-foreground"
                  >
                    {t("createTable.targetSchemaLabel")}
                  </label>
                  <Select
                    value={selectedSchema}
                    onValueChange={handleSchemaChange}
                  >
                    <SelectTrigger
                      id="create-table-target-schema"
                      aria-label={t("createTable.targetSchemaAria")}
                      size="sm"
                      className="w-full"
                    >
                      <SelectValue placeholder="schema" />
                    </SelectTrigger>
                    <SelectContent>
                      {schemaOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Table name */}
              <div>
                <label
                  htmlFor="create-table-name"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("createTable.tableNameLabel")}
                </label>
                <input
                  id="create-table-name"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={tableName}
                  onChange={(e) => handleTableNameChange(e.target.value)}
                  placeholder="my_new_table"
                  aria-label={t("createTable.tableNameAria")}
                  autoFocus
                />
              </div>

              {/* Table comment (optional). Plumbs into
                  `buildRequest.table_comment` (trimmed, null when blank). */}
              <div>
                <label
                  htmlFor="create-table-comment"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("createTable.tableCommentLabel")}
                </label>
                <input
                  id="create-table-comment"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={tableComment}
                  onChange={(e) => handleTableCommentChange(e.target.value)}
                  placeholder={t("createTable.tableCommentPlaceholder")}
                  aria-label={t("createTable.tableCommentAria")}
                />
              </div>

              {/* Tabs */}
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as typeof activeTab)}
              >
                <TabsList className="w-full justify-start gap-0 rounded-none border-b border-border">
                  {/* `(N)` count badges next to Keys / Indexes / Foreign Keys
                      when their declared-list count > 0. The badge digits
                      flow as plain text inside the trigger so screen readers
                      pick them up as part of the tab's accessible name (e.g.
                      "Keys (2)"). Hidden when count is 0 — no `(0)` noise. */}
                  <TabsTrigger value="columns" className="rounded-none">
                    {t("createTable.tabColumns")}
                  </TabsTrigger>
                  <TabsTrigger value="keys" className="rounded-none">
                    {t("createTable.tabKeys")}
                    {declaredPk.length > 0 && (
                      <span className="ml-1 text-3xs text-muted-foreground">
                        ({declaredPk.length})
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="indexes" className="rounded-none">
                    {t("createTable.tabIndexes")}
                    {declaredIndexesForChain.length > 0 && (
                      <span className="ml-1 text-3xs text-muted-foreground">
                        ({declaredIndexesForChain.length})
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="foreign_keys" className="rounded-none">
                    {t("createTable.tabConstraints")}
                    {declaredConstraintsForChain.length > 0 && (
                      <span className="ml-1 text-3xs text-muted-foreground">
                        (
                        {[
                          fks.length > 0 ? `FK ${fks.length}` : null,
                          checks.length > 0 ? `CHK ${checks.length}` : null,
                          uniques.length > 0 ? `UQ ${uniques.length}` : null,
                        ]
                          .filter((s): s is string => s !== null)
                          .join(" · ")}
                        )
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* Columns tab */}
                <TabsContent
                  value="columns"
                  className="pt-3 data-[state=inactive]:hidden"
                  data-testid="create-table-columns-panel"
                  forceMount
                >
                  <ColumnsTabBody
                    columns={columns}
                    pgTypes={pgTypes}
                    pgTypesByName={pgTypesByName}
                    selectedSchema={selectedSchema}
                    schemaOptions={schemaOptions}
                    refTablesByKey={refTablesByKey}
                    refColumnsByKey={refColumnsByKey}
                    onSchemaPicked={(s) => {
                      void fkPicker.ensureTablesLoaded(s);
                    }}
                    onTablePicked={(s, tbl) => {
                      void fkPicker.loadColumnsIfMissing(s, tbl);
                    }}
                    onAddColumn={handleAddColumn}
                    onRemoveColumn={handleRemoveColumn}
                    onUpdateColumn={handleUpdateColumn}
                    onMoveColumn={handleMoveColumn}
                  />
                </TabsContent>

                {/* Keys tab */}
                <TabsContent
                  value="keys"
                  className="pt-3 data-[state=inactive]:hidden"
                  data-testid="create-table-keys-panel"
                  forceMount
                >
                  <KeysTabBody
                    columns={columns}
                    validPkColumns={validPkColumns}
                    onUpdateColumn={handleUpdateColumn}
                  />
                </TabsContent>

                {/* Indexes tab — Sprint 228 editor (extracted body) */}
                <TabsContent
                  value="indexes"
                  className="pt-3 data-[state=inactive]:hidden"
                  data-testid="create-table-indexes-panel"
                  forceMount
                >
                  <IndexesTabBody
                    indexes={indexes}
                    availableColumns={validPkColumns}
                    isPkDuplicate={(draft) => indexMatchesPk(draft, declaredPk)}
                    onAdd={handleAddIndex}
                    onRemove={handleRemoveIndex}
                    onUpdate={handleUpdateIndex}
                    onToggleColumn={handleToggleIndexColumn}
                    onMove={handleMoveIndex}
                  />
                </TabsContent>

                {/* Foreign Keys tab — Sprint 229 editor (extracted body) */}
                <TabsContent
                  value="foreign_keys"
                  className="pt-3 data-[state=inactive]:hidden"
                  data-testid="create-table-foreign-keys-panel"
                  forceMount
                >
                  <ForeignKeysTabBody
                    fks={fks}
                    checks={checks}
                    uniques={uniques}
                    availableColumns={validPkColumns}
                    availableSchemas={schemaOptions}
                    refTablesByKey={refTablesByKey}
                    refColumnsByKey={refColumnsByKey}
                    fkRefColumnsLoadingByTrackingId={
                      fkRefColumnsLoadingByTrackingId
                    }
                    onAddFk={handleAddFk}
                    onRemoveFk={handleRemoveFk}
                    onUpdateFk={handleUpdateFk}
                    onToggleFkLocalColumn={handleToggleFkLocalColumn}
                    onToggleFkRefColumn={handleToggleFkRefColumn}
                    onAddCheck={handleAddCheck}
                    onRemoveCheck={handleRemoveCheck}
                    onUpdateCheck={handleUpdateCheck}
                    onAddUnique={handleAddUnique}
                    onRemoveUnique={handleRemoveUnique}
                    onUpdateUnique={handleUpdateUnique}
                    onToggleUniqueColumn={handleToggleUniqueColumn}
                    onMoveFk={handleMoveFk}
                    onMoveCheck={handleMoveCheck}
                    onMoveUnique={handleMoveUnique}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </DialogShell.Body>

          <DialogShell.Footer>
            {/* Inline DDL Preview pane (collapsible) — pinned above the
                action button row so it stays visible while the body
                scrolls. */}
            <div>
              <button
                type="button"
                onClick={handleShowDdl}
                className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-secondary-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                aria-expanded={showDdl}
                aria-controls="create-table-ddl-preview"
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
                  id="create-table-ddl-preview"
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
                      {t("ddlHintFillForm")}
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
                onClick={handleExecute}
                disabled={!canPreview || ddl.previewLoading || !ddl.previewSql}
                aria-label={t("execute")}
              >
                {ddl.previewLoading ? (
                  <Loader2 className="animate-spin size-3.5" />
                ) : null}
                {t("execute")}
              </Button>
            </DialogFooter>
          </DialogShell.Footer>
        </DialogShell>
      </Dialog>

      {/* Warn-tier confirmation dialog. Stacks above the create modal. */}
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
