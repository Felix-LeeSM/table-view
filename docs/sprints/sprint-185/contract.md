# Sprint Contract: sprint-185

## Summary

- **Goal**: Phase 23 / TablePlus 패리티 #4 — Safe Mode **MVP**. Phase 22
  의 Preview/Commit 게이트 위에 (a) WHERE-less DML / DDL drop 정적 분석,
  (b) production 연결 자동 식별 (`environment === "production"`), (c)
  strict / off 2-mode toggle, (d) commit pipeline 의 차단 inject, (e)
  Preview Dialog 헤더 색띠 (DataGrid + EditableQueryResultGrid 두 surface)
  를 더한다. 백엔드 변경 0 — `ConnectionConfig.environment` 가 이미 존재
  (`src/types/connection.ts:35,272-299` 의 `EnvironmentTag` /
  `ENVIRONMENT_META`) 하므로 프런트엔드만으로 가드 가능. mode 상태는
  Sprint 152 의 `attachZustandIpcBridge` 로 cross-window sync.
- **Audience**: Generator (single agent) — implements; Evaluator — verifies AC.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (browser smoke 권장 — Safe Mode 의
  목적이 명백히 사람이 보는 UX 이므로).

## In Scope

- `AC-185-01`: **`src/lib/sqlSafety.ts` (NEW)** — pure functions:
  ```ts
  type Severity = "safe" | "danger";
  interface StatementAnalysis {
    kind: "select" | "insert" | "update" | "delete" | "ddl-drop"
        | "ddl-truncate" | "ddl-other" | "other";
    severity: Severity;
    reasons: string[]; // human-readable, e.g. "DELETE without WHERE"
  }
  export function analyzeStatement(sql: string): StatementAnalysis;
  export function isDangerous(a: StatementAnalysis): boolean; // a.severity === "danger"
  ```
  검증 규칙:
  - `DELETE FROM <ident>` 단독 (WHERE 가 없는 토큰 시퀀스) → `delete` +
    `danger` + reason "DELETE without WHERE clause".
  - `UPDATE <ident> SET …` WHERE 가 없는 → `update` + `danger` + reason
    "UPDATE without WHERE clause".
  - `DROP TABLE` / `DROP DATABASE` / `DROP SCHEMA` → `ddl-drop` + `danger`
    + reason 첫 두 토큰 echo (예: "DROP TABLE").
  - `TRUNCATE` (TABLE 키워드 옵션) → `ddl-truncate` + `danger` + reason
    "TRUNCATE".
  - `INSERT INTO …`, `UPDATE … WHERE …`, `DELETE FROM … WHERE …`,
    `SELECT …`, `ALTER TABLE`, `CREATE TABLE/INDEX/…` → `safe`.
  - 주석 (single-line `--`, multi-line `/* */`) 은 token화 전에 stripping.
  - 대소문자 무관 (`delete` / `DELETE` / `Delete` 동일 처리).
  - **subquery WHERE 는 외부 WHERE 로 인정하지 않음** — `DELETE FROM t
    WHERE id IN (SELECT id FROM u)` 는 *외부* WHERE 가 있으므로 safe.
    `DELETE FROM t` 만 외부 WHERE 부재.
  - **MQL / Mongo 는 본 sprint 가 cover 안 함** (Mongo paradigm 은 SQL
    문자열 자체를 가지지 않으므로). 본 함수의 caller 는 RDB 분기만.

- `AC-185-02`: **`src/stores/safeModeStore.ts` (NEW)**:
  ```ts
  type SafeMode = "strict" | "off";
  interface SafeModeState {
    mode: SafeMode;
    setMode(next: SafeMode): void;
    toggle(): void;
  }
  ```
  - default `"strict"` — production 가드는 *기본값으로 활성*.
  - localStorage 영속화 (`zustand/middleware` `persist`).
  - cross-window sync — `attachZustandIpcBridge` 로 `mode` 키만 broadcast.
  - 단위 테스트: 초기값 / setMode / toggle / persist roundtrip / SYNCED_KEYS
    가 정확히 `["mode"]`.

- `AC-185-03`: **`src/components/workspace/SafeModeToggle.tsx` (NEW)**.
  - `WorkspaceToolbar` 의 `<DisconnectButton>` 앞에 삽입 (toolbar
    `flex h-9` 안 ml-auto 이전).
  - 시각: strict 일 때 shield-on icon + "Safe Mode" 텍스트 + production
    accent (`#ef4444` border 1px), off 일 때 shield-off icon + 라벨
    `"Safe Mode: Off"` + 무채색 (muted-foreground).
  - 클릭 → `useSafeModeStore.toggle()`.
  - aria-label, title (tooltip) 모두 명시.
  - 회귀 테스트: 두 상태의 텍스트 + aria + 클릭 후 store mode 토글.

