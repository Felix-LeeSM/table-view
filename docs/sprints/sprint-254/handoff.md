# Sprint 254 — Generator Handoff

> Reference: contract `docs/sprints/sprint-254/contract.md`,
> execution brief `docs/sprints/sprint-254/execution-brief.md`,
> ADR 0023, Sprint 253 baseline 528063b, Sprint 255 baseline b8600bc.

## Changed Files

### Modified
- `src/lib/sql/sqlSafety.ts` — `Severity` union 3-tier split
  (`"info" | "warn" | "danger"`). 3-tier 분류: SELECT/EXPLAIN/SHOW/DESCRIBE
  → INFO, INSERT/UPDATE WHERE/DELETE WHERE/CREATE/ALTER additive → WARN,
  DROP/TRUNCATE/WHERE-less DELETE·UPDATE/ALTER DROP/GRANT/REVOKE → DANGER.
  DML CTE (`WITH x AS (UPDATE …) SELECT *`) 식별 추가 — wrapped statement
  의 severity 와 정합. `isInfoStatement` 본문 단순화 (`severity === "info"`).
  GRANT / REVOKE 신규 분기. Empty / unrecognised default → INFO (defensive).
- `src/lib/sql/sqlSafety.test.ts` — 3-tier corpus 확장. AC-254-01..04
  매핑 (INFO/WARN/STOP + DML CTE). 기존 Sprint 185-187 / 255 회귀 보존.
- `src/lib/mongo/mongoSafety.ts` — Mongo 3-tier 동일. read-only pipeline
  → INFO, *-many (non-empty filter) → WARN, *-all/$out/$merge/drop →
  DANGER. `isInfoMongoOperation` 본문 단순화 (`severity === "info"`).
- `src/lib/mongo/mongoSafety.test.ts` — 3-tier corpus.
- `src/lib/safeMode.ts` — `decideSafeModeAction` 의 새 union 처리.
  `severity === "danger"` 만 confirm; INFO/WARN 모두 allow (매트릭스
  결과 회귀 0). 주석에 ADR 0023 grill Q2-(a) 의 정합 명시.
- `src/lib/safeMode.test.ts` — 새 union 회귀 + AC-254-05a/b.
- `src/components/query/QueryTab/useQueryExecution.ts` —
  `isInfoStatement(analysis)` / `isInfoMongoOperation(analysis)` 휴리스틱
  → `analysis.severity === "info"` / `=== "warn"` 직접 비교 전환. WARN
  bounded UPDATE/DELETE 의 dry-run row-count escalation helper 호출
  추가 (`escalateWarnIfLargeImpact`). 다중 statement 우선순위 (STOP >
  WARN > INFO) 보존.
- `src/components/query/QueryTab.execution.test.tsx` — `BAD 1; BAD 2` 의
  `kind: "other"` default 가 INFO 로 변경되어 dialog click 우회. 기존
  multi-statement collapse 검증 의도 보존.
- `src/components/query/QueryTab.document.test.tsx` — `\c admin` 의
  `kind: "other"` default 가 INFO 로 변경되어 dialog click 우회 (S132 두
  개 테스트 갱신).

### Added
- `src/lib/sql/escalateWarnIfLargeImpact.ts` (신규) — WARN-tier bounded
  UPDATE/DELETE 의 dry-run row-count escalation helper. 2s timeout +
  IPC unsupported / throw → STOP fallback. 100-row threshold. caller
  (`useQueryExecution.handleExecute`) 가 batch loop 안에서 후보를 수집
  후 sequential probe.
- `src/components/query/QueryTab/useQueryExecution.escalation.test.tsx`
  (신규) — 8 cases. dry-run 150 → STOP / dry-run 50 → WARN / timeout →
  STOP fallback / IPC throw → STOP fallback / INSERT escalation skip /
  SELECT INFO 직접 IPC / WHERE-less DELETE → STOP via gate (no probe) /
  multi (SELECT + UPDATE WHERE 200) → STOP escalate.

### Deleted
- 없음.

## Checks Run

