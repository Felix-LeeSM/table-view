# Sprint Contract: sprint-248

## Summary

- Goal: ADR 0022 Phase 4 — 별도 "Dry Run" 버튼 + Cmd+Shift+Enter 단축키. 사용자가
  destructive dialog 를 거치지 않고도 임의 SQL 을 BEGIN/ROLLBACK 으로 미리
  실행해 결과를 그리드에 표시할 수 있게 한다. Phase 3 (Sprint 247) 의
  `executeQueryDryRun` IPC + `useDryRun` 인프라를 그대로 사용.
- Audience: Generator + Evaluator agents (harness 흐름)
- Owner: Phase 4 (Sprint 248)
- Verification Profile: `command`

## In Scope

### tabStore / QueryState 확장

1. **`src/types/query.ts`** — `QueryState.completed` 에 `isDryRun?: boolean`
   필드 추가. 기존 `status: "completed"` payload 모두 디폴트 false.
   `QueryStatementResult` 는 변경 없음 (statement 단위 dry-run 표시는 grid
   상단 단일 banner 로 충분).

2. **`src/stores/tabStore.ts`** — 신규 action
   `completeQueryDryRun(tabId, queryId, result | statements)` 추가:
   - 시그니처: `(tabId: string, queryId: string, result: QueryResult, statements?: QueryStatementResult[])`.
   - 본문: 기존 `completeMultiStatementQuery` 와 동일한 stale-response guard,
     단지 setState 결과에 `isDryRun: true` 플래그 추가.
   - 단일/멀티 문장 모두 한 action 으로 처리 (statements 미지정 = 단일).
   - JSDoc: "Phase 4 — explicit dry-run (Cmd+Shift+Enter / 'Dry Run' 버튼)
     완료 시 호출. ROLLBACK 이 끝난 read-only preview 라는 시각적 시그널
     (`isDryRun: true`) 만 컴포넌트가 surface 한다."

### 실행 hook 확장

3. **`src/components/query/QueryTab/useQueryExecution.ts`**:
   - 신규 action 노출: `handleDryRun: () => Promise<void>`.
   - Mongo paradigm (`tab.paradigm === "document"`) → `toast.info("Dry-run is
     not supported for MongoDB.")` 후 즉시 return (IPC 미호출).
   - 빈 SQL → 즉시 return (기존 `handleExecute` 와 동일한 가드).
   - `running` 상태에서 호출 → 무시 (기존 `handleExecute` 와 동일한 가드).
   - SQL split (`splitSqlStatements`) 후 `executeQueryDryRun(connectionId,
     statements, queryId)` 호출. queryId prefix `"dry:"`.
   - 성공 시 `completeQueryDryRun` 호출. 단일/멀티 문장 모두 동일 path.
   - 실패 시 기존 `failQuery` 호출 (에러 표시는 동일).
   - cancel: 기존 `cancelQuery` 와 동일하게 query token 등록.
   - Safe Mode dialog 트리거하지 않음 — dry-run 은 commit 안 하므로 정책
     대상 외 (단, history 에 `isDryRun` 표기는 옵션, 본 sprint 에선 history
     기록 자체를 생략).

4. **반환 shape 확장** — `QueryExecution.handleDryRun`. 기존 6개 필드 보존:
   ```ts
   export interface QueryExecution {
     handleExecute: () => Promise<void>;
     handleDryRun: () => Promise<void>; // NEW
     pendingMongoConfirm: ...;
     ...
   }
   ```

### Toolbar 버튼

5. **`src/components/query/QueryTab/Toolbar.tsx`**:
   - 신규 prop: `onDryRun: () => void`.
   - "Format" 버튼 앞 (또는 "Run" 버튼 바로 옆) 에 "Dry Run" 버튼 추가:
     ```tsx
     <Button
       variant="ghost"
       size="xs"
       onClick={onDryRun}
       disabled={isDocument || running || !tab.sql.trim()}
       aria-label="Dry run query"
       title="Dry run (Cmd+Shift+Enter) — BEGIN; ... ROLLBACK"
     >
       <FlaskConical />  {/* lucide-react 의 적절한 아이콘 */}
       <span>Dry Run</span>
       <span className="text-3xs text-muted-foreground">{"⌘⇧⏎"}</span>
     </Button>
     ```
   - Mongo (`isDocument === true`) 일 때 disabled.
   - Run 이 disabled (running / 빈 SQL) 인 조건과 동일하게 disabled.

