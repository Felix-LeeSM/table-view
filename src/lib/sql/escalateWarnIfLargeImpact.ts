// WARN-tier dry-run row-count escalation helper (2026-05-09).
// Prevents the incident from ADR 0023 grill Q2-(a): "I thought it was WARN,
// but it actually updated 1 million rows". When the dry-run of a bounded
// UPDATE WHERE / DELETE WHERE reports 100+ rows, escalate to STOP
// (`danger`).
//
// Policy:
//   - Only WARN bounded UPDATE/DELETE/MERGE are escalation targets
//     (kind === "dml-update" | "dml-delete" | "dml-merge"; MERGE per
//     #1116). CREATE / ALTER additive are excluded because their ROI is low
//     relative to the cost of the dry-run query.
//   - The dry-run IPC has a 2s timeout. On timeout, fall back to STOP.
//   - IPC unsupported (the adapter returns an Unsupported error) → STOP
//     fallback (conservative).
//   - A `totalCount` of 100 or more escalates to STOP.
//   - DML rows-affected arrives as `queryType === { dml: { rows_affected } }`,
//     so that value is checked first. When a SELECT comes back as the
//     dry-run result, `totalCount` is used.
//   - For the Mongo paradigm the caller skips escalation — upper-level
//     routing guards so this helper is not called at all.
//
// Signature: the caller (`executeRdbQuery` in `rdbQueryExecution.ts`, run
// from `useQueryExecution.handleExecute`) calls it at batch level. This
// helper is dispatched only for an individual statement that is a WARN
// bounded write.

import { executeQueryDryRun } from "@lib/tauri";
import type { Severity } from "@/lib/sql/sqlSafety";
import type { QueryResult } from "@/types/query";

/** 2s timeout for dry-run row-count probe. */
export const DRY_RUN_ESCALATION_TIMEOUT_MS = 2000;
/** Row-count threshold above which WARN escalates to STOP (danger). */
export const DRY_RUN_ESCALATION_THRESHOLD = 100;

export interface EscalateWarnOptions {
  /** Override timeout (ms) — used by tests to drive timeout fallback. */
  timeoutMs?: number;
  /** Override threshold — used by tests / future tuning. */
  threshold?: number;
}

/**
 * Why a WARN escalated (or not). `measured` = the dry-run probe ran and
 * returned a row count at/above the threshold. `unsupported` = the probe
 * could not run (adapter rejected — MySQL/SQLite today — or IPC error).
 * `timeout` = the probe ran past the 2s budget. `unsupported`/`timeout`
 * are fail-closed fallbacks with NO measured count, so callers must not
 * claim a concrete row impact for them (issue #1110).
 */
export type EscalationCause = "measured" | "unsupported" | "timeout";

export interface EscalateWarnResult {
  severity: Severity;
  /** Set only when `severity === "danger"` via the WARN probe path. */
  cause?: EscalationCause;
}

/**
 * Returns the *effective* severity for a WARN-tier bounded UPDATE/DELETE
 * after a dry-run row-count probe, plus the `cause` behind an escalation
 * so callers can render a truthful reason. Returns the input severity
 * unchanged (no `cause`) for non-WARN inputs.
 *
 * Behaviour matrix:
 *   - severity !== "warn"             → { severity } (no probe).
 *   - dry-run rowCount >= threshold   → { danger, cause: "measured" }.
 *   - dry-run rowCount < threshold    → { warn } (no escalate).
 *   - dry-run timeout (2s)            → { danger, cause: "timeout" }.
 *   - dry-run IPC unsupported / err   → { danger, cause: "unsupported" }.
 */
export async function escalateWarnIfLargeImpact(
  connectionId: string,
  statement: string,
  severity: Severity,
  options: EscalateWarnOptions = {},
): Promise<EscalateWarnResult> {
  if (severity !== "warn") return { severity };

  const timeoutMs = options.timeoutMs ?? DRY_RUN_ESCALATION_TIMEOUT_MS;
  const threshold = options.threshold ?? DRY_RUN_ESCALATION_THRESHOLD;
  const queryId = `dry-escalate:${Date.now()}`;

  // Race the dry-run IPC against a timer so a hung backend can't block
  // the Execute click. The timeout result is intentionally distinct
  // ("__timeout__") from a real success so the caller can fall back.
  let results: QueryResult[] | "__timeout__";
  try {
    results = await Promise.race<QueryResult[] | "__timeout__">([
      executeQueryDryRun(connectionId, [statement], queryId),
      new Promise<"__timeout__">((resolve) =>
        setTimeout(() => resolve("__timeout__"), timeoutMs),
      ),
    ]);
  } catch {
    // IPC error (Unsupported, syntax error, transaction failure, …) →
    // STOP fallback. Conservative: better to surface a confirm dialog
    // than silently auto-execute when the dry-run probe couldn't run.
    // No count was measured — cause "unsupported" so the caller does
    // NOT claim a "100+ rows" impact (issue #1110).
    return { severity: "danger", cause: "unsupported" };
  }

  if (results === "__timeout__")
    return { severity: "danger", cause: "timeout" };

  const result = results[0];
  // IPC succeeded but returned no per-statement result. Treat as 0 rows
  // (no escalation) — the dry-run probe ran without error so we have
  // signal that the statement is syntactically valid; an empty result
  // shape just means no rows matched.
  if (!result) return { severity: "warn" };

  const rowCount = extractRowsAffected(result);
  if (rowCount >= threshold) return { severity: "danger", cause: "measured" };
  return { severity: "warn" };
}

/**
 * Extract rows-affected from a DML result. The backend's
 * `QueryResult.queryType` is the union
 * `"select" | "ddl" | { dml: { rows_affected: number } }`, so for DML use
 * that value first, otherwise use `totalCount`.
 */
function extractRowsAffected(result: QueryResult): number {
  const qt = result.queryType;
  if (typeof qt === "object" && qt !== null && "dml" in qt) {
    const dml = (qt as { dml: { rows_affected: number } }).dml;
    if (typeof dml.rows_affected === "number") return dml.rows_affected;
  }
  return result.totalCount ?? 0;
}
