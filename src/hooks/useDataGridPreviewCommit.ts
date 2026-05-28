// Sub-hook for the preview / commit / Safe Mode handoff. Paradigm
// branching lives in `paradigmEditAdapter` (`lib/datagrid/`); this hook
// drives the Safe Mode dialog state machine and the commitError /
// pendingConfirm / commit-flash lifecycle. RDB and Document share the
// same body now — adapter `kind` is only consulted at the return
// boundary so the facade's legacy `sqlPreview` / `mqlPreview` fields
// stay populated for downstream UI components.
import { useCallback, useMemo, useState } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeGate } from "@/hooks/useSafeModeGate";
import { recordHistoryEntry } from "@lib/runtime/history/recordHistoryEntry";
// Sprint 354 (L2 fix, 2026-05-16) — `executeQueryBatch` lives in
// `@lib/tauri`; use namespace import so a test that stubs `@lib/tauri`
// with a partial surface doesn't fail at module-load time. The lookup
// is only reached on the RDB commit path; document commits never read
// `tauri.executeQueryBatch`.
import * as tauri from "@lib/tauri";
import { toast } from "@/lib/toast";
import {
  buildRdbSession,
  documentEditAdapter,
  rdbEditAdapter,
  type Paradigm,
  type PreviewSession,
  type RdbAdapterDeps,
  type DocumentAdapterDeps,
} from "@/lib/datagrid/paradigmEditAdapter";
import type { MqlPreview } from "@/lib/mongo/mqlGenerator";
import type { TableData } from "@/types/schema";
import type { CommitError } from "@/components/datagrid/dataGridEditFsm";
import type { SqlDialect } from "@/components/datagrid/sqlGenerator";

/** Sprint 347 — connection.dbType → sqlGenerator dialect tag. Redis /
 *  unsupported types fall through to undefined (the generator default). */
function dialectFromDbType(dbType: string | undefined): SqlDialect | undefined {
  if (dbType === "postgresql") return "postgresql";
  if (dbType === "mysql" || dbType === "mariadb") return "mysql";
  if (dbType === "sqlite") return "sqlite";
  return undefined;
}

export interface UseDataGridPreviewCommitParams {
  data: TableData | null;
  database: string;
  schema: string;
  table: string;
  connectionId: string;
  page: number;
  paradigm: Paradigm;
  fetchData: () => void;
  /** 읽기 전용 pending state — preview 생성 시 입력. */
  pendingEdits: Map<string, string | null>;
  pendingNewRows: unknown[][];
  pendingDeletedRowKeys: Set<string>;
  canEditRows?: boolean;
  /**
   * 성공 / discard 등에서 facade 가 보유한 모든 pending state 와
   * editing cell / selection 을 한 번에 비우는 cleanup. RDB / MQL 양쪽
   * 성공 분기에서 호출.
   */
  clearAllPending: () => void;
  /**
   * 커밋 시도 중 surface 한 cell-level coercion error map. preview 생성
   * 시 reset (adapter 가 채운 `coerceErrors`), batch 실패 시 실패
   * statement 의 key 에 한 entry 추가.
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
   * `true` when a preview opened. Drives the facade's decision to
   * dismiss the in-flight cell editor — when validation fails and
   * the preview never opens, the editor must stay so the user can
   * fix the value in place.
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
   * Called by the facade's discard path. Clears preview / commitError /
   * pendingConfirm in one shot, paradigm-agnostic.
   */
  resetPreviewState: () => void;
}

