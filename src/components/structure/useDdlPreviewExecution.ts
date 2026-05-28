import { useCallback, useRef, useState } from "react";
import { analyzeStatement } from "@/lib/sql/sqlSafety";
import { useSafeModeGate } from "@/hooks/useSafeModeGate";
import { recordHistoryEntry } from "@lib/runtime/history/recordHistoryEntry";
import { parseDbMismatch } from "@lib/api/dbMismatch";
import { syncMismatchedActiveDb } from "@lib/runtime/recovery/syncMismatchedActiveDb";
import { toast } from "@lib/toast";

/**
 * Shared DDL preview/execute lifecycle for the Structure-surface editors
 * (ColumnsEditor / IndexesEditor / ConstraintsEditor). Lifecycle:
 *
 *   1. fetch preview SQL via a Tauri `*_preview_only=true` call.
 *   2. on Execute, split `previewSql` on `";"`, walk each statement
 *      through `analyzeStatement` + `useSafeModeGate.decide`, and branch
 *      on strict / warn / safe.
 *   3. warn-tier surfaces a `ConfirmDestructiveDialog`; the user clicks
 *      Confirm (or hits Enter) and the same commit closure runs.
 *   4. commit (`*_preview_only=false`) records a
 *      `useQueryHistoryStore.addHistoryEntry` entry tagged
 *      `source: "ddl-structure"`, then triggers `onRefresh()`.
 *   5. cancel inside the warn dialog surfaces the canonical message
 *      `"Safe Mode (warn): confirmation cancelled — no changes
 *      committed"` via `previewError` (no toast).
 *
 * The hook does NOT reach into `@lib/tauri`. Each editor owns its domain
 * payload (e.g. `alterTable(buildAlterRequest(false))`) and passes
 * preview/commit calls to `loadPreview` as closures. That keeps the hook
 * free of DDL command request shapes and preserves the editor-specific
 * `pendingExecuteRef` pattern without leaking it across the commit
 * boundary.
 *
 * Internal to `src/components/structure/`; not a project-wide hook.
 */

export interface DdlPreviewPendingConfirm {
  reason: string;
  sql: string;
}

export interface UseDdlPreviewExecutionOptions {
  /** Connection id used by the Safe Mode gate + history record. */
  connectionId: string;
  /**
   * Called once after a successful commit so the editor can re-fetch
   * its slice of schema metadata. Awaited — failures inside `onRefresh`
   * fall into the catch branch and surface as `previewError` /
   * `status: "error"` history entries.
   */
  onRefresh: () => Promise<void>;
}

export interface UseDdlPreviewExecutionResult {
  /** Most recent preview SQL (empty string before first `loadPreview`). */
  previewSql: string;
  /** True while preview fetch or commit is in flight. */
  previewLoading: boolean;
  /** Set when preview fetch / commit / Safe Mode block emits an error. */
  previewError: string | null;
  /**
   * Non-null while the warn-tier dialog is mounted. `reason` is the
   * verbatim analyzer reason; `sql` is the offending statement (post
   * `;`-split + trim) — both are forwarded to the dialog props.
   */
  pendingConfirm: DdlPreviewPendingConfirm | null;
  /**
   * Fetch a preview, register the matching commit closure, and clear
   * any prior error. `requestPreview` is invoked exactly once and its
   * `sql` becomes the `previewSql`. `prepareCommit` is a closure
   * factory — it is called once after a successful preview to mint
   * the commit closure; the resulting `() => Promise<void>` is held
   * inside the hook until `attemptExecute` (or `confirmDangerous`)
   * runs it. Editor-specific cleanup (e.g. `setPendingChanges([])`)
   * lives inside the commit closure caller-side.
   */
  loadPreview: (
    requestPreview: () => Promise<{ sql: string }>,
    prepareCommit: () => () => Promise<void>,
  ) => Promise<void>;
  /**
   * `";"`-split the previewed SQL, run each statement through
   * `analyzeStatement` + `useSafeModeGate.decide`. block → set
   * `previewError`; confirm → set `pendingConfirm`; otherwise call
   * the registered commit closure.
   */
  attemptExecute: () => Promise<void>;
  /** Warn-tier confirm: clear `pendingConfirm` + run the commit closure. */
  confirmDangerous: () => Promise<void>;
  /**
   * Warn-tier cancel: clear `pendingConfirm` and surface the canonical
   * `"Safe Mode (warn): confirmation cancelled — no changes committed"`
   * message in `previewError` (verbatim across the three editors).
   */
  cancelDangerous: () => void;
  /**
   * Preview dialog cancel: reset `previewSql` / `previewError` /
   * `pendingConfirm` and discard the registered commit closure.
   * Editors with additional domain cleanup (e.g. ColumnsEditor's
   * `pendingChanges`) should call `cancelPreview` and then their own
   * reset; the hook does not own domain state.
   */
  cancelPreview: () => void;
}

