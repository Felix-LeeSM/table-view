import type { StatementAnalysis } from "@/lib/sql/sqlSafety";

/**
 * Sprint 188 — MongoDB aggregate-pipeline danger analyzer.
 *
 * RDB 의 `analyzeStatement` 와 같은 `StatementAnalysis` shape 을 반환해
 * `useSafeModeGate` 가 paradigm 무관하게 동일한 decision matrix 로 동작.
 *
 * 현재 cover 하는 destructive stage 는 collection-level 대체/upsert 만:
 * - `$out`   : 결과를 collection 으로 *replace* (덮어쓰기). 기존
 *              collection 이 있으면 통째로 날아감.
 * - `$merge` : 결과를 collection 에 *upsert*. partial replace + insert
 *              가 자동 적용되어 의도치 않은 row 변형 가능.
 *
 * `$lookup` 의 cycle / `$function` 의 server-side JS 평가는 위험 정의가
 * 명확하지 않아 Sprint 188 scope 에서 제외 (contract Out-of-Scope).
 *
 * 여러 위반 stage 가 섞여도 첫 위반 stage 의 reason 만 노출 — UI 가
 * 단일 reason 을 보여주므로 단순화. 해소 후 다음 위반이 같은 경로로
 * 재차단된다.
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
 * Sprint 198 — MongoDB write-op (bulk-write 3) safety classifier.
 *
 * `analyzeMongoPipeline` 와 마주보는 분류기. pipeline 이 read-shape
 * (find / aggregate) 인 데 비해 본 함수는 collection 통째 변형의 위험을
 * 본다. shape 은 같은 `StatementAnalysis` 라 `useSafeModeGate.decide` 가
 * paradigm 무관하게 호출 가능.
 *
 * 분류:
 * - `dropCollection` → 항상 `danger` (drop 자체가 partial 보호 불가).
 * - `deleteMany` with empty filter (`{}`) → `danger` (whole collection
 *   delete; RDB `DELETE without WHERE` 의 Mongo 평행).
 * - `updateMany` with empty filter → `danger` (whole collection mass
 *   update; `UPDATE without WHERE` 의 Mongo 평행).
 * - filter 가 non-empty → `safe` (실제 위험은 driver/사용자 의도 영역).
 *
 * Patch 의 `_id` mutation 은 **여기서 검사하지 않는다** — 백엔드의
 * `update_many_impl` 가 Validation error 로 거절하고 드라이버 round-trip
 * 전에 차단한다. UI 층은 동일 contract 의 사후 catch 에서 toast 처리.
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
