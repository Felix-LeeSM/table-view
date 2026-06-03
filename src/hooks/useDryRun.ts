import { useEffect, useRef, useState } from "react";
import { cancelQuery, executeQueryDryRun } from "@lib/tauri";
import { normalizeQueryResult } from "@lib/wireCamelCase";
import type { QueryResult } from "@/types/query";

/**
 * Sprint 247 (ADR 0022 Phase 3) — `useDryRun` powers the destructive-
 * statement confirm dialog's preview pane. When `enabled` flips true
 * (dialog mounts), the hook calls `execute_query_dry_run` so the user
 * sees per-statement `rows_affected` / `execution_time_ms` BEFORE
 * approving the commit. The transaction is unconditionally rolled back
 * on the backend; the dialog's Yes button still routes through the
 * existing `executeQueryBatch` commit path so commit semantics are
 * unchanged.
 *
 * Branches:
 *   - `paradigm !== "rdb"` → `status: "unsupported"` immediately,
 *     IPC NOT invoked. Non-RDB adapters cannot use transaction-scoped
 *     dry-run, so the dialog shows a disclaimer.
 *   - `enabled === false` → `status: "idle"`, IPC NOT invoked. The
 *     dialog is closed; we don't speculatively pre-fetch.
 *   - `enabled === true` (rdb only) → mint a `"dry:<uuid>"` query id,
 *     invoke `executeQueryDryRun`, transition `running → success | error`.
 *
 * Cancellation: when the hook unmounts, the in-flight query id is
 * best-effort cancelled via `cancelQuery` (matches the dialog close-
 * before-resolve pattern). The query id is prefixed `"dry:"` so it
 * cannot collide with the commit-path query id minted by sibling hooks.
 *
 * The hook does NOT mutate any global store and holds no subscriptions
 * — its sole side effect is the IPC call + cancel. State transitions
 * are guarded against unmount via a mounted-ref to avoid setting state
 * after the dialog is closed.
 */

export type DryRunStatus =
  | "idle"
  | "running"
  | "success"
  | "error"
  | "unsupported";

export interface DryRunState {
  status: DryRunStatus;
  results: QueryResult[] | null;
  error: string | null;
}

export interface UseDryRunArgs {
  connectionId: string;
  statements: string[];
  paradigm: "rdb" | "document" | "kv";
  enabled: boolean;
}

const IDLE_STATE: DryRunState = {
  status: "idle",
  results: null,
  error: null,
};

const UNSUPPORTED_STATE: DryRunState = {
  status: "unsupported",
  results: null,
  error: null,
};

export function useDryRun(args: UseDryRunArgs): DryRunState {
  const { connectionId, statements, paradigm, enabled } = args;

  // Non-RDB paradigms short-circuit without IPC.
  const initialState: DryRunState =
    paradigm !== "rdb"
      ? UNSUPPORTED_STATE
      : enabled
        ? { status: "running", results: null, error: null }
        : IDLE_STATE;

  const [state, setState] = useState<DryRunState>(initialState);
  const queryIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Serialise statements for the effect dep — array identity changes
  // every render at most call sites, but the value is what drives the
  // dry-run; `JSON.stringify` is cheap for the typical 1-3 statement
  // dialog payload. Dialog commit-path uses the same ergonomic.
  const statementsKey = statements.join("\u0000");

  useEffect(() => {
    if (paradigm !== "rdb") {
      setState(UNSUPPORTED_STATE);
      return;
    }
    if (!enabled) {
      setState(IDLE_STATE);
      return;
    }
    // Empty / whitespace-only batch is a programmer error at the call
    // site; surface as error so the dialog tells the user the preview
    // failed rather than silently spinning.
    if (statements.length === 0) {
      setState({
        status: "error",
        results: null,
        error: "No statements to dry-run",
      });
      return;
    }

    setState({ status: "running", results: null, error: null });

    const queryId = `dry:${crypto.randomUUID()}`;
    queryIdRef.current = queryId;

    let cancelled = false;
    void executeQueryDryRun(connectionId, statements, queryId)
      .then((results) => {
        if (cancelled || !mountedRef.current) return;
        // Guard against a stale resolve from a prior `enabled=true`
        // pass — only commit state if the query id is still the one
        // we minted at the top of this effect.
        if (queryIdRef.current !== queryId) return;
        setState({
          status: "success",
          results: results.map(normalizeQueryResult),
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled || !mountedRef.current) return;
        if (queryIdRef.current !== queryId) return;
        setState({
          status: "error",
          results: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
      // Only release the ref if it still points at this effect's
      // query id — a sibling re-run already reset it otherwise.
      if (queryIdRef.current === queryId) {
        queryIdRef.current = null;
      }
      // Best-effort cancel — failures are unactionable (the backend
      // may have already completed and removed the token). Wrap in
      // `Promise.resolve` so the call is robust against test mocks
      // that return `undefined` (the production wrapper always
      // returns a Promise via `invoke`).
      try {
        const maybe = cancelQuery(queryId) as unknown;
        if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
          (maybe as Promise<unknown>).catch(() => {
            /* best-effort */
          });
        }
      } catch {
        /* best-effort */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, statementsKey, paradigm, enabled]);

  return state;
}
