# Sprint Execution Brief: sprint-101

## Objective
MongoDB 컬렉션 탭 상단 sticky beta/제한 안내 배너. RDB 미노출.

## In Scope
- `src/components/document/CollectionReadOnlyBanner.tsx` (신규).
- `src/lib/strings/document.ts` 또는 동등 — `COLLECTION_READONLY_BANNER_TEXT` 상수.
- `src/components/DocumentDataGrid.tsx` — 배너 마운트.
- 테스트: DocumentDataGrid + DataGrid + (선택) banner 단위.

## Out of Scope
- DDL 활성화.
- Dismiss 메커니즘.
- sprint-88~100 산출물.

## Done Criteria
1. MongoDB 탭 상단 배너 (`role="status"`).
2. dismiss 부재 + 탭 전환 후 재현.
3. RDB 미노출.
4. 텍스트 상수에서 import.

## Verification
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Hint
- 배너 위치: `DocumentDataGrid.tsx` 컴포넌트 return 의 root `<div>` 내부 최상단. toolbar 위.
- 텍스트 권장: "Beta — schema and DDL operations are not yet supported." (sprint-87 이후 반영). Generator 가 사유 findings 에 기록.
- 색상: `bg-warning/10 border-b border-warning/30 text-warning-foreground` 또는 동등 (sprint-95 tone variants 참고).
- DataGrid 회귀 가드: `DataGrid.test.tsx` 의 적당한 위치에 단언 1 추가 (`queryByText(BANNER_TEXT) === null`).

## Untouched
- `memory/`, `CLAUDE.md`, sprint-88~100 산출물.
