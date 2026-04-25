# Sprint Execution Brief: sprint-97

## Objective
탭 dirty indicator + close 가드 (sprint-96 ConfirmDialog preset).

## In Scope
- `src/components/layout/TabBar.tsx`
- `src/stores/tabStore.ts`
- `src/components/layout/TabBar.test.tsx`

## Out of Scope
- 다른 컴포넌트
- sprint-88~96 산출물

## Done Criteria
1. dirty 탭 (pendingEdits/NewRows/DeletedRowKeys 합 > 0) 에 dot.
2. dirty close 시 ConfirmDialog (`src/components/ui/dialog/ConfirmDialog`).
3. dirty 0 → 마크 제거.
4. 회귀 0.

## Verification
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Hint
- dirty 정보가 어디에 살지 결정: tabStore 의 `dirtyTabs: Set<string>` 또는 `useDataGridEdit` 가 활성 탭 dirty 를 publish. tabStore 라우팅 권장.
- 호출 사이트: `useDataGridEdit` 의 `pendingEdits/pendingNewRows/pendingDeletedRowKeys` 합산을 활성 탭에 동기화.

## Untouched
- `memory/`
