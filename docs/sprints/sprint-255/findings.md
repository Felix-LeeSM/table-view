# Sprint 255 — Evaluator Findings

> Evaluator: Claude Opus 4.7 (1M ctx). Date: 2026-05-09.
> Profile: System rubric (non-UI command-profile work).
> Scope: ADR 0023 grill Q3-(b) "모든 환경 + 모든 write 표면" — raw SQL/MQL editor 의 WARN-tier preview dialog mount.

## Sprint 255 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness (35%)** | 9/10 | `handleExecute` 의 STOP > WARN > INFO 우선순위 분기 (`useQueryExecution.ts:628-684`) 가 STOP `confirm` 먼저 라우팅 후 early-return → WARN state 미설정으로 두 dialog 동시 mount 차단. `isInfoStatement` (sqlSafety.ts:155-157) 가 `kind === "select" \|\| kind === "info"` 만 true. `analyzeStatement` 의 EXPLAIN/SHOW/DESCRIBE/DESC 신규 분기 (`sqlSafety.ts:132-134`) 가 `kind: "info"` 로 매핑 — 기존 분기 회귀 0 (위 분기에서 매칭되지 않은 statement 만 도달). `useSafeModeGate` / `decideSafeModeAction` 시그니처 변경 0. `analyzeMongoPipeline` 시그니처 변경 0. `pendingMongoConfirm` / `pendingRdbConfirm` (Sprint 231) 동작 보존 — STOP path 에서 early return 하므로 WARN state 미설정. |
| **Completeness (25%)** | 9/10 | 6 ACs 모두 매핑 + 증거. SqlPreviewDialog mount JSX (`QueryTab.tsx:291-301`), MqlPreviewModal mount JSX (`:310-322`). `confirmRdbWarn` / `cancelRdbWarn` / `confirmMongoWarn` / `cancelMongoWarn` 4 callback 모두 export (`useQueryExecution.ts:418-445`). 14 신규 testcases 가 RDB WARN happy path / cancel / INFO skip / 다중 statement priority / Mongo INFO·STOP 회귀 모두 커버. Out of Scope (Sprint 254 의 3-tier classifier / 256 의 chrome / 257 의 palette) 침범 0. |
| **Reliability (20%)** | 8/10 | Cancel path → state clear (`setPendingRdbWarn(null)`) + IPC 미발동 (테스트 [AC-255-04a]). 다중 statement INSERT+DELETE-no-WHERE 에서 STOP-only 라우팅 검증 ([AC-255-06b]). `worstAction === "block"` 분기 (현재 decideSafeModeAction 이 block 반환 안 하지만) 보존. Loop 의 break 가 `block` 시에만 발생하므로 `confirm` 발견 후에도 후속 statement 가 `block` 으로 escalate 가능 — 정확. |
| **Verification Quality (20%)** | 9/10 | 7 check 모두 pass: tsc 0 errors / lint 0 / vitest 3065 passed / cargo test 627 passed / cargo clippy exit 0 / rg pendingRdbWarn 19 매치 / rg isInfoStatement 34 매치. Helper 단위 테스트 corpus 가 SELECT / WITH / EXPLAIN / EXPLAIN ANALYZE / SHOW / DESCRIBE / DESC / lowercase / INSERT / UPDATE WHERE / DELETE WHERE / CREATE / ALTER ADD COLUMN / DROP TABLE / 빈 입력 (15 cases) 망라. /tdd red→green 증거 명시. |
| **Overall** | **8.75/10** | |

## Verdict: PASS

## Sprint Contract Status (Done Criteria)

- [x] **AC-255-01** (`isInfoStatement` helper 신설 + EXPLAIN/SHOW/DESCRIBE 분기): `sqlSafety.ts:155-157` 의 helper, `:132-134` 의 새 `kind: "info"` 분기, `:9` 의 union 확장. 기존 분기 회귀 0 — 위 SELECT / WITH / DELETE / UPDATE / DROP / CREATE / ALTER 매칭 후에만 새 분기 도달. 단위 테스트 `sqlSafety.test.ts:171-259` (15 cases — corpus + WARN/STOP candidates).
- [x] **AC-255-02** (`isInfoMongoOperation` helper 신설): `mongoSafety.ts:127-129`. 단위 테스트 `mongoSafety.test.ts:147-203` (8 cases — empty pipeline / read-only / $out / $merge / dropCollection / deleteMany WHERE / updateMany WHERE).
- [x] **AC-255-03** (`useQueryExecution` WARN state + 4 callback): `useQueryExecution.ts:196-201` (state), `:418-445` (callbacks 4개), `:100-117` (interface field 6개 신설).
- [x] **AC-255-04** (`handleExecute` STOP > WARN > INFO 분기): RDB `useQueryExecution.ts:628-684` (worstAction loop + hasWarn 추적 + STOP early return + WARN routing). Mongo aggregate `:494-534` (gate confirm → STOP route, `analysis.severity === "safe" && !isInfoMongoOperation` → WARN route, 그 외 → 직접 IPC).
- [x] **AC-255-05** (`QueryTab.tsx` SqlPreviewDialog + MqlPreviewModal mount JSX): `QueryTab.tsx:291-301` (RDB WARN), `:310-322` (Mongo WARN). 회귀 테스트 [AC-255-03a..d] / [AC-255-04a] / [AC-255-06a..b] / [AC-255-07a..c].
- [x] **AC-255-06** (Sprint 250-252 polish 회귀 0): SqlPreviewDialog 의 `copyText={sql}` (Sprint 252 Copy 버튼) + `<SqlSyntax sql={sql} />` (Sprint 252 highlight) 보존. PreviewDialog onBlur commit / Esc discard / store-lift 기존 동작 영향 0. 전체 vitest 3065 / 3065 pass.