export function useDataGridPreviewCommit(
  params: UseDataGridPreviewCommitParams,
): UseDataGridPreviewCommitReturn {
  const {
    data,
    database,
    schema,
    table,
    connectionId,
    page,
    paradigm,
    fetchData,
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    canEditRows = true,
    clearAllPending,
    setPendingEditErrors,
    beginCommitFlash,
  } = params;

  // Sprint 354 (L2 fix) — schemaStore.executeQueryBatch was a thin
  // pass-through (no cache write); reach for `@lib/tauri` directly. The
  // namespace `tauri.executeQueryBatch` access is wrapped in a closure
  // so vitest mocks that stub `@lib/tauri` with a partial surface (e.g.
  // DocumentDataGrid tests that only need `findDocuments`) don't trip
  // the "no export defined" guard at hook-mount time — the lookup is
  // only reached on the RDB commit branch which already requires the
  // mock to provide `executeQueryBatch`.
  const executeQueryBatch = useCallback(
    (...args: Parameters<typeof tauri.executeQueryBatch>) =>
      tauri.executeQueryBatch(...args),
    [],
  );
  // sprint-373 (2026-05-17) — `addHistoryEntry` (in-memory) retired.
  // `recordHistoryEntry` 가 backend wire shape + disable gate 를 책임.
  // RDB / Mongo / DDL editors share one decision matrix via `useSafeModeGate`.
  const safeModeGate = useSafeModeGate(connectionId);
  // Sprint 347 — derive SQL dialect from the connection's dbType so the
  // generator can dispatch jsonb_set vs JSON_SET correctly.
  const dialect = useConnectionStore((s) => {
    const conn = s.connections.find((c) => c.id === connectionId);
    return dialectFromDbType(conn?.dbType);
  });

  // Paradigm-keyed adapter. Selection happens here exactly once per
  // dep change — the hook body never branches on `paradigm` again.
  const adapter = useMemo(() => {
    if (paradigm === "document") {
      const deps: DocumentAdapterDeps = {
        connectionId,
        history: {
          recordSuccess: ({ sql, startedAt, duration }) =>
            recordHistoryEntry({
              sql,
              executedAt: startedAt,
              duration,
              status: "success",
              connectionId,
              paradigm: "document",
              queryMode: "find",
              database: schema,
              collection: table,
              source: "grid-edit",
            }),
          recordError: ({ sql, startedAt, duration }) =>
            recordHistoryEntry({
              sql,
              executedAt: startedAt,
              duration,
              status: "error",
              connectionId,
              paradigm: "document",
              queryMode: "find",
              database: schema,
              collection: table,
              source: "grid-edit",
            }),
        },
      };
      return documentEditAdapter(deps);
    }
    const deps: RdbAdapterDeps = {
      connectionId,
      expectedDatabase: database || undefined,
      safeModeGate,
      executeQueryBatch,
      dialect,
      canEditRows,
      history: {
        recordSuccess: ({ sql, startedAt, duration }) =>
          recordHistoryEntry({
            sql,
            executedAt: startedAt,
            duration,
            status: "success",
            connectionId,
            paradigm: "rdb",
            queryMode: "sql",
            database,
            source: "grid-edit",
          }),
        recordError: ({ sql, startedAt, duration }) =>
          recordHistoryEntry({
            sql,
            executedAt: startedAt,
            duration,
            status: "error",
            connectionId,
            paradigm: "rdb",
            queryMode: "sql",
            database,
            source: "grid-edit",
          }),
      },
    };
    return rdbEditAdapter(deps);
  }, [
    paradigm,
    connectionId,
    database,
    schema,
    table,
    safeModeGate,
    executeQueryBatch,
    dialect,
    canEditRows,
  ]);

  const [session, setSession] = useState<PreviewSession | null>(null);
  const [commitError, setCommitError] = useState<CommitError | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    reason: string;
    sql: string;
    statementIndex: number;
  } | null>(null);

  // Back-door for tests that seed `sqlPreview` with raw SQL strings
  // (useDataGridEdit.safe-mode.test.ts etc.). Synthesizes an RDB session
  // with the same Safe Mode risk-classification path that
  // `rdbEditAdapter` uses, so `handleExecuteCommit` behaves identically
  // whether the session came from `handleCommit` or this setter.
  const setSqlPreviewExposed = useCallback(
    (v: string[] | null) => {
      if (v === null) {
        setSession(null);
        setCommitError(null);
        return;
      }
      if (!canEditRows) return;
      const deps: RdbAdapterDeps = {
        connectionId,
        expectedDatabase: database || undefined,
        safeModeGate,
        executeQueryBatch,
        dialect,
        canEditRows,
        history: {
          recordSuccess: ({ sql, startedAt, duration }) =>
            recordHistoryEntry({
              sql,
              executedAt: startedAt,
              duration,
              status: "success",
              connectionId,
              paradigm: "rdb",
              queryMode: "sql",
              database,
              source: "grid-edit",
            }),
          recordError: ({ sql, startedAt, duration }) =>
            recordHistoryEntry({
              sql,
              executedAt: startedAt,
              duration,
              status: "error",
              connectionId,
              paradigm: "rdb",
              queryMode: "sql",
              database,
              source: "grid-edit",
            }),
        },
      };
      const synth = buildRdbSession(
        v,
        v.map(() => undefined),
        deps,
      );
      setSession(synth);
      setCommitError(null);
    },
    [
      connectionId,
      database,
      safeModeGate,
      executeQueryBatch,
      dialect,
      canEditRows,
    ],
  );

  // `setMqlPreview(null)` dismisses the preview dialog. Non-null sets
  // are not used by any caller (only tests do that for RDB via
  // `setSqlPreview`), so the back-door is RDB-only.
  const setMqlPreview = useCallback((v: MqlPreview | null) => {
    if (v === null) {
      setSession(null);
      setCommitError(null);
    }
    // Non-null branch intentionally no-op — `handleCommit` is the only
    // legitimate producer of a document session.
  }, []);

  const runExecution = useCallback(
    async (sess: PreviewSession) => {
      const result = await sess.execute();
      if (result.ok) {
        setSession(null);
        setCommitError(null);
        clearAllPending();
        fetchData();
        return;
      }
      // Failure: keep the preview visible so the user can see what was
      // attempted. RDB adapters surface `failedKey` + `failedIndex` from
      // the backend's `"statement N of M failed"` error; Mongo leaves
      // both undefined and the banner falls back to the first item.
      const failedIndex = result.failedIndex ?? 0;
      const failedItem = sess.items[failedIndex];
      setCommitError({
        statementIndex: failedIndex,
        statementCount: sess.items.length,
        sql: failedItem?.text ?? "",
        message: result.errorMessage ?? "Commit failed.",
        failedKey: result.failedKey,
      });
      if (result.failedKey) {
        const key = result.failedKey;
        setPendingEditErrors((prev) => {
          const next = new Map(prev);
          next.set(key, result.errorMessage ?? "Commit failed.");
          return next;
        });
      }
    },
    [clearAllPending, fetchData, setPendingEditErrors],
  );

  const handleCommit = useCallback(
    (overrides?: HandleCommitOverrides): HandleCommitResult => {
      if (!data) return { opened: false };
      if (!canEditRows) return { opened: false };
      // Always begin the flash; the 400ms safety guard caps it for the
      // empty-preview / no-op branches that never resolve a commit.
      beginCommitFlash();
      const effectivePendingEdits =
        overrides?.pendingEditsOverride ?? pendingEdits;
      const { session: newSession, coerceErrors } = adapter.preparePreview({
        data,
        schema,
        table,
        page,
        pendingEdits: effectivePendingEdits,
        pendingNewRows,
        pendingDeletedRowKeys,
      });
      // Adapter always reports coerce errors regardless of whether the
      // preview opens — pure-error edits surface inline next to the cell
      // even when no statements are emitted.
      setPendingEditErrors(coerceErrors);
      if (newSession === null) return { opened: false };
      setSession(newSession);
      setCommitError(null);
      return { opened: true };
    },
    [
      data,
      adapter,
      pendingEdits,
      pendingDeletedRowKeys,
      pendingNewRows,
      schema,
      table,
      page,
      canEditRows,
      beginCommitFlash,
      setPendingEditErrors,
    ],
  );

  const handleExecuteCommit = useCallback(async () => {
    if (!session) return;
    // Per-item Safe Mode gate: destructive → commitError + early return,
    // warn → pendingConfirm + early return. Walk in order so the first
    // failing item wins; subsequent items are not analysed until the
    // user resolves the dialog.
    for (let i = 0; i < session.items.length; i++) {
      const item = session.items[i];
      if (!item) continue;
      if (item.risk === "destructive") {
        const reason = item.reason ?? "Blocked by Safe Mode";
        setCommitError({
          statementIndex: i,
          statementCount: session.items.length,
          sql: item.text,
          message: reason,
          failedKey: item.key,
        });
        return;
      }
      if (item.risk === "warn") {
        setPendingConfirm({
          reason: item.reason ?? "Confirmation required",
          sql: item.text,
          statementIndex: i,
        });
        return;
      }
    }
    await runExecution(session);
  }, [session, runExecution]);

  // Warn-tier handoff. `confirmDangerous` runs the session unconditionally
  // (re-uses the same closure built at preview time); `cancelDangerous`
  // surfaces a warn-tier `commitError` so the user knows why nothing
  // happened.
  const confirmDangerous = useCallback(async () => {
    if (!pendingConfirm) return;
    setPendingConfirm(null);
    if (!session) return;
    await runExecution(session);
  }, [pendingConfirm, session, runExecution]);

  const cancelDangerous = useCallback(() => {
    if (!pendingConfirm) return;
    const statementCount = session?.items.length ?? 0;
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
  }, [pendingConfirm, session]);

  const resetPreviewState = useCallback(() => {
    setSession(null);
    setCommitError(null);
    setPendingConfirm(null);
  }, []);

  // Legacy paradigm-specific surface, derived from the unified session.
  // `DataGrid.tsx` (RDB) reads `sqlPreview`; `DocumentDataGrid.tsx` reads
  // `mqlPreview.errors` / `.previewLines`. Both ignore the other paradigm
  // so this discriminator is harmless.
  const sqlPreview =
    session?.kind === "rdb" ? session.items.map((i) => i.text) : null;
  const mqlPreview = session?.kind === "document" ? session.mqlPreview : null;

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