6. **`src/components/query/QueryTab.tsx`** — Toolbar 에 `onDryRun={handleDryRun}`
   prop 전달.

### Editor 단축키

7. **`src/components/query/SqlQueryEditor.tsx`**:
   - 신규 prop `onDryRun: () => void`.
   - keymap 에 `Cmd-Shift-Enter` 바인딩 추가. `Mod-Enter` 와 동일한 패턴
     (`onDryRunRef.current()` 호출, `return true`).
   - 기존 `Mod-Enter` 바인딩 위치 보존 (defaultKeymap 보다 위).

8. **`src/components/query/QueryEditor.tsx`** — props 에 `onDryRun: () => void`
   추가, `SqlQueryEditor` 에 forward. `MongoQueryEditor` 는 prop 받지만
   keymap 추가 안 함 (Mongo dry-run 미지원).

9. **`src/components/query/MongoQueryEditor.tsx`** — prop 받기만 함 (keymap
   변경 없음, dry-run 호출 안 함).

10. **`src/components/query/QueryTab.tsx`** — paradigm router 의 두 SQL 경로 모두
    `onDryRun={handleDryRun}` 전달.

### Result grid banner

11. **`src/components/query/QueryResultGrid.tsx`**:
    - `result.isDryRun === true` 일 때 grid 상단에 banner:
      ```tsx
      {isDryRun && (
        <div
          role="status"
          data-testid="dry-run-banner"
          className="border-b border-warning/40 bg-warning/10 px-3 py-1 text-xs text-warning"
        >
          Dry Run — rolled back. No data was changed.
        </div>
      )}
      ```
    - props 에 `isDryRun?: boolean` 추가, `QueryTab.tsx` 에서 queryState
      payload 에서 파생해 전달.
    - tabStore 의 `QueryState.completed.isDryRun` 이 true 일 때만 banner
      mount.

### Mongo 가드 (toast)

12. Mongo 단축키는 짧은 toast 만 (`useQueryExecution.handleDryRun` 내부에서
    처리됨). 별도 keymap 변경 없음.

### 테스트

13. **`src/components/query/QueryTab/useQueryExecution.test.ts`** (또는 신규
    `useQueryExecution.dry-run.test.ts`):
    - `[AC-248-E1]` document paradigm → `toast.info` 호출 + `executeQueryDryRun`
      미호출.
    - `[AC-248-E2]` running 상태에서 호출 → no-op.
    - `[AC-248-E3]` 빈 SQL → no-op.
    - `[AC-248-E4]` 단일 문장 + 성공 → `completeQueryDryRun` 호출, `isDryRun:
      true` payload 전달.
    - `[AC-248-E5]` 단일 문장 + 실패 → `failQuery` 호출.
    - `[AC-248-E6]` 멀티 문장 → `executeQueryDryRun` 1회 호출 + statements
      배열 + isDryRun 표기.
    - `[AC-248-E7]` queryId prefix `"dry:"` 확인.

14. **`src/components/query/QueryTab/Toolbar.test.tsx`** (있으면 / 없으면 추가):
    - `[AC-248-T1]` rdb + idle + non-empty SQL → "Dry Run" 버튼 enabled.
    - `[AC-248-T2]` document → "Dry Run" 버튼 disabled.
    - `[AC-248-T3]` running → "Dry Run" 버튼 disabled.
    - `[AC-248-T4]` 클릭 → `onDryRun` 호출.

15. **`src/components/query/SqlQueryEditor.test.tsx`** (있으면 / 없으면
    `QueryEditor.test.tsx` 의 keymap 패턴 따라):
    - `[AC-248-K1]` Cmd-Shift-Enter 바인딩 → `onDryRun` 호출.

16. **`src/components/query/QueryResultGrid.banner.test.tsx`** (신규):
    - `[AC-248-B1]` `isDryRun=true` payload → banner DOM 노출.
    - `[AC-248-B2]` `isDryRun=false` (혹은 부재) → banner 부재.

## Out of Scope

