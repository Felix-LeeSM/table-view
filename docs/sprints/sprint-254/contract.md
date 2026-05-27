# Sprint 254 Contract

> Reference: master spec `docs/sprints/sprint-253/spec.md` §Sprint 254.
> Reference: ADR 0023 / grill Q2-(a).

## Scope

Statement classifier 의 `severity` union 을 `"safe" | "danger"` (2-tier)
에서 `"info" | "warn" | "danger"` (3-tier) 로 split — Sprint 255 가
`isInfoStatement` 휴리스틱으로 우회한 부분을 정식 분류로 흡수. 추가:
WARN-tier bounded UPDATE/DELETE 의 dry-run row-count 가 100+ 면 STOP
으로 자동 escalate (Sprint 247 IPC 재사용). Sprint 255 의 dialog mount
경로는 보존 — 본 sprint 는 *분류 정밀화* 만 (UI 변경 0).

Acceptance criteria 매핑: AC-254-01 / AC-254-02 / AC-254-03 / AC-254-04 /
AC-254-05 / AC-254-06 / AC-254-07.

## Done Criteria (완료 기준)

1. **`StatementAnalysis.severity` union 3-tier 로 확장**:
   `src/lib/sql/sqlSafety.ts` 의 `Severity` type 이 `"info" | "warn" | "danger"` 로 변경. 기존 `"safe"` 값 사용처 (`useQueryExecution.ts`, `safeMode.ts`, `mongoSafety.ts`, 테스트) 모두 `"info"` 또는 `"warn"` 으로 매핑됨.

2. **INFO 분류**:
   `analyzeStatement` 가 SELECT / WITH …SELECT (no DML CTE) / EXPLAIN / SHOW / DESCRIBE / DESC → `severity: "info"`. Sprint 255 의 신규 `kind: "info"` (EXPLAIN/SHOW/DESCRIBE) 가 severity `"info"` 와 정합. `kind: "select"` 도 severity `"info"`. 단위 테스트 corpus 확장.

3. **WARN 분류**:
   INSERT / bounded UPDATE WHERE / bounded DELETE WHERE / CREATE / ALTER additive (no DROP COLUMN/CONSTRAINT) → `severity: "warn"`. 단위 테스트.

4. **STOP 분류 (severity `"danger"` 보존)**:
   DROP / TRUNCATE / WHERE-less DELETE·UPDATE / ALTER DROP COLUMN/CONSTRAINT / GRANT / REVOKE / Mongo $out·$merge·drop·*-all → `severity: "danger"`. 회귀 (이전 `"danger"` 와 동일).

5. **DML CTE 식별**:
   `WITH x AS (UPDATE …) SELECT *` / `WITH x AS (DELETE …) SELECT *` / `WITH x AS (INSERT …) SELECT *` 같은 DML CTE 는 INFO 가 아니어야 함. CTE 본문의 첫 키워드가 UPDATE/DELETE/INSERT 면 wrapped statement 의 severity 와 동일 결정. 회귀 0 — 기존 `WITH … SELECT` 는 INFO 보존.

6. **Mongo classifier 3-tier**:
   `src/lib/mongo/mongoSafety.ts` 의 `analyzeMongoPipeline` / `analyzeMongoOperation` 도 동일 3-tier — read-only aggregate / find → `"info"`, write *-many → `"warn"`, *-all / $out / $merge / drop → `"danger"`. 단위 테스트.

7. **dry-run row-count STOP escalation**:
   WARN-tier bounded UPDATE/DELETE 의 dry-run row count → 100+ 면 STOP 으로 escalate. Sprint 247 의 `executeQueryDryRun` IPC 재사용. 2s timeout, timeout/unsupported 시 STOP fallback. helper 신설 — `escalateWarnIfLargeImpact(connId, statement, severity, options): Promise<EffectiveSeverity>` 또는 `useQueryExecution` 안 inline. Mongo 는 IPC unsupported → escalate skip (현재 severity 그대로).

8. **`decideSafeModeAction` 새 tier 분기**:
   `src/lib/safeMode.ts` 가 `severity` 새 union 처리 — `info` → `allow` (항상), `warn` → `allow` (raw editor WARN dialog 가 QueryTab-level 에서 처리, 매트릭스 변경 0), `danger` → 기존 `confirm` (env-aware copy 보존). 시그니처 변경 0.

9. **Sprint 255 의 WARN dialog flow 보존**:
   `useQueryExecution.handleExecute` 가 `isInfoStatement(analysis)` 휴리스틱 대신 `analysis.severity === "info"` 직접 비교로 전환 — 기능 회귀 0. `pendingRdbWarn` / `pendingMongoWarn` 동작 보존.

10. **`isInfoStatement` / `isInfoMongoOperation` 의 본문 갱신**:
    Sprint 255 의 helper 본문이 새 severity 와 정합 — `severity === "info"` 로 단일화. export 시그니처 보존 (caller 회귀 0).

11. **AC-254-01..07 모두 매핑**.

12. **/tdd 흐름**:
    - 신규 corpus 테스트 먼저 (severity 3-tier 매핑 검증), fail (red) → 구현 → green.
    - dry-run escalation 테스트 (mock IPC return rowCount=150 → severity escalates to "danger"; mock timeout → severity "danger" fallback; mock unsupported → severity "danger" fallback).
    - 기존 회귀 테스트 (Sprint 245-249 SafeMode + Sprint 255 WARN dialog) 모두 pass.

