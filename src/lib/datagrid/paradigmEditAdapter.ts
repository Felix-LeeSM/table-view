import {
  generateSqlWithKeys,
  type CoerceError,
  type GeneratedSqlStatement,
  type SqlDialect,
} from "@/components/datagrid/sqlGenerator";
import {
  generateMqlPreview,
  type MqlCommand,
  type MqlPreview,
} from "@/lib/mongo/mqlGenerator";
import {
  analyzeRdbStatementForDialect,
  decideOracleOrGenericSafeMode,
} from "@/lib/sql/oracleSafety";
import { bulkWriteDocuments } from "@/lib/tauri";
import { mqlCommandsToBulkOps } from "@/lib/mongo/mqlToBulk";
import { toast } from "@/lib/runtime/toast";
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

export interface BatchResult {
  ok: boolean;
  /** 0-based index into `session.items` of the failing item. */
  failedIndex?: number;
  failedKey?: string;
  errorMessage?: string;
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

const MONGO_ORDERED_BULK_WRITE_PARTIAL_COMMIT_WARNING =
  "MongoDB bulk writes are ordered but not transactional in this app. " +
  "If a later command fails, earlier document writes may already be committed; " +
  "pending edits stay available for retry.";

function parseMongoBulkWriteFailedIndex(message: string): number | undefined {
  const indexMatch = message.match(/\bbulk_write op (\d+)\b/);
  if (!indexMatch) return undefined;
  const index = Number(indexMatch[1]);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
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
    await deps.executeQueryBatch(
      deps.connectionId,
      sqls,
      `edit-${Date.now()}`,
      deps.expectedDatabase,
    );
    toast.success(`${count} ${count === 1 ? "change" : "changes"} committed.`);
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
          : "Failed to commit changes.";
    // Backend reports `"statement N of M failed"` (1-based). Map back to
    // the 0-based items index so the commitError banner can highlight
    // the right preview line. Falls back to 0 when the message shape
    // changes (defensive — the entire batch is rolled back either way).
    const indexMatch = message.match(/statement (\d+) of \d+ failed/);
    const failedIndex = indexMatch ? Math.max(0, Number(indexMatch[1]) - 1) : 0;
    const failedKey = items[failedIndex]?.key;
    toast.error(`Commit failed — all changes rolled back: ${message}`);
    deps.history.recordError({
      sql: joinedSql,
      startedAt,
      duration: Date.now() - startedAt,
    });
    return {
      ok: false,
      failedIndex,
      failedKey,
      errorMessage: `Commit failed — all changes rolled back: ${message}`,
    };
  }
}

export function rdbEditAdapter(deps: RdbAdapterDeps): ParadigmEditAdapter {
  return {
    preparePreview(input): PreparePreviewResult {
      const coerceErrors = new Map<string, string>();
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
          // Sprint 347 — forward the dialect so JSON dispatch knows which
          // emit (jsonb_set / JSON_SET) to use. Undefined falls back to
          // postgresql inside the generator for Sprint 343/344 callers.
          dialect: deps.dialect,
          allowRowWrites: deps.canEditRows ?? true,
        },
      );
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
      const session: DocumentPreviewSession = {
        kind: "document",
        items,
        mqlPreview,
        execute: async () => {
          const startedAt = Date.now();
          const joinedMql = mqlPreview.previewLines.join("\n");
          const count = commands.length;
          try {
            await dispatchMqlBatch(deps.connectionId, commands);
            toast.success(
              `${count} document ${count === 1 ? "change" : "changes"} committed.`,
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
                  : "Failed to commit document changes.";
            const failedIndex = parseMongoBulkWriteFailedIndex(message);
            const errorMessage = `Commit failed. ${MONGO_ORDERED_BULK_WRITE_PARTIAL_COMMIT_WARNING} ${message}`;
            toast.error(errorMessage);
            deps.history.recordError({
              sql: joinedMql,
              startedAt,
              duration: Date.now() - startedAt,
            });
            // The backend preserves ordered short-circuit position in
            // `bulk_write op N ...` errors. Surface it when present so the
            // preview banner highlights the failed MQL line without implying
            // that earlier document writes rolled back.
            return { ok: false, failedIndex, errorMessage };
          }
        },
      };
      return { session, coerceErrors: new Map() };
    },
  };
}
