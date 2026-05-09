import type { StatementAnalysis } from "@/lib/sql/sqlSafety";

/**
 * MongoDB aggregate-pipeline danger analyzer. Returns the same
 * `StatementAnalysis` shape as RDB's `analyzeStatement` so
 * `useSafeModeGate` can run paradigm-agnostically.
 *
 * Destructive stages covered:
 * - `$out`   — replaces the target collection wholesale.
 * - `$merge` — upserts; can mutate rows the user didn't intend.
 *
 * `$lookup` cycles and `$function` server-side JS are out of scope —
 * the danger boundary isn't well-defined for those.
 *
 * On multiple violations, only the first stage's reason is surfaced;
 * resolving it lets the next violation re-block on the same path.
 */
export function analyzeMongoPipeline(pipeline: unknown[]): StatementAnalysis {
  for (const stage of pipeline) {
    if (!isPipelineStage(stage)) continue;
    const keys = Object.keys(stage);
    if (keys.length === 0) continue;
    const op = keys[0];
    if (op === "$out") {
      return {
        kind: "mongo-out",
        severity: "danger",
        reasons: ["MongoDB $out (collection replace)"],
      };
    }
    if (op === "$merge") {
      return {
        kind: "mongo-merge",
        severity: "danger",
        reasons: ["MongoDB $merge (collection upsert)"],
      };
    }
  }
  return { kind: "mongo-other", severity: "safe", reasons: [] };
}

function isPipelineStage(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== null
  );
}

/**
 * MongoDB write-op safety classifier (the bulk-write parallel of
 * `analyzeMongoPipeline`). Returns the same `StatementAnalysis` shape
 * so `useSafeModeGate.decide` stays paradigm-agnostic.
 *
 * Classification:
 * - `dropCollection` → `danger` (no partial protection).
 * - `deleteMany` with empty filter (`{}`) → `danger`. Mongo parallel
 *   of `DELETE without WHERE`.
 * - `updateMany` with empty filter → `danger`. Mongo parallel of
 *   `UPDATE without WHERE`.
 * - non-empty filter → `safe`.
 *
 * `_id` mutations in patches are NOT checked here — the backend's
 * `update_many_impl` rejects them as a validation error before the
 * driver round-trip; the UI catches via the post-call toast.
 */
export type MongoOperation =
  | { kind: "deleteMany"; filter: Record<string, unknown> }
  | {
      kind: "updateMany";
      filter: Record<string, unknown>;
      patch: Record<string, unknown>;
    }
  | { kind: "dropCollection" };

export function analyzeMongoOperation(op: MongoOperation): StatementAnalysis {
  if (op.kind === "dropCollection") {
    return {
      kind: "mongo-drop",
      severity: "danger",
      reasons: ["MongoDB dropCollection (whole collection)"],
    };
  }
  if (op.kind === "deleteMany") {
    if (isEmptyFilter(op.filter)) {
      return {
        kind: "mongo-delete-all",
        severity: "danger",
        reasons: ["MongoDB deleteMany without filter"],
      };
    }
    return { kind: "mongo-delete-many", severity: "safe", reasons: [] };
  }
  // updateMany
  if (isEmptyFilter(op.filter)) {
    return {
      kind: "mongo-update-all",
      severity: "danger",
      reasons: ["MongoDB updateMany without filter"],
    };
  }
  return { kind: "mongo-update-many", severity: "safe", reasons: [] };
}

function isEmptyFilter(filter: Record<string, unknown>): boolean {
  // analyzeMongoPipeline 의 isPipelineStage 와 동일 가드를 적용해도 되지만
  // operation analyzer 는 caller 가 Record 보장 후 호출하므로 key 수만 본다.
  return Object.keys(filter).length === 0;
}

/**
 * Sprint 255 — Mongo paradigm 의 INFO tier 식별 휴리스틱. raw MQL editor 의
 * WARN dialog mount 분기에서 호출되어 read-only aggregate pipeline (find /
 * pure-read pipeline: $match / $sort / $project / $group / $addFields /
 * $unset 만으로 구성) 만 dialog skip → 직접 IPC 발동.
 *
 * INFO = `severity: "safe"` && `kind === "mongo-other"` — `analyzeMongoPipeline`
 * 가 read-only pipeline 만 `mongo-other` + safe 로 분류하기 때문.
 * `analyzeMongoOperation` 으로부터 온 `mongo-delete-many` / `mongo-update-many`
 * (non-empty filter) 는 safe 지만 INFO 가 아님 → WARN 후보. `*-all` /
 * `mongo-out` / `mongo-merge` / `mongo-drop` 은 danger 이므로 STOP.
 *
 * Mongo find path 는 `useQueryExecution` 에서 항상 INFO 로 처리 (이 helper
 * 거치지 않음 — find 는 pipeline analyzer 가 적용되지 않는 경로).
 */
export function isInfoMongoOperation(analysis: StatementAnalysis): boolean {
  return analysis.severity === "safe" && analysis.kind === "mongo-other";
}
