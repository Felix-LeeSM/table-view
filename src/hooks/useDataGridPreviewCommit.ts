// Sub-hook for the preview / commit / Safe Mode handoff. Owns paradigm
// branching (RDB SQL preview ↔ Mongo MQL preview), the
// executeQueryBatch / dispatchMqlCommand executors, the
// `useSafeModeGate` consumer, and the warn-tier confirmDangerous /
// cancelDangerous + commitError lifecycle.
//
// The hook consumes its zustand deps directly (schemaStore +
// useSafeModeGate); the facade wires only cell editing / pending state
// and the cleanup callback so deps aren't doubly-wired.
import { useCallback, useState } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import { analyzeStatement } from "@/lib/sql/sqlSafety";
import { useSafeModeGate } from "@/hooks/useSafeModeGate";
import {
  generateSqlWithKeys,
  type CoerceError,
  type GeneratedSqlStatement,
} from "@/components/datagrid/sqlGenerator";
import {
  generateMqlPreview,
  type MqlCommand,
  type MqlPreview,
} from "@/lib/mongo/mqlGenerator";
import { insertDocument, updateDocument, deleteDocument } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import type { TableData } from "@/types/schema";
import type { CommitError } from "@/components/datagrid/useDataGridEdit";

export interface UseDataGridPreviewCommitParams {
  data: TableData | null;
  schema: string;
  table: string;
  connectionId: string;
  page: number;
  paradigm: "rdb" | "document" | "search" | "kv";
  fetchData: () => void;
  /** 읽기 전용 pending state — preview 생성 시 입력. */
  pendingEdits: Map<string, string | null>;
  pendingNewRows: unknown[][];
  pendingDeletedRowKeys: Set<string>;
  /**
   * 성공 / discard 등에서 facade 가 보유한 모든 pending state 와
   * editing cell / selection 을 한 번에 비우는 cleanup. RDB / MQL 양쪽
   * 성공 분기에서 호출.
   */
  clearAllPending: () => void;
  /**
   * 커밋 시도 중 surface 한 cell-level coercion error map. hook 이
   * commit 시 reset (RDB: nextErrors / MQL: empty) 하고, batch 실패 시
   * 실패 statement 의 key 에 한 entry 추가.
   */
  setPendingEditErrors: React.Dispatch<
    React.SetStateAction<Map<string, string>>
  >;
  /**
   * Commit-flash entry helper, called immediately on every handleCommit
   * branch. The hook intentionally doesn't import `useCommitFlash` —
   * the facade composes both hooks so toolbar visualisation stays in
   * one place.
   */
  beginCommitFlash: () => void;
}

export interface HandleCommitOverrides {
  /**
   * Used when Cmd+S fires with an in-flight cell editor. The facade
   * pre-merges editValue into pendingEdits and passes the resulting
   * map directly so SQL generation sees the active edit on the same
   * tick — bypasses React's async setState batching.
   */
  pendingEditsOverride?: Map<string, string | null>;
}

export interface HandleCommitResult {
  /**
   * `true` when an SQL or MQL preview opened. Drives the facade's
   * decision to dismiss the in-flight cell editor — when validation
   * fails and the preview never opens, the editor must stay so the
   * user can fix the value in place.
   */
  opened: boolean;
}

export interface UseDataGridPreviewCommitReturn {
  sqlPreview: string[] | null;
  setSqlPreview: (v: string[] | null) => void;
  mqlPreview: MqlPreview | null;
  setMqlPreview: (v: MqlPreview | null) => void;
  commitError: CommitError | null;
  setCommitError: (v: CommitError | null) => void;
  pendingConfirm: {
    reason: string;
    sql: string;
    statementIndex: number;
  } | null;
  handleCommit: (overrides?: HandleCommitOverrides) => HandleCommitResult;
  handleExecuteCommit: () => Promise<void>;
  confirmDangerous: () => Promise<void>;
  cancelDangerous: () => void;
  /**
   * Called by the facade's discard path. Clears preview / statements /
   * commitError / pendingConfirm in one shot, paradigm-agnostic.
   */
  resetPreviewState: () => void;
}

