# Sprint Execution Brief: sprint-248

## Objective

ADR 0022 Phase 4 — destructive dialog 를 거치지 않고 임의 SQL 을 BEGIN/ROLLBACK
으로 미리 실행하는 explicit "Dry Run" 액션 추가:
- 신규 `handleDryRun` action in `useQueryExecution`.
- "Dry Run" toolbar 버튼 (Run 옆) + Cmd+Shift+Enter 단축키.
- `QueryState.completed.isDryRun` flag → `<QueryResultGrid>` banner.
- Mongo paradigm 은 toast disclaimer 로 fallback.

## Task Why

Phase 1-3 가 destructive 자동 dialog + dry-run preview 를 통합했지만, "내가
지금 작성한 SELECT 결과가 INSERT 후 어떻게 바뀔지" 같은 일상적 미리보기 요구
는 아직 수동 BEGIN/ROLLBACK 이 필요했음. Phase 4 의 별도 버튼/단축키는 이
power-user 워크플로 (TablePlus 의 "Run", DBeaver 의 "Explain Plan" 옆에 자리
잡는 패턴) 를 채워, ADR 0022 의 "user-driven safety net" 약속을 완성한다.

## Scope Boundary

- 변경: `useQueryExecution` (신규 `handleDryRun`), Toolbar 버튼, `QueryEditor`/
  `SqlQueryEditor` 단축키, `QueryResultGrid` banner, `tabStore` 신규 action,
  `QueryState` payload 의 optional `isDryRun?: boolean`, query tab 라우팅
  (`QueryTab.tsx` 에서 hook → toolbar / editor 와이어링).
- 변경 금지:
  - `executeQuery` / `executeQueryBatch` / `executeQueryDryRun` IPC 본문.
  - `decideSafeModeAction` / SafeModeStore.
  - `useDryRun` hook 본문 (호출만).
  - ConfirmDestructiveDialog / `<DryRunPreview>` 동작 (Phase 2/3 결과 보존).
  - 기존 `Mod-Enter` (Run) 단축키 동작.
  - History 에 dry-run 기록 (의도적 생략).
  - DDL editor / DataGrid commit 흐름 (out of scope).
  - Cmd+Z (Phase 5).

## Invariants

- 기존 `Mod-Enter` keymap = Run 동작 보존.
- `QueryState` 의 기존 4 status / statements shape 보존, `isDryRun` 만 추가.
- `pendingConfirm` shape (모든 hook) 보존.
- `executeQueryDryRun` IPC 가 dry-run path 외에서 호출되지 않음 (Phase 3 의
  ConfirmDestructiveDialog 호출 + 신규 `handleDryRun` 이외 0).
- AC-247-* / AC-246-* / AC-245-* / AC-186-* 기존 가드 보존.

## Done Criteria

1. `useQueryExecution.handleDryRun` 추가 (paradigm/running/empty 가드, IPC
   호출, queryId "dry:" prefix, success → `completeQueryDryRun`, error →
   `failQuery`).
2. Toolbar "Dry Run" 버튼 (rdb idle + non-empty SQL 만 enabled, 클릭 →
   `onDryRun`).
3. SqlQueryEditor `Cmd-Shift-Enter` keymap → `onDryRun` 호출. Mongo /
   placeholder paradigm 영향 없음.
4. `tabStore.completeQueryDryRun` action + `QueryState.completed.isDryRun?`
   필드.
5. `QueryResultGrid` banner — `isDryRun=true` 시 carrier 노드 (`data-testid`).
6. AC-248-E1..E7 (hook), T1..T4 (toolbar), K1 (keymap), B1..B2 (banner),
   W1..W2 (wire) 매핑 완료.
7. Verification Plan 7개 check 모두 pass.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 / 0)
  3. `pnpm vitest run` (전체 통과 + AC-248 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀 가드)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` (회귀 가드)
  6. `rg "Cmd-Shift-Enter\\b" src/components/query/SqlQueryEditor.tsx` (1 hit)
  7. `rg "data-testid=\"dry-run-banner\"" src/components/query/QueryResultGrid.tsx` (1 hit)
- Required evidence:
  - 변경 / 신규 / 삭제 파일 목록 (1줄 의도)
  - 7 check stdout 발췌
  - AC ↔ 파일:라인 매핑
  - `handleDryRun` 본문 인용 (paradigm gate, queryId "dry:" prefix, IPC
    dispatch).
  - `Cmd-Shift-Enter` keymap 코드 인용.
  - 가정 / 잔여 위험 (history 미기록, Mongo toast UX, banner 색상).

## Evidence To Return

- 변경 파일과 purpose
- Checks run and outcomes (7개)
- Done criteria coverage with evidence
- Assumptions
- Residual risk or verification gaps

## References

- Contract: `docs/sprints/sprint-248/contract.md`
- Phase 3 baseline: `docs/sprints/sprint-247/contract.md`, `findings.md`
- ADR 0022: `memory/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`
- Relevant files:
  - `src/types/query.ts`
  - `src/stores/tabStore.ts`
  - `src/components/query/QueryTab/useQueryExecution.ts`
  - `src/components/query/QueryTab/Toolbar.tsx`
  - `src/components/query/QueryTab.tsx`
  - `src/components/query/QueryEditor.tsx`
  - `src/components/query/SqlQueryEditor.tsx`
  - `src/components/query/MongoQueryEditor.tsx`
  - `src/components/query/QueryResultGrid.tsx`
