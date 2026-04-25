# Sprint Contract: sprint-98

## Summary
- Goal: Cmd+S 즉시 시각 피드백 (스피너/버튼 상태). 키 입력 직후 SQL Preview 모달 mount 전에 사용자가 인식 가능한 상태 변화. dirty 0 일 때 toast 안내.
- Profile: `command` (DOM assertion via Vitest + RTL — sprint-92 / sprint-94 와 동일 패턴, 브라우저 spec 의 시각적 의도를 단위테스트로 보장)
- Owner: Generator

## In Scope
- `src/components/datagrid/useDataGridEdit.ts`
  - `commit-changes` 이벤트 리스너 + 툴바 `handleCommit` 진입 직후 `isCommitFlashing` (또는 동의어) `true` flip.
  - dirty 0 (`!hasPendingChanges`) 인 상태에서 commit 진입 시 `toast.info("No changes to commit")` (sprint-94 toast 사용) + 짧은 flash (선택) — modal/toast 모두 가능하나 toast 가 명세 권장.
  - sqlPreview / mqlPreview 가 set 되거나 (`length > 0` / non-null), commit 완료/실패, in-flight commit 종료 시 flashing flip 해제.
  - 안전 타임아웃 ≥ 200ms / ≤ 600ms — modal mount 신호가 도달하지 않아도 stale 하지 않게.
  - 훅 반환에 `isCommitFlashing: boolean` 추가.
- `src/components/datagrid/DataGridToolbar.tsx`
  - 새 prop `isCommitFlashing?: boolean`. `Commit` 버튼이 true 일 때 `Check` → `Loader2 animate-spin` 스왑 + `data-committing="true"` + `aria-busy="true"` + (선택) `disabled`.
- `src/components/DataGrid.tsx`
  - `editState.isCommitFlashing` 을 toolbar 로 전달.
- `src/components/datagrid/useDataGridEdit.commit-flash.test.ts` (신규) 또는 기존 `commit-shortcut.test.ts` 확장.
- `src/components/datagrid/DataGridToolbar.test.tsx`: `isCommitFlashing` 시 spinner / aria-busy 단언.

## Out of Scope
- 다른 컴포넌트 (QueryTab, EditableQueryResultGrid 의 commit-changes 핸들러는 회귀 보존만; 새 시각 피드백 추가는 후속 sprint).
- handleCommit 의 sync→async 전환 (현재 sync 유지).
- sprint-88~97 산출물 추가 변경.
- `CLAUDE.md`, `memory/`.

## Invariants
- 회귀 0 (1726/1726 통과 유지 + 신규 테스트만 추가).
- sprint-91~96 dialog invariants.
- sprint-93 commitError, sprint-94 toast hookup.
- sprint-97 dirty indicator + close 가드 (TabBar.tsx, tabStore.ts) 변경 금지.

## Acceptance Criteria
- AC-01: Cmd+S (또는 `commit-changes` 이벤트) 발생 시 200ms 이내에 시각 피드백 — 툴바 Commit 버튼이 `data-committing="true"` 또는 `aria-busy="true"` + spinner — 가 나타난다.
- AC-02: sqlPreview/mqlPreview 가 set 되거나 commit 종료 시 flashing 이 사라진다. 안전 타임아웃 (≤ 600ms) 으로도 사라진다.
- AC-03: `hasPendingChanges === false` 인 상태에서 Cmd+S → `toast.info("No changes to commit")` (또는 동등 문구) 발행 + flashing 즉시 해제 (또는 발화하지 않음 — 단, 사용자에게 인식 가능한 안내 1회는 보장).
- AC-04: 기존 `useDataGridEdit` Cmd+S happy path 회귀 0 — 1726/1726 통과 후 신규 테스트 합산값으로 통과.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Test Requirements
- flashing on/off transition ≥ 2 단언 (set 진입 직후 → preview set 후 / 타임아웃 후).
- dirty 0 toast 발화 단언 1.
- toolbar `isCommitFlashing` rendering 단언 ≥ 1.
- 기존 `commit-shortcut.test.ts` 시나리오 재실행 단언 (회귀 0).

## Exit Criteria
- P1/P2 findings: 0
- All checks pass