## Verification Plan Results

| Check | Result | Evidence |
|---|---|---|
| `pnpm tsc --noEmit` | pass (0 errors) | EXIT=0 |
| `pnpm lint` | pass (0/0) | EXIT=0 |
| `pnpm vitest run` | pass (Test Files: 241 passed; Tests: 3065 passed) | Duration 45.58s |
| `cargo test --lib` | pass (627 passed; 0 failed; 2 ignored) | EXIT=0 |
| `cargo clippy --all-targets --all-features -- -D warnings` | pass | EXIT=0 |
| `rg "pendingRdbWarn\|pendingMongoWarn" src/components/query/` | 19 매치 (≥ 2) | 2 files |
| `rg "isInfoStatement\|isInfoMongoOperation" src/lib/` | 34 매치 (≥ 2) | 4 files |

## Critical Inspection Notes

### Invariant 위반 의심 — 결과: 통과
- `analyzeStatement` 의 새 `kind: "info"` 분기는 위 SELECT/UPDATE/DROP/CREATE/ALTER/INSERT/WITH 분기 *이후* 추가됨. 기존 statement 가 `info` 로 잘못 매핑될 가능성 0.
- `StatementKind` union 에 `"info"` 추가 — 기존 caller (`useSafeModeGate`, `useDataGridPreviewCommit`, etc.) 는 모두 `severity` 만 보거나 `kind === "..."` 로 string 비교. exhaustive switch 미사용. 회귀 0.
- `useSafeModeGate` / `decideSafeModeAction` 시그니처 byte-for-byte 동일.
- `analyzeMongoPipeline` / `analyzeMongoOperation` 시그니처 / 반환 동일 — 새 helper 만 추가.

### Sprint 231 보존 — 결과: 통과
- `pendingRdbConfirm` / `pendingMongoConfirm` 의 callback 시그니처 / state shape 동일.
- STOP path 의 `setPendingRdbConfirm({ statements, reason })` 후 early return — WARN state 미설정으로 두 dialog 동시 mount 차단 보장.
- 회귀 테스트: `QueryTab.warn-dialog.test.tsx` [AC-255-06b] (production+warn+INSERT+DELETE → STOP only) + `QueryTab.safe-mode.test.tsx` 의 [AC-245-C4] etc 모두 pass.

### STOP > WARN 우선순위 — 결과: 통과
- `useQueryExecution.ts:669-675`: `if (worstAction === "confirm")` → `setPendingRdbConfirm(...)` + return. WARN check (`if (hasWarn)`) 는 그 *아래* 위치하므로 STOP 시 절대 도달 X.
- 동일 분기 in Mongo aggregate path (`:513-519`).

### Cancel/X path — 결과: 통과
- `cancelRdbWarn` / `cancelMongoWarn` callback 은 `setPending*Warn(null)` 만 호출. IPC 미발동.
- Test [AC-255-04a]: WARN dialog Cancel → `mockExecuteQuery` 미호출 + dialog dismissed + tab status idle 유지.

### EXPLAIN/SHOW/DESCRIBE corpus — 결과: 충분
- 단위 테스트가 SELECT / WITH (no DML CTE) / EXPLAIN / EXPLAIN ANALYZE / SHOW (TABLES) / DESCRIBE / DESC / lowercase 8 cases 명시.
- `^(EXPLAIN|SHOW|DESCRIBE|DESC)\b` 정규식이 `EXPLAIN ANALYZE` / `SHOW DATABASES` / `DESC users` 모두 prefix 매칭. (`\b` word boundary 가 `DESCRIBE` 와 `DESC` 모두 안전.)

### WITH …UPDATE CTE 가 WARN 으로 정확 분류 — 결과: 미통과 (사전 한계, 본 sprint OUT OF SCOPE)
- `analyzeStatement` 는 `^WITH\b` 만 매칭하여 `kind: "select"` 반환 — 즉 `WITH x AS (UPDATE …) SELECT *` 같은 DML CTE 도 INFO 로 분류됨.
- 이는 **사전 존재 한계** (Sprint 185 부터). 본 sprint 의 회귀가 아니다.
- Master spec §Sprint 254 가 명시적으로 "WITH …SELECT (no DML CTE) → INFO" 를 Sprint 254 task 로 지정. Sprint 255 contract 도 "WITH …SELECT no DML CTE 는 analyzer 에서 이미 `kind: "select"` 로 분류" 라고 acknowledged.
- 잔여 위험으로 기록만 — 본 sprint score 에 영향 0.

