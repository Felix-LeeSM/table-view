import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";
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
import * as tauri from "@lib/tauri";
import { useDdlPreviewExecution } from "@components/structure/useDdlPreviewExecution";
import ConfirmDestructiveDialog from "@components/workspace/ConfirmDestructiveDialog";
import SqlSyntax from "@components/shared/SqlSyntax";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useFkReferencePicker } from "@hooks/useFkReferencePicker";
import { usePostgresTypes } from "@hooks/usePostgresTypes";
import CreateTableTypeCombobox from "./CreateTableTypeCombobox";
import CreateTableDialogHeader from "./CreateTableDialog/Header";
import IndexesTabBody, {
  type IndexDraft,
} from "./CreateTableDialog/IndexesTabBody";
import ForeignKeysTabBody, {
  type ForeignKeyDraft,
  type CheckDraft,
  type UniqueDraft,
} from "./CreateTableDialog/ForeignKeysTabBody";
import InlineFkPopover from "./CreateTableDialog/InlineFkPopover";
import type {
  ColumnDefinition,
  ConstraintDefinition,
  CreateTablePlanConstraint,
  CreateTablePlanIndex,
  CreateTablePlanRequest,
} from "@/types/schema";

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
  /**
   * Sprint 241 — inline single-column FK target (TablePlus parity).
   * Empty `fk_ref_table` ⇒ no inline FK on this column. When populated,
   * the chain builder synthesises a `ConstraintDefinition::ForeignKey`
   * with a single-element `columns` array and auto-name
   * `fk_<table>_<column>`. Multi-column FKs stay in the Constraints
   * tab.
   *
   * `fk_ref_schema` blank ⇒ fall back to the table's own schema
   * (PG implicit-search-path semantics). `fk_on_delete` / `fk_on_update`
   * default to `"NO ACTION"`; user can override via the cell popover.
   */
  fk_ref_schema: string;
  fk_ref_table: string;
  fk_ref_column: string;
  fk_on_delete: string;
  fk_on_update: string;
  /**
   * Sprint 241 — inline single-column CHECK expression. Empty ⇒ no
   * inline CHECK. When non-empty, the chain builder synthesises a
   * `ConstraintDefinition::Check` with auto-name `chk_<table>_<column>`.
   * Multi-column / cross-column CHECKs stay in the Constraints tab.
   */
  check_expression: string;
  /**
   * Sprint 242 — identity / auto-increment toggle. When `true` the
   * emitted column gets `GENERATED BY DEFAULT AS IDENTITY` (PG 10+)
   * and the dialog disables the `Nullable` + `default value` inputs
   * (the IDENTITY sequence is the default; PG forces NOT NULL).
   * Caller is still responsible for choosing an integer-family
   * `data_type` (`smallint` / `integer` / `bigint`).
   */
  is_identity: boolean;
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
    fk_ref_schema: "",
    fk_ref_table: "",
    fk_ref_column: "",
    fk_on_delete: "NO ACTION",
    fk_on_update: "NO ACTION",
    check_expression: "",
    is_identity: false,
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

function newFkDraft(defaultRefSchema: string): ForeignKeyDraft {
  return {
    trackingId: makeId(),
    name: "",
    columns: [],
    ref_schema: defaultRefSchema,
    ref_table: "",
    ref_columns: [],
    on_delete: "NO ACTION",
    on_update: "NO ACTION",
  };
}

function newCheckDraft(): CheckDraft {
  return {
    trackingId: makeId(),
    name: "",
    expression: "",
  };
}