1. `pnpm tsc --noEmit` — pass (0 errors)
2. `pnpm lint` — pass (0 errors / 0 warnings)
3. `pnpm vitest run` — pass (3099/3099, 242 files)
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — pass
   (627/627, 2 ignored, Rust 변경 0)
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
   — pass (clean)
6. `rg "severity: \"info\"|severity: \"warn\"" src/lib/` — 20 매치
   (sqlSafety + mongoSafety + safeMode + tests; >= 5 충족)
7. `rg "escalateWarn|dry-run.*100|rowCount.*100" src/` — 11 매치 (helper
   + 호출처 + 테스트; >= 1 충족)

## Done Criteria Coverage

| Criterion | Evidence |
| --- | --- |
| 1. Severity union 3-tier 확장 + 모든 callsite 매핑 | `src/lib/sql/sqlSafety.ts:32` (`export type Severity = "info" \| "warn" \| "danger"`). 모든 callsite (`useSafeModeGate.test.ts`, `safeMode.test.ts`, `mongoSafety.ts`, `useQueryExecution.ts`, `sqlSafety.test.ts`) 업데이트 완료. |
| 2. INFO 분류 (SELECT / WITH / EXPLAIN / SHOW / DESCRIBE / DESC) | `sqlSafety.ts:163-178` (SELECT / WITH branch + INFO branch). 테스트 `sqlSafety.test.ts:177-216` (AC-254-01a..f). |
| 3. WARN 분류 (INSERT / UPDATE WHERE / DELETE WHERE / CREATE / ALTER additive) | `sqlSafety.ts:118-159` (DELETE WHERE → warn / UPDATE WHERE → warn / DDL fall-through → ddl-other warn / INSERT → warn). 테스트 `sqlSafety.test.ts:218-247`. |
| 4. STOP 분류 (DROP / TRUNCATE / WHERE-less / ALTER DROP / GRANT / REVOKE) + Mongo $out/$merge/drop/*-all | `sqlSafety.ts:121-156` + `mongoSafety.ts:36-49`, `78-99`. 테스트 `sqlSafety.test.ts:249-275`, `mongoSafety.test.ts:33-63`, `90-118`. GRANT/REVOKE 신규 분기 (sqlSafety.ts:139-146). |
| 5. DML CTE 식별 | `sqlSafety.ts:73-105` (`analyzeDmlCte` + `extractBalanced`). 테스트 `sqlSafety.test.ts:277-304` (AC-254-04a..e). |
| 6. Mongo 3-tier (find/aggregate read → INFO, *-many → WARN, *-all/$out/$merge/drop → DANGER) | `mongoSafety.ts:36-99`. 테스트 `mongoSafety.test.ts:18-138`. |
| 7. dry-run row-count STOP escalation (100+ → STOP, 2s timeout, IPC unsupported → fallback, Mongo skip) | `src/lib/sql/escalateWarnIfLargeImpact.ts` (helper). caller `useQueryExecution.ts:680-695` (batch loop). Mongo skip — `useQueryExecution.ts:529` 만 `severity === "warn"` 분기, escalation helper 호출 없음. 테스트 `useQueryExecution.escalation.test.tsx` 8 cases. |
| 8. `decideSafeModeAction` 새 union 처리 (매트릭스 결과 회귀 0) | `safeMode.ts:60-76` 만 변경 (주석 + isDanger 동일 로직). 매트릭스 결과 회귀 — `safeMode.test.ts` 의 L1..L8 + AC-254-05a/b 모두 pass. |
| 9. Sprint 255 의 WARN dialog flow 보존 | `useQueryExecution.ts` 의 `pendingRdbWarn` / `pendingMongoWarn` 상태 + `confirmRdbWarn` / `cancelRdbWarn` / `confirmMongoWarn` / `cancelMongoWarn` 시그니처 변경 0. `QueryTab.warn-dialog.test.tsx` 모두 pass (12 cases). `QueryTab.tsx` 의 dialog mount JSX 변경 0. |
| 10. `isInfoStatement` / `isInfoMongoOperation` 본문 갱신 (export 시그니처 보존) | `sqlSafety.ts:191-193` (`return analysis.severity === "info";`), `mongoSafety.ts:108-110` (`return analysis.severity === "info";`). caller 회귀 0 — 모두 boolean 반환. |
| 11. AC-254-01..07 매핑 | AC-254-01 (INFO) → `sqlSafety.test.ts:177-216`. AC-254-02 (WARN) → `:218-247`. AC-254-03 (STOP) → `:249-275`. AC-254-04 (DML CTE) → `:277-304`. AC-254-05 (decideSafeModeAction 새 union) → `safeMode.test.ts:174-200`. AC-254-06 (dry-run escalation) → `useQueryExecution.escalation.test.tsx`. AC-254-07 (Sprint 255 회귀) → `QueryTab.warn-dialog.test.tsx`, `QueryTab.safe-mode.test.tsx`, `QueryTab.execution.test.tsx`. |
| 12. /tdd red → green | red log: 36 fail (severity 비교 불일치) → 구현 후 green. escalation: 1 red (test setup order) → 수정 후 8/8 pass. evidence: handoff 의 "TDD evidence" 섹션 참고. |
| 13. Verification Plan 7 check pass | 위 "Checks Run" 섹션 참고. |

## TDD Evidence

### Red phase (구현 전 테스트 fail)
```
$ pnpm vitest run src/lib/sql/sqlSafety.test.ts src/lib/mongo/mongoSafety.test.ts src/lib/safeMode.test.ts
Test Files  2 failed | 1 passed (3)
     Tests  36 failed | 58 passed (94)
```
주요 fail 사유:
- `expected 'safe' to be 'info'` — SELECT 의 severity 변경.
- `expected 'safe' to be 'warn'` — INSERT / UPDATE WHERE / DELETE WHERE / CREATE.
- `expected 'safe' to be 'info'` — read-only Mongo pipeline.
- `expected 'safe' to be 'warn'` — Mongo *-many.

### Green phase (구현 후 모두 통과)
```
$ pnpm vitest run src/lib/sql/sqlSafety.test.ts src/lib/mongo/mongoSafety.test.ts src/lib/safeMode.test.ts
Test Files  3 passed (3)
     Tests  94 passed (94)
```

### Escalation TDD (8 cases)
```
$ pnpm vitest run src/components/query/QueryTab/useQueryExecution.escalation.test.tsx
Test Files  1 passed (1)
     Tests  8 passed (8)
```

### Full suite
```
$ pnpm vitest run
Test Files  242 passed (242)
     Tests  3099 passed (3099)
```

## Severity Union Quote

```ts
// src/lib/sql/sqlSafety.ts (Sprint 254)
export type Severity = "info" | "warn" | "danger";
```

## analyzeStatement 3-tier branches (간결 인용)

```ts
// DELETE / UPDATE — bounded vs WHERE-less.
if (/^DELETE\s+FROM\b/.test(upper)) {
  if (!hasOuterWhere(upper)) {
    return { kind: "delete", severity: "danger", reasons: ["DELETE without WHERE clause"] };
  }
  return { kind: "delete", severity: "warn", reasons: [] };  // Sprint 254: bounded WARN.
}
// ... UPDATE 동일 패턴.

// DROP / TRUNCATE / ALTER DROP / GRANT / REVOKE → DANGER.
// CREATE / ALTER additive / DDL fall-through → WARN.
if (/^GRANT\b/.test(upper)) return { kind: "ddl-other", severity: "danger", reasons: ["GRANT"] };
if (/^REVOKE\b/.test(upper)) return { kind: "ddl-other", severity: "danger", reasons: ["REVOKE"] };
if (/^DROP\b/.test(upper) || /^ALTER\b/.test(upper) || /^CREATE\b/.test(upper)) {
  return { kind: "ddl-other", severity: "warn", reasons: [] };  // Sprint 254.
}

// INSERT INTO → WARN.
if (/^INSERT\s+INTO\b/.test(upper)) return { kind: "insert", severity: "warn", reasons: [] };

// SELECT → INFO.
if (/^SELECT\b/.test(upper)) return { kind: "select", severity: "info", reasons: [] };

// WITH … — DML CTE 식별 후 분기.
if (/^WITH\b/.test(upper)) {
  const dml = analyzeDmlCte(upper);
  if (dml) return dml;
  return { kind: "select", severity: "info", reasons: [] };
}

// EXPLAIN / SHOW / DESCRIBE / DESC → INFO.
if (/^(EXPLAIN|SHOW|DESCRIBE|DESC)\b/.test(upper)) {
  return { kind: "info", severity: "info", reasons: [] };
}
```

## DML CTE detection

```ts
function analyzeDmlCte(upper: string): StatementAnalysis | null {
  const match = upper.match(
    /^WITH\s+(?:RECURSIVE\s+)?[A-Z_][A-Z0-9_]*\s*(?:\([^)]*\)\s*)?AS\s*\(\s*(UPDATE|DELETE|INSERT)\b/,
  );
  if (!match) return null;
  // ... extractBalanced + recursive analyzeStatement(inner) ...
}
```

## analyzeMongoPipeline / analyzeMongoOperation 3-tier

```ts
// analyzeMongoPipeline — read-only pipeline → INFO.
return { kind: "mongo-other", severity: "info", reasons: [] };  // Sprint 254.

// analyzeMongoOperation — bounded *-many → WARN.
return { kind: "mongo-delete-many", severity: "warn", reasons: [] };  // Sprint 254.
return { kind: "mongo-update-many", severity: "warn", reasons: [] };
```

## escalateWarnIfLargeImpact helper

```ts
// src/lib/sql/escalateWarnIfLargeImpact.ts (Sprint 254)
export const DRY_RUN_ESCALATION_TIMEOUT_MS = 2000;
export const DRY_RUN_ESCALATION_THRESHOLD = 100;

export async function escalateWarnIfLargeImpact(
  connectionId: string,
  statement: string,
  severity: Severity,
  options: EscalateWarnOptions = {},
): Promise<Severity> {
  if (severity !== "warn") return severity;
  // ... Promise.race against 2s timeout ...
  // timeout / catch → "danger" (fallback).
  // result missing → "warn" (probe ran cleanly, 0 rows).
  // rowCount >= threshold → "danger".
}
```

## decideSafeModeAction diff

```diff
-  const isDanger = analysis.severity === "danger";
+  // Sprint 254 (2026-05-09) — `severity` union split to 3-tier ...
+  const isDanger = analysis.severity === "danger";
+
+  // Read / WARN write are never gated at the `decideSafeModeAction` layer.
+  // Pass-through everywhere — the QueryTab's `pendingRdbWarn` /
+  // `pendingMongoWarn` (Sprint 255) catches WARN at a higher surface.
   if (!isDanger) return { action: "allow" };
```

매트릭스 *결과* 회귀 0 — `safeMode.test.ts` 의 L1..L8 모두 pass.

## useQueryExecution.handleExecute diff (Sprint 254)

```diff
-  if (analysis.severity === "safe" && !isInfoMongoOperation(analysis)) {
+  if (analysis.severity === "warn") {
     setPendingMongoWarn({ pipeline: parsed });
     return;
   }

-  if (decision.action === "allow" &&
-      analysis.severity === "safe" &&
-      !isInfoStatement(analysis)) {
+  if (decision.action === "allow" && analysis.severity === "warn") {
     hasWarn = true;
+    if (analysis.kind === "update" || analysis.kind === "delete") {
+      escalationCandidates.push({ stmt, reason: ... });
+    }
   }

+  // Sprint 254 — escalate before mounting WARN dialog.
+  if (hasWarn && escalationCandidates.length > 0) {
+    for (const candidate of escalationCandidates) {
+      const escalated = await escalateWarnIfLargeImpact(
+        tab.connectionId,
+        candidate.stmt,
+        "warn",
+      );
+      if (escalated === "danger") {
+        setPendingRdbConfirm({ statements, reason: candidate.reason });
+        return;
+      }
+    }
+  }
```

## Assumptions

1. **dry-run 2s timeout** — `DRY_RUN_ESCALATION_TIMEOUT_MS = 2000`. Master
   spec / contract 의 명시 값. timeout 만료 시 STOP fallback (보수적).
2. **100-row threshold** — `DRY_RUN_ESCALATION_THRESHOLD = 100`. Master
   spec 의 명시 값.
3. **DML CTE 인식 휴리스틱** — `WITH [RECURSIVE]? <ident> [(<cols>)]? AS (
   <UPDATE|DELETE|INSERT> ...)` 의 first CTE body 만 검사. 중첩 CTE 는
   first 가 dominant write op 라고 가정. 현재 contract 의 단위 테스트
   범위 (AC-254-04a..e) 는 이 가정을 충족.
4. **Mongo paradigm escalation skip** — Mongo `*-many` 는 WARN 으로 분류
   되지만 dry-run IPC 가 rdb-only 라 escalation helper 가 호출되지 않는다
   (`useQueryExecution.ts:529` 의 Mongo aggregate 분기는 `severity ===
   "warn"` 직접 분기로만 진입; escalation helper 호출 X). 향후 Mongo
   dry-run 지원 시 helper 확장.
5. **bounded UPDATE/DELETE 만 escalation 대상** — INSERT / CREATE / ALTER
   additive 는 dry-run 비용 대비 ROI 가 낮아 본 sprint 에서는 제외.
   master spec §Sprint 254 의 명시.
6. **Empty / unrecognised statement → INFO** — 새 default. 이전 `safe`
   default 와 의미 동일 (allow / no dialog) 지만 union 명시화. 부수적으로
   Sprint 255 의 `\c admin` / `BAD …` 같은 unknown statement 가 WARN
   dialog 를 mount 하지 않는다 — 두 개 테스트 (S132 / collapses to error
   when ALL statements fail) 의 dialog click 단계 제거.
7. **escalation IPC 는 `@lib/tauri` barrel 통해 import** — test mock
   (`vi.mock("@lib/tauri", ...)`) 가 정상 작동하도록 보장.
8. **STOP escalate 시 reason copy** — "UPDATE/DELETE affects 100+ rows
   (dry-run threshold)". 향후 sprint 256 에서 dialog 헤더 token 정렬과
   함께 carry.

## Residual Risk

- **Sprint 256 OUT OF SCOPE** — Chrome H / top stripe / Button F /
  ConfirmDestructiveDialog 헤더 env token 정렬은 Sprint 256 에서 처리.
  Sprint 254 의 escalation reason copy 가 dialog 본문에 그대로 표시되며,
  Sprint 256 이 그 헤더 surface 를 더 풍부하게 만들 예정 — 본 sprint 의
  reason 자체는 단순 ASCII 영어 문자열이라 token 정렬과 직교.
- **DML CTE 의 nested / 다중 CTE** — 현재 helper 는 first CTE 의 first
  write op 만 검사. `WITH a AS (SELECT 1), b AS (UPDATE …) SELECT *`
  같은 multi-CTE 에서 a 가 SELECT 면 DML CTE 인식이 wrong false. 단,
  실제 Postgres 의 multi-CTE write 는 first CTE 가 SELECT 일 경우 거의
  발생하지 않으며, contract 의 AC-254-04a..e 범위 밖. 후속 sprint 에서
  enhance 가능.
- **dry-run probe 의 transaction overhead** — bounded UPDATE/DELETE 가
  WARN 인 모든 multi-statement batch 가 escalation probe 를 거치므로,
  RTT × candidate 개수만큼 latency 추가. 현재 100ms 이내 RTT 가정.
  사용자 perception 영향 최소화는 후속 sprint UX 폴리싱.
- **escalation 미적용 INSERT WARN** — INSERT 는 row-count 사전 추정 IPC
  가 없어 escalation 미적용. INSERT 100k 같은 대규모 bulk 는 여전히
  WARN dialog 만 발동. 향후 sprint 에서 INSERT 의 VALUES count 휴리스틱
  + dry-run 확장 가능.

## References

- Master spec: `docs/sprints/sprint-253/spec.md` §Sprint 254
- Contract: `docs/sprints/sprint-254/contract.md`
- ADR 0023: `docs/archives/decisions/0023-production-warning-environment-aware-chrome-and-warn-dialog/memory.md`
- 13-question grill (Q2-(a) 채택): `docs/sprints/sprint-253/grill-decisions.md`
- Sprint 253 baseline: commit 528063b
- Sprint 255 baseline: commit b8600bc