- `AC-185-04`: **`useDataGridEdit.handleExecuteCommit` (RDB 분기) — Safe
  Mode 게이트 inject**.
  - 실행 직전 (`executeQueryBatch` 호출 전) 모든 statement 를
    `analyzeStatement` 로 검사.
  - **차단 조건**: `mode === "strict"` *그리고* connection 의
    environment === "production" *그리고* 어떤 statement 든
    `severity === "danger"`.
  - 차단 시: `commitError.message` 를 `"Safe Mode blocked: <첫 reason>
    (toggle Safe Mode off in toolbar to override)"` 로 set. `executeQueryBatch`
    *호출하지 않음*. 토스트 `toast.error` 로 동일 메시지. `failedKey`
    는 첫 danger statement 의 sqlPreviewStatements key.
  - **전제**: 본 commit pipeline 의 statements 는 Phase 22 generator 가
    만든 — UPDATE/INSERT/DELETE 모두 WHERE 절이 있는 것이 정상이므로,
    실제로는 본 가드가 발화하는 시나리오가 거의 없다. 단, raw query
    editor 의 미래 path 또는 generator 의 미래 옵션이 WHERE-less DML 을
    emit 하는 경우의 회귀 가드.
  - Mongo 분기 (paradigm === "document") 무수정.

- `AC-185-05`: **`EditableQueryResultGrid.handleExecute` — 동일 게이트**.
  - 실행 직전 sqlPreview 의 모든 statement 를 `analyzeStatement` 로 검사.
  - 차단 조건 / 메시지 / 토스트 형태는 AC-185-04 와 동일.
  - `executeError` 메시지에 "Safe Mode blocked: ..." 형식.

- `AC-185-06`: **Preview Dialog 헤더 색띠 — 두 surface**.
  - `src/components/rdb/DataGrid.tsx` (line 496~ Preview Dialog) 의
    DialogHeader 상단에 1px 색띠 1줄. Connection environment 색
    (`ENVIRONMENT_META[env].color`, environment 가 null 이면 색띠 없음
    — `null` 로 conditional).
  - `src/components/query/EditableQueryResultGrid.tsx` (line 470~
    Preview Dialog) 의 동일 위치에 동일 패턴.
  - color stripe = `<div className="h-1" style={{ background: color }} />`.
    aria-hidden 명시 (장식적, 의미는 environment 문자열로 별도 노출).
  - production 외 environment 도 같은 색 매핑 (production 만 빨강, 나머지
    각자 환경 색) — 사용자가 *어느* 환경에 commit 하는지 항상 시각화.

- `AC-185-07`: **회귀 + 시나리오 테스트**.
  - `sqlSafety.test.ts`: 12 케이스 (각 kind / WHERE 유무 / 주석 stripping
    / case-insensitivity / subquery WHERE).
  - `safeModeStore.test.ts`: 5 케이스 (default / setMode / toggle /
    persist / SYNCED_KEYS).
  - `SafeModeToggle.test.tsx`: 3 케이스 (strict 렌더 / off 렌더 / 토글).
  - `useDataGridEdit.safe-mode.test.ts` (NEW): 4 케이스 — (a) production +
    strict + WHERE-less DELETE → 차단 / (b) production + strict + safe
    statements → 통과 / (c) non-production + strict + WHERE-less → 통과
    (production 한정) / (d) production + off + WHERE-less → 통과 (사용자
    override).
  - `EditableQueryResultGrid.safe-mode.test.tsx` (NEW): 같은 4 케이스.
  - `DataGrid.test.tsx`, `EditableQueryResultGrid.test.tsx` 의 Preview
    Dialog 회귀 (색띠 표시 + connection 색이 정확히 환경 색).

## Out of Scope

- **`warn` mode** — Phase 23 spec 의 strict / warn / safe 3 모드 중 warn
  (추가 confirm 다이얼로그) 은 별 sprint. 본 sprint 는 strict / off
  2 모드만. 이유: warn 의 *confirm 다이얼로그* 자체가 새 component 한
  개 분량. 본 sprint scope 통제.
- **DDL typing confirm** — 사용자가 production 에서 DROP TABLE 을 강행할
  때 테이블명 재입력을 요구하는 confirm. 본 sprint 의 strict 모드는
  *차단* 만 하고 typing override 는 별 sprint.
- **`SqlPreviewDialog` (structure/)** 의 색띠 — `ColumnsEditor`,
  `IndexesEditor`, `ConstraintsEditor` 가 사용하는 별 component 는 본
  sprint Out of Scope. 동일 패턴이지만 surface 가 더 많아 별 sprint.
