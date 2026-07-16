import {
  generateSqlWithKeys,
  type CoerceError,
  type GeneratedSqlStatement,
  type SqlDialect,
} from "@/components/datagrid/sqlGenerator";
import {
  generateMqlPreview,
  type MqlCommand,
  type MqlCommandSource,
  type MqlPreview,
} from "@/lib/mongo/mqlGenerator";
import {
  analyzeRdbStatementForDialect,
  decideOracleOrGenericSafeMode,
} from "@/lib/sql/oracleSafety";
import { bulkWriteDocuments } from "@/lib/tauri";
import { mqlCommandsToBulkOps } from "@/lib/mongo/mqlToBulk";
import { detectBatchRowsAffectedMismatch } from "@/lib/datagrid/batchRowsAffected";
import { toast } from "@/lib/runtime/toast";
import i18n from "@lib/i18n";
import type { SafeModeGate } from "@/hooks/useSafeModeGate";
import type { TableData } from "@/types/schema";

/**
 * Edit-lifecycle seam between RDB SQL and Document MQL paradigms. Mirrors
 * the backend `RdbAdapter` / `DocumentAdapter` trait split (src-tauri/src/db/traits.rs)
 * so a DataGrid commit cycle is paradigm-blind in the React layer too.
 *
 * Lifecycle: `preparePreview(input)` builds a {@link PreviewSession} that
 * carries the user-visible preview lines, baked-in Safe Mode risk per
 * item, cell-level coerce errors (RDB only), and a closure that executes
 * the batch. The hook above this layer (`useDataGridPreviewCommit`) owns
 * Safe Mode dialog state, commitError plumbing, history-entry routing
 * to the store, and clear/refetch side effects. The adapter owns paradigm-
 * specific generation, executor selection, and per-paradigm risk analysis.
 */
export type Paradigm = "rdb" | "document" | "search" | "kv";

export type PreviewRisk = "safe" | "warn" | "destructive";

export interface PreviewItem {
  /** User-visible preview line — SQL statement (RDB) or mongosh-flavoured
   *  MQL line (Document). */
  text: string;
  risk: PreviewRisk;
  /** Reason copy from the Safe Mode gate decision. Surfaced in the warn
   *  / destructive dialog and the commitError banner. */
  reason?: string;
  /** Pending-edit key (`"rowIdx-colIdx"` / `"row-page-rowIdx"` / `"new-..."`)
   *  paired with the preview line so a commit-time failure routes back to
   *  the offending cell. RDB only; Mongo items leave this `undefined`. */
  key?: string;
}

/**
 * Issue #1440 — pending-state origins of the ops the backend APPLIED before
 * the failing op of a non-transactional Mongo bulk commit. The facade prunes
 * exactly these entries so a re-commit cannot duplicate the applied writes.
 */
export interface AppliedPendingOps {
  /** Full `pendingEdits` keys (incl. nested `:path` suffix). */
  editKeys: string[];
  /** `pendingDeletedRowKeys` entries. */
  deleteKeys: string[];
  /**
   * The exact `pendingNewRows` row references captured at preview time.
   * Identity, not index — the live pending array shifts left as earlier
   * partial failures prune it, so a preview-time position would point at
   * the wrong row on the same session's 2nd+ failure (PR #1483 review B1).
   * Edit/delete keys are stable, so only the insert namespace needs this.
   */
  newRows: unknown[][];
}

export interface BatchResult {
  ok: boolean;
  /** 0-based index into `session.items` of the failing item. */
  failedIndex?: number;
  failedKey?: string;
  errorMessage?: string;
  /** Issue #1440 — document paradigm only; set when a partial failure left
   *  ops before `failedIndex` already applied on the server. */
  appliedPending?: AppliedPendingOps;
}

export interface BasePreviewSession {
  items: PreviewItem[];
  /** Run the batch unconditionally — Safe Mode gating happens in the hook
   *  via `items[i].risk` before calling `execute`. Adapter owns toast
   *  copy + history-entry recording so paradigm-specific status messages
   *  ("N changes committed" vs "N document changes committed") stay
   *  encapsulated. */
  execute(): Promise<BatchResult>;
}

export interface RdbPreviewSession extends BasePreviewSession {
  kind: "rdb";
}

export interface DocumentPreviewSession extends BasePreviewSession {
  kind: "document";
  /** Backward-compat surface for `DocumentDataGrid.tsx` which reads
   *  `.errors` + `.previewLines` directly. Hook re-exposes this via
   *  the facade's legacy `mqlPreview` field. */
  mqlPreview: MqlPreview;
}

export type PreviewSession = RdbPreviewSession | DocumentPreviewSession;

