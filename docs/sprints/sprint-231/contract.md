# Sprint Contract: sprint-231

## Summary

- Goal: P0 production-data-protection 회귀 fix — `QueryTab` editor 의 raw RDB query
  실행 경로 (`useQueryExecution.handleExecute` 의 single + multi-statement
  branch) 가 Safe Mode gate 를 우회한다. `UPDATE … SET …`, `DELETE …`
  WHERE 없이, `DROP TABLE` 등이 production connection 에서도 즉시
  실행된다. Sprint 185–190 cycle 이 Mongo aggregate / grid edit / DDL
  editors 에 깐 gate 와 같은 결을 raw RDB editor 에도 깔아 회귀를 닫는다.
- Audience: production user (2026-05-07 보고). Phase 23 (Safe Mode) 의
  invariant 복구.
- Owner: harness Generator
- Verification Profile: `command + static`

## In Scope

- `src/components/query/QueryTab/useQueryExecution.ts` — single-statement
  RDB path (line 335–368) + multi-statement RDB path (line 374–431) 양쪽에
  `analyzeStatement` + `useSafeModeGate.decide` 게이트를 삽입한다.
  Mongo aggregate path (line 238) 의 패턴을 그대로 답습한다.
- `pendingRdbConfirm` state + `confirmRdbDangerous` / `cancelRdbDangerous`
  callback 추가. shape 은 `{ statements: string[]; reason: string }` —
  multi-statement batch 는 1번의 confirmation 으로 전체 batch 를 통과시킨다
  (per-statement individual approval 금지).
- `src/components/query/QueryTab.tsx` — `pendingRdbConfirm` 을 두 번째
  `<ConfirmDangerousDialog>` 로 mount. `sqlPreview` prop 은 batch 의 모든
  statement 를 `;\n` join 한 문자열을 전달.
- AC-231-04 audit: `src/hooks/useDataGridPreviewCommit.ts` 의 promote-tab
  / Quick Look 단일 셀 경로가 preview 단계를 우회하는지 확인. 우회 경로가
  발견되면 같은 sprint 안에서 closing fix 적용 (gate 호출 + `pendingConfirm`
  surface 또는 commit refusal). 우회 경로가 없으면 audit 결과만 문서화하고
  파일은 diff = 0.
- AC-231-05 audit: `ConnectionDialog` environment dropdown 이 visible 하고
  `production` 옵션이 selectable 한지 verification only — 코드 변경 없음.
- 신규 vitest cases (≥ 8) — 7-cell decision matrix + 1 multi-statement
  mixed + 1 confirm-then-run + 1 TDD red→green capture.
- `docs/PLAN.md` 의 Feature sequencing 표 6번 row 를 ✓ 로 갱신.

## Out of Scope

- Sprint 232 (DataGrid id sorting + update row position).
- Sprint 233 (UPDATE SET column autocomplete + bottom strip syntax).
- Sprint 234 (cross-tab visual feedback / reorder ↑↓ / table COMMENT /
  schema picker move / type coloring).
- ConnectionDialog environment dropdown UX overhaul (default 옵션 변경,
  production warn-banner 등) — 별도 backlog.
- MongoDB raw query path — 이미 gated, 변경 없음.
- `decideSafeModeAction`, `analyzeStatement`, `safeModeStore` 본문 — 의도된
  decision matrix 와 분석기는 손대지 않는다.
- Sprint 226–230 freeze 산출물 (CreateTableDialog tabs / `usePostgresTypes`
  / 백엔드 `create_table` / `create_index` / `add_constraint` /
  `list_postgres_types` / Rust fixture).
- 추가 paradigm (kv/search) — `assertNever` 가드 그대로.

## Invariants

- `useDdlPreviewExecution.ts` diff = 0 (Sprint 214 freeze).
- `SqlPreviewDialog.tsx` diff = 0 (Sprint 214 freeze).
- `cross-window-*.test.tsx`, `window-lifecycle.ac141.test.tsx` diff = 0
  (Sprint 224 freeze).
