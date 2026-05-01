import type { StatementAnalysis } from "@/lib/sqlSafety";

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