export interface PreparePreviewResult {
  /** `null` when no executable items emerged. The hook reads
   *  {@link coerceErrors} unconditionally and only mounts the preview
   *  dialog when `session` is non-null. */
  session: PreviewSession | null;
  /** Cell-level coercion errors keyed by pending-edit key. RDB populates
   *  this during preview generation; Mongo returns an empty Map. */
  coerceErrors: Map<string, string>;
}

export interface PreviewInput {
  data: TableData;
  schema: string;
  table: string;
  page: number;
  pendingEdits: Map<string, string | null>;
  pendingNewRows: unknown[][];
  pendingDeletedRowKeys: Set<string>;
  /**
   * Issue #1081 — row-identity anchors keyed by the base CELL key
   * `${rowIdx}-${colIdx}` (edits) and the full delete key (deletes). The
   * commit builders prefer these over `data.rows[rowIdx]` so
   * pagination/sort/refetch can't retarget a write.
   */
  pendingEditRowSnapshots?: ReadonlyMap<string, ReadonlyArray<unknown>>;
  pendingDeletedRowSnapshots?: ReadonlyMap<string, ReadonlyArray<unknown>>;
}

export interface ParadigmEditAdapter {
  preparePreview(input: PreviewInput): PreparePreviewResult;
}

/** Shared by the RDB adapter and the hook's `setSqlPreview(non-null)`
 *  back-door so a raw SQL list resolves to the same risk-tagged items
 *  with no duplicate analysis logic. */
export function classifyRdbRisk(
  sql: string,
  safeModeGate: SafeModeGate,
  dialect?: SqlDialect,
): { risk: PreviewRisk; reason?: string } {
  const analysis = analyzeRdbStatementForDialect(sql, dialect);
  const decision = decideOracleOrGenericSafeMode(analysis, safeModeGate.decide);
  if (decision.action === "block") {
    return { risk: "destructive", reason: decision.reason };
  }
  if (decision.action === "confirm") {
    return { risk: "warn", reason: decision.reason };
  }
  return { risk: "safe" };
}

export interface HistoryRecorder {
  recordSuccess(args: {
    sql: string;
    startedAt: number;
    duration: number;
  }): void;
  recordError(args: { sql: string; startedAt: number; duration: number }): void;
}

export interface RdbAdapterDeps {
  connectionId: string;
  expectedDatabase?: string;
  safeModeGate: SafeModeGate;
  executeQueryBatch: (
    connectionId: string,
    sqls: string[],
    correlationId: string,
    expectedDatabase?: string,
    safetyConfirmed?: boolean,
  ) => Promise<unknown>;
  history: HistoryRecorder;
  canEditRows?: boolean;
  /**
   * Sprint 347 — DBMS dialect for the SQL generator. Postgres jsonb edits
   * stay on `jsonb_set`; MySQL JSON edits route through `JSON_SET` /
   * `JSON_REMOVE`. Defaults to `"postgresql"` when callers haven't been
   * plumbed yet (preserves Sprint 343/344 behaviour).
   */
  dialect?: SqlDialect;
}

export interface DocumentAdapterDeps {
  connectionId: string;
  history: HistoryRecorder;
}