- `connectionStore.ts`, `schemaStore.ts` diff = 0 (Sprint 219/223 freeze).
- `safeModeStore.ts` 본문 diff = 0 (decision matrix 가 이미 정확).
- `decideSafeModeAction` (`src/lib/safeMode.ts`) 본문 diff = 0.
- `analyzeStatement` (`src/lib/sql/sqlSafety.ts`) 본문 diff = 0.
- Sprint 226–230 backend fixture (`create_table` / `create_index` /
  `add_constraint` / `list_types` SQL fixture) byte-equivalent.
- Sprint 230 frozen files: `Header.tsx` / `IndexesTabBody.tsx` /
  `ForeignKeysTabBody.tsx` / `useFkReferencePicker.ts` /
  `usePostgresTypes.ts` / `postgresTypes.ts` / `CreateTableTypeCombobox.tsx`
  diff = 0.
- `useDataGridPreviewCommit.ts` diff = 0 — AC-231-04 audit 결과 leak 가
  발견되면 그 한 변경에 한정 (audit 문서화 동반).
- `useRawQueryGridEdit.ts` diff = 0 — 이미 gated, 변경 없음.
- ConnectionDialog 본문 diff = 0 (audit only).
- Mongo aggregate gate 동작 (existing `pendingMongoConfirm`) byte-equivalent.
- `it.skip`, `eslint-disable`, `any`, silent `catch{}` 신규 도입 0.

## Acceptance Criteria

- `AC-231-01` — Single-statement RDB path: `useQueryExecution.ts`
  line 335–368 가 `await executeQuery` 호출 직전에 `const analysis =
  analyzeStatement(sql)` + `const decision = safeModeGate.decide(analysis)`
  를 평가한다. dispatch matrix:
  - `decision.action === "allow"` → 기존 `executeQuery` 호출 진행.
  - `decision.action === "block"` → `executeQuery` 호출하지 않음.
    `updateQueryState(tab.id, { status: "error", error: decision.reason })`
    호출. `recordHistory({ sql, executedAt, duration: 0, status: "error" })`
    호출. running 상태 진입 금지.
  - `decision.action === "confirm"` → `setPendingRdbConfirm({ statements:
    [sql], reason: decision.reason })`. `executeQuery` 호출하지 않음.
    running 상태 진입 금지.
  주의: `dispatchDbMutationHint` 는 `block` / `confirm` 경로에서 호출하지
  않는다 (실제 backend 변경이 발생하지 않으므로 active_db 추측이 잘못된다).

- `AC-231-02` — Multi-statement RDB path: `useQueryExecution.ts` 의
  `splitSqlStatements` 결과를 단일 pass 에서 모두 분석한다. `for-of`
  루프로 `analyzeStatement(stmt)` 후 `safeModeGate.decide(analysis)` 를
  호출하고, 가장 심각한 결정을 채택한다. 우선 순위: `block` > `confirm` >
  `allow`. 어느 statement 라도 `block` 이면 batch 전체를 abort —
  `executeQuery` 호출 0회, `updateQueryState(tab.id, { status: "error",
  error: decision.reason })`, `recordHistory(... status: "error")`.
  `confirm` 결정이 (block 없이) 한 건 이상이면 `setPendingRdbConfirm({
  statements, reason })` 한 번만 호출 — 사용자가 1회 confirmation 으로
  전체 batch 를 통과시킨다 (per-statement 개별 승인 금지). multi-statement
  reason 은 첫 dangerous statement 의 reason 을 사용한다.

