import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import * as tauri from "@lib/tauri";
import { useDdlPreviewExecution } from "@components/structure/useDdlPreviewExecution";
import ConfirmDangerousDialog from "@components/workspace/ConfirmDangerousDialog";
import SqlSyntax from "@components/shared/SqlSyntax";
import CreateTableTypeCombobox from "./CreateTableTypeCombobox";
import CreateTableDialogHeader from "./CreateTableDialog/Header";
import IndexesTabBody, {
  type IndexDraft,
} from "./CreateTableDialog/IndexesTabBody";
import type { ColumnDefinition, CreateIndexRequest } from "@/types/schema";

/**
 * `CreateTableDialog` — Sprint 226 / Phase 27 sprint 1, redesigned in
 * Sprint 227 (Phase 27 sprint 2) for DataGrip-parity, Indexes tab
 * functionalised in Sprint 228 (Phase 27 sprint 3).
 *
 * Sprint 227 changes:
 * - Tabs (Columns / Keys / Indexes / Foreign Keys). FK tab body is
 *   still a Sprint 229 placeholder.
 * - Target schema dropdown header populated from `availableSchemas`
 *   (right-clicked schema is the default; user may switch).
 * - Per-column data-type input is the `CreateTableTypeCombobox`
 *   (filterable + free-text fallback).
 * - Per-column comment input feeds backend's optional `comment` field.
 * - Inline collapsible DDL Preview pane replaces the modal-on-modal
 *   `SqlPreviewDialog`. Sibling editors keep using `SqlPreviewDialog`.
 * - Footer: Cancel + Execute (no separate "Preview SQL" button).
 *
 * Sprint 228 changes:
 * - Indexes tab body is interactive — `+ Index` / `−` row buttons +
 *   per-row index name input + columns multi-checkbox group +
 *   index type `<Select>` (btree / hash / gin / gist) + unique flag.
 * - Show DDL fans out one `tauri.createIndex({preview_only:true})` per
 *   declared (non-PK-dedup) row alongside the canonical
 *   `tauri.createTable({preview_only:true})`. Inline preview pane
 *   renders the joined multi-statement bundle (CREATE TABLE +
 *   COMMENT ON × N + CREATE INDEX × M, separated by `;\n`).
 * - Execute closure (registered with `useDdlPreviewExecution.loadPreview`'s
 *   `prepareCommit` factory) chains:
 *     await tauri.createTable({preview_only:false})  // 1 transaction
 *     for (const idx of declaredIndexesAfterPkDedup) {
 *       try { await tauri.createIndex({preview_only:false, …}) }
 *       catch (e) { throw new Error(`Index "${idx.name}" failed: ${e}`) }
 *     }
 *   This is partial-atomic policy C (DataGrip pattern) — index
 *   failures do NOT roll back the CREATE TABLE; already-applied
 *   indexes earlier in the chain stay applied; the failing index
 *   name surfaces verbatim in the inline preview pane error slot.
 * - PK auto-emission deduplication: a row whose `columns` (in declared
 *   order) exactly matches the PK column list is skipped (PG indexes
 *   PKs implicitly). The row remains visible with an inline note
 *   `"Skipped — primary key is already indexed"`.
 *
 * The lifecycle hook (`useDdlPreviewExecution`, Sprint 214) is reused
 * verbatim — modal owns inline preview JSX, hook owns state slots
 * (preview SQL / loading / error / pendingConfirm / commit closure).
 */

interface ColumnDraft {
  trackingId: string;
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string;
  comment: string;
  is_pk: boolean;
}

// Sprint 228 — `IndexDraft` / `IndexType` / `INDEX_TYPE_OPTIONS` live
// inside the extracted `./CreateTableDialog/IndexesTabBody.tsx` so the
// JSX that consumes them ships with the type. The parent only needs
// the type-imports above to thread the draft list through.

function makeId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function newDraft(): ColumnDraft {
  return {
    trackingId: makeId(),
    name: "",
    data_type: "",
    nullable: true,
    default_value: "",
    comment: "",
    is_pk: false,
  };
}

function newIndexDraft(): IndexDraft {
  return {
    trackingId: makeId(),
    name: "",
    columns: [],
    index_type: "btree",
    unique: false,
  };
}

/**
 * True iff the index row's `columns` array (in declared order) is
 * exactly the declared PK column array. PG implicitly indexes PK
 * columns with the same shape, so the chain skips the redundant
 * `tauri.createIndex` call (the backend would otherwise succeed, but
 * we'd be paying for a duplicate index — DataGrip parity).
 */