- **Mongo paradigm 의 dangerous-op 분류** — Mongo 의 `db.collection.drop()`
  / `deleteMany({})` 같은 위험 op 는 Mongo dispatch 에서 따로 가드해야
  하는데, MQL 정적 분석기는 본 sprint 범위 외. Mongo 분기는 Sprint 87 의
  MqlPreviewModal 그대로.
- **safety_level 새 필드** — Phase 23 spec 의 ConnectionConfig
  `safety_level` 필드는 본 sprint 가 환경 (`environment`) 으로 충분하다고
  판단해 도입하지 않음. 사용자가 production 외 환경에서 strict 가드를
  원할 때 별 sprint 가 safety_level override 도입.
- **Subquery 분석 의 정밀화** — `DELETE FROM t WHERE id IN (SELECT id
  FROM u WHERE …)` 같은 외부 WHERE 의 *형식*만 검사. 외부 WHERE 가
  `WHERE 1=1` 같은 의미상 zero-filter 인 경우는 검출하지 않는다 (별
  sprint).
- **Multi-statement parsing** — 본 sprint 의 caller 는 commit pipeline
  으로 이미 statement 별 분리됐으므로 `analyzeStatement` 도 *단일*
  statement 만 받는다. 사용자가 raw editor 에서 `DELETE FROM x; DELETE
  FROM y;` 한 줄로 입력하는 경로는 별 sprint (multi-statement splitter
  필요).
- **Sprint 175~184 산출물** — 코드 무수정. 단, AC-185-04/05 가
  `useDataGridEdit.ts` 와 `EditableQueryResultGrid.tsx` 의 commit catch
  블록 직전 *몇 줄*을 추가한다 (게이트 inject). 그 외 invariant 무변동.

### Files allowed to modify

- `src/types/connection.ts` — 변경 0. (이미 environment 필드 존재 확인.)
- `src-tauri/` — 변경 0.
- **NEW** `src/lib/sqlSafety.ts` — analyzer.
- **NEW** `src/lib/sqlSafety.test.ts` — 12 케이스.
- **NEW** `src/stores/safeModeStore.ts` — Zustand + persist + bridge.
- **NEW** `src/stores/safeModeStore.test.ts` — 5 케이스.
- **NEW** `src/components/workspace/SafeModeToggle.tsx` — 토글 버튼.
- **NEW** `src/components/workspace/SafeModeToggle.test.tsx` — 3 케이스.
- `src/components/workspace/WorkspaceToolbar.tsx` — `<SafeModeToggle />`
  삽입 1 줄.
- `src/components/datagrid/useDataGridEdit.ts` — RDB 분기 commit entry
  에 Safe Mode 게이트 inject. Mongo 분기 무수정.
- **NEW** `src/components/datagrid/useDataGridEdit.safe-mode.test.ts`.
- `src/components/query/EditableQueryResultGrid.tsx` — 동일 게이트
  inject + Preview Dialog 헤더 색띠.
- **NEW** `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`.
- `src/components/rdb/DataGrid.tsx` — Preview Dialog 헤더 색띠. Connection
  prop 이 already props 통해 들어와 있으면 그것의 environment 사용,
  아니면 connection store 에서 selector.
- `src/components/rdb/DataGrid.test.tsx` — 색띠 회귀.
- `docs/sprints/sprint-185/contract.md` (this file).
- `docs/sprints/sprint-185/findings.md` (new).
- `docs/sprints/sprint-185/handoff.md` (new).

## Invariants

- **Sprint 175~184 산출물**: 위에 명시된 두 commit pipeline (RDB) 외
  무수정. 특히 `executeQueryBatch` IPC, `RdbAdapter::execute_sql_batch`,
  `PostgresAdapter::execute_query_batch`, `PendingChangesTray`,
  `MqlPreviewModal`, `dispatchMqlCommand` 모두 git diff 0.
- **Mongo paradigm 의 commit 동작 무변동** — 본 sprint 가 Mongo 게이트를
  *추가하지 않는다*. Mongo 의 위험 op 가드는 별 sprint.
- **`environment === null` 연결의 동작 무변동** — production 식별이
  안 되는 연결은 strict 모드라도 통과. 사용자가 connection edit 에서
  environment 를 명시해야 가드 활성.
- **신규 런타임 의존성 0**. `package.json` / `Cargo.toml` 미변경.
- **`it.skip` / `it.todo` / `xit` 0건** (skip-zero gate). Rust 측
  `#[ignore]` 0건 net new (변경 없음).