- `AC-231-03` — Pending confirm UI: `QueryTab.tsx` 가 `pendingRdbConfirm`
  truthy 일 때 `<ConfirmDangerousDialog>` 를 mount 한다 (Mongo path 와 같은
  컴포넌트 재사용). props:
  - `open` = true,
  - `reason` = `pendingRdbConfirm.reason`,
  - `sqlPreview` = `pendingRdbConfirm.statements.join(";\n")` — batch 전체
    을 사용자에게 verbatim 노출,
  - `onConfirm` = `confirmRdbDangerous`,
  - `onCancel` = `cancelRdbDangerous`.
  `confirmRdbDangerous` 는 gate 를 skip 하고 동일한 single 또는
  multi-statement path 를 그대로 재실행한다 (helper 추출 — `runRdbBatch` /
  `runRdbSingleNow` 두 callback 으로 single + multi 를 공통화). cancel 은
  `pendingRdbConfirm` 만 null 처리 (`updateQueryState` 호출 없음 — running
  진입 자체가 안 되었으므로 idle 유지).

- `AC-231-04` — `useDataGridPreviewCommit.ts` audit. 다음 두 시나리오를
  코드 + 테스트 양쪽에서 검사:
  - (a) Quick Look 단일 셀 빠른 편집 / promote-tab 직후 commit 흐름이
    `handleCommit` → `sqlPreview` 단계를 거치는지. handleCommit 의
    `paradigm === "document"` 분기, 그리고 RDB 분기가 `setSqlPreview` 를
    호출하는 경로 외에 `executeQueryBatch` 를 직접 부르는 사이트가 없는지.
  - (b) `handleExecuteCommit` 경로 (line 355–459) 의 `block` /
    `confirm` 분기가 모든 paradigm + promote 콜백 (e.g., `clearAllPending`)
    이전에 emit 되는지.
  audit 결과를 sprint findings.md 에 기록한다. leak 가 없으면 파일 diff = 0;
  발견되면 같은 sprint 안에서 fix 적용 + 새 vitest case 추가 + invariant
  exception 메모.

- `AC-231-05` — ConnectionDialog environment input verification. 다음을
  문서화 (코드 변경 없음):
  - `ConnectionDialogBody.tsx` 의 line 250–280 에 environment `<Select>`
    dropdown 이 존재. `htmlFor="conn-environment"` label / `aria-label
    ="Environment"`.
  - `ENVIRONMENT_OPTIONS` (`src/types/connection.ts:280`) 가 `production`
    포함.
  - `ENV_NONE_SENTINEL` 로 None 표현 (form.environment 는 `null`).
  - `ConnectionDialog.test.tsx` line 555–629 가 dropdown rendering /
    pre-select / save / None reset 을 모두 커버.
  - 사용자가 production connection 으로 등록하지 않으면 (None / staging /
    development 등) gate 가 항상 `allow` — 이는 `decideSafeModeAction`
    설계대로의 의도된 동작. UX 개선 (production 자동 감지 / 기본값 변경)
    은 별도 sprint 백로그.

- `AC-231-06` — Test suite. `QueryTab.execution.test.tsx` (또는 sibling
  `QueryTab.safe-mode.test.tsx` 신규 파일) 에 ≥ 8 새 vitest case:
  1. `[AC-231-01a]` production + strict + WHERE-less DELETE 단일
     statement → `executeQuery` 0회 호출 / `tab.queryState.status ===
     "error"` / error message `/Safe Mode blocked/` / history
     `status === "error"`.
  2. `[AC-231-01b]` production + warn + WHERE-less DELETE 단일 →
     `pendingRdbConfirm` 가 `{ statements: ["DELETE FROM users"], reason:
     "DELETE without WHERE clause" }` / `executeQuery` 0회.
  3. `[AC-231-01c]` production + off + DROP TABLE → block 경로 동작
     (`/production environment forces Safe Mode/`).
  4. `[AC-231-01d]` non-production (`development`) + strict + DROP TABLE
     → allow / `executeQuery` 1회.
  5. `[AC-231-01e]` production + strict + safe `SELECT * FROM users` →
     allow / `executeQuery` 1회.
  6. `[AC-231-02a]` production + strict + multi-statement
     `SELECT 1; DELETE FROM users` → `executeQuery` 0회 (전체 batch
     abort) / status error.
  7. `[AC-231-02b]` production + warn + multi-statement `UPDATE users SET
     active = 1 WHERE id = 1; DELETE FROM logs` → `pendingRdbConfirm.statements`
     길이 2 / `confirmRdbDangerous` 호출 후 `executeQuery` 정확히 2회 (각
     statement 1회씩, 순서 보존).
  8. `[AC-231-03]` `cancelRdbDangerous` 호출 → `pendingRdbConfirm` null /
     `executeQuery` 0회 / `tab.queryState.status` 가 idle 또는 fix 전
     상태로 복구 (running 미진입 invariant).
  최소 1 case 가 TDD red→green capture: 예 [AC-231-01a] — Sprint 231 전
  코드에서는 `executeQuery` 가 호출되어 fail 하고, fix 후 PASS. red-state
  log 를 `docs/sprints/sprint-231/tdd-evidence/red-state.log` 에 보존.

