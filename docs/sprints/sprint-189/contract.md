# Sprint Contract: sprint-189

## Summary

- **Goal**: Phase 23 closure refactor — RDB 5 사이트의 inline Safe Mode
  gate 를 Sprint 188 에서 도입한 `useSafeModeGate` hook 으로 마이그레이션.
  paradigm-agnostic decision matrix (Mongo aggregate 가 이미 사용 중) 을
  RDB 가 동일하게 consume 하도록 통일. drive-by 로 (a) `useSafeModeGate`
  의 `decide` 분기를 `src/lib/safeMode.ts` 의 pure function 으로 추출
  (D-4), (b) `src/lib/` sub-grouping 정리 (D-6 — `mongo/`, `sql/`,
  `safeMode.ts`), (c) `DEFAULT_PAGE_SIZE` 중복 단일화.
- **Audience**: Generator (single agent) — implements; Evaluator — verifies AC.
- **Owner**: harness orchestrator.
- **Verification Profile**: `vitest-only` — 5 사이트 모두 회귀 단언이
  vitest 로 가능. browser smoke 불필요 (각 분기는 기존 테스트가 이미
  cover; 신규 dedicated 테스트가 추가됨).

## In Scope

### 마이그레이션 — RDB 5 사이트

각 사이트에서 `useSafeModeStore` + `useConnectionStore` 두 selector 직접
read + inline `if (mode === "strict") ... if (mode === "warn") ...` 분기를
**삭제**하고, `useSafeModeGate(connectionId).decide(analyzeStatement(sql))`
호출로 통일. 분석 결과의 `decision.action` 으로 `allow` / `block` /
`confirm` 분기.

- `AC-189-01`: **`useDataGridEdit`** (`src/components/datagrid/useDataGridEdit.ts:864-905`).
  - 기존 inline gate 의 strict-loop / warn-loop 두 단계를 단일 loop +
    `gate.decide(...)` 로 통합. block → `setCommitError({...})`,
    confirm → `setPendingConfirm({ reason, sql, statementIndex })`,
    allow → batch 진행.
  - **`pendingConfirm.statementIndex` 보존** — `cancelDangerous` 가
    `setCommitError({ statementIndex, ... })` 로 "failed at: K" UI 를
    채우므로 component-local 필드로 유지. hook contract 와는 독립.

- `AC-189-02`: **`EditableQueryResultGrid`** (`src/components/query/EditableQueryResultGrid.tsx:241-287`).
  - 동일 패턴. `pendingConfirm: { reason, sql }` shape 보존
    (현재 statementIndex 없음).

- `AC-189-03`: **`ColumnsEditor`** (`src/components/structure/ColumnsEditor.tsx:516-556`).
  - `previewSql.split(";")` multi-statement 분석 loop 안에서 `gate.decide(...)`
    호출. block → `setPreviewError(decision.reason)`,
    confirm → `setPendingConfirm({ reason, sql: stmt })`.
  - **신규 dedicated safe-mode 테스트 5 케이스 추가** (정찰 결과 현재
    통합 테스트만 존재): strict block / warn confirm-then-run / warn
    cancel / off allow / non-prod allow.

- `AC-189-04`: **`IndexesEditor`** (`src/components/structure/IndexesEditor.tsx:331-366`).
  - 동일 패턴. **신규 dedicated safe-mode 테스트 5 케이스 추가**.

- `AC-189-05`: **`ConstraintsEditor`** (`src/components/structure/ConstraintsEditor.tsx:446-483`).
  - 동일 패턴. **신규 dedicated safe-mode 테스트 5 케이스 추가**.

각 사이트의 `confirmDangerous` / `cancelDangerous` helper 와 `runXxxBatch`
헬퍼는 **그대로 유지** (정찰 결과 5 사이트 모두 이미 추출됨). 마이그레이션은
inline gate 부분만 교체.

### Drive-by

- `AC-189-06a`: **D-4 — `decideSafeModeAction` pure function 추출**.
  - 신규 `src/lib/safeMode.ts`:
    ```typescript
    export function decideSafeModeAction(
      mode: SafeMode,
      environment: ConnectionEnvironment | null,
      analysis: StatementAnalysis,
    ): SafeModeDecision { /* ... */ }
    ```
  - `src/hooks/useSafeModeGate.ts` 의 `decide` 콜백은 `decideSafeModeAction(
    mode, environment, analysis)` 호출만. store wiring 만 hook 책임.
  - **신규 단위 테스트**: `src/lib/safeMode.test.ts` — decision matrix
    6 케이스 (safe / non-prod / strict / warn / off / missing connection).
    `useSafeModeGate.test.ts` 는 wiring (store read 유효성) 만 검증으로
    축소 — 로직 중복 단언 제거.

- `AC-189-06b`: **D-6 — `src/lib/` sub-grouping** (`docs/refactoring-plan.md` §스멜→Sprint 매핑 의 D-6 항목).
  - `src/lib/sql/` 통합: `sqlSafety`, `sqlDialect*`, `sqlTokenize`,
    `sqlUtils`, `rawQuerySqlBuilder`, `queryAnalyzer` (현재 flat).
  - `src/lib/mongo/` 통합: `mongoSafety`, `mongoTokenize` (현재 flat) +
    기존 `mongo/` sub-folder 보존.
  - `src/lib/safeMode.ts` 신설 위치 확정 (sub-folder 안 만듦, 단일 파일).
  - git mv + 모든 import 경로 일괄 갱신. 행동 변경 0.