function parseMongoBulkWriteFailedIndex(message: string): number | undefined {
  const indexMatch = message.match(/\bbulk_write op (\d+)\b/);
  if (!indexMatch) return undefined;
  const index = Number(indexMatch[1]);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

/** Issue #1440 — aggregate the pending origins of applied commands so the
 *  facade can prune them in one pass. `previewNewRows` is the preview-time
 *  `pendingNewRows` array; insert sources resolve their index against it so
 *  the report carries the row itself (see {@link AppliedPendingOps}). */
function collectAppliedSources(
  sources: ReadonlyArray<MqlCommandSource>,
  previewNewRows: ReadonlyArray<unknown[]>,
): AppliedPendingOps {
  const applied: AppliedPendingOps = {
    editKeys: [],
    deleteKeys: [],
    newRows: [],
  };
  for (const source of sources) {
    if (source.kind === "insert") {
      const row = previewNewRows[source.newRowIndex];
      if (row !== undefined) applied.newRows.push(row);
    } else if (source.kind === "update") {
      applied.editKeys.push(...source.editKeys);
    } else {
      applied.deleteKeys.push(source.deleteKey);
    }
  }
  return applied;
}

/** Build an RDB session directly from raw SQL strings. Used by the hook's
 *  `setSqlPreview` back-door (test seeding path); the adapter's own
 *  `preparePreview` calls this after generating the SQL list. */
export function buildRdbSession(
  sqls: string[],
  keys: ReadonlyArray<string | undefined>,
  deps: RdbAdapterDeps,
): RdbPreviewSession {
  const items: PreviewItem[] = sqls.map((sql, i) => {
    const { risk, reason } = classifyRdbRisk(
      sql,
      deps.safeModeGate,
      deps.dialect,
    );
    return { text: sql, risk, reason, key: keys[i] };
  });
  return {
    kind: "rdb",
    items,
    execute: () => executeRdbBatch(sqls, items, deps),
  };
}

async function executeRdbBatch(
  sqls: string[],
  items: PreviewItem[],
  deps: RdbAdapterDeps,
): Promise<BatchResult> {
  const startedAt = Date.now();
  const joinedSql = sqls.join(";\n");
  const count = sqls.length;
  try {
    const results = await deps.executeQueryBatch(
      deps.connectionId,
      sqls,
      `edit-${Date.now()}`,
      deps.expectedDatabase,
      // Issue #1112 — the datagrid commit runs only after the user reviews
      // and confirms the SQL preview dialog; forward the confirmation proof
      // so the backend Safe Mode gate accepts any destructive statement.
      true,
    );
    // #1441 P3-3 — cross-check the per-statement rows_affected against the
    // one-row-per-statement intent so a 0-row / partial write surfaces instead
    // of a plain success toast.
    const mismatch = detectBatchRowsAffectedMismatch(results);
    if (mismatch) {
      toast.warning(
        i18n.t("datagrid:commitFlow.rowsAffectedMismatch", mismatch),
      );
    } else {
      toast.success(i18n.t("datagrid:commitFlow.committed", { count }));
    }
    deps.history.recordSuccess({
      sql: joinedSql,
      startedAt,
      duration: Date.now() - startedAt,
    });
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : i18n.t("datagrid:commitFlow.failed");
    // Backend reports `"statement N of M failed"` (1-based). Map back to
    // the 0-based items index so the commitError banner can highlight
    // the right preview line. Falls back to 0 when the message shape
    // changes (defensive — the entire batch is rolled back either way).
    const indexMatch = message.match(/statement (\d+) of \d+ failed/);
    const failedIndex = indexMatch ? Math.max(0, Number(indexMatch[1]) - 1) : 0;
    const failedKey = items[failedIndex]?.key;
    toast.error(i18n.t("datagrid:commitFlow.rolledBack", { message }));
    deps.history.recordError({
      sql: joinedSql,
      startedAt,
      duration: Date.now() - startedAt,
    });
    return {
      ok: false,
      failedIndex,
      failedKey,
      errorMessage: i18n.t("datagrid:commitFlow.rolledBack", { message }),
    };
  }
}

export function rdbEditAdapter(deps: RdbAdapterDeps): ParadigmEditAdapter {
  return {
    preparePreview(input): PreparePreviewResult {
      const coerceErrors = new Map<string, string>();
      // #1441 P3-2 — set when any emitted statement reassigns a whole Postgres
      // ARRAY column; deduped into a single warning toast below.
      let arrayWholeReassign = false;
      const statements: GeneratedSqlStatement[] = generateSqlWithKeys(
        input.data,
        input.schema,
        input.table,
        input.pendingEdits,
        input.pendingDeletedRowKeys,
        input.pendingNewRows,
        {
          onCoerceError: (e: CoerceError) => {
            coerceErrors.set(e.key, e.message);
          },
          onArrayWholeReassign: () => {
            arrayWholeReassign = true;
          },
          // Sprint 347 — forward the dialect so JSON dispatch knows which
          // emit (jsonb_set / JSON_SET) to use. Undefined falls back to
          // postgresql inside the generator for Sprint 343/344 callers.
          dialect: deps.dialect,
          allowRowWrites: deps.canEditRows ?? true,
          // Issue #1081 — row-identity anchors for the WHERE clause.
          editRowSnapshots: input.pendingEditRowSnapshots,
          deletedRowSnapshots: input.pendingDeletedRowSnapshots,
        },
      );
      if (arrayWholeReassign) {
        toast.warning(i18n.t("datagrid:commitFlow.arrayReassignWarning"));
      }
      if (statements.length === 0) {
        return { session: null, coerceErrors };
      }
      const session = buildRdbSession(
        statements.map((s) => s.sql),
        statements.map((s) => s.key),
        deps,
      );
      return { session, coerceErrors };
    },
  };
}

/**
 * Sprint 326 — Slice I.1: per-command IPC roundtrip 을 단일
 * `bulk_write_documents` 호출로 묶는다. 동일 collection 내의 모든 op 가
 * 같은 (db, collection) 을 가짐을 generator 가 보장한다.
 */
async function dispatchMqlBatch(
  connectionId: string,
  commands: ReadonlyArray<MqlCommand>,
): Promise<void> {
  if (commands.length === 0) return;
  const first = commands[0]!;
  const ops = mqlCommandsToBulkOps(commands);
  await bulkWriteDocuments(connectionId, first.database, first.collection, ops);
}

export function documentEditAdapter(
  deps: DocumentAdapterDeps,
): ParadigmEditAdapter {
  return {
    preparePreview(input): PreparePreviewResult {
      const columns = input.data.columns.map((c) => ({
        name: c.name,
        data_type: c.data_type,
        is_primary_key: c.is_primary_key,
      }));
      const insertRecords: Record<string, unknown>[] = input.pendingNewRows.map(
        (row) => {
          const record: Record<string, unknown> = {};
          columns.forEach((col, idx) => {
            const value = (row as unknown[])[idx];
            if (value !== null && value !== undefined) {
              record[col.name] = value;
            }
          });
          return record;
        },
      );
      const mqlPreview = generateMqlPreview({
        database: input.schema,
        collection: input.table,
        columns,
        rows: input.data.rows,
        page: input.page,
        pendingEdits: input.pendingEdits,
        pendingDeletedRowKeys: input.pendingDeletedRowKeys,
        pendingNewRows: insertRecords,
        // Issue #1081 — row-identity anchors for the `_id` filter.
        editRowSnapshots: input.pendingEditRowSnapshots,
        deletedRowSnapshots: input.pendingDeletedRowSnapshots,
      });
      if (mqlPreview.commands.length === 0) {
        return { session: null, coerceErrors: new Map() };
      }
      // Mongo grid commits go straight to "safe" — Safe Mode gate is
      // currently RDB-only at this surface. `$out` / `$merge` /
      // collection-drop type commands flow through `useSafeModeGate`
      // at higher-level Mongo aggregate surfaces (Phase 23). When that
      // expands to grid commits, classify here per command.
      const items: PreviewItem[] = mqlPreview.previewLines.map((text) => ({
        text,
        risk: "safe",
      }));
      const commands = mqlPreview.commands;
      // Issue #1440 — resume cursor. Mongo bulk writes are ordered but
      // non-transactional: on a partial failure the ops before the failed
      // index are already applied. The cursor advances to the failed op so
      // an in-modal retry of the SAME session re-sends only the remainder,
      // never duplicating applied inserts/updates.
      let cursor = 0;
      const session: DocumentPreviewSession = {
        kind: "document",
        items,
        mqlPreview,
        execute: async () => {
          const startedAt = Date.now();
          const batchStart = cursor;
          const remaining = commands.slice(batchStart);
          const joinedMql = mqlPreview.previewLines
            .slice(batchStart)
            .join("\n");
          const count = remaining.length;
          try {
            await dispatchMqlBatch(deps.connectionId, remaining);
            toast.success(
              i18n.t("datagrid:commitFlow.committedDoc", { count }),
            );
            deps.history.recordSuccess({
              sql: joinedMql,
              startedAt,
              duration: Date.now() - startedAt,
            });
            return { ok: true };
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : typeof err === "string"
                  ? err
                  : i18n.t("datagrid:commitFlow.failedDoc");
            // The backend preserves ordered short-circuit position in
            // `bulk_write op N ...` errors (0-based within the dispatched
            // slice). Map back to the absolute items index for the banner.
            // PR #1483 review F1 — an index past the dispatched slice is a
            // garbled/stale message; claiming the whole remainder was applied
            // would prune never-applied ops (data loss). Treat it like an
            // unparseable error instead (keep-all fallback).
            const relativeIndex = parseMongoBulkWriteFailedIndex(message);
            const failedIndex =
              relativeIndex === undefined || relativeIndex >= remaining.length
                ? undefined
                : batchStart + relativeIndex;
            // Issue #1440 — ops in [batchStart, failedIndex) were applied by
            // the server. Report their pending origins so the facade prunes
            // them, tell the user how far the batch got, and advance the
            // resume cursor. An unparseable error (e.g. connection loss
            // before dispatch) prunes nothing — safe fallback.
            let appliedPending: AppliedPendingOps | undefined;
            if (failedIndex !== undefined) {
              if (failedIndex > batchStart) {
                appliedPending = collectAppliedSources(
                  mqlPreview.sources.slice(batchStart, failedIndex),
                  input.pendingNewRows,
                );
              }
              cursor = failedIndex;
            }
            const errorMessage = appliedPending
              ? i18n.t("datagrid:commitFlow.partialAppliedDoc", {
                  applied: failedIndex,
                  total: commands.length,
                  message,
                })
              : i18n.t("datagrid:commitFlow.commitFailedDoc", { message });
            toast.error(errorMessage);
            deps.history.recordError({
              sql: joinedMql,
              startedAt,
              duration: Date.now() - startedAt,
            });
            return { ok: false, failedIndex, errorMessage, appliedPending };
          }
        },
      };
      return { session, coerceErrors: new Map() };
    },
  };
}