- `AC-231-07` — 회귀 0. Sprint 226–230 의 backend fixture / vitest case
  byte-equivalent. 4-set verification (`pnpm vitest run` / `pnpm tsc
  --noEmit` / `pnpm lint` / `cargo build --manifest-path src-tauri/Cargo.toml`)
  exit 0. `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
  `cargo test --manifest-path src-tauri/Cargo.toml` PASS. cross-window
  invariant (15/15) 통과.

- `AC-231-08` — `docs/PLAN.md` Feature sequencing (post-225 cycle) 표
  6번 row 를 다음으로 갱신:
  ```
  | 6 | **231** ✓ | feature | (Phase 23 회귀 fix) | Safe Mode raw RDB query path closure …
  ```
  Sprint 231 의 placeholder text (`Phase 27 sprint 6 폴리시 후보`) 는 Sprint
  234 row (별도 추가) 또는 향후 Sprint 232–234 row 로 분리.

## Design Bar / Quality Bar

- Helper 추출: `runRdbSingleNow(sql)` + `runRdbBatchNow(statements)`
  callback 두 개로 single / multi path 를 추출해 `confirm` 분기에서 재사용.
  Mongo path 의 `runMongoAggregateNow` 패턴 답습. 이것 없이 inline
  duplication 을 유지하면 confirm 후 재실행 코드가 분기당 1세트씩 = 2
  세트 중복.
- Decision priority resolver 는 단일 헬퍼 (`pickMostSevere(decisions)` 또는
  inline 우선순위 비교) — block > confirm > allow. multi-statement 경우
  최초 발견된 dangerous statement 의 reason 을 채택.
- `pendingRdbConfirm` shape `{ statements: string[]; reason: string }` —
  Mongo 의 `pendingMongoConfirm` 과 같은 결 (`pipeline` 자리에 `statements`).
- `dispatchDbMutationHint` 는 `block` / `confirm` cancel 경로에서 호출
  금지 (실제로 실행되지 않은 statement 가 active_db 를 flip 하면 안 됨).
  `confirm` 후 실행 경로에서는 호출.
- Hook deps array 는 `pendingRdbConfirm` 와 새 helper 들을 추가하되
  `eslint-disable react-hooks/exhaustive-deps` 주석 (기존)을 그대로 유지.
- 새 vitest case 는 `connectionStore` 에 명시적으로 production / development
  connection 을 setState 로 주입한다 (existing `useConnectionStore.setState`
  pattern, queryTabTestHelpers.ts:148 답습). `useSafeModeStore.setState({
  mode })` 로 mode 주입.
- 모든 새 case 에 작성 사유 + 날짜 (2026-05-07) 1줄 주석 (testing rule).

## Verification Plan

### Required Checks

1. `pnpm vitest run` PASS — file count ≥ 219 (≥ Sprint 230) + 새
   `QueryTab.safe-mode.test.tsx` 또는 확장된 `QueryTab.execution.test.tsx`
   case 8건. 신규 case 모두 pass.
2. `pnpm tsc --noEmit` exit 0 — `pendingRdbConfirm` / new callbacks 의
   타입 누수 없음.
3. `pnpm lint` exit 0 — `it.skip` / `eslint-disable` / `any` 신규 도입 0.
4. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0 — Rust 변경
   없음 expected.
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
   -- -D warnings` exit 0.