- **strict TS / ESLint**: `any` 금지, `pnpm tsc --noEmit` zero,
  `pnpm lint` zero.

## Acceptance Criteria

- `AC-185-01` — `analyzeStatement` 가 12 케이스 단위 테스트 통과.
- `AC-185-02` — `safeModeStore` 가 5 케이스 단위 테스트 통과 + cross-window
  bridge 등록 확인.
- `AC-185-03` — `SafeModeToggle` 가 3 케이스 시각/상호작용 회귀 통과.
- `AC-185-04` — useDataGridEdit RDB 분기 4 시나리오 (block/pass × 2)
  통과.
- `AC-185-05` — EditableQueryResultGrid 동일 4 시나리오 통과.
- `AC-185-06` — Preview Dialog 헤더 색띠가 environment 색 정확히 표시
  (회귀 테스트 2 surface).
- `AC-185-07` — 위 모든 검증 + skip-zero + 신규 ignore 0 + Sprint 175~184
  산출물 git diff 0 (commit pipeline 두 진입점 외).

## Design Bar / Quality Bar

- **analyzer 는 pure / sync / no-throw** — 잘못된 SQL 도 `kind: "other"`
  + `severity: "safe"` 로 graceful. 본 sprint 가 SQL parser 를 자처하지
  않음 (정확한 파싱은 PG 측 책임).
- **regex first** — 토큰화 + state machine 보다 anchored 정규식 몇
  개 + 주석 stripping 이 본 sprint 의 분류에 충분. case-insensitive
  flag 명시.
- **block message 표준 문구**: 정확히 `"Safe Mode blocked: <reason>
  (toggle Safe Mode off in toolbar to override)"`. 변경 시 회귀 테스트
  와 함께.
- **store sync key 단일**: `safeModeStore` 의 SYNCED_KEYS = `["mode"]`
  하나. 다른 키 broadcast 금지 (회귀 테스트로 핀).
- **시각 색띠 일관성**: 두 Preview Dialog 가 동일 markup 패턴 (`<div
  className="h-1" style={{ background: color }} aria-hidden />`). 별
  컴포넌트로 빼지 않음 (call site 가 두 곳뿐 + future structure surface
  도입 시 그때 helper 로 승격).
- **테스트 명명**: `[AC-185-0X]` prefix. 각 신규 테스트에
  `// AC-185-0X — <reason>; date 2026-05-01.` 코멘트 (auto-memory
  `feedback_test_documentation.md`).
- **커버리지**: 신규 라인 80% 이상. analyzer 의 모든 reason 분기 100%.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/lib/sqlSafety.test.ts
   src/stores/safeModeStore.test.ts
   src/components/workspace/SafeModeToggle.test.tsx
   src/components/datagrid/useDataGridEdit.safe-mode.test.ts
   src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`
   — 신규 5 파일 green.
2. `pnpm vitest run` — 전체 suite green (회귀 0).
3. `pnpm tsc --noEmit` — zero errors.
4. `pnpm lint` — zero errors.
5. `cd src-tauri && cargo test --lib` + clippy + fmt — clean (코드 변경
   0 회귀 가드).
6. **Static (Generator-recorded, Evaluator re-runs)**:
   - `git diff src-tauri/` — empty.
   - `git diff src/types/connection.ts` — empty.
   - `grep -RnE 'it\.(skip|todo)|xit\(' src/lib/sqlSafety.test.ts
     src/stores/safeModeStore.test.ts
     src/components/workspace/SafeModeToggle.test.tsx
     src/components/datagrid/useDataGridEdit.safe-mode.test.ts
     src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` →
     0 matches.

### Required Evidence

- Generator: 변경 파일 목록 (purpose 한 줄씩); Vitest stdout 일부;
  `findings.md` 섹션 (analyzer 설계 결정 / strict-only 결정 / Out of Scope
  warn 모드 이유 / cross-window sync 패턴 / AC→테스트 매핑); `handoff.md`
  AC 별 evidence 행.
- Evaluator: AC 별 통과 evidence 인용 + invariant `git diff` 확인.

## Test Requirements

### Unit Tests (필수)

- **`src/lib/sqlSafety.test.ts`** (12):
  - `[AC-185-01a] DELETE without WHERE → danger`
  - `[AC-185-01b] DELETE with WHERE → safe`
  - `[AC-185-01c] UPDATE without WHERE → danger`
  - `[AC-185-01d] UPDATE with WHERE → safe`
  - `[AC-185-01e] DROP TABLE → danger`
  - `[AC-185-01f] DROP DATABASE → danger`
  - `[AC-185-01g] TRUNCATE → danger`
  - `[AC-185-01h] INSERT INTO → safe`
  - `[AC-185-01i] SELECT → safe`
  - `[AC-185-01j] case-insensitive (delete from t) → danger`
  - `[AC-185-01k] strips line comments before analysis`
  - `[AC-185-01l] subquery WHERE counted as outer WHERE present`
- **`src/stores/safeModeStore.test.ts`** (5):
  - `[AC-185-02a] default mode is "strict"`
  - `[AC-185-02b] setMode updates mode`
  - `[AC-185-02c] toggle flips strict↔off`
  - `[AC-185-02d] persists to localStorage`
  - `[AC-185-02e] SYNCED_KEYS exactly ["mode"]`

### Component Tests (필수)

- **`src/components/workspace/SafeModeToggle.test.tsx`** (3):
  - `[AC-185-03a] strict renders shield-on + "Safe Mode" label`
  - `[AC-185-03b] off renders shield-off + "Safe Mode: Off" label`
  - `[AC-185-03c] click toggles store mode`
- **`useDataGridEdit.safe-mode.test.ts`** (4):
  - `[AC-185-04a] production + strict + WHERE-less DELETE → blocked, executeQueryBatch not called, commitError matches /Safe Mode blocked/`
  - `[AC-185-04b] production + strict + safe DML → passes through`
  - `[AC-185-04c] non-production + strict + WHERE-less DELETE → passes (env-gated)`
  - `[AC-185-04d] production + off + WHERE-less DELETE → passes (mode override)`
- **`EditableQueryResultGrid.safe-mode.test.tsx`** (4): 같은 4 시나리오.
- **`DataGrid.test.tsx` 색띠 회귀** (1): production 연결 → Preview
  Dialog 헤더에 빨간 색띠 1px (style.background == `#ef4444`).