- Cmd+Z pending undo 단축키 — **Phase 5 (Sprint 249)**.
- `decideSafeModeAction` / Safe Mode policy 변경 (Phase 1 그대로).
- ConfirmDestructiveDialog UI 변경 (Phase 2/3 그대로).
- `executeQueryDryRun` IPC 본문 / `useDryRun` hook 본문 변경 (Phase 3 그대로).
- Mongo dry-run 실제 구현 (toast disclaimer 만).
- DDL editor / DataGrid commit 흐름의 dry-run 버튼 — query tab 의 SQL 에디터
  에 한정.
- History 기록의 `isDryRun` 표기 (history 자체를 dry-run 에 대해 기록 안 함).

## Invariants

- `executeQuery` / `executeQueryBatch` IPC 동작 변경 0.
- `executeQueryDryRun` IPC + `useDryRun` hook 변경 0 (호출만 추가).
- `decideSafeModeAction` 본문 / 매트릭스 변경 0.
- `pendingConfirm` shape (모든 hook) 변경 0.
- `safeModeStore` / persistence / IPC 채널 변경 0.
- ConfirmDestructiveDialog 헤더 / Yes/No / `<DryRunPreview>` 동작 변경 0.
- 기존 `Mod-Enter` (`Cmd+Enter`) 단축키 동작 변경 0.
- `QueryState.completed.result` / `statements` shape 변경 0 — `isDryRun?` 만
  optional 추가 (기존 코드 모두 false 디폴트로 무영향).
- AC-247-D8..D11, AC-246-D1..D7, AC-245-L1..L8, AC-186-* 기존 가드 모두 통과.

## Acceptance Criteria

### Hook

