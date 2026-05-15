# Sprint 329 Contract — Slice DB-Scope.2 (Tab inline DB chip — Mongo)

날짜: 2026-05-15

## Scope

Mongo (document) paradigm 의 query tab toolbar 좌측에 inline DB chip 추가.
DataGrip 패턴 — chip 은 tab 의 self-contained display + popover 로 진입점
안내. *변경 액션은 Sprint 330 의 sidebar 우클릭 "New query here" 으로 위임.*

## 배경 / 제약

`workspaceStore.workspaces` 가 `(connId, db)` 로 key 됨 (ADR 0027). tab.database
변경 = workspace slot 이동, 단순 setter 가 아님. inline chip 에서 직접 DB 변경
하려면 workspace migration 로직이 필요. 본 sprint 는 변경을 sidebar 명시 진입점
으로 위임하고, chip 은 *display + 사용자 안내* 만 책임진다 (DataGrip 도
실제로는 새 editor 를 spawn 한다).

## Done Criteria

1. `src/components/query/QueryTab/TabDbChip.tsx` (NEW) — small chip:
   - 좌측 Database icon + tab.database 텍스트 + ChevronDown.
   - 클릭 → popover. popover 내용:
     - "Database — <db>" 라벨.
     - "To query a different database, right-click a database in the
       sidebar and choose 'New query here'." (Sprint 330 wire-up 후).
   - tab.database 가 empty/null 이면 chip 자체 비표시 (tab 이 still
     initializing 상태).
2. `QueryTab/Toolbar.tsx` 에서 `isDocument` 일 때 `<TabDbChip>` mount.
   기존 Run / Dry Run / Insert ▾ 와 같은 row, Run 직전에 배치.
3. RTL 가드:
   - chip 이 mongosh tab 에서 렌더되고 database 텍스트 노출.
   - chip 이 RDB tab 에서는 렌더되지 않음.
   - chip 클릭 → popover 가 열리고 안내 문구가 가시.
   - tab.database 가 empty 인 mongosh tab 에서는 chip 미표시.
4. tsc / lint / vitest sweep exit 0; sprint-328 기준 3769 → +N (≥ 3).

## Out of Scope

- 실제 DB 변경 액션 (Sprint 330 sidebar 우클릭).
- Popover 안 database list fetch (Sprint 330+).
- RDB tab 에 같은 chip (RDB 는 toolbar DbSwitcher 유지).

## Invariants

- 기존 QueryTab Toolbar 의 RDB/Mongo 분기 회귀 0.
- mongosh editor surface (InsertSnippetMenu, sql 입력 등) 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run --no-coverage src/components/query/QueryTab/TabDbChip.test.tsx src/components/query/QueryTab/Toolbar.test.tsx` 통과.
  2. 전체 sweep — 3769 → 3772 이상.
  3. tsc / lint exit 0.
