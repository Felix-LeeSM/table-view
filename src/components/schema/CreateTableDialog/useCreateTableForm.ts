import { useEffect, useMemo, useState } from "react";
import * as tauri from "@lib/tauri";
import { useDdlPreviewExecution } from "@components/structure/useDdlPreviewExecution";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useFkReferencePicker } from "@hooks/useFkReferencePicker";
import { usePostgresTypes } from "@hooks/usePostgresTypes";
import type { IndexDraft } from "./IndexesTabBody";
import type {
  ForeignKeyDraft,
  CheckDraft,
  UniqueDraft,
} from "./ForeignKeysTabBody";
import {
  type ColumnDraft,
  type TabKey,
  indexMatchesPk,
  moveByTrackingId,
  newCheckDraft,
  newDraft,
  newFkDraft,
  newIndexDraft,
  newUniqueDraft,
} from "./types";
import {
  buildPlanRequest,
  computeDeclaredConstraints,
  type DeclaredConstraint,
} from "./planBuilders";
import type { SchemaName, TableName } from "@/types/branded";

export interface UseCreateTableFormArgs {
  /** Connection id used by the Safe Mode gate + history record. */
  connectionId: string;
  /** Active database — schemaStore cache key dimension. */
  database: string;
  /** Right-clicked schema name; default selection of the schema dropdown. */
  schemaName: string;
  /**
   * Schemas available on the connection — drives the Target schema dropdown
   * options. Sourced from `useSchemaStore.schemas[connectionId]` by the
   * SchemaTree dialog slot. When omitted (legacy callers), defaults to a
   * single-element list containing `schemaName` — a migration-only compat
   * surface tracked in the frontend compatibility inventory.
   */
  availableSchemas?: string[];
  /** Modal closes when set false (Dialog open/close pattern). */
  open: boolean;
  /** Called on Cancel / outside-close / commit-success. */
  onClose: () => void;
  /** Called once after a successful commit so the SchemaTree can re-fetch. */
  onRefresh: () => Promise<void>;
}

/**
 * All form state + handlers + preview/commit chain wiring for
 * `CreateTableDialog`. Extracted verbatim from the dialog component so the
 * component owns only the tab layout JSX. The lifecycle hook
 * (`useDdlPreviewExecution`) is reused unchanged — this hook owns the draft
 * lists, the auto-refresh debounce, and the single-IPC `createTablePlan`
 * preview/commit closures (partial-atomic policy C: index/constraint
 * failures do not roll back the CREATE TABLE).
 */
