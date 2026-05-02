// AC-193-03 — preview / commit / Safe Mode handoff 책임을 useDataGridEdit
// 에서 분리한 sub-hook. paradigm 분기 (RDB SQL preview ↔ Mongo MQL
// preview) + executeQueryBatch / dispatchMqlCommand executor + Safe
// Mode gate (`useSafeModeGate`) consume + warn-tier confirmDangerous /
// cancelDangerous + commitError 라이프사이클을 한 책임으로 묶는다.
//
// hook 내부에서 zustand stores (schemaStore.executeQueryBatch /
// useSafeModeGate(connectionId)) 를 직접 consume — facade 가 같은 의존
// 성을 두 번 wiring 할 필요가 없게 함. 외부로는 cell editing / pending
// state 와 cleanup 만 협력 인자로 받는다.
//
// 본 hook 의 신규 단위 테스트는 0건 — 기존 12 test files / 118 cases
// (useDataGridEdit.*.test.ts) 가 paradigm 분기 + Safe Mode + commitError
// 의 cross-cutting 회귀 가드로 충분하다 (Sprint 193 contract AC-193-03).
// date 2026-05-02.
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
   * Sprint 98 commit flash 진입 helper. handleCommit 의 토대 분기
   * 진입 직후 호출 — 본 hook 이 useCommitFlash 를 직접 import 하지
   * 않는다 (facade 가 두 hook 을 묶어 동일 toolbar 가시화 동작 유지).
   */
  beginCommitFlash: () => void;
}

export interface HandleCommitOverrides {
  /**
   * Cmd+S 단축키가 in-flight cell editor 를 보유한 채로 호출될 때 사용.
   * facade 의 handler 가 editValue 를 pendingEdits 에 미리 merge 한 map 을
   * 직접 전달 — useState 비동기 batch 를 우회해 같은 tick 에 정확한
   * pending 으로 SQL 생성을 한다.
   */
  pendingEditsOverride?: Map<string, string | null>;
}

export interface HandleCommitResult {
  /**
   * RDB SQL preview 가 열렸거나 MQL preview 가 set 됐는지 여부. facade 의
   * commit-changes handler 가 in-flight cell 을 dismiss 할지 결정 —
   * 검증 실패로 preview 가 안 열린 경우 사용자가 cell 안에서 값을
   * 고칠 수 있게 editor 를 유지.
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
   * facade 의 handleDiscard 가 호출 — preview / statements / commitError /
   * pendingConfirm 4개 state 를 한 번에 reset. paradigm 무관 모두 비움.
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
  // Sprint 189 (AC-189-01) — Safe Mode gate. RDB / Mongo / DDL editors
  // 가 같은 decision matrix (`decideSafeModeAction`) 를 공유.
  const safeModeGate = useSafeModeGate(connectionId);

  const [sqlPreview, setSqlPreview] = useState<string[] | null>(null);
  // Sprint 93 — keyed statements (sqlPreview 와 lockstep). handleExecute
  // Commit 이 실패 statementIndex 를 pending edit cell key 로 매핑.
  const [sqlPreviewStatements, setSqlPreviewStatements] = useState<
    GeneratedSqlStatement[] | null
  >(null);
  const [commitError, setCommitError] = useState<CommitError | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    reason: string;
    sql: string;
    statementIndex: number;
  } | null>(null);
  // Sprint 86 — paradigm-document MQL preview state. RDB grid 에서는 항상
  // null 이며 hasPendingChanges 의 OR 조건에 참여한다.
  const [mqlPreview, setMqlPreview] = useState<MqlPreview | null>(null);

  // Sprint 93 — wrapped setter exposed to consumers. preview modal dismiss
  // 시 (`null`) keyed statements 와 commitError 도 함께 비워 다음 open
  // 이 깨끗하게 시작.
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
      // Sprint 98 — flash 진입. 토대 분기 (document early-return / no-op
      // RDB) 도 spinner 가 stick 되지 않도록 400ms safety 가 보호.
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
        // MQL path 는 row-level errors 를 preview 자체에 기록 — facade 의
        // pendingEditErrors 는 RDB 경로 전용이므로 여기서 reset.
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

  // Sprint 186 — runRdbBatch 는 try/catch + cleanup 를 한 곳에 두기 위해
  // handleExecuteCommit / confirmDangerous 가 공유.
  const runRdbBatch = useCallback(
    async (statements: GeneratedSqlStatement[], statementCount: number) => {
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
      }
    },
    [
      executeQueryBatch,
      connectionId,
      fetchData,
      clearAllPending,
      setPendingEditErrors,
    ],
  );

  const handleExecuteCommit = useCallback(async () => {
    if (paradigm === "document") {
      if (!mqlPreview || mqlPreview.commands.length === 0) return;
      const docCount = mqlPreview.commands.length;
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
      } catch (err) {
        // Sprint 94 — MQL branch 의 catch 는 commitError 까지 wiring 되지
        // 않았으나 toast 로 surface 해 catch-audit (sprint-88) 의 빈
        // catch 금지 규칙을 만족.
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Failed to commit document changes.";
        toast.error(`Commit failed: ${message}`);
      }
      return;
    }
    if (!sqlPreview) return;
    const statements: GeneratedSqlStatement[] =
      sqlPreviewStatements ?? sqlPreview.map((sql) => ({ sql }));
    const statementCount = statements.length;
    // Sprint 189 (AC-189-01) — per-statement Safe Mode gate. block →
    // commitError 로 surface, confirm → pendingConfirm 으로 warn-tier
    // dialog 띄움.
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
  ]);

  // Sprint 186 — warn-tier handoff. confirmDangerous 는 현재 sqlPreview /
  // statements 로부터 batch 재구성 후 무조건 실행. cancelDangerous 는
  // commitError 를 warn-tier 메시지로 set 해 사용자가 왜 아무 일도
  // 안 일어났는지 알 수 있게 한다.
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