function indexMatchesPk(idx: IndexDraft, pk: string[]): boolean {
  if (pk.length === 0) return false;
  if (idx.columns.length !== pk.length) return false;
  for (let i = 0; i < pk.length; i += 1) {
    if (idx.columns[i] !== pk[i]) return false;
  }
  return true;
}

export interface CreateTableDialogProps {
  /** Connection id used by the Safe Mode gate + history record. */
  connectionId: string;
  /** Right-clicked schema name; default selection of the schema dropdown. */
  schemaName: string;
  /**
   * Schemas available on the connection — drives the Target schema
   * dropdown options. Sourced from `useSchemaStore.schemas[connectionId]`
   * by the SchemaTree dialog slot. When omitted (legacy callers),
   * defaults to a single-element list containing `schemaName`.
   */
  availableSchemas?: string[];
  /** Modal closes when set false (Dialog open/close pattern). */
  open: boolean;
  /** Called on Cancel / outside-close / commit-success. */
  onClose: () => void;
  /**
   * Called once after a successful commit so the SchemaTree can
   * re-fetch the schema's table list.
   */
  onRefresh: () => Promise<void>;
}

type TabKey = "columns" | "keys" | "indexes" | "foreign_keys";

export default function CreateTableDialog({
  connectionId,
  schemaName,
  availableSchemas,
  open,
  onClose,
  onRefresh,
}: CreateTableDialogProps) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([newDraft()]);
  // Sprint 228 — indexes editor draft list. Default = empty array
  // (index editor is opt-in; 0 indexes is the canonical base state).
  const [indexes, setIndexes] = useState<IndexDraft[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("columns");
  // Default schema = right-clicked schemaName. The dropdown selection
  // persists across tab switches but is reset when the modal closes.
  const [selectedSchema, setSelectedSchema] = useState<string>(schemaName);
  const [showDdl, setShowDdl] = useState(false);
  // Cache invalidation flag — flipped to true whenever any form field
  // changes after a preview has been loaded. Next "Show DDL" click
  // re-fetches.
  const [previewStale, setPreviewStale] = useState(false);

  const schemaOptions = useMemo(() => {
    const list = availableSchemas?.length ? availableSchemas : [schemaName];
    // De-dupe + ensure the default is always present even if the
    // store is mid-load.
    const set = new Set(list);
    set.add(schemaName);
    return Array.from(set);
  }, [availableSchemas, schemaName]);

  const ddl = useDdlPreviewExecution({
    connectionId,
    onRefresh: async () => {
      await onRefresh();
      resetForm();
      onClose();
    },
  });

  const resetForm = () => {
    setTableName("");
    setColumns([newDraft()]);
    setIndexes([]);
    setSelectedSchema(schemaName);
    setActiveTab("columns");
    setShowDdl(false);
    setPreviewStale(false);
  };

  // Reset the modal whenever it (re)opens. `selectedSchema` follows
  // the right-clicked schema name — if SchemaTree opens the modal on
  // a different schema row, the dropdown defaults to that row.
  useEffect(() => {
    if (open) {
      setSelectedSchema(schemaName);
    }
    // Intentionally narrow deps: `schemaName` is the entry-point seed
    // that should override the dropdown when the user re-opens the
    // modal. Reopening with same schema is a no-op.
  }, [open, schemaName]);

  // Live PK candidate list — derived from current column rows.
  const validPkColumns = useMemo(() => {
    return columns
      .filter((c) => c.name.trim().length > 0)
      .map((c) => c.name.trim());
  }, [columns]);

  const hasValidColumn = columns.some(
    (c) => c.name.trim().length > 0 && c.data_type.trim().length > 0,
  );
  const canPreview = tableName.trim().length > 0 && hasValidColumn;

  const handleAddColumn = () => {
    setColumns((prev) => [...prev, newDraft()]);
    invalidatePreview();
  };

  const handleRemoveColumn = (trackingId: string) => {
    setColumns((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((c) => c.trackingId !== trackingId);
    });
    invalidatePreview();
  };

  const handleUpdateColumn = (
    trackingId: string,
    updates: Partial<ColumnDraft>,
  ) => {
    setColumns((prev) =>
      prev.map((c) => (c.trackingId === trackingId ? { ...c, ...updates } : c)),
    );
    invalidatePreview();
  };

  // ── Sprint 228 — Indexes tab handlers ────────────────────────────

  const handleAddIndex = () => {
    setIndexes((prev) => [...prev, newIndexDraft()]);
    invalidatePreview();
  };

  const handleRemoveIndex = (trackingId: string) => {
    setIndexes((prev) => prev.filter((i) => i.trackingId !== trackingId));
    invalidatePreview();
  };

  const handleUpdateIndex = (
    trackingId: string,
    updates: Partial<IndexDraft>,
  ) => {
    setIndexes((prev) =>
      prev.map((i) => (i.trackingId === trackingId ? { ...i, ...updates } : i)),
    );
    invalidatePreview();
  };

  const handleToggleIndexColumn = (trackingId: string, colName: string) => {
    setIndexes((prev) =>
      prev.map((i) => {
        if (i.trackingId !== trackingId) return i;
        const has = i.columns.includes(colName);
        return {
          ...i,
          columns: has
            ? i.columns.filter((c) => c !== colName)
            : [...i.columns, colName],
        };
      }),
    );
    invalidatePreview();
  };

  // Invalidates the cached DDL preview. Called from every form-edit
  // pathway. When the inline pane is currently open it collapses back
  // to the "Show DDL" label so the next click re-fetches; the cached
  // SQL is discarded so the Execute button can't fire stale DDL.
  const invalidatePreview = () => {
    if (ddl.previewSql) {
      setPreviewStale(true);
      setShowDdl(false);
      ddl.cancelPreview();
    }
  };

  const handleSchemaChange = (next: string) => {
    setSelectedSchema(next);
    invalidatePreview();
  };

  const handleTableNameChange = (next: string) => {
    setTableName(next);
    invalidatePreview();
  };

  const buildRequest = (previewOnly: boolean) => {
    const pkColumns = columns
      .filter((c) => c.is_pk && c.name.trim().length > 0)
      .map((c) => c.name.trim());
    const columnDefs: ColumnDefinition[] = columns
      .filter((c) => c.name.trim().length > 0 && c.data_type.trim().length > 0)
      .map((c) => {
        const trimmedComment = c.comment.trim();
        const def: ColumnDefinition = {
          name: c.name.trim(),
          data_type: c.data_type.trim(),
          nullable: c.nullable,
          default_value: c.default_value.trim() ? c.default_value.trim() : null,
        };
        if (trimmedComment.length > 0) {
          def.comment = trimmedComment;
        }
        return def;
      });
    return {
      connection_id: connectionId,
      schema: selectedSchema,
      name: tableName.trim(),
      columns: columnDefs,
      primary_key: pkColumns.length > 0 ? pkColumns : null,
      preview_only: previewOnly,
    };
  };

  // Live PK column list — used by the Indexes tab for dedup decisions
  // and surface annotations.
  const declaredPk = useMemo(
    () =>
      columns
        .filter((c) => c.is_pk && c.name.trim().length > 0)
        .map((c) => c.name.trim()),
    [columns],
  );

  /**
   * The list of index drafts that the chain will actually execute,
   * after filtering out:
   * - rows whose `name` is empty / whitespace-only (user added a row
   *   but didn't fill it in),
   * - rows with zero columns selected,
   * - rows whose columns array is exactly the declared PK (PG indexes
   *   PKs implicitly — emitting a duplicate would fail with a name
   *   collision in the worst case, or just waste storage).
   */
  const declaredIndexesForChain = useMemo<IndexDraft[]>(() => {
    return indexes.filter((i) => {
      if (i.name.trim().length === 0) return false;
      if (i.columns.length === 0) return false;
      if (indexMatchesPk(i, declaredPk)) return false;
      return true;
    });
  }, [indexes, declaredPk]);

  const buildIndexRequest = (
    idx: IndexDraft,
    previewOnly: boolean,
  ): CreateIndexRequest => ({
    connection_id: connectionId,
    schema: selectedSchema,
    table: tableName.trim(),
    index_name: idx.name.trim(),
    columns: idx.columns.map((c) => c.trim()).filter((c) => c.length > 0),
    index_type: idx.index_type,
    is_unique: idx.unique,
    preview_only: previewOnly,
  });

  const handleShowDdl = async () => {
    if (showDdl && !previewStale) {
      // Toggle off — collapse the pane without discarding the cached
      // preview. Next click re-shows the same SQL without re-fetch.
      setShowDdl(false);
      return;
    }
    setShowDdl(true);
    setPreviewStale(false);
    if (!canPreview) return;
    // Snapshot the indexes-for-chain at preview time so the request /
    // commit closures use the same list (form edits between Show DDL
    // and Execute already invalidate the cache via `previewStale`).
    const chainIndexes = declaredIndexesForChain;
    await ddl.loadPreview(
      async () => {
        const tableResult = await tauri.createTable(buildRequest(true));
        // Multi-statement preview — fan out one CREATE INDEX preview
        // call per declared (non-PK-dedup) row, in row-declared order.
        // Sequential to keep output deterministic and to avoid mass
        // parallel IPC; the row count is small and these are cheap
        // SQL builders, not actual database calls.
        const indexSqls: string[] = [];
        for (const idx of chainIndexes) {
          const r = await tauri.createIndex(buildIndexRequest(idx, true));
          indexSqls.push(r.sql);
        }
        const all = [tableResult.sql, ...indexSqls].filter(
          (s) => s && s.trim().length > 0,
        );
        return { sql: all.join(";\n") };
      },
      () => async () => {
        // Atomic policy C — CREATE TABLE first, in its own transaction
        // (the backend wraps CREATE TABLE + COMMENT ON in a single
        // tx). Index calls are sequential and each in its own
        // transaction. Index failures do NOT roll back the table.
        await tauri.createTable(buildRequest(false));
        for (const idx of chainIndexes) {
          try {
            await tauri.createIndex(buildIndexRequest(idx, false));
          } catch (e) {
            // Surface the failing index name verbatim so the hook's
            // `previewError` slot tells the user which row failed.
            // Subsequent indexes in `chainIndexes` are NOT executed
            // because we re-throw here (the `for` loop unwinds and
            // the closure rejects).
            throw new Error(`Index "${idx.name.trim()}" failed: ${String(e)}`);
          }
        }
      },
    );
  };

  const handleExecute = async () => {
    // Execute closure runs through the hook's Safe Mode gate +
    // history record. The commit closure was registered by
    // `loadPreview`. If the preview is stale or unloaded, refuse.
    if (!ddl.previewSql) return;
    await ddl.attemptExecute();
  };

  const handleCancel = () => {
    ddl.cancelPreview();
    resetForm();
    onClose();
  };

  const ddlButtonLabel = showDdl ? "Hide DDL" : "Show DDL";

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
            <CreateTableDialogHeader
              selectedSchema={selectedSchema}
              schemaOptions={schemaOptions}
              onSchemaChange={handleSchemaChange}
              onClose={handleCancel}
            />

            {/* Body */}
            <div className="space-y-3 px-4 py-3">
              {/* Table name */}
              <div>
                <label
                  htmlFor="create-table-name"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  Table name
                </label>
                <input
                  id="create-table-name"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={tableName}
                  onChange={(e) => handleTableNameChange(e.target.value)}
                  placeholder="my_new_table"
                  aria-label="Table name"
                  autoFocus
                />
              </div>

              {/* Tabs */}
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as TabKey)}
              >
                <TabsList className="w-full justify-start gap-0 rounded-none border-b border-border">
                  <TabsTrigger value="columns" className="rounded-none">
                    Columns
                  </TabsTrigger>
                  <TabsTrigger value="keys" className="rounded-none">
                    Keys
                  </TabsTrigger>
                  <TabsTrigger value="indexes" className="rounded-none">
                    Indexes
                  </TabsTrigger>
                  <TabsTrigger value="foreign_keys" className="rounded-none">
                    Foreign Keys
                  </TabsTrigger>
                </TabsList>

                {/* Columns tab */}
                <TabsContent
                  value="columns"
                  className="pt-3 data-[state=inactive]:hidden"
                  data-testid="create-table-columns-panel"
                  forceMount
                >
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-xs font-medium text-secondary-foreground">
                        Columns
                      </label>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={handleAddColumn}
                        aria-label="Add column"
                      >
                        <Plus />
                        Column
                      </Button>
                    </div>
                    <div className="space-y-1">
                      {columns.map((col) => (
                        <div
                          key={col.trackingId}
                          className="flex items-start gap-1.5 rounded border border-border bg-background p-2"
                        >
                          <div className="flex flex-1 flex-col gap-1">
                            <div className="flex gap-1.5">
                              <input
                                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                                value={col.name}
                                onChange={(e) =>
                                  handleUpdateColumn(col.trackingId, {
                                    name: e.target.value,
                                  })
                                }
                                placeholder="column_name"
                                aria-label="Column name"
                              />
                              <div className="flex-1">
                                <CreateTableTypeCombobox
                                  value={col.data_type}
                                  onChange={(next) =>
                                    handleUpdateColumn(col.trackingId, {
                                      data_type: next,
                                    })
                                  }
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <label className="flex cursor-pointer items-center gap-1 text-xs text-foreground">
                                <input
                                  type="checkbox"
                                  checked={col.nullable}
                                  onChange={(e) =>
                                    handleUpdateColumn(col.trackingId, {
                                      nullable: e.target.checked,
                                    })
                                  }
                                  className="rounded border-border"
                                  aria-label="Column nullable"
                                />
                                Nullable
                              </label>
                              <input
                                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                                value={col.default_value}
                                onChange={(e) =>
                                  handleUpdateColumn(col.trackingId, {
                                    default_value: e.target.value,
                                  })
                                }
                                placeholder="default value (optional)"
                                aria-label="Column default value"
                              />
                            </div>
                            <input
                              className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                              value={col.comment}
                              onChange={(e) =>
                                handleUpdateColumn(col.trackingId, {
                                  comment: e.target.value,
                                })
                              }
                              placeholder="comment (optional)"
                              aria-label="Column comment"
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleRemoveColumn(col.trackingId)}
                            disabled={columns.length <= 1}
                            aria-label="Remove column"
                            title={
                              columns.length <= 1
                                ? "At least one column required"
                                : "Remove column"
                            }
                          >
                            <Minus />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </TabsContent>

                {/* Keys tab */}
                <TabsContent
                  value="keys"
                  className="pt-3 data-[state=inactive]:hidden"
                  data-testid="create-table-keys-panel"
                  forceMount
                >
                  <div>
                    <label className="mb-1 block text-xs font-medium text-secondary-foreground">
                      Primary key
                    </label>
                    <div
                      className="max-h-scroll-sm overflow-auto rounded border border-border bg-background p-2"
                      aria-label="Primary key columns"
                    >
                      {validPkColumns.length === 0 ? (
                        <span className="text-xs italic text-muted-foreground">
                          Add a column with a name to choose primary key columns
                        </span>
                      ) : (
                        validPkColumns.map((colName) => {
                          const draft = columns.find(
                            (c) => c.name.trim() === colName,
                          );
                          const checked = !!draft?.is_pk;
                          return (
                            <label
                              key={colName}
                              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-foreground hover:bg-muted"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (!draft) return;
                                  handleUpdateColumn(draft.trackingId, {
                                    is_pk: e.target.checked,
                                  });
                                }}
                                className="rounded border-border"
                                aria-label={`Primary key: ${colName}`}
                              />
                              {colName}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
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
                  />
                </TabsContent>

                {/* Foreign Keys tab — Sprint 229 placeholder */}
                <TabsContent
                  value="foreign_keys"
                  className="pt-3 data-[state=inactive]:hidden"
                  data-testid="create-table-foreign-keys-panel"
                  forceMount
                >
                  <div className="rounded border border-dashed border-border bg-background p-4 text-center">
                    <p className="text-xs italic text-muted-foreground">
                      Available in Sprint 229
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Inline DDL Preview pane (collapsible) */}
            <div className="border-t border-border">
              <button
                type="button"
                onClick={handleShowDdl}
                disabled={!canPreview && !showDdl}
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
                      Generating preview…
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
                      -- Fill in the form to see the generated SQL
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <DialogFooter className="border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleExecute}
                disabled={
                  !canPreview ||
                  ddl.previewLoading ||
                  !ddl.previewSql ||
                  previewStale
                }
                aria-label="Execute"
              >
                {ddl.previewLoading ? (
                  <Loader2 className="animate-spin size-3.5" />
                ) : null}
                Execute
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Warn-tier confirmation dialog. Stacks above the create modal. */}
      {ddl.pendingConfirm && (
        <ConfirmDangerousDialog
          open
          reason={ddl.pendingConfirm.reason}
          sqlPreview={ddl.pendingConfirm.sql}
          onConfirm={() => {
            void ddl.confirmDangerous();
          }}
          onCancel={ddl.cancelDangerous}
        />
      )}
    </>
  );
}