6. `cargo test --manifest-path src-tauri/Cargo.toml` PASS — Sprint 226–230
   backend test (`create_table` 16/16, `create_index` 11/11, `add_constraint`
   12/12, `list_types` 2/2 등) 동일 결과.
7. `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0.
8. `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0.
9. `git diff --stat src/__tests__/cross-window-*.test.tsx
   src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
10. `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts
    src/stores/safeModeStore.ts` = 0.
11. `git diff --stat src/lib/safeMode.ts src/lib/sql/sqlSafety.ts` = 0.
12. `git diff --stat src/components/schema/CreateTableDialog/Header.tsx
    src/components/schema/CreateTableDialog/IndexesTabBody.tsx
    src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx
    src/hooks/useFkReferencePicker.ts src/hooks/usePostgresTypes.ts
    src/lib/sql/postgresTypes.ts
    src/components/schema/CreateTableTypeCombobox.tsx` = 0.
13. `grep -nE 'safeModeGate|useSafeModeGate'
    src/components/query/QueryTab/useQueryExecution.ts` ≥ 2 hits (raw RDB
    path + Mongo aggregate path 양쪽 wired).
14. `grep -nE 'analyzeStatement'
    src/components/query/QueryTab/useQueryExecution.ts` ≥ 1 hit.
15. `grep -nE 'pendingRdbConfirm'
    src/components/query/QueryTab/useQueryExecution.ts
    src/components/query/QueryTab.tsx` ≥ 3 hits (state declaration / setter
    호출 / parent dialog mount 분기).
16. Sprint 226–230 vitest fixture (e.g.,
    `useDataGridEdit.safe-mode.test.ts`,
    `useDataGridPreviewCommit.safe-mode.test.ts`,
    `useRawQueryGridEdit.safe-mode.test.ts` 가 있다면) PASS unchanged.

### Required Evidence

- Generator must provide:
  - 변경 파일 표 (file → purpose) — 최소 4 파일
    (`useQueryExecution.ts` / `QueryTab.tsx` / 새 또는 확장된
    `QueryTab.*.test.tsx` / `docs/PLAN.md`).
  - vitest before/after count.
  - AC-231-NN ↔ vitest case name + line table.
  - 16 verification check 결과.
  - audit 결과 (AC-231-04 + AC-231-05) findings — leak 발견 여부 + 발견
    시 fix 상세 + 미발견 시 verification 근거.
  - TDD red→green capture — `docs/sprints/sprint-231/tdd-evidence/red-state.log`.
  - Assumption + residual risk.
- Evaluator must cite:
  - 각 AC 별 vitest case + line.
  - 16 verification check 별 PASS/FAIL.
  - audit finding 의 코드 근거 (line + file).

## Test Requirements

### Unit Tests (필수)

- AC-231-01 (single statement matrix) ↔ ≥ 5 case (allow safe / allow non-prod
  / block strict-prod / block off-prod / confirm warn-prod).
- AC-231-02 (multi statement) ↔ ≥ 2 case (mixed danger block / mixed danger
  confirm-then-execute).
- AC-231-03 (pending dialog) ↔ ≥ 1 case (cancel + confirm 양쪽).
- AC-231-04 (audit) ↔ leak 발견 시 추가 case; 미발견 시 audit memo 만.

### Coverage Target

- `useQueryExecution.ts` 신규 라인 70% 이상 (gate dispatch + helper +
  pending state).
- 전체 CI 기준 (라인 40% / 함수 40% / 브랜치 35%) 동결.

### Scenario Tests (필수)

- [x] Happy path — production + strict + safe SELECT (AC-231-01e).
- [x] 에러/예외 — block 시 history `error` 기록 + `executeQuery` 0회
  (AC-231-01a / AC-231-01c).
- [x] 경계 조건 — empty SQL (`tab.sql.trim() === ""` early return; 기존
  동작 보존), 동시 confirm 두 번 호출 (idempotent),
  `splitSqlStatements` 결과 0개 (early return), multi-statement 모든 항목이
  safe 인 경우 (allow + 기존 path 그대로).
- [x] 기존 기능 회귀 없음 — Mongo aggregate gate / grid edit gate / DDL gate
  / cross-window invariant.

## Test Script / Repro Script

1. (현재 상태 — fix 전) `pnpm tauri dev` → production environment 의
   PostgreSQL connection 생성 → query tab 에서 `UPDATE users SET active =
   false` 입력 → Run 버튼 클릭. **회귀**: 즉시 실행됨.
2. (fix 후) 동일 단계 → Run 클릭 → `<ConfirmDangerousDialog>` 가 열리며
   `reason: "UPDATE without WHERE clause"` 노출. Cancel → 실행 안 됨.
3. (fix 후) Safe Mode mode = `strict` 로 toolbar 토글 → 동일 입력 + Run →
   `<ConfirmDangerousDialog>` 대신 inline error message
   `Safe Mode blocked: UPDATE without WHERE clause (toggle Safe Mode off in
   toolbar to override)`. `executeQuery` 호출 안 됨.
4. (fix 후) Safe Mode = `off` + production 환경 → 동일 입력 + Run →
   `production environment forces Safe Mode` 메시지로 block (prod-auto).
5. (fix 후) connection environment = `development` → 동일 입력 + Run →
   즉시 실행됨 (gate 의 의도된 동작; AC-231-05 audit 참조).
6. multi-statement: `SELECT 1; DELETE FROM logs` (mode=warn, prod) →
   confirm dialog 1회 / preview 에 두 statement 모두 verbatim →
   Confirm → 두 statement 순서대로 실행 / history 1 entry.

## Ownership

- Generator: harness Generator agent.
- Write scope:
  - `src/components/query/QueryTab/useQueryExecution.ts` (단일 fix site).
  - `src/components/query/QueryTab.tsx` (dialog wiring).
  - `src/components/query/QueryTab.execution.test.tsx` 또는 신규
    `src/components/query/QueryTab.safe-mode.test.tsx` (≥ 8 new case).
  - 필요 시 `src/components/query/__tests__/queryTabTestHelpers.ts` 의
    `resetQueryTabStores` 에 `useSafeModeStore.setState({ mode: "strict" })`
    초기화 추가 (테스트 격리).
  - `docs/PLAN.md` (sequencing 표 row 갱신).
  - `docs/sprints/sprint-231/{contract.md,execution-brief.md,findings.md,handoff.md,tdd-evidence/red-state.log}`.
  - 만일 AC-231-04 audit 에서 leak 발견 시 `useDataGridPreviewCommit.ts`
    + 관련 test (해당 leak 를 closing 하는 최소 변경).
- Merge order: 단일 commit. tree 단위 1-commit (per
  `feedback_sprint_comment_cleanup.md`).

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- 16 verification checks 모두 PASS.
- 8 acceptance criteria 모두 evidence 와 함께 `handoff.md` 에 링크.
- `docs/PLAN.md` 6번 row 가 ✓ 로 갱신.
- `docs/sprints/sprint-231/tdd-evidence/red-state.log` 가 RED 상태를 보존.
- 사용자 repro 시나리오 (Test Script 1 → 2/3/4) 가 fix 후 차단 동작.