export function useCreateTableForm({
  connectionId,
  database,
  schemaName,
  availableSchemas,
  open,
  onClose,
  onRefresh,
}: UseCreateTableFormArgs) {
  const [tableName, setTableName] = useState("");
  // Table-level COMMENT ON TABLE input. Optional, default empty string. When
  // non-empty (post-trim), plumbed into `buildRequest` as `table_comment`;
  // when empty post-trim, plumbed as `null` so the byte-equivalence
  // invariant holds.
  const [tableComment, setTableComment] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([newDraft()]);
  // Indexes editor draft list. Default = empty array (index editor is
  // opt-in; 0 indexes is the canonical base state).
  const [indexes, setIndexes] = useState<IndexDraft[]>([]);
  // Three constraint family draft lists. Default = empty; FK / CHECK /
  // UNIQUE editors are all opt-in.
  const [fks, setFks] = useState<ForeignKeyDraft[]>([]);
  const [checks, setChecks] = useState<CheckDraft[]>([]);
  const [uniques, setUniques] = useState<UniqueDraft[]>([]);
  // Per-row "ref columns are loading" flag — set true between picking a
  // reference table and its columns being populated by the lazy
  // `getTableColumns` call. Drives the disabled state in the body.
  const [fkRefColumnsLoadingByTrackingId, setFkRefColumnsLoadingByTrackingId] =
    useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<TabKey>("columns");
  // Default schema = right-clicked schemaName. The dropdown selection
  // persists across tab switches but is reset when the modal closes.
  const [selectedSchema, setSelectedSchema] = useState<string>(schemaName);
  // Preview pane defaults open — auto-debounced fetch fills it as the user
  // types. Hiding it by default required an extra click and made users think
  // the preview was broken.
  const [showDdl, setShowDdl] = useState(true);

  const schemaOptions = useMemo(() => {
    const list = availableSchemas?.length ? availableSchemas : [schemaName];
    // De-dupe + ensure the default is always present even if the store is
    // mid-load.
    const set = new Set(list);
    set.add(schemaName);
    return Array.from(set);
  }, [availableSchemas, schemaName]);

  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );
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
    setTableComment("");
    setColumns([newDraft()]);
    setIndexes([]);
    setFks([]);
    setChecks([]);
    setUniques([]);
    setFkRefColumnsLoadingByTrackingId({});
    setSelectedSchema(schemaName);
    setActiveTab("columns");
    setShowDdl(true);
  };

  // Reset the modal whenever it (re)opens. `selectedSchema` follows the
  // right-clicked schema name — if SchemaTree opens the modal on a different
  // schema row, the dropdown defaults to that row.
  useEffect(() => {
    if (open) {
      setSelectedSchema(schemaName);
    }
    // Intentionally narrow deps: `schemaName` is the entry-point seed that
    // should override the dropdown when the user re-opens the modal.
    // Reopening with same schema is a no-op.
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
  };

  const handleRemoveColumn = (trackingId: string) => {
    setColumns((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((c) => c.trackingId !== trackingId);
    });
  };

  const handleUpdateColumn = (
    trackingId: string,
    updates: Partial<ColumnDraft>,
  ) => {
    setColumns((prev) =>
      prev.map((c) => (c.trackingId === trackingId ? { ...c, ...updates } : c)),
    );
  };

  // Column reorder. Wraps `moveByTrackingId` — cached SQL invalidates
  // implicitly because column declaration order is byte-significant in
  // CREATE TABLE and the auto-refresh effect watches `columns`.
  const handleMoveColumn = (trackingId: string, direction: -1 | 1) => {
    setColumns((prev) => moveByTrackingId(prev, trackingId, direction));
  };

  // ── Indexes tab handlers ────────────────────────────────────────

  const handleAddIndex = () => {
    setIndexes((prev) => [...prev, newIndexDraft()]);
  };

  const handleRemoveIndex = (trackingId: string) => {
    setIndexes((prev) => prev.filter((i) => i.trackingId !== trackingId));
  };

  const handleUpdateIndex = (
    trackingId: string,
    updates: Partial<IndexDraft>,
  ) => {
    setIndexes((prev) =>
      prev.map((i) => (i.trackingId === trackingId ? { ...i, ...updates } : i)),
    );
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
  };

  const handleMoveIndex = (trackingId: string, direction: -1 | 1) => {
    setIndexes((prev) => moveByTrackingId(prev, trackingId, direction));
  };

  // ── Foreign Keys / CHECK / UNIQUE handlers ──────────────────────

  const handleAddFk = () => {
    setFks((prev) => [...prev, newFkDraft(selectedSchema)]);
  };

  const handleRemoveFk = (trackingId: string) => {
    setFks((prev) => prev.filter((f) => f.trackingId !== trackingId));
    setFkRefColumnsLoadingByTrackingId((prev) => {
      if (!(trackingId in prev)) return prev;
      const next = { ...prev };
      delete next[trackingId];
      return next;
    });
  };

  const fkPicker = useFkReferencePicker(connectionId, database);
  // Dynamic PG type list. Hook returns the merged canonical-first +
  // live-extras list (or canonical exactly while the fetch is in flight /
  // on error). `typesByName` surfaces the type-kind map so the combobox can
  // render type-kind color dots per option (enum=blue, domain=green,
  // range=purple, composite=orange; base=no dot).
  const { types: pgTypes, typesByName: pgTypesByName } =
    usePostgresTypes(connectionId);

  const handleUpdateFk = (
    trackingId: string,
    updates: Partial<ForeignKeyDraft>,
  ) => {
    let nextRefSchema: string | undefined;
    let nextRefTable: string | undefined;
    let snapshotRefSchema: string | undefined;
    setFks((prev) =>
      prev.map((f) => {
        if (f.trackingId !== trackingId) return f;
        if (updates.ref_schema && updates.ref_schema !== f.ref_schema) {
          nextRefSchema = updates.ref_schema;
        }
        if (
          updates.ref_table !== undefined &&
          updates.ref_table !== f.ref_table
        ) {
          nextRefTable = updates.ref_table;
        }
        // Capture the resulting ref_schema for the column-lazy-load closure
        // below — either the new value if it's being changed in this same
        // `updates`, or the existing one.
        snapshotRefSchema = updates.ref_schema ?? f.ref_schema;
        return { ...f, ...updates };
      }),
    );
    // Lazy load tables when ref_schema changes and the cache is empty.
    if (nextRefSchema) {
      void fkPicker.ensureTablesLoaded(nextRefSchema as SchemaName);
    }
    // Lazy load reference columns when ref_table changes.
    if (
      nextRefTable !== undefined &&
      nextRefTable.trim().length > 0 &&
      snapshotRefSchema &&
      snapshotRefSchema.trim().length > 0
    ) {
      const refTable = nextRefTable.trim() as TableName;
      const refSchema = snapshotRefSchema as SchemaName;
      setFkRefColumnsLoadingByTrackingId((prev) => ({
        ...prev,
        [trackingId]: true,
      }));
      void fkPicker.loadColumnsIfMissing(refSchema, refTable).finally(() => {
        setFkRefColumnsLoadingByTrackingId((prev) => {
          if (!(trackingId in prev)) return prev;
          const next = { ...prev };
          delete next[trackingId];
          return next;
        });
      });
    }
  };

  const handleToggleFkLocalColumn = (trackingId: string, colName: string) => {
    setFks((prev) =>
      prev.map((f) => {
        if (f.trackingId !== trackingId) return f;
        const has = f.columns.includes(colName);
        return {
          ...f,
          columns: has
            ? f.columns.filter((c) => c !== colName)
            : [...f.columns, colName],
        };
      }),
    );
  };

  const handleToggleFkRefColumn = (trackingId: string, colName: string) => {
    setFks((prev) =>
      prev.map((f) => {
        if (f.trackingId !== trackingId) return f;
        const has = f.ref_columns.includes(colName);
        return {
          ...f,
          ref_columns: has
            ? f.ref_columns.filter((c) => c !== colName)
            : [...f.ref_columns, colName],
        };
      }),
    );
  };

  const handleAddCheck = () => {
    setChecks((prev) => [...prev, newCheckDraft()]);
  };
  const handleRemoveCheck = (trackingId: string) => {
    setChecks((prev) => prev.filter((c) => c.trackingId !== trackingId));
  };
  const handleUpdateCheck = (
    trackingId: string,
    updates: Partial<CheckDraft>,
  ) => {
    setChecks((prev) =>
      prev.map((c) => (c.trackingId === trackingId ? { ...c, ...updates } : c)),
    );
  };

  const handleAddUnique = () => {
    setUniques((prev) => [...prev, newUniqueDraft()]);
  };
  const handleRemoveUnique = (trackingId: string) => {
    setUniques((prev) => prev.filter((u) => u.trackingId !== trackingId));
  };
  const handleUpdateUnique = (
    trackingId: string,
    updates: Partial<UniqueDraft>,
  ) => {
    setUniques((prev) =>
      prev.map((u) => (u.trackingId === trackingId ? { ...u, ...updates } : u)),
    );
  };
  const handleToggleUniqueColumn = (trackingId: string, colName: string) => {
    setUniques((prev) =>
      prev.map((u) => {
        if (u.trackingId !== trackingId) return u;
        const has = u.columns.includes(colName);
        return {
          ...u,
          columns: has
            ? u.columns.filter((c) => c !== colName)
            : [...u.columns, colName],
        };
      }),
    );
  };

  // FK / CHECK / UNIQUE reorder handlers. Same swap-in-place semantics as
  // columns/indexes; the body components carry the boundary `disabled` state
  // via row position.
  const handleMoveFk = (trackingId: string, direction: -1 | 1) => {
    setFks((prev) => moveByTrackingId(prev, trackingId, direction));
  };
  const handleMoveCheck = (trackingId: string, direction: -1 | 1) => {
    setChecks((prev) => moveByTrackingId(prev, trackingId, direction));
  };
  const handleMoveUnique = (trackingId: string, direction: -1 | 1) => {
    setUniques((prev) => moveByTrackingId(prev, trackingId, direction));
  };

  const handleSchemaChange = (next: string) => {
    setSelectedSchema(next);
  };

  const handleTableNameChange = (next: string) => {
    setTableName(next);
  };

  const handleTableCommentChange = (next: string) => {
    setTableComment(next);
  };

  // Args shared by `buildPlanRequest` (base request + plan bundle). Kept as a
  // per-render snapshot so preview and commit observe identical form state.
  const planRequestArgs = {
    connectionId,
    selectedSchema,
    tableName,
    tableComment,
    columns,
    database,
  };

  // Live PK column list — used by the Indexes tab for dedup decisions and
  // surface annotations.
  const declaredPk = useMemo(
    () =>
      columns
        .filter((c) => c.is_pk && c.name.trim().length > 0)
        .map((c) => c.name.trim()),
    [columns],
  );

  /**
   * The list of index drafts that the chain will actually execute, after
   * filtering out:
   * - rows whose `name` is empty / whitespace-only (user added a row but
   *   didn't fill it in),
   * - rows with zero columns selected,
   * - rows whose columns array is exactly the declared PK (PG indexes PKs
   *   implicitly — emitting a duplicate would fail with a name collision in
   *   the worst case, or just waste storage).
   */
  const declaredIndexesForChain = useMemo<IndexDraft[]>(() => {
    return indexes.filter((i) => {
      if (i.name.trim().length === 0) return false;
      if (i.columns.length === 0) return false;
      if (indexMatchesPk(i, declaredPk)) return false;
      return true;
    });
  }, [indexes, declaredPk]);

  // ── constraint chain wiring ─────────────────────────────────────

  // Reactive subscriptions to the schema store. The reference table picker
  // reads `useSchemaStore.tables[<conn>:<refSchema>]` and the reference
  // column picker reads `tableColumnsCache[<conn>:<schema>:<table>]`.
  // Subscribing reactively means the FK editor body re-renders when a lazy
  // `loadTables` / `getTableColumns` populates a previously-empty slot — so
  // the dropdowns auto-fill without the user having to re-open the row.
  // schemaStore is nested `(connId, db, schema, table)`.
  const tablesByConnAndSchema = useSchemaStore((s) => s.tables);
  const tableColumnsCache = useSchemaStore((s) => s.tableColumnsCache);

  /** Slice keyed by `<refSchema>` — each entry is `string[]` (table names). */
  const refTablesByKey = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    const tablesBySchema =
      tablesByConnAndSchema[connectionId]?.[database] ?? {};
    for (const [refSchema, list] of Object.entries(tablesBySchema)) {
      out[refSchema] = list.map((t) => t.name);
    }
    return out;
  }, [tablesByConnAndSchema, connectionId, database]);

  /** Slice keyed by `<refSchema>:<refTable>` — each entry is `string[]`. */
  const refColumnsByKey = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    const columnsBySchema = tableColumnsCache[connectionId]?.[database] ?? {};
    for (const [refSchema, tablesInSchema] of Object.entries(columnsBySchema)) {
      for (const [refTable, list] of Object.entries(tablesInSchema)) {
        out[`${refSchema}:${refTable}`] = list.map((c) => c.name);
      }
    }
    return out;
  }, [tableColumnsCache, connectionId, database]);

  // FK + CHECK + UNIQUE drafts that the chain will actually execute (invalid
  // rows filtered, inline column-row FK/CHECK folded in). Byte-stable across
  // preview and execute. See `computeDeclaredConstraints`.
  const declaredConstraintsForChain = useMemo<DeclaredConstraint[]>(
    () =>
      computeDeclaredConstraints({ fks, checks, uniques, columns, tableName }),
    [fks, checks, uniques, columns, tableName],
  );

  // Auto-refresh debounced + single-IPC unified plan. One
  // `tauri.createTablePlan` call per debounce flush; the backend builds the
  // joined preview SQL (or executes the chain under atomic policy C) and
  // returns it verbatim — the preview pane renders the result with zero
  // client-side composition.
  useEffect(() => {
    if (!open) return;
    if (!canPreview) return;
    const handle = window.setTimeout(() => {
      // Snapshot at debounce-flush time — same chain rows feed both the
      // preview request and the commit closure, so both observe identical
      // row sets even if the user keeps typing.
      const chainIndexes = declaredIndexesForChain;
      const chainConstraints = declaredConstraintsForChain;
      void ddl.loadPreview(
        async () => {
          return tauri.createTablePlan(
            buildPlanRequest(
              chainIndexes,
              chainConstraints,
              true,
              planRequestArgs,
            ),
          );
        },
        () => async () => {
          await tauri.createTablePlan(
            buildPlanRequest(
              chainIndexes,
              chainConstraints,
              false,
              planRequestArgs,
            ),
          );
        },
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // Dep array intentionally watches the inputs that drive SQL content: the
    // table-level fields, the column drafts, and the chain row arrays.
    // `ddl.loadPreview` / build* helpers are stable per render and excluded
    // for noise reduction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    canPreview,
    tableName,
    tableComment,
    selectedSchema,
    columns,
    declaredIndexesForChain,
    declaredConstraintsForChain,
    connectionId,
  ]);

  const handleShowDdl = () => {
    setShowDdl((s) => !s);
  };

  const handleExecute = async () => {
    // No stale gate — auto-refresh keeps the commit closure on the latest
    // form snapshot, so committing is safe as long as `previewSql` exists.
    if (!ddl.previewSql) return;
    await ddl.attemptExecute();
  };

  const handleCancel = () => {
    ddl.cancelPreview();
    resetForm();
    onClose();
  };

  return {
    // primitives + inputs
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
    // columns
    columns,
    validPkColumns,
    declaredPk,
    handleAddColumn,
    handleRemoveColumn,
    handleUpdateColumn,
    handleMoveColumn,
    // indexes
    indexes,
    declaredIndexesForChain,
    handleAddIndex,
    handleRemoveIndex,
    handleUpdateIndex,
    handleToggleIndexColumn,
    handleMoveIndex,
    // constraints
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
    // pg types (columns combobox)
    pgTypes,
    pgTypesByName,
    // ddl preview / commit
    ddl,
    connectionEnvironment,
    handleExecute,
    handleCancel,
  };
}