### Out of Scope 침범 — 결과: 통과
- Severity 3-tier split (info/warn/danger) 미시도 — `Severity` union 그대로 `"safe" | "danger"`.
- Dry-run row-count escalation 미시도.
- Chrome H / Button F / per-theme syntax palette / ConfirmDestructiveDialog 헤더 정렬 모두 미터치.
- `decideSafeModeAction` / `useSafeModeGate` 새 tier 분기 미추가.

### 테스트 품질 — 결과: 통과
- 14 cases 가 happy path (4 — INSERT/UPDATE WHERE/CREATE/ALTER ADD COLUMN) + cancel path (1) + INFO skip (4 — SELECT/EXPLAIN/SHOW/DESCRIBE) + multi-statement priority (2) + Mongo INFO/STOP/find (3) 모두 커버.
- 실제 `mockExecuteQuery.toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith` 로 IPC 1회 발동 검증 — fragile mock-only test 아님.
- [AC-255-06a]: `Copy SQL to clipboard` aria-label 존재로 dialog 가 `;\n` join SQL 을 보유했음을 가드 (SqlSyntax token 분리에 의한 textContent 매칭 회피 — 합리적 휴리스틱).

## 가정 검증

1. **EXPLAIN/SHOW/DESCRIBE/DESC 분류**: `kind: "info"` 신규 분기로 통합 — caller 회귀 0 (검증됨).
2. **Mongo find 항상 INFO**: find branch 가 analyzer 거치지 않고 즉시 IPC dispatch — 본 sprint 변경 0 (검증됨).
3. **danger + gate-allow → WARN bypass**: dev+warn 의 destructive (env-gated unguarded) 는 severity:"safe" 가 아니므로 WARN dialog 미발동 — ADR 0022 와 align (검증됨).
4. **`other` kind 도 WARN 대상**: PG `\c admin` / 잘못된 syntax 가 WARN dialog mount → 사용자 friction 잠재 (handoff 의 residual risk 1번에서 명시).
5. **다중 statement (INFO + WARN) preview**: `;\n` join 으로 전체 batch 노출 (검증됨).
6. **`pendingRdbConfirm` / `pendingMongoConfirm` (Sprint 231) 보존**: STOP path 의 early return 으로 WARN state set 안 됨 — 두 dialog 동시 mount 안 됨 (검증됨).

## 잔여 위험 지적

1. **Mongo aggregate WARN path 가 dead code**: 현재 `analyzeMongoPipeline` 가 모든 read-only pipeline 을 `mongo-other` + safe 로 분류 → `isInfoMongoOperation` 가 항상 true → WARN dialog 발동 안 됨. **Sprint 254 의 3-tier split 후 자연 활성화 예정 — contract 의 brief 가 "현재 분류상 거의 없음 — 보존을 위한 발판" 명시.** Sprint 255 의 평가에는 영향 없음.
2. **WITH …UPDATE CTE 가 WARN 우회 가능**: 위 [Critical Inspection] 참조. 사전 한계, Sprint 254 에서 fix 예정.
3. **`other` kind WARN 의 user surprise**: PG `\c admin` 같은 meta-command 가 WARN dialog 추가 → UX friction. 본 sprint OUT OF SCOPE 이지만 user feedback 모니터링 권장.
4. **다중 statement (INFO + WARN) preview 의 가독성**: `;\n` join 으로 모든 statement 노출. 매우 긴 batch 에서 syntax highlighting 성능 영향 가능 — Sprint 257 (per-theme syntax palette) 에서 검토.

## Feedback for Generator

PASS 판정. 추가 작업 불필요. 다음 sprint 로 이행 시 다음을 권고:

- **Sprint 254** 진입 시 `^WITH` 분기를 정밀화 (DML CTE 식별) 하여 본 sprint 의 잔여 위험 #2 해소.
- **Sprint 254** 의 3-tier split 후 `isInfoMongoOperation` 의 식별 corpus 를 확장하여 잔여 위험 #1 의 dead code 활성화.
- 본 sprint 가 도입한 `kind: "info"` 신규 union member 는 Sprint 254 의 severity 3-tier split 시 자연스럽게 `severity: "info"` 로 흡수 가능 — 두 sprint 에서 일관된 분류기 path 유지 가능.
- 본 sprint 의 dialog mount path 가 (a) 기존 `pendingRdbConfirm` 과 동일한 `runRdbSingleNow` / `runRdbBatchNow` helper 재사용 + (b) 기존 SqlPreviewDialog/MqlPreviewModal 컴포넌트 재사용 → 코드 중복 0. 좋은 설계.

---

> Findings 끝. Generator 의 변경은 contract 의 모든 invariant 와 6 ACs 를 충족하며, 회귀 0 으로 PASS 판정.
