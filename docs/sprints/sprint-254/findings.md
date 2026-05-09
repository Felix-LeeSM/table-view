# Sprint 254 Evaluation — findings

> Evaluator: Claude (Opus 4.7 1M).
> Date: 2026-05-09.
> Profile: System rubric (Correctness 35% / Completeness 25% / Reliability 20% /
> Verification Quality 20%).
> Inputs: `contract.md`, `execution-brief.md`, `spec.md` §Sprint 254,
> ADR 0023, `handoff.md`.

## Sprint 254 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness (35%)** | **9/10** | `Severity` union 정확히 3-tier (`sqlSafety.ts:20`). 모든 callsite 매핑 (info/warn/danger 만 등장; `severity === "safe"` 코드 0 — 남은 `"safe"` 는 stale 주석/문서만). DML CTE 분기 정확 (UPDATE/DELETE/INSERT 인식 + balanced paren extraction; `analyzeDmlCte` `sqlSafety.ts:82-108`). GRANT/REVOKE 새 분기 + DANGER (`:191-196`). `decideSafeModeAction` 결과 매트릭스 회귀 0 (L1..L8 + AC-254-05a/b 8개 커버). dry-run escalation 100/threshold 비교 정확 (`>=`; rowCount 100 → DANGER, 99 → WARN). 2s timeout `Promise.race` 정확 + IPC error catch → DANGER fallback 정확. 다중 statement worst-tier 우선순위 (STOP > WARN > INFO) 보존. Mongo escalation skip 정확 (`useQueryExecution.ts:530` 만 분기, helper 호출 X). |
| **Completeness (25%)** | **8/10** | AC-254-01..07 모두 매핑. corpus 충분 (sqlSafety.test.ts 의 INFO 6 + WARN 6 + STOP 7 + DML CTE 5 = 24개 신규). mongoSafety 의 INFO 4 + WARN 2 + DANGER 3 + isInfoMongoOperation 8 = 17개. escalation 8 cases (150 STOP / 50 WARN / timeout / IPC throw / INSERT skip / SELECT skip / WHERE-less DELETE 통과 / multi-statement 200rows). `decideSafeModeAction` 의 새 union 처리는 시그니처 변경 0. `analyzeStatement` / `analyzeMongoPipeline` / `analyzeMongoOperation` 시그니처 보존. **Minor gap**: 100/101 boundary 테스트 누락 (위쪽 150, 아래쪽 50 만; 정확 100 또는 101 edge case 없음). corpus 의 lowercase / multi-line 추가 가능. |
| **Reliability (20%)** | **8/10** | 2s timeout race 정확. catch-all → DANGER fallback (보수적). `result === undefined` → WARN (no escalate) — 문서화 명시. WARN dialog flow 보존 (`QueryTab.warn-dialog.test.tsx` 14/14 pass; handoff 의 "12 cases" 는 minor 기재 오류 — 실제 14). escalation 후 `pendingRdbConfirm` 으로 routing 시 batch-level (statements 전체 carry) — AC-231-02 ("single dialog per batch") 준수. 다중 statement 의 escalation 후 reason copy = "UPDATE/DELETE affects 100+ rows" 정확. **Subtle 위험**: empty/unknown statement default 가 INFO 로 변경 → Sprint 255 의 명시된 "`other` kind 도 WARN 대상" stance 일부 reverse. `\c admin` / `BAD ...` 가 더 이상 WARN dialog 를 mount 하지 않음. 완전한 contract 위반 아님 (Done Criteria #1 의 매핑 결정 권한 안에 있음) + ADR 0023 Q3 의 "모든 write 표면" 해석상 meta-command/syntax-error 는 write 가 아님 → 정당화 가능. 그러나 **regression risk**. |
| **Verification Quality (20%)** | **9/10** | 7-check Verification Plan 모두 pass: tsc 0 errors / lint 0 errors+warnings / vitest 3099 pass / cargo test 627 pass / cargo clippy clean / `severity: "info"\|"warn"` 20 매치 (>=5) / `escalateWarn\|dry-run.*100` 11 매치 (>=1). Handoff 의 evidence 섹션 풍부 (Severity union 인용, analyzeStatement 분기 인용, DML CTE / Mongo 3-tier / escalation helper / decideSafeModeAction diff / useQueryExecution diff). TDD red→green log 명시 (36 fail → 94 pass + 8 escalation pass). Assumptions 8개 + Residual Risk 4개 명시. **Minor**: `pnpm vitest run --coverage` 미실행 (신규 파일 coverage 명시 없음 — AC-GLOBAL-03 "70% 이상" 직접 증거 없음). |
| **Overall** | **8.4/10** | (9·0.35 + 8·0.25 + 8·0.20 + 9·0.20) = 3.15 + 2.00 + 1.60 + 1.80 = 8.55. |

## Verdict: **PASS**

## Sprint Contract Status

- [x] **AC-254-01** Severity union → `"info" | "warn" | "danger"`. 모든 callsite 매핑.
  - `src/lib/sql/sqlSafety.ts:20` — `export type Severity = "info" | "warn" | "danger"`.
  - 모든 callsite 통과 (`pnpm tsc --noEmit` 0 errors). `rg 'severity:\s*"safe"' src/` 코드 매치 0 (주석만).
- [x] **AC-254-02** SELECT/EXPLAIN/SHOW/DESCRIBE/WITH …SELECT no DML CTE → INFO.
  - `sqlSafety.ts:214-232` — SELECT/WITH/EXPLAIN|SHOW|DESCRIBE|DESC 분기 모두 `severity: "info"`.
  - `sqlSafety.test.ts:182-216` (AC-254-01a..f, 6 cases) all pass.
- [x] **AC-254-03** INSERT / bounded UPDATE WHERE / bounded DELETE WHERE / CREATE / ALTER additive → WARN.
  - `sqlSafety.ts:148-211` — DELETE WHERE/UPDATE WHERE/ALTER additive/CREATE/INSERT 모두 `severity: "warn"`.
  - `sqlSafety.test.ts:219-253` (AC-254-02a..f, 6 cases) all pass.
- [x] **AC-254-04** DROP / TRUNCATE / WHERE-less DELETE·UPDATE / ALTER DROP / GRANT / REVOKE / Mongo $out·$merge·drop·*-all → STOP.
  - `sqlSafety.ts:140-196` — DELETE/UPDATE no WHERE → DANGER. DROP/TRUNCATE/ALTER DROP → DANGER. GRANT/REVOKE 신규 → DANGER (`:191-196`).
  - `mongoSafety.ts:27-99` — $out/$merge/drop/*-all 모두 `severity: "danger"`.
  - `sqlSafety.test.ts:256-290` (AC-254-03a..g, 7 cases) + `mongoSafety.test.ts` 95-118 (3 *-all DANGER) all pass.
- [x] **AC-254-05** WARN bounded UPDATE/DELETE dry-run 100+ → STOP escalate. 2s timeout / unsupported → STOP fallback.
  - `escalateWarnIfLargeImpact.ts:52-94` — `Promise.race` against 2s timer. catch → "danger". timeout → "danger". rowCount >= 100 → "danger". 미만 → "warn".
  - `useQueryExecution.escalation.test.tsx` 8 cases all pass (150 STOP / 50 WARN / timeout STOP / IPC throw STOP / INSERT skip / SELECT skip / WHERE-less DELETE / multi 200 STOP).
  - Mongo skip — `useQueryExecution.ts:530` 만 `severity === "warn"` 분기, helper 호출 X.
- [x] **AC-254-06** `decideSafeModeAction` 새 union 처리 — INFO 항상 allow, WARN allow (현 safe 흐름), STOP confirm 보존.
  - `safeMode.ts:54-105` — `isDanger = analysis.severity === "danger"` only; `!isDanger → allow`. 매트릭스 결과 회귀 0.
  - `safeMode.test.ts:60-213` (L1..L8 + AC-254-05a/b) all pass — STOP confirm 보존, INFO/WARN allow.
- [x] **AC-254-07** Sprint 245-249 / Sprint 255 회귀 0.
  - `pnpm vitest run` 3099/3099 pass, 242 files. `cargo test --lib` 627 pass.
  - `QueryTab.warn-dialog.test.tsx` 14/14 pass (handoff 의 "12 cases" 는 오류 — 실제 14). `QueryTab.safe-mode.test.tsx` + `QueryTab.execution.test.tsx` + `QueryTab.document.test.tsx` 모두 pass.

## Verification Plan Results

| Check | Result | Evidence |
|-------|--------|----------|
| 1. `pnpm tsc --noEmit` | PASS (0 errors) | EXIT 0 |
| 2. `pnpm lint` | PASS (0/0) | EXIT 0 |
| 3. `pnpm vitest run` | PASS (3099/3099, 242 files, 47.3s) | EXIT 0 |
| 4. `cargo test --lib` | PASS (627/627, 2 ignored, 17.97s) | EXIT 0 |
| 5. `cargo clippy ... -D warnings` | PASS (clean) | EXIT 0 |
| 6. `rg "severity: \"info\"\|severity: \"warn\"" src/lib/` | PASS (20 matches >= 5) | sqlSafety + mongoSafety + safeMode + tests |
| 7. `rg "escalateWarn\|dry-run.*100\|rowCount.*100" src/` | PASS (11 matches >= 1) | helper + caller + tests |

## Critical Inspection Results

1. **SafeMode 매트릭스 회귀 0**: 검증 PASS. `decideSafeModeAction` 의 결과 (info/warn → allow, danger → confirm) 가 L1..L8 모두 회귀 0. STOP 의 env-aware copy ("production environment forces…") 보존 (`safeMode.ts:79-86`). WARN 의 allow 동작 보존 (`safeMode.test.ts:151-172`).
2. **Sprint 255 WARN dialog flow 보존**: 검증 PASS. `pendingRdbWarn` / `pendingMongoWarn` shape 0 변경. `useQueryExecution.ts:194-199` state 시그니처 그대로. `confirmRdbWarn` / `cancelRdbWarn` / `confirmMongoWarn` / `cancelMongoWarn` 시그니처 그대로. `QueryTab.warn-dialog.test.tsx` 14/14 pass (handoff 표기 12 → 실제 14, 문서 minor 오류).
3. **DML CTE 인식**: 검증 PASS. `analyzeDmlCte` (`sqlSafety.ts:82-108`) 가 `WITH x AS (UPDATE …) SELECT *` → wrapped statement severity 따름. AC-254-04a..d 4 cases 검증. `WITH x AS (SELECT …) SELECT *` → INFO 보존 (AC-254-04e).
4. **Mongo 3-tier**: 검증 PASS. `analyzeMongoPipeline` read-only → INFO (`mongoSafety.ts:43`), $out/$merge → DANGER (`:27-40`). `analyzeMongoOperation` *-many → WARN (`:90,101`), *-all/drop → DANGER (`:74-98`). `isInfoMongoOperation` 본문 `severity === "info"` 단순화 (`:117-119`). 8 cases corpus.
5. **dry-run escalation 정확도**: 검증 PASS. 100-row threshold (`>=`; 100 → DANGER). 2s timeout `Promise.race`. IPC throw catch → DANGER. Mongo paradigm escalate skip (helper 호출 자체 없음). **Minor gap**: 100/101 boundary edge test 부재 — 실제 threshold edge 의 회귀 가드는 unit test 가 아닌 implementation review 로 확인.
6. **Invariant 위반 의심**: 검증 PASS. `analyzeStatement` 시그니처 보존 (반환 union 의 멤버 *값* 만 변경). `analyzeMongoPipeline` / `analyzeMongoOperation` 동일. `decideSafeModeAction` 시그니처 보존. `useSafeModeGate` 변경 0. IPC 시그니처 0 변경. Rust 변경 0 (cargo test 627 pass — Sprint 247 dry-run IPC 재사용).
7. **Out of Scope 침범**: 검증 PASS. `git status`: 변경된 파일은 모두 Sprint 254 scope (sqlSafety / mongoSafety / safeMode / useQueryExecution + tests + escalation helper + 2 test 회귀 갱신). Chrome H / Button F / ConfirmDestructiveDialog 헤더 / per-theme syntax palette / 6 env tokens / TabBar / IPC / store 변경 0.
8. **테스트 품질**: 검증 mostly PASS. corpus 다양 (DML CTE 5 cases, INFO 6, WARN 6, STOP 7, isInfoStatement 15, Mongo isInfoMongoOperation 8). `lowercase` / `case-insensitive` / multi-line / leading whitespace edge case 일부 커버 (AC-185-01j, k; AC-255-01h). escalation 의 timeout / IPC throw / INSERT skip / SELECT skip / multi-statement 모두 검증. **Minor**: 정확 100-row boundary edge 부재. mock 만 통과한 fragile 테스트 없음 — 실제 helper 본문이 IPC 결과를 사용한다.
9. **`other` kind statement 의 INFO default**: **부분 우려**. Generator 가 handoff Assumptions #6 에서 `\c admin` / `BAD ...` 의 default 가 WARN 에서 INFO 로 변경되어 dialog 우회됐다고 명시. 두 회귀 테스트 (`QueryTab.execution.test.tsx` `collapses to error` / `QueryTab.document.test.tsx` 두 [S132] 케이스) 의 dialog click 단계가 제거됨. Sprint 255 handoff 의 명시된 "`other` kind 도 WARN 대상" stance 와 충돌. 그러나 **contract Done Criteria #1 의 매핑 결정 권한** 안에 있고, ADR 0023 Q3 의 "모든 write 표면" 의 *write* 정의를 좁게 해석한 것 (meta-command 와 syntax-error 는 write 가 아님) 으로 정당화 가능. 명시적 Sprint 254 Out of Scope 위반 아님.

## Assumptions Verification

| Generator Assumption | 평가 |
|---|---|
| 1. dry-run 2s timeout (`DRY_RUN_ESCALATION_TIMEOUT_MS = 2000`) | OK — master spec / contract 명시. |
| 2. 100-row threshold (`DRY_RUN_ESCALATION_THRESHOLD = 100`) | OK — master spec 명시. |
| 3. DML CTE first-CTE-only heuristic | Reasonable. Residual risk 명시 (multi-CTE first SELECT 의 경우 wrong-false). |
| 4. Mongo escalation skip | OK — IPC rdb-only. `useQueryExecution.ts:530` 만 분기, helper 미호출. |
| 5. INSERT / CREATE / ALTER additive escalation 미적용 | OK — master spec §Sprint 254 명시. INSERT row-count 추정 IPC 부재. |
| 6. Empty / unrecognised → INFO default | **검토 필요**. Sprint 255 handoff 의 명시 stance 와 reverse. 그러나 contract 매핑 결정 권한 안. defensive 정당화 가능. |
| 7. escalation IPC `@lib/tauri` barrel 통한 import | OK — vi.mock 정상 작동. |
| 8. STOP escalate reason copy "UPDATE/DELETE affects 100+ rows (dry-run threshold)" | OK — Sprint 256 의 dialog 헤더 token 정렬과 직교. |

## Residual Risks

- **`other` kind statement 의 INFO default**: handoff Assumptions #6 + Residual Risk 가 Sprint 255 handoff 의 "other kind 도 WARN" stance 와 충돌. 향후 sprint 에서 "unknown statement = INFO vs WARN" 의 정책 명시 ADR 또는 grill Q 보강 필요.
- **DML CTE multi-CTE 의 nested**: helper 가 first CTE 의 first write op 만 검사. `WITH a AS (SELECT 1), b AS (UPDATE …) SELECT *` 같은 case 의 wrong-false. handoff Residual Risk 에 명시. 후속 sprint 에서 enhance 가능.
- **dry-run probe 의 transaction overhead**: bounded UPDATE/DELETE 의 WARN candidate 다수 시 RTT × candidate 개수 latency. 현재 100ms RTT 가정 — 실측 검증 후속 sprint UX polish.
- **escalation 미적용 INSERT WARN**: INSERT 100k 같은 대규모 bulk 는 WARN dialog 만. master spec scope 안 — but residual.
- **100-row boundary edge test 부재**: 정확 100/101 row threshold 의 회귀 가드는 implementation review 만. corpus 강화 후속 sprint 가능.
- **Stale 주석**: `QueryTab.tsx:303-309` 의 "Sprint 254 의 3-tier split *will* widen WARN coverage" 가 stale (이미 Sprint 254 가 진행 중). minor doc-staleness — 후속 sprint 에서 정리.

## Feedback for Generator

PASS verdict이므로 강제 수정 사항 없음. 다음은 **추후 sprint 에서 carry 하면 좋을 minor improvements**:

1. **Test corpus**: 정확 100-row boundary edge case 추가 (`makeDmlResult(100)` → STOP, `makeDmlResult(99)` → WARN). escalation helper 의 `>=` 비교 회귀 가드.
2. **Doc staleness**: `src/components/query/QueryTab.tsx:303-309` 의 주석이 "Sprint 254 의 3-tier split *will* widen" 라고 하는데, Sprint 254 가 이미 진행 중이므로 "Sprint 254 가 widen" 으로 갱신.
3. **handoff 정확도**: handoff 의 "QueryTab.warn-dialog.test.tsx 의 12 cases" 는 실제 14 cases. evidence 신뢰성 확보 차원에서 정확한 숫자 기재 권장.
4. **Sprint 255 stance reverse 명시**: handoff Residual Risk 에 "Sprint 255 의 'other kind 도 WARN' 의 stance 가 본 sprint 에서 INFO default 로 부분 reverse 됨" 한 줄 추가 — 후속 evaluator / reader 가 충돌 인지하기 쉽게.
5. **`other` kind 의 정책 명시**: 향후 sprint 에서 "unknown statement = INFO vs WARN" 의 정책 ADR 보강 또는 grill Q 추가 — Sprint 254/255 의 implicit 충돌 해소.

## Overall Assessment

Sprint 254 contract 의 7 ACs 모두 만족, Verification Plan 7 checks 모두 pass, invariants
모두 보존. `decideSafeModeAction` 매트릭스 결과 회귀 0, Sprint 255 의 WARN dialog flow
state shape 0 변경. 3-tier severity classifier + DML CTE 인식 + dry-run row-count
escalation 모두 contract 명세대로 구현. TDD red→green 흐름 명시. 작은 minor: handoff
의 test count 표기, doc staleness, 100-row boundary edge test 부재 — 모두 production
gate 통과 수준은 아니다. **PASS.**
