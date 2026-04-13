# Sprint Execution Brief: sprint-43

## Objective

- 임시 탭(Preview Tab) 시스템 고도화 — 자동 승격 트리거, 수동 승격, 교체 로직

## Task Why

- 사용자가 테이블을 탐색할 때 임시 탭이 제대로 동작하지 않아 혼란 발생
- 정식 탭으로 승격되는 조건이 너무 제한적이거나 동작하지 않음

## Scope Boundary

- 주로 수정: `src/stores/tabStore.ts`, `src/components/DataGrid.tsx`, `src/components/TabBar.tsx`
- 최소 수정: `src/components/SchemaTree.tsx` (테이블 클릭 동작 확인만)

## Invariants

- 쿼리 탭은 preview 시스템 영향 없음
- 기존 테스트 모두 통과
- 탭 복원(localStorage) 시 isPreview=false로 복원

## Done Criteria

1. 테이블 클릭 → 임시 탭으로 열림 (이탤릭+dimmed)
2. 정렬/필터/페이지 변경 → 자동 승격
3. 셀 더블클릭(편집 진입) → 자동 승격
4. 행 추가/삭제 → 자동 승격
5. 탭 더블클릭 → 수동 승격
6. 스크롤만 → 임시 유지
7. 다른 테이블 클릭 → 임시 탭 교체
8. 정식 탭 → 유지 + 새 임시 탭 추가

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`

## Key Context

### Current Implementation (from Sprint 41 handoff investigation)

**tabStore.ts**:
- `addTab`: Creates table tabs with `isPreview: true`. If existing preview tab for same connectionId, replaces in-place. If same table already open, just activates.
- `promoteTab(id)`: Sets `isPreview = false` on a specific tab.
- Persistence: On load, all table tabs get `isPreview = false`.

**DataGrid.tsx**:
- Currently calls `promoteTab` on page change (line 85-89) and filter application.
- Does NOT call promoteTab on: sorting, inline editing, row add/delete.

**TabBar.tsx**:
- Shows preview tabs with italic + opacity-70.
- No double-click handler for promotion.

### What Needs to Change

1. **DataGrid.tsx**: Add `promoteTab` calls for:
   - Sorting (column header click)
   - Inline editing start (cell double-click)
   - Row add/delete button clicks

2. **TabBar.tsx**: Add double-click handler on preview tabs that calls `promoteTab`.

3. **tabStore.ts**: Verify the replacement logic is correct. The current implementation seems correct:
   - addTab: dedup → preview replace → new preview tab
   - promoteTab: isPreview = false

### Relevant Files
- `src/stores/tabStore.ts`
- `src/components/DataGrid.tsx`
- `src/components/TabBar.tsx`
- `src/components/TabBar.test.tsx`
- `src/stores/tabStore.test.ts`