- **`EditableQueryResultGrid.test.tsx` 색띠 회귀** (1): 동일.

### Coverage Target

- 신규 라인: 80% 이상. analyzer 의 reason 분기는 100%.

### Scenario Tests (필수)

- [x] Happy path — analyzer 가 모든 kind 정확히 분류.
- [x] 빈/누락 입력 — 빈 SQL → `kind: "other"` + safe.
- [x] 에러 복구 — strict block 후 사용자가 토글 off → 다시 commit 통과.
- [x] 동시성 — 본 sprint 가 새 race 도입 안 함. cross-window sync 만
  추가 (이미 zustand-ipc-bridge 가 race-safe).
- [x] 상태 전이 — strict ↔ off 토글 + persist roundtrip.
- [x] 회귀 — Mongo 분기 무영향.

## Test Script / Repro Script

1. `pnpm install`.
2. `pnpm vitest run src/lib/sqlSafety.test.ts
   src/stores/safeModeStore.test.ts
   src/components/workspace/SafeModeToggle.test.tsx
   src/components/datagrid/useDataGridEdit.safe-mode.test.ts
   src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`.
3. `pnpm vitest run` (full suite).
4. `pnpm tsc --noEmit`.
5. `pnpm lint`.
6. `cd src-tauri && cargo test --lib` + clippy + fmt.
7. Static greps + invariant `git diff` (Verification Plan §6).
8. (Optional) Operator browser smoke — production-tagged 연결 →
   `EditableQueryResultGrid` 에서 raw `DELETE FROM users` 입력 → Cmd+S →
   Commit 클릭 → blocked 토스트. 토글 off → 다시 commit → 통과 (실제
   PG 는 PK 충돌 등으로 다른 에러로 fail 하지만 *Safe Mode 차단* 은
   해제됨을 확인).

## Ownership

- Generator: single agent.
- Write scope (정확): 위 §"Files allowed to modify".
- Untouched: `CLAUDE.md`, `memory/`, `src/types/connection.ts`, sprints
  175~184 코드 산출물 (commit pipeline 두 진입점의 inject 외 무수정),
  `package.json`, `Cargo.toml`, `src-tauri/` 전체, Mongo adapter / dispatch
  코드.
- Merge order: Sprint 184 머지 후 (이미 머지됨, commit `17a97fa`). Phase
  23 의 후속 sprint (warn 모드 / DDL typing confirm / structure surface
  색띠) 가 본 sprint 위에서 시작.

## Exit Criteria

- 열린 `P1` / `P2` findings: `0`
- Required checks 통과: `yes` (1–6 in Verification Plan)
- `docs/sprints/sprint-185/findings.md` 존재 + 사양대로 섹션 채움.
- `docs/sprints/sprint-185/handoff.md` 에 AC 별 evidence 행 (한 행 =
  한 AC).
