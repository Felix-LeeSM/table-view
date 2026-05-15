# Sprint 330 Contract — Slice DB-Scope.3 (Sidebar "New query here")

날짜: 2026-05-15

## Scope

`DocumentDatabaseTree` 의 database row 우클릭 → "New query here". 클릭한
row 의 database 로 prefilled mongosh tab 생성. sprint-329 의 TabDbChip
popover 안내 문구의 실 entry-point.

## Done Criteria

1. `DocumentDatabaseTree/rows.tsx` `DatabaseRow` 가 `ContextMenu` 로 감싸짐.
   메뉴: 단일 항목 "New query here" — 우클릭 → `onNewQueryHere(dbName)`.
2. `DocumentDatabaseTree.tsx` 의 `handleNewQueryHere`:
   - `addQueryTab(connectionId, dbName, { paradigm: "document", database: dbName })`.
   - `markConnectionUsed(connectionId)`.
3. RTL 가드:
   - 우클릭 → "New query here" 메뉴 가시.
   - 클릭 → `addQueryTab` 가 dbName / paradigm: "document" 와 함께 호출.
4. tsc / lint / vitest sweep exit 0.

## Out of Scope

- Collection row 우클릭 (이미 "Drop Collection" 만 존재; 본 sprint 무변경).
- mongosh editor 의 sql prefill (빈 editor 로 시작).

## Invariants

- 기존 DatabaseRow 의 expand/collapse 동작 회귀 0.
- CollectionRow 의 ContextMenu 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run --no-coverage src/components/schema/DocumentDatabaseTree.test.tsx`
     + 새 케이스 ≥ 1.
  2. 전체 sweep — 3772 → +1.
  3. tsc / lint exit 0.
