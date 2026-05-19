// Sprint 254 (2026-05-09) — WARN-tier dry-run row-count escalation helper.
// ADR 0023 grill Q2-(a) 의 "WARN 인 줄 알았는데 실제로 100 만 row update"
// 사고 방지. bounded UPDATE WHERE / DELETE WHERE 의 dry-run 결과가 100+
// row 면 STOP (`danger`) 로 escalate.
//
// 정책:
//   - WARN bounded UPDATE/DELETE 만 escalation 대상
//     (kind === "dml-update" | "dml-delete"). CREATE / ALTER additive 는
//     dry-run 조회 비용 대비 ROI 가 낮으므로 본 sprint 에서는 제외.
//   - dry-run IPC 2s timeout. timeout 시 STOP fallback.
//   - IPC unsupported (MySQL / SQLite — adapter 가 Unsupported error) →
//     STOP fallback (보수적).
//   - `total_count` 가 100 이상이면 STOP escalate.
//   - DML rows-affected 정보는 `query_type === { dml: { rows_affected } }`
//     로 제공되므로 그것을 우선 본다. SELECT 가 dry-run 결과로 오면
//     `total_count` 를 사용.
//   - Mongo paradigm 은 caller 가 escalate skip — 본 helper 는 호출 자체가
//     안 되도록 상위 routing 에서 가드.
//
// 시그니처: caller (`useQueryExecution.handleExecute`) 가 batch level 에서
// 호출. 단일 statement 가 WARN bounded write 일 때만 본 helper 가
// dispatch 된다.

import { executeQueryDryRun } from "@lib/tauri";
import type { QueryResult } from "@/types/query";
import type { Severity } from "@/lib/sql/sqlSafety";

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
 * Returns the *effective* severity for a WARN-tier bounded UPDATE/DELETE
 * after a dry-run row-count probe. Returns the input severity unchanged
 * for non-WARN inputs.
 *
 * Behaviour matrix:
 *   - severity !== "warn"             → return severity (no probe).
 *   - dry-run rowCount >= threshold   → "danger" (escalate).
 *   - dry-run rowCount < threshold    → "warn" (no escalate).
 *   - dry-run timeout (2s)            → "danger" (fallback, conservative).
 *   - dry-run IPC unsupported / err   → "danger" (fallback, conservative).
 */
export async function escalateWarnIfLargeImpact(
  connectionId: string,
  statement: string,
  severity: Severity,
  options: EscalateWarnOptions = {},
): Promise<Severity> {
  if (severity !== "warn") return severity;

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
    return "danger";
  }

  if (results === "__timeout__") return "danger";

  const result = results[0];
  // IPC succeeded but returned no per-statement result. Treat as 0 rows
  // (no escalation) — the dry-run probe ran without error so we have
  // signal that the statement is syntactically valid; an empty result
  // shape just means no rows matched.
  if (!result) return "warn";

  const rowCount = extractRowsAffected(result);
  if (rowCount >= threshold) return "danger";
  return "warn";
}

/**
 * DML 결과의 rows-affected 추출. backend 의 `QueryResult.query_type` 은
 * `"select" | "ddl" | { dml: { rows_affected: number } }` union 이므로
 * DML 인 경우 우선 그 값을, 아니면 `total_count` 를 사용한다.
 */
function extractRowsAffected(result: QueryResult): number {
  const qt = result.query_type;
  if (typeof qt === "object" && qt !== null && "dml" in qt) {
    const dml = (qt as { dml: { rows_affected: number } }).dml;
    if (typeof dml.rows_affected === "number") return dml.rows_affected;
  }
  return result.total_count ?? 0;
}
