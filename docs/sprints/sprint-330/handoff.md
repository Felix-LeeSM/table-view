# Sprint 330 Handoff — Slice DB-Scope.3 (Sidebar "New query here")

날짜: 2026-05-15

## 결과

- `DocumentDatabaseTree` 의 database row 가 ContextMenu 로 감싸짐.
- 메뉴 항목: "New query here" — 클릭 → `addQueryTab(connId, dbName,
  { paradigm: "document", database: dbName })`.
- 회귀: 0 — vitest 3773 통과 / 10 skipped (sprint-329 기준 3772 → +1).
- tsc / lint exit 0.

## 변경 파일

- `src/components/schema/DocumentDatabaseTree/rows.tsx` — `DatabaseRow`
  가 `ContextMenu` wrapper + `onNewQueryHere` prop.
- `src/components/schema/DocumentDatabaseTree.tsx` — `handleNewQueryHere`
  + DatabaseRow prop wire.
- `src/components/schema/DocumentDatabaseTree.test.tsx` — 신규 케이스 1건.

## DataGrip 패턴 closure

- Sprint 328 — toolbar global DbSwitcher hidden on Mongo paradigm.
- Sprint 329 — query tab inline DB chip + sidebar 진입점 안내 popover.
- Sprint 330 — sidebar 우클릭 "New query here" 실제 entry-point.

Sprint 329 의 TabDbChip 안내 문구 ("right-click a database in the sidebar
and choose 'New query here'") 가 실제로 동작.

## 다음

- **Sprint 331 — Slice DB-Scope.4**: backend Mongo `switch_active_db` /
  `current_active_db` / connection `active_db` 필드 dead code 제거.
  RDB 경로 무영향.