export function useDataGridPreviewCommit(
  params: UseDataGridPreviewCommitParams,
): UseDataGridPreviewCommitReturn {
  const {
    data,
    schema,
    table,
    connectionId,
    page,
    paradigm,
    fetchData,
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    clearAllPending,
    setPendingEditErrors,
    beginCommitFlash,
  } = params;

  const executeQueryBatch = useSchemaStore((s) => s.executeQueryBatch);
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);
  // RDB / Mongo / DDL editors share one decision matrix via `useSafeModeGate`.
  const safeModeGate = useSafeModeGate(connectionId);

  const [sqlPreview, setSqlPreview] = useState<string[] | null>(null);
  // Keyed statements (lockstep with `sqlPreview`). `handleExecuteCommit`
  // maps a failing `statementIndex` back to the pending-edit cell key.
  const [sqlPreviewStatements, setSqlPreviewStatements] = useState<
    GeneratedSqlStatement[] | null
  >(null);
  const [commitError, setCommitError] = useState<CommitError | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    reason: string;
    sql: string;
    statementIndex: number;
  } | null>(null);
  // Document-paradigm MQL preview. Always null on RDB grids; participates
  // in the `hasPendingChanges` OR.
  const [mqlPreview, setMqlPreview] = useState<MqlPreview | null>(null);

  // Wrapped setter — clearing the preview also clears keyed statements
  // and commitError so the next open starts fresh.
  const setSqlPreviewExposed = useCallback((v: string[] | null) => {
    setSqlPreview(v);
    if (v === null) {
      setSqlPreviewStatements(null);
      setCommitError(null);
    }
  }, []);

  const handleCommit = useCallback(
    (overrides?: HandleCommitOverrides): HandleCommitResult => {
      if (!data) return { opened: false };
      // Always begin the flash; the 400ms safety guard caps it for the
      // document early-return / no-op RDB branches that never resolve a
      // commit.
      beginCommitFlash();
      const effectivePendingEdits =
        overrides?.pendingEditsOverride ?? pendingEdits;
      if (paradigm === "document") {
        const columns = data.columns.map((c) => ({
          name: c.name,
          data_type: c.data_type,
          is_primary_key: c.is_primary_key,
        }));
        const insertRecords: Record<string, unknown>[] = pendingNewRows.map(
          (row) => {
            const record: Record<string, unknown> = {};
            columns.forEach((col, idx) => {
              const value = row[idx];
              if (value !== null && value !== undefined) {
                record[col.name] = value;
              }
            });
            return record;
          },
        );
        const preview = generateMqlPreview({
          database: schema,
          collection: table,
          columns,
          rows: data.rows,
          page,
          pendingEdits: effectivePendingEdits,
          pendingDeletedRowKeys,
          pendingNewRows: insertRecords,
        });
        // The MQL path records row-level errors on the preview itself;
        // the RDB-only `pendingEditErrors` map must be reset here.
        setPendingEditErrors(new Map());
        if (preview.commands.length === 0) return { opened: false };
        setMqlPreview(preview);
        return { opened: true };
      }
      const nextErrors = new Map<string, string>();
      const keyedStatements = generateSqlWithKeys(
        data,
        schema,
        table,
        effectivePendingEdits,
        pendingDeletedRowKeys,
        pendingNewRows,
        {
          onCoerceError: (err: CoerceError) => {
            nextErrors.set(err.key, err.message);
          },
        },
      );
      setPendingEditErrors(nextErrors);
      if (keyedStatements.length === 0) return { opened: false };
      setSqlPreview(keyedStatements.map((s) => s.sql));
      setSqlPreviewStatements(keyedStatements);
      setCommitError(null);
      return { opened: true };
    },
    [
      data,
      pendingEdits,
      pendingDeletedRowKeys,
      pendingNewRows,
      schema,
      table,
      paradigm,
      page,
      beginCommitFlash,
      setPendingEditErrors,
    ],
  );

  const dispatchMqlCommand = useCallback(
    async (cmd: MqlCommand): Promise<void> => {
      switch (cmd.kind) {
        case "insertOne":
          await insertDocument(
            connectionId,
            cmd.database,
            cmd.collection,
            cmd.document,
          );
          return;
        case "updateOne":
          await updateDocument(
            connectionId,
            cmd.database,
            cmd.collection,
            cmd.documentId,
            cmd.patch,
          );
          return;
        case "deleteOne":
          await deleteDocument(
            connectionId,
            cmd.database,
            cmd.collection,
            cmd.documentId,
          );
          return;
        default: {
          const never: never = cmd;
          return never;
        }
      }
    },
    [connectionId],
  );

  // Shared by `handleExecuteCommit` and `confirmDangerous` so try/catch
  // + cleanup live in one place.
  const runRdbBatch = useCallback(
    async (statements: GeneratedSqlStatement[], statementCount: number) => {
      const startedAt = Date.now();
      const joinedSql = statements.map((s) => s.sql).join(";\n");
      try {
        await executeQueryBatch(
          connectionId,
          statements.map((s) => s.sql),
          `edit-${Date.now()}`,
        );
        setSqlPreview(null);
        setSqlPreviewStatements(null);
        setCommitError(null);
        clearAllPending();
        fetchData();
        toast.success(
          `${statementCount} ${statementCount === 1 ? "change" : "changes"} committed.`,
        );
        // RDB grid-commit history. Mongo commits record from the
        // document branch in `handleExecuteCommit`.
        addHistoryEntry({
          sql: joinedSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "success",
          connectionId,
          paradigm: "rdb",
          queryMode: "sql",
          source: "grid-edit",
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Failed to commit changes.";
        const indexMatch = message.match(/statement (\d+) of \d+ failed/);
        const failedIndex = indexMatch
          ? Math.max(0, Number(indexMatch[1]) - 1)
          : 0;
        const failedStmt = statements[failedIndex] ?? statements[0];
        setCommitError({
          statementIndex: failedIndex,
          statementCount,
          sql: failedStmt?.sql ?? "",
          message: `Commit failed — all changes rolled back: ${message}`,
          failedKey: failedStmt?.key,
        });
        if (failedStmt?.key) {
          setPendingEditErrors((prev) => {
            const next = new Map(prev);
            next.set(failedStmt.key!, message);
            return next;
          });
        }
        toast.error(`Commit failed — all changes rolled back: ${message}`);
        addHistoryEntry({
          sql: joinedSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "error",
          connectionId,
          paradigm: "rdb",
          queryMode: "sql",
          source: "grid-edit",
        });
      }
    },
    [
      executeQueryBatch,
      connectionId,
      fetchData,
      clearAllPending,
      setPendingEditErrors,
      addHistoryEntry,
    ],
  );

  const handleExecuteCommit = useCallback(async () => {
    if (paradigm === "document") {
      if (!mqlPreview || mqlPreview.commands.length === 0) return;
      const docCount = mqlPreview.commands.length;
      const startedAt = Date.now();
      // History row needs a single string; collapse the human-readable
      // per-command preview lines.
      const joinedMql = mqlPreview.previewLines.join("\n");
      try {
        for (const cmd of mqlPreview.commands) {
          await dispatchMqlCommand(cmd);
        }
        setMqlPreview(null);
        clearAllPending();
        fetchData();
        toast.success(
          `${docCount} document ${docCount === 1 ? "change" : "changes"} committed.`,
        );
        addHistoryEntry({
          sql: joinedMql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "success",
          connectionId,
          paradigm: "document",
          queryMode: "find",
          // `data?.` plumbing: schema / table prop on this hook is repurposed
          // for Mongo as `database` / `collection`. The cell-edit hook contract
          // already passes the Mongo db/collection through these slots.
          database: schema,
          collection: table,
          source: "grid-edit",
        });
      } catch (err) {
        // The MQL branch surfaces the failure via toast — `commitError`
        // is RDB-only — so the user still sees what went wrong.
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Failed to commit document changes.";
        toast.error(`Commit failed: ${message}`);
        addHistoryEntry({
          sql: joinedMql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "error",
          connectionId,
          paradigm: "document",
          queryMode: "find",
          database: schema,
          collection: table,
          source: "grid-edit",
        });
      }
      return;
    }
    if (!sqlPreview) return;
    const statements: GeneratedSqlStatement[] =
      sqlPreviewStatements ?? sqlPreview.map((sql) => ({ sql }));
    const statementCount = statements.length;
    // Per-statement Safe Mode gate: block → `commitError`,
    // confirm → `pendingConfirm` (warn-tier dialog).
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt) continue;
      const analysis = analyzeStatement(stmt.sql);
      const decision = safeModeGate.decide(analysis);
      if (decision.action === "block") {
        setCommitError({
          statementIndex: i,
          statementCount,
          sql: stmt.sql,
          message: decision.reason,
          failedKey: stmt.key,
        });
        toast.error(decision.reason);
        return;
      }
      if (decision.action === "confirm") {
        setPendingConfirm({
          reason: decision.reason,
          sql: stmt.sql,
          statementIndex: i,
        });
        return;
      }
    }
    await runRdbBatch(statements, statementCount);
  }, [
    sqlPreview,
    sqlPreviewStatements,
    mqlPreview,
    paradigm,
    dispatchMqlCommand,
    fetchData,
    safeModeGate,
    runRdbBatch,
    clearAllPending,
    addHistoryEntry,
    connectionId,
    schema,
    table,
  ]);

  // Warn-tier handoff. `confirmDangerous` rebuilds the batch from the
  // current preview and runs unconditionally; `cancelDangerous` sets a
  // warn-tier `commitError` so the user knows why nothing happened.
  const confirmDangerous = useCallback(async () => {
    if (!pendingConfirm) return;
    setPendingConfirm(null);
    if (!sqlPreview) return;
    const statements: GeneratedSqlStatement[] =
      sqlPreviewStatements ?? sqlPreview.map((sql) => ({ sql }));
    await runRdbBatch(statements, statements.length);
  }, [pendingConfirm, sqlPreview, sqlPreviewStatements, runRdbBatch]);

  const cancelDangerous = useCallback(() => {
    if (!pendingConfirm) return;
    const statementCount =
      sqlPreviewStatements?.length ?? sqlPreview?.length ?? 0;
    const message =
      "Safe Mode (warn): confirmation cancelled — no changes committed";
    setCommitError({
      statementIndex: pendingConfirm.statementIndex,
      statementCount,
      sql: pendingConfirm.sql,
      message,
      failedKey: undefined,
    });
    setPendingConfirm(null);
    toast.info(message);
  }, [pendingConfirm, sqlPreview, sqlPreviewStatements]);

  const resetPreviewState = useCallback(() => {
    setMqlPreview(null);
    setSqlPreviewStatements(null);
    setCommitError(null);
    setPendingConfirm(null);
  }, []);

  return {
    sqlPreview,
    setSqlPreview: setSqlPreviewExposed,
    mqlPreview,
    setMqlPreview,
    commitError,
    setCommitError,
    pendingConfirm,
    handleCommit,
    handleExecuteCommit,
    confirmDangerous,
    cancelDangerous,
    resetPreviewState,
  };
}