13. **Verification Plan** 7개 check 모두 pass.

## Out of Scope

- Chrome H / top stripe / prod-only window border — Sprint 256.
- Button F (composed Execute button color × target) — Sprint 256.
- ConfirmDestructiveDialog 헤더 env token 정렬 — Sprint 256.
- Per-theme syntax palette curation — Sprint 257.
- Sprint 253 의 6 env tokens / `--tv-warning` 값 / TabBar.
- Sprint 255 의 dialog mount JSX / state shape (`pendingRdbWarn` / `pendingMongoWarn`).
- IPC 시그니처 변경 — `executeQuery`, `executeQueryDryRun`, `aggregateDocuments`, `findDocuments`, `cancelQuery`.
- safeModeStore / connectionStore / tabStore / queryHistoryStore 액션·상태 변경.
- 신규 ADR 작성 — ADR 0023 가 본 sprint 의 결정 묶음.
- WARN dialog 마찰 polish — Sprint 256 의 button F color matrix 가 carry.

## Invariants

- ADR 0022 Phase 1-5 / Sprint 250-252 polish 회귀 0.
- ADR 0023 Phase 1 (Sprint 253 token foundation) / Phase 2 (Sprint 255 WARN dialog mount) 동작 보존.
- AC-255-01..06 / AC-253-01..06 / AC-251-S1..S5 H1..H5 T1..T3 R1..R4 / AC-250-01..06 / AC-249-U1..U9 / AC-248-* / AC-247-* / AC-246-* / AC-245-* / AC-186-* / AC-185-* / AC-109 모두 회귀 0.
- IPC 시그니처 0 변경.
- `analyzeStatement` 의 함수 시그니처 보존 (반환 union 의 멤버 *값* 만 변경).
- `analyzeMongoPipeline` / `analyzeMongoOperation` 의 함수 시그니처 보존.
- `decideSafeModeAction` 시그니처 보존 + 매트릭스 의미 보존 (info → allow, warn → allow, danger → confirm).
- `useSafeModeGate` 인터페이스 보존.
- Mongo grid read-only invariant 보존.
- SafeMode 매트릭스 (mode × env × severity) 의 *결과* 회귀 0 — STOP 의 confirm 동작은 그대로, WARN 의 allow 동작도 그대로.
- 다중 statement 우선순위: STOP > WARN > INFO (worst tier 결정) — Sprint 255 와 동일.
- WARN dialog Cancel/X → IPC 미발동 + state clear (Sprint 255 동작 보존).

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 errors / 0 warnings)
  3. `pnpm vitest run` (전체 통과 + AC-254 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "severity: \"info\"|severity: \"warn\"" src/lib/` (≥ 5 매치 — sqlSafety + mongoSafety)
  7. `rg "escalateWarn|dry-run.*100|rowCount.*100" src/` (≥ 1 매치 — escalation helper)

- **Required evidence**:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 7 check stdout 발췌.
  - AC ↔ 파일:라인 매핑 (7 ACs).
  - `Severity` union 변경 본문 인용 + corpus 테스트 인용.
  - `analyzeStatement` 의 INFO/WARN/DANGER 3-tier 분류 코드 인용 (DML CTE 분기 포함).
  - `analyzeMongoPipeline` / `analyzeMongoOperation` 의 3-tier 분류 인용.
  - dry-run escalation helper 본문 + timeout / unsupported fallback 케이스 인용.
  - `decideSafeModeAction` 의 새 union 처리 diff 인용.
  - `useQueryExecution.handleExecute` 의 `severity === "info"` 직접 비교 전환 diff.
  - 기존 회귀 테스트 (Sprint 245-249 + 255) 모두 pass — vitest stdout 발췌.
  - /tdd 흐름 증거 (red → green log).
  - 가정 (예: dry-run 2s timeout, 100-row threshold, DML CTE 인식 휴리스틱) / 잔여 위험.

## References

- Master spec: `docs/sprints/sprint-253/spec.md` §Sprint 254
- 13-question grill (Q2-(a) 3-tier severity 채택): `docs/sprints/sprint-253/grill-decisions.md`
- ADR 0023: `docs/archives/decisions/0023-production-warning-environment-aware-chrome-and-warn-dialog/memory.md`
- Sprint 253 baseline: `docs/sprints/sprint-253/contract.md` (commit 528063b)
- Sprint 255 baseline: `docs/sprints/sprint-255/contract.md` (commit b8600bc)
- Relevant files:
  - `src/lib/sql/sqlSafety.ts`
  - `src/lib/sql/sqlSafety.test.ts`
  - `src/lib/mongo/mongoSafety.ts`
  - `src/lib/mongo/mongoSafety.test.ts`
  - `src/lib/safeMode.ts`
  - `src/lib/safeMode.test.ts`
  - `src/hooks/useSafeModeGate.ts`
  - `src/hooks/useSafeModeGate.test.ts`
  - `src/components/query/QueryTab/useQueryExecution.ts`
  - `src/components/query/QueryTab.execution.test.tsx`
  - `src/components/query/QueryTab.safe-mode.test.tsx`
  - `src/components/query/QueryTab.warn-dialog.test.tsx`
  - `src/lib/tauri/query.ts` (참조만 — `executeQueryDryRun` IPC 사용)