function newUniqueDraft(): UniqueDraft {
  return {
    trackingId: makeId(),
    name: "",
    columns: [],
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
  /** Active database — schemaStore cache key dimension (Sprint 263). */
  database: string;
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
  database,
  schemaName,
  availableSchemas,
  open,
  onClose,
  onRefresh,
}: CreateTableDialogProps) {
  const [tableName, setTableName] = useState("");
  // Sprint 234 — table-level COMMENT ON TABLE input. Optional, default
  // empty string. When non-empty (post-trim), plumbed into
  // `buildRequest` as `table_comment`; when empty post-trim, plumbed as
  // `null` so the Sprint 226-233 byte-equivalence invariant holds.
  const [tableComment, setTableComment] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([newDraft()]);
  // Sprint 228 — indexes editor draft list. Default = empty array
  // (index editor is opt-in; 0 indexes is the canonical base state).
  const [indexes, setIndexes] = useState<IndexDraft[]>([]);
  // Sprint 229 — three constraint family draft lists. Default = empty;
  // FK / CHECK / UNIQUE editors are all opt-in.
  const [fks, setFks] = useState<ForeignKeyDraft[]>([]);
  const [checks, setChecks] = useState<CheckDraft[]>([]);
  const [uniques, setUniques] = useState<UniqueDraft[]>([]);
  // Per-row "ref columns are loading" flag — set true between picking
  // a reference table and its columns being populated by the lazy
  // `getTableColumns` call. Drives the disabled state in the body.
  const [fkRefColumnsLoadingByTrackingId, setFkRefColumnsLoadingByTrackingId] =
    useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<TabKey>("columns");
  // Default schema = right-clicked schemaName. The dropdown selection
  // persists across tab switches but is reset when the modal closes.
  const [selectedSchema, setSelectedSchema] = useState<string>(schemaName);
  // Preview pane defaults open — auto-debounced fetch fills it as the
  // user types. Hiding it by default required an extra click and made
  // users think the preview was broken.
  const [showDdl, setShowDdl] = useState(true);

  const schemaOptions = useMemo(() => {
    const list = availableSchemas?.length ? availableSchemas : [schemaName];
    // De-dupe + ensure the default is always present even if the
    // store is mid-load.
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
    // Sprint 234 — reset the table-level COMMENT input so the modal
    // starts fresh on next open.
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

  // Sprint 234 — generic in-place swap helper for the row reorders.
  // Returns the previous list reference unchanged when the move would
  // be a no-op (target tracking id missing, or swap target out of
  // bounds). Preserves React `trackingId`-keyed identity so the swapped
  // rows reuse their existing component instances + DOM nodes.
  function moveByTrackingId<T extends { trackingId: string }>(
    list: T[],
    trackingId: string,
    direction: -1 | 1,
  ): T[] {
    const idx = list.findIndex((row) => row.trackingId === trackingId);
    if (idx < 0) return list;
    const swap = idx + direction;
    if (swap < 0 || swap >= list.length) return list;
    const next = [...list];
    [next[idx], next[swap]] = [next[swap]!, next[idx]!];
    return next;
  }

  // Sprint 234 — column reorder. Wraps `moveByTrackingId` + flips the
  // preview-stale flag (cached SQL must invalidate because column
  // declaration order is byte-significant in CREATE TABLE).
  const handleMoveColumn = (trackingId: string, direction: -1 | 1) => {
    setColumns((prev) => moveByTrackingId(prev, trackingId, direction));
  };

  // ── Sprint 228 — Indexes tab handlers ────────────────────────────

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

  // Sprint 234 — index reorder (parent-owned, mirrors `handleMoveColumn`).
  const handleMoveIndex = (trackingId: string, direction: -1 | 1) => {
    setIndexes((prev) => moveByTrackingId(prev, trackingId, direction));
  };

  // ── Sprint 229 — Foreign Keys / CHECK / UNIQUE handlers ──────────

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
  // Sprint 230 — dynamic PG type list. Hook returns the merged
  // canonical-first + live-extras list (or canonical exactly while
  // the fetch is in flight / on error). Pass through as `typesSource`
  // to the per-row combobox so suggestions reflect the live PG state.
  //
  // Sprint 234 — also surface the `typesByName` Map so the combobox
  // can render type-kind color dots per option (enum=blue,
  // domain=green, range=purple, composite=orange; base=no dot).
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
        // Capture the resulting ref_schema for the column-lazy-load
        // closure below — either the new value if it's being changed
        // in this same `updates`, or the existing one.
        snapshotRefSchema = updates.ref_schema ?? f.ref_schema;
        return { ...f, ...updates };
      }),
    );
    // Lazy load tables when ref_schema changes and the cache is empty.
    if (nextRefSchema) {
      void fkPicker.ensureTablesLoaded(nextRefSchema);
    }
    // Lazy load reference columns when ref_table changes.
    if (
      nextRefTable !== undefined &&
      nextRefTable.trim().length > 0 &&
      snapshotRefSchema &&
      snapshotRefSchema.trim().length > 0
    ) {
      const refTable = nextRefTable.trim();
      const refSchema = snapshotRefSchema;
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

  // Sprint 234 — FK / CHECK / UNIQUE reorder handlers (parent-owned).
  // Same swap-in-place semantics as columns/indexes; the body
  // components carry the boundary `disabled` state via row position.
  const handleMoveFk = (trackingId: string, direction: -1 | 1) => {
    setFks((prev) => moveByTrackingId(prev, trackingId, direction));
  };
  const handleMoveCheck = (trackingId: string, direction: -1 | 1) => {
    setChecks((prev) => moveByTrackingId(prev, trackingId, direction));
  };
  const handleMoveUnique = (trackingId: string, direction: -1 | 1) => {
    setUniques((prev) => moveByTrackingId(prev, trackingId, direction));
  };

  // Sprint 238 — auto-refresh preview on form edit (debounced 250 ms);
  // 직접 invalidatePreview / previewStale 추적은 제거됐다. 사용자가
  // form 을 편집하는 동안 SQL 이 라이브로 업데이트되며, Execute 버튼은
  // stale 게이트 없이 preview 가 존재하기만 하면 활성화된다.
  // (auto-refresh effect 는 buildRequest 정의 다음에 위치.)

  const handleSchemaChange = (next: string) => {
    setSelectedSchema(next);
  };

  const handleTableNameChange = (next: string) => {
    setTableName(next);
  };

  // Sprint 234 — table-level COMMENT input handler.
  const handleTableCommentChange = (next: string) => {
    setTableComment(next);
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
        // Sprint 242 — only attach `is_identity` when true so the wire
        // payload stays byte-equivalent to pre-Sprint-242 callers when
        // the toggle is off (backend's `#[serde(default)]` accepts both
        // omitted and `false`).
        if (c.is_identity) {
          def.is_identity = true;
        }
        return def;
      });
    // Sprint 234 — table_comment is `null` when blank/whitespace-only
    // so the Sprint 226-233 caller invariant holds (backend's
    // `#[serde(default)]` deserialises both omitted and `null` to None).
    const trimmedTableComment = tableComment.trim();
    return {
      connection_id: connectionId,
      schema: selectedSchema,
      name: tableName.trim(),
      columns: columnDefs,
      primary_key: pkColumns.length > 0 ? pkColumns : null,
      preview_only: previewOnly,
      table_comment:
        trimmedTableComment.length > 0 ? trimmedTableComment : null,
    };
  };

  // Sprint 240 — unified plan request. Bundles CREATE TABLE columns +
  // primary key + table_comment + index drafts + constraint drafts so
  // the backend's `create_table_plan` IPC emits the full preview SQL
  // (or executes the chain) in one round trip. `chainIndexes` /
  // `chainConstraints` are caller-provided so the auto-refresh
  // useEffect can pass identical snapshots to preview and commit.
  const buildPlanRequest = (
    chainIndexes: IndexDraft[],
    chainConstraints: {
      trackingId: string;
      name: string;
      definition: ConstraintDefinition;
    }[],
    previewOnly: boolean,
  ): CreateTablePlanRequest => {
    const base = buildRequest(previewOnly);
    const planIndexes: CreateTablePlanIndex[] = chainIndexes.map((idx) => ({
      indexName: idx.name.trim(),
      columns: idx.columns.map((c) => c.trim()).filter((c) => c.length > 0),
      indexType: idx.index_type,
      isUnique: idx.unique,
    }));
    const planConstraints: CreateTablePlanConstraint[] = chainConstraints.map(
      (c) => ({
        constraintName: c.name,
        definition: c.definition,
      }),
    );
    return {
      connectionId: base.connection_id,
      schema: base.schema,
      name: base.name,
      columns: base.columns,
      primaryKey: base.primary_key,
      tableComment: base.table_comment ?? null,
      indexes: planIndexes,
      constraints: planConstraints,
      previewOnly,
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

  // ── Sprint 229 — constraint chain wiring ────────────────────────

  // Reactive subscriptions to the schema store. The reference table
  // picker reads `useSchemaStore.tables[<conn>:<refSchema>]` and the
  // reference column picker reads `tableColumnsCache[<conn>:<schema>:
  // <table>]`. Subscribing reactively means the FK editor body
  // re-renders when a lazy `loadTables` / `getTableColumns` populates
  // a previously-empty slot — so the dropdowns auto-fill without the
  // user having to re-open the row.
  // Sprint 263 — schemaStore is now nested `(connId, db, schema, table)`.
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

  /**
   * The list of constraint drafts (FK + CHECK + UNIQUE) that the chain
   * will actually execute, after filtering out invalid rows. Order is
   * `[...validatedFks, ...validatedChecks, ...validatedUniques]` —
   * declared family order, byte-stable across preview and execute.
   *
   * Filter rules (per Sprint 229 contract Test Requirements §"empty /
   * 누락 입력"):
   * - Empty trimmed name uses the auto-suggested name; the row only
   *   drops when name auto-suggestion can't fill (e.g. FK with no
   *   local columns).
   * - FK with empty local columns / empty ref table / empty ref columns
   *   is filtered out (not enough info to produce valid SQL).
   * - CHECK with whitespace-only expression is filtered out (backend
   *   would reject anyway).
   * - UNIQUE with empty columns is filtered out.
   */
  const declaredConstraintsForChain = useMemo<
    {
      trackingId: string;
      name: string;
      definition: ConstraintDefinition;
    }[]
  >(() => {
    const tableNameSafe = tableName.trim();
    const out: {
      trackingId: string;
      name: string;
      definition: ConstraintDefinition;
    }[] = [];

    for (const f of fks) {
      const cols = f.columns.map((c) => c.trim()).filter((c) => c.length > 0);
      const refTable = f.ref_table.trim();
      const refCols = f.ref_columns
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cols.length === 0) continue;
      if (refTable.length === 0) continue;
      if (refCols.length === 0) continue;
      const autoName =
        cols.length > 0 && tableNameSafe.length > 0
          ? `fk_${tableNameSafe}_${cols.join("_")}`
          : "";
      const finalName = f.name.trim().length > 0 ? f.name.trim() : autoName;
      if (finalName.length === 0) continue;
      out.push({
        trackingId: f.trackingId,
        name: finalName,
        definition: {
          type: "foreign_key",
          columns: cols,
          reference_table: refTable,
          reference_columns: refCols,
          on_delete: f.on_delete,
          on_update: f.on_update,
        },
      });
    }

    let checkIndex = 0;
    for (const c of checks) {
      checkIndex += 1;
      const expr = c.expression.trim();
      if (expr.length === 0) continue;
      const autoName =
        tableNameSafe.length > 0 ? `chk_${tableNameSafe}_${checkIndex}` : "";
      const finalName = c.name.trim().length > 0 ? c.name.trim() : autoName;
      if (finalName.length === 0) continue;
      out.push({
        trackingId: c.trackingId,
        name: finalName,
        definition: {
          type: "check",
          expression: expr,
        },
      });
    }

    for (const u of uniques) {
      const cols = u.columns.map((c) => c.trim()).filter((c) => c.length > 0);
      if (cols.length === 0) continue;
      const autoName =
        cols.length > 0 && tableNameSafe.length > 0
          ? `uq_${tableNameSafe}_${cols.join("_")}`
          : "";
      const finalName = u.name.trim().length > 0 ? u.name.trim() : autoName;
      if (finalName.length === 0) continue;
      out.push({
        trackingId: u.trackingId,
        name: finalName,
        definition: {
          type: "unique",
          columns: cols,
        },
      });
    }

    // Sprint 241 — pick up inline single-column FK / CHECK declared on
    // column rows (TablePlus parity). Auto-name uses the column name so
    // multiple rows with the same target table don't collide. Empty
    // ref_schema falls back to `selectedSchema` so the user only has to
    // pick a different schema when the target lives in another one.
    for (const col of columns) {
      const colName = col.name.trim();
      if (colName.length === 0) continue;

      const refTable = col.fk_ref_table.trim();
      const refColumn = col.fk_ref_column.trim();
      if (refTable.length > 0 && refColumn.length > 0) {
        const fkName =
          tableNameSafe.length > 0 ? `fk_${tableNameSafe}_${colName}` : "";
        if (fkName.length > 0) {
          // Inline FK reference targets share the table's own schema —
          // matches the Sprint 229 Constraints tab behaviour (the
          // backend's `ConstraintDefinition::ForeignKey` does not yet
          // accept a separate schema; cross-schema FKs are deferred).
          out.push({
            trackingId: `inline-fk-${col.trackingId}`,
            name: fkName,
            definition: {
              type: "foreign_key",
              columns: [colName],
              reference_table: refTable,
              reference_columns: [refColumn],
              on_delete: col.fk_on_delete,
              on_update: col.fk_on_update,
            },
          });
        }
      }

      const expr = col.check_expression.trim();
      if (expr.length > 0) {
        const chkName =
          tableNameSafe.length > 0 ? `chk_${tableNameSafe}_${colName}` : "";
        if (chkName.length > 0) {
          out.push({
            trackingId: `inline-chk-${col.trackingId}`,
            name: chkName,
            definition: {
              type: "check",
              expression: expr,
            },
          });
        }
      }
    }

    return out;
  }, [fks, checks, uniques, columns, tableName]);

  // Sprint 240 — auto-refresh debounced + single-IPC unified plan.
  // Replaces the Sprint 238 N+1 fan-out (1 createTable + N createIndex
  // + M addConstraint round trips) with one `tauri.createTablePlan`
  // call per debounce flush. The backend builds the joined preview
  // SQL (or executes the chain under atomic policy C) and returns it
  // verbatim — the dialog's preview pane renders the result with
  // zero client-side composition.
  useEffect(() => {
    if (!open) return;
    if (!canPreview) return;
    const handle = window.setTimeout(() => {
      // Snapshot at debounce-flush time — same chain rows feed both
      // the preview request and the commit closure, so both observe
      // identical row sets even if the user keeps typing.
      const chainIndexes = declaredIndexesForChain;
      const chainConstraints = declaredConstraintsForChain;
      void ddl.loadPreview(
        async () => {
          return tauri.createTablePlan(
            buildPlanRequest(chainIndexes, chainConstraints, true),
          );
        },
        () => async () => {
          await tauri.createTablePlan(
            buildPlanRequest(chainIndexes, chainConstraints, false),
          );
        },
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // Dep array intentionally watches the inputs that drive SQL
    // content: the table-level fields, the column drafts, and the
    // chain row arrays. `ddl.loadPreview` / build* helpers are stable
    // per render and excluded for noise reduction.
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
    // Sprint 238: stale 게이트 제거 — auto-refresh 가 commit closure 를
    // 항상 최신 form snapshot 으로 갱신하므로, previewSql 만 존재하면
    // 안전하게 commit 가능.
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
        <DialogShell className="w-dialog-md" showCloseButton={false}>
          {/* Sprint 241 — 3-region compound layout (Header / Body /
              Footer). Header + Footer are pinned (flex-shrink-0); only
              the middle Body scrolls so the user always sees the title
              bar above and the DDL preview / Execute button below
              while a long column / index / constraint list scrolls
              between them. */}
          <DialogShell.Header>
            <CreateTableDialogHeader
              selectedSchema={selectedSchema}
              onClose={handleCancel}
            />
          </DialogShell.Header>

          <DialogShell.Body>
            <div className="space-y-3">
              {/* Sprint 234 — Schema picker (moved out of the header).
                  Renders ABOVE the Table name input so the layout reads
                  top-to-bottom: schema → table name → table comment →
                  tabs. Hidden when schemaOptions is empty (mirrors the
                  prior header guard for MySQL/MariaDB capability). */}
              {schemaOptions.length > 0 && (
                <div>
                  <label
                    htmlFor="create-table-target-schema"
                    className="mb-1 block text-xs font-medium text-secondary-foreground"
                  >
                    Target schema
                  </label>
                  <Select
                    value={selectedSchema}
                    onValueChange={handleSchemaChange}
                  >
                    <SelectTrigger
                      id="create-table-target-schema"
                      aria-label="Target schema"
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

              {/* Sprint 234 — Table comment (optional). Rendered between
                  Table name and the Tabs block. Plumbs into
                  `buildRequest.table_comment` (trimmed, null when blank). */}
              <div>
                <label
                  htmlFor="create-table-comment"
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  Table comment
                </label>
                <input
                  id="create-table-comment"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={tableComment}
                  onChange={(e) => handleTableCommentChange(e.target.value)}
                  placeholder="comment (optional)"
                  aria-label="Table comment"
                />
              </div>

              {/* Tabs */}
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as TabKey)}
              >
                <TabsList className="w-full justify-start gap-0 rounded-none border-b border-border">
                  {/* Sprint 234 — `(N)` count badges next to Keys /
                      Indexes / Foreign Keys when their respective
                      declared-list count > 0. The badge digits flow as
                      plain text inside the trigger so screen readers
                      pick them up as part of the tab's accessible name
                      (e.g. "Keys (2)" — natural language). Hidden when
                      count is 0 — no `(0)` noise. */}
                  <TabsTrigger value="columns" className="rounded-none">
                    Columns
                  </TabsTrigger>
                  <TabsTrigger value="keys" className="rounded-none">
                    Keys
                    {declaredPk.length > 0 && (
                      <span className="ml-1 text-3xs text-muted-foreground">
                        ({declaredPk.length})
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="indexes" className="rounded-none">
                    Indexes
                    {declaredIndexesForChain.length > 0 && (
                      <span className="ml-1 text-3xs text-muted-foreground">
                        ({declaredIndexesForChain.length})
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="foreign_keys" className="rounded-none">
                    Constraints
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
                    {/* Sprint 241 — single-layer scroll. Long lists
                        flow naturally inside the dialog body's outer
                        scroll region; the row container itself does
                        not introduce a second scroll axis. */}
                    <div className="space-y-1">
                      {columns.map((col, position) => {
                        // Sprint 234 — boundary flags for ↑/↓ reorder.
                        const isFirst = position === 0;
                        const isLast = position === columns.length - 1;
                        return (
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
                                    typesSource={pgTypes}
                                    typeKindMap={pgTypesByName}
                                    onChange={(next) =>
                                      handleUpdateColumn(col.trackingId, {
                                        data_type: next,
                                      })
                                    }
                                  />
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {/* Sprint 242 — IDENTITY columns are
                                    SQL-standard NOT NULL and the
                                    sequence acts as the default, so
                                    nullable + default-value inputs are
                                    disabled when identity is on. */}
                                <label
                                  className={`flex cursor-pointer items-center gap-1 text-xs text-foreground ${col.is_identity ? "opacity-50" : ""}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={col.nullable && !col.is_identity}
                                    onChange={(e) =>
                                      handleUpdateColumn(col.trackingId, {
                                        nullable: e.target.checked,
                                      })
                                    }
                                    disabled={col.is_identity}
                                    className="rounded border-border"
                                    aria-label="Column nullable"
                                  />
                                  Nullable
                                </label>
                                <label
                                  className="flex cursor-pointer items-center gap-1 text-xs text-foreground"
                                  title="Auto-incrementing identity column (PG: GENERATED BY DEFAULT AS IDENTITY)"
                                >
                                  <input
                                    type="checkbox"
                                    checked={col.is_identity}
                                    onChange={(e) =>
                                      handleUpdateColumn(col.trackingId, {
                                        is_identity: e.target.checked,
                                      })
                                    }
                                    className="rounded border-border"
                                    aria-label="Column identity"
                                  />
                                  Identity
                                </label>
                                <input
                                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
                                  value={
                                    col.is_identity ? "" : col.default_value
                                  }
                                  onChange={(e) =>
                                    handleUpdateColumn(col.trackingId, {
                                      default_value: e.target.value,
                                    })
                                  }
                                  disabled={col.is_identity}
                                  placeholder={
                                    col.is_identity
                                      ? "(IDENTITY sequence)"
                                      : "default value (optional)"
                                  }
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
                              {/* Sprint 241 — inline FK + CHECK on the
                                column row (TablePlus parity). FK is
                                edited via a popover (cell-click
                                pattern); single-column CHECK is a
                                free-text input. Multi-column variants
                                continue to live in the Constraints
                                tab. */}
                              <div className="flex items-center gap-1.5">
                                <InlineFkPopover
                                  columnTrackingId={col.trackingId}
                                  value={{
                                    ref_schema: col.fk_ref_schema,
                                    ref_table: col.fk_ref_table,
                                    ref_column: col.fk_ref_column,
                                    on_delete: col.fk_on_delete,
                                    on_update: col.fk_on_update,
                                  }}
                                  defaultSchema={selectedSchema}
                                  availableSchemas={schemaOptions}
                                  refTablesByKey={refTablesByKey}
                                  refColumnsByKey={refColumnsByKey}
                                  onSchemaPicked={(s) => {
                                    void fkPicker.ensureTablesLoaded(s);
                                  }}
                                  onTablePicked={(s, t) => {
                                    void fkPicker.loadColumnsIfMissing(s, t);
                                  }}
                                  onChange={(updates) => {
                                    const mapped: Partial<ColumnDraft> = {};
                                    if (updates.ref_schema !== undefined)
                                      mapped.fk_ref_schema = updates.ref_schema;
                                    if (updates.ref_table !== undefined)
                                      mapped.fk_ref_table = updates.ref_table;
                                    if (updates.ref_column !== undefined)
                                      mapped.fk_ref_column = updates.ref_column;
                                    if (updates.on_delete !== undefined)
                                      mapped.fk_on_delete = updates.on_delete;
                                    if (updates.on_update !== undefined)
                                      mapped.fk_on_update = updates.on_update;
                                    handleUpdateColumn(col.trackingId, mapped);
                                  }}
                                  onClear={() =>
                                    handleUpdateColumn(col.trackingId, {
                                      fk_ref_schema: "",
                                      fk_ref_table: "",
                                      fk_ref_column: "",
                                      fk_on_delete: "NO ACTION",
                                      fk_on_update: "NO ACTION",
                                    })
                                  }
                                />
                                <input
                                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                                  value={col.check_expression}
                                  onChange={(e) =>
                                    handleUpdateColumn(col.trackingId, {
                                      check_expression: e.target.value,
                                    })
                                  }
                                  placeholder="check expression (optional, e.g. age >= 0)"
                                  aria-label="Column check expression"
                                />
                              </div>
                            </div>
                            {/* Sprint 234 — ↑ / ↓ reorder buttons (left
                              of `−`). Boundary-disabled at top/bottom
                              row; defense-in-depth handler in parent
                              also no-ops on out-of-range swaps. */}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                handleMoveColumn(col.trackingId, -1)
                              }
                              disabled={isFirst}
                              aria-label="Move column up"
                              title="Move column up"
                            >
                              <ArrowUp />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                handleMoveColumn(col.trackingId, 1)
                              }
                              disabled={isLast}
                              aria-label="Move column down"
                              title="Move column down"
                            >
                              <ArrowDown />
                            </Button>
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
                        );
                      })}
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
                          Add named columns in the Columns tab to use this
                          picker.
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

            <DialogFooter className="border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleExecute}
                disabled={!canPreview || ddl.previewLoading || !ddl.previewSql}
                aria-label="Execute"
              >
                {ddl.previewLoading ? (
                  <Loader2 className="animate-spin size-3.5" />
                ) : null}
                Execute
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