- `AC-248-E1` document paradigm + `handleDryRun()` → `toast.info` ("Dry-run
  is not supported for MongoDB."), `executeQueryDryRun` 미호출.
- `AC-248-E2` running 상태 + `handleDryRun()` → no-op, IPC 미호출.
- `AC-248-E3` 빈 SQL + `handleDryRun()` → no-op, IPC 미호출.
- `AC-248-E4` rdb + 단일 문장 → `executeQueryDryRun` 1회 + `completeQueryDryRun`
  호출, payload `isDryRun: true`.
- `AC-248-E5` rdb + IPC reject → `failQuery` 호출.
- `AC-248-E6` rdb + 멀티 문장 → IPC 1회 호출 + statements 배열 + isDryRun.
- `AC-248-E7` queryId 가 `"dry:"` 로 시작.

### Toolbar

- `AC-248-T1` rdb + idle + non-empty SQL → "Dry Run" 버튼 enabled.
- `AC-248-T2` document → "Dry Run" 버튼 `disabled`.
- `AC-248-T3` running → 버튼 `disabled`.
- `AC-248-T4` 클릭 → `onDryRun` callback 1회 호출.

### Keyboard

- `AC-248-K1` SqlQueryEditor 의 `Cmd-Shift-Enter` keymap → `onDryRun` 호출.
- 기존 `Mod-Enter` keymap 은 `onExecute` 그대로 호출 (회귀 가드).

### Banner

- `AC-248-B1` `QueryResultGrid` 가 `isDryRun=true` 받으면
  `data-testid="dry-run-banner"` 노드 + 카피 "Dry Run — rolled back. No data
  was changed." 노출.
- `AC-248-B2` `isDryRun=false`/부재 → banner 부재.

### Wire-up

- `AC-248-W1` `QueryTab.tsx` 의 `<QueryTabToolbar>` JSX 가 `onDryRun={handleDryRun}`
  prop 을 전달.
- `AC-248-W2` `QueryTab.tsx` 의 두 SQL 에디터 mount (rdb / mongo router) 모두
  `onDryRun` prop 전달 (Mongo 는 노옵).

## Design Bar / Quality Bar

- TypeScript 0 errors. ESLint 0 errors / 0 warnings.
- vitest 모든 테스트 통과 (예상 ≥ 2950).
- Rust 미변경 → cargo test / clippy 회귀 가드 통과.
- 단축키 충돌 검증: 기존 `Cmd-Shift-F` (Favorites) / `Cmd-I` (Format) 등과
  충돌 없음. `Cmd-Shift-Enter` 는 신규.
- aria-label / title 모두 표기 (스크린 리더 지원).
- "Dry Run" 버튼 위치는 "Run" 바로 옆 권장 (사용자 mental model: 두 가지
  실행 옵션이 짝을 이룸).

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 errors.
2. `pnpm lint` — 0 errors / 0 warnings.
3. `pnpm vitest run` — 모든 테스트 통과. 신규 `AC-248-*` 매핑 명시.
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — 회귀 가드 (Rust
   미변경).
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 회귀 가드.
6. `rg "Cmd-Shift-Enter\\b" src/components/query/SqlQueryEditor.tsx` — 1 hit.
7. `rg "data-testid=\"dry-run-banner\"" src/components/query/QueryResultGrid.tsx` — 1 hit.

### Required Evidence

- Generator must provide:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 위 7 checks 의 stdout/stderr 발췌.
  - `[AC-248-*]` ↔ 테스트 파일:라인 매핑 표.
  - `handleDryRun` 본문 인용 (paradigm gate, queryId prefix, IPC dispatch).
  - `Cmd-Shift-Enter` keymap 코드 인용.
  - 기존 `Mod-Enter` 동작 보존 코드 spot.
  - 가정 / 잔여 위험 (예: history 에 dry-run 미기록 결정, banner 색상 토큰).
- Evaluator must cite:
  - 각 AC 항목별 테스트 파일:라인 또는 코드 위치.
  - paradigm guard / running guard 가 코드에 실제 존재하는지 검증.
  - `executeQueryDryRun` IPC 가 dry-run path 외에서 호출되지 않음을 grep 으로
    재확인.

## Test Requirements

### Unit Tests (필수)

- `useQueryExecution.dry-run.test.ts` (또는 기존 `.test.ts` 에 describe 추가)
  — 7 케이스 (`AC-248-E1..E7`).
- Toolbar 테스트 — 4 케이스 (`AC-248-T1..T4`).
- SqlQueryEditor keymap 테스트 — 1 케이스 (`AC-248-K1`).
- QueryResultGrid banner 테스트 — 2 케이스 (`AC-248-B1..B2`).

### Coverage Target

- 변경 / 신규 파일: 라인 70% 이상.
- 전체 CI: 라인 40% / 함수 40% / 브랜치 35% (현재 통과 기준 유지).

### Scenario Tests (필수)

- [x] Happy path — rdb + 단일 INSERT → dry-run → grid 에 banner + 0 rows
  affected (commit 안 됨).
- [x] 에러/예외 — IPC reject → failQuery + 에러 grid.
- [x] 경계 조건 — Mongo paradigm / running / 빈 SQL → no-op + toast (Mongo).
- [x] 회귀 없음 — 기존 `Mod-Enter` (Run) 동작, ConfirmDestructiveDialog dry-run
  표시 모두 통과.

## Test Script / Repro Script

```bash
git diff --stat HEAD

pnpm tsc --noEmit
pnpm lint

# 변경 영역 타겟 테스트
pnpm vitest run \
  src/components/query/QueryTab/useQueryExecution.dry-run.test.ts \
  src/components/query/QueryTab/Toolbar.test.tsx \
  src/components/query/QueryEditor.test.tsx \
  src/components/query/SqlQueryEditor.test.tsx \
  src/components/query/QueryResultGrid.banner.test.tsx \
  src/components/query/QueryTab.safe-mode.test.tsx \
  src/components/workspace/ConfirmDestructiveDialog.test.tsx \
  src/hooks/useDryRun.test.ts

# 전체 회귀
pnpm vitest run

# Rust 회귀 가드
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

# Wire-up grep
rg "Cmd-Shift-Enter\b" src/components/query/SqlQueryEditor.tsx
rg "data-testid=\"dry-run-banner\"" src/components/query/QueryResultGrid.tsx
```

## Ownership

- Generator: harness Generator agent (general-purpose)
- Write scope: 위 In Scope 의 파일들만. Cmd+Z (Phase 5) / Mongo dry-run 실제
  구현 / `executeQueryDryRun` IPC 본문 변경 금지.
- Merge order: 단일 commit 권장 — toolbar / 에디터 / hook / banner / store
  변경은 atomic. lefthook pre-commit 통과 필수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (전체 7 check).
- Acceptance criteria evidence linked in `handoff.md`.
- ADR 0022 본문 Phase 4 의 In Scope (별도 Dry Run 버튼 + 단축키) 와 일관성
  유지.