- `AC-189-06c`: **`DEFAULT_PAGE_SIZE` 단일화**.
  - 신규 위치: `src/lib/grid/policy.ts` (또는 `src/lib/gridPolicy.ts`
    — 단일 파일이면 sub-folder 불필요. 구현 시 D-6 정합성 우선 결정).
  - `src/components/rdb/DataGrid.tsx:37` + `src/components/document/DocumentDataGrid.tsx:30`
    의 로컬 `const DEFAULT_PAGE_SIZE = 300;` 삭제, import 로 교체.

## Out of Scope

- **`useSafeModeGate` 의 return shape 변경 / API 확장** — Sprint 188 의
  `{ decide(analysis): SafeModeDecision }` 그대로. 본 sprint 는 callsite
  통일만.
- **`pendingConfirm` shape 통일** — 정찰 결과 useDataGridEdit 의
  `statementIndex` 가 cancelDangerous → setCommitError UI 에 의미 있으므로
  shape 통일 시도하지 않음. 5 사이트 각각 component-local state 유지.
- **`ConfirmDangerousDialog` props 변경** — 회귀 위험. Sprint 188 에서
  `aria-label` 만 정정한 상태 유지.
- **Mongo aggregate path** — 이미 Sprint 188 에서 hook consume 중. 무변경.
- **`docs/refactoring-smells.md` §8.2 (test-utils dead) 재평가** — 정찰
  결과 11 파일이 import 중으로 alive. smells 문서는 frozen snapshot 이라
  갱신 안 함. Sprint 189 findings 에 정정 기록만.
- **smell §6 의 hook deps 정리** (DataGridTable:552, SchemaTree:519,
  DataGrid:116, DocumentDatabaseTree:230) — Sprint 191 / 193 으로 분배
  (`memory/conventions/refactoring/hook-api/memory.md` C-2).
- **`runRdbBatch` / `runBatch` / `runAlter` / `runPendingExecute` helper
  의 공용화** — 5 사이트가 paradigm 별로 미세하게 다름. 본 sprint 의
  스코프는 gate 통일만, helper 통일은 하지 않음.

## Acceptance verification

- **vitest baseline 보존** + 신규:
  - `src/lib/safeMode.test.ts` (NEW, 6 cases — AC-189-06a).
  - `src/components/structure/ColumnsEditor.test.tsx` 의 새 `describe(
    "Sprint 189 — Safe Mode gate")` 5 cases (AC-189-03).
  - `src/components/structure/IndexesEditor.test.tsx` 동일 5 cases (AC-189-04).
  - `src/components/structure/ConstraintsEditor.test.tsx` 동일 5 cases (AC-189-05).
  - 기존 `useDataGridEdit.safe-mode.test.ts` (238 라인) /
    `EditableQueryResultGrid.safe-mode.test.tsx` (260 라인) **그대로 통과**
    — 마이그레이션이 단언 변경 0 보장.
  - `useSafeModeGate.test.ts` 는 wiring smoke 2~3 cases 로 축소 (decision
    matrix 단언은 lib 테스트로 이동).
- **lib import audit**: `src/lib/sql/*`, `src/lib/mongo/*`,
  `src/lib/safeMode.ts` 모두 `react` / `@stores/` / `@hooks/` import 0
  (D-1 검증 — `grep -l "from ['\"]react" src/lib/...`).
- **검증 4-set**: `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint`
  / `git diff --stat src-tauri/` empty 모두 통과.
- **회귀 0**: 5 사이트의 기존 strict block / warn confirm / off allow
  baseline 테스트 단언 변경 0.

## Commit 분할 (예상)

`memory/conventions/refactoring/decomposition/memory.md` A-5 의 5+ commit
시퀀스 적용:

1. **D-4 lib pure 추출** — `decideSafeModeAction` + lib 테스트 + hook 단순화.
2. **D-6 lib sub-grouping** — `sql/`, `mongo/` git mv + import 경로 갱신.
3. **DEFAULT_PAGE_SIZE 단일화** — 단일 export + 두 grid import.
4. **5 사이트 마이그레이션** — site 별로 분리 commit (5 커밋) 권장.
   각 commit 후 vitest 통과.
5. **cleanup** — dead import / 주석 / 문서 정정 (smells §8.2 정정 노트는
   findings.md 에).

각 commit 후 vitest / tsc / lint 통과 — 중간 빨간 상태 0.

## Refs

- `docs/sprints/sprint-188/{contract,findings,handoff}.md` — Phase 23
  closure 상태 + Sprint 188 findings §10 followup.
- `docs/refactoring-plan.md` — Sprint 189 항목 (시한부, Sprint 198 retire).
- `memory/conventions/refactoring/memory.md` — 코드 표준 4 카테고리 (영속).
- `memory/conventions/refactoring/store-coupling/memory.md` — B-6 (cross-
  store 결합은 hook 레벨에서만 — `useSafeModeGate` 가 본 룰 적용 사례).
- `memory/conventions/refactoring/lib-hook-boundary/memory.md` — D-4 / D-6.
- `memory/conventions/refactoring/hook-api/memory.md` — C-1 / C-2.