export function useDdlPreviewExecution({
  connectionId,
  onRefresh,
}: UseDdlPreviewExecutionOptions): UseDdlPreviewExecutionResult {
  const [previewSql, setPreviewSql] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] =
    useState<DdlPreviewPendingConfirm | null>(null);
  const pendingExecuteRef = useRef<(() => Promise<void>) | null>(null);

  const safeModeGate = useSafeModeGate(connectionId);

  // Sprint 271c (2026-05-13) — DbMismatch recovery. DDL dispatches are
  // user-initiated (dialog Apply / editor Execute), so on a mismatch the
  // backend's Sprint 266 wire format reaches this catch path. Route
  // through Sprint 267's `syncMismatchedActiveDb` to align the
  // frontend's `activeDb` with the backend pool, and raise the Sprint
  // 269 passive Retry toast so the user re-issues the action against
  // the synced db (DDL Apply has no auto-retry — re-clicking the dialog
  // button is the natural retry surface).
  const surfaceDbMismatchIfMatched = useCallback(
    (message: string): boolean => {
      const info = parseDbMismatch(message);
      if (!info) return false;
      void syncMismatchedActiveDb(connectionId, (actual) => {
        toast.warning(
          `Active database synced to '${actual}'. Re-apply if needed.`,
        );
      });
      return true;
    },
    [connectionId],
  );

  const runCommit = useCallback(async () => {
    const commit = pendingExecuteRef.current;
    if (!commit) return;
    setPreviewLoading(true);
    setPreviewError(null);
    const startedAt = Date.now();
    const recordedSql = previewSql;
    try {
      await commit();
      pendingExecuteRef.current = null;
      setPreviewSql("");
      // onRefresh is awaited so a refresh failure surfaces as a commit
      // error (history entry status: "error") — sprint-187/196 parity.
      await onRefresh();
      recordHistoryEntry({
        sql: recordedSql,
        executedAt: startedAt,
        duration: Date.now() - startedAt,
        status: "success",
        connectionId,
        paradigm: "rdb",
        queryMode: "sql",
        source: "ddl-structure",
      });
    } catch (e) {
      // Use `err.message` (not `String(e)`) so the Sprint 266 wire
      // format ("Database mismatch: …") sits at column 0 of the
      // matched string — `parseDbMismatch` anchors with `^…$`.
      const message = e instanceof Error ? e.message : String(e);
      setPreviewError(message);
      surfaceDbMismatchIfMatched(message);
      recordHistoryEntry({
        sql: recordedSql,
        executedAt: startedAt,
        duration: Date.now() - startedAt,
        status: "error",
        connectionId,
        paradigm: "rdb",
        queryMode: "sql",
        source: "ddl-structure",
      });
    }
    setPreviewLoading(false);
  }, [connectionId, onRefresh, previewSql, surfaceDbMismatchIfMatched]);

  const loadPreview = useCallback(
    async (
      requestPreview: () => Promise<{ sql: string }>,
      prepareCommit: () => () => Promise<void>,
    ) => {
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewSql("");
      try {
        const result = await requestPreview();
        setPreviewSql(result.sql);
        pendingExecuteRef.current = prepareCommit();
      } catch (e) {
        // Use `err.message` (not `String(e)`) — see `runCommit` catch.
        const message = e instanceof Error ? e.message : String(e);
        setPreviewError(message);
        setPreviewSql("");
        pendingExecuteRef.current = null;
        surfaceDbMismatchIfMatched(message);
      }
      setPreviewLoading(false);
    },
    [surfaceDbMismatchIfMatched],
  );

  const attemptExecute = useCallback(async () => {
    if (!pendingExecuteRef.current) return;
    // `;`-split + analyseStatement + decide loop. A batch with any
    // DROP COLUMN / DROP CONSTRAINT / DROP INDEX trips the gate even
    // when sibling statements are safe ADDs.
    const statements = previewSql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      const analysis = analyzeStatement(stmt);
      const decision = safeModeGate.decide(analysis);
      if (decision.action === "block") {
        setPreviewError(decision.reason);
        return;
      }
      if (decision.action === "confirm") {
        setPendingConfirm({ reason: decision.reason, sql: stmt });
        return;
      }
    }
    await runCommit();
  }, [previewSql, runCommit, safeModeGate]);

  const confirmDangerous = useCallback(async () => {
    setPendingConfirm(null);
    await runCommit();
  }, [runCommit]);

  const cancelDangerous = useCallback(() => {
    setPendingConfirm(null);
    setPreviewError(
      "Safe Mode (warn): confirmation cancelled — no changes committed",
    );
  }, []);

  const cancelPreview = useCallback(() => {
    pendingExecuteRef.current = null;
    setPreviewSql("");
    setPreviewError(null);
    setPendingConfirm(null);
  }, []);

  return {
    previewSql,
    previewLoading,
    previewError,
    pendingConfirm,
    loadPreview,
    attemptExecute,
    confirmDangerous,
    cancelDangerous,
    cancelPreview,
  };
}
