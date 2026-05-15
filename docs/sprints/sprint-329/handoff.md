# Sprint 329 Handoff — Slice DB-Scope.2 (Tab inline DB chip — Mongo)

날짜: 2026-05-15

## 결과

- 신규 컴포넌트: `TabDbChip.tsx` — Mongo query tab toolbar 의 tab-local
  display chip + sidebar 진입점 안내 popover.
- 신규 테스트: 3 cases.
- 회귀: 0 — vitest 3772 통과 / 10 skipped (sprint-328 기준 3769 → +3).
- tsc / lint exit 0.

## 변경 파일

- `src/components/query/QueryTab/TabDbChip.tsx` (NEW)
- `src/components/query/QueryTab/TabDbChip.test.tsx` (NEW)
- `src/components/query/QueryTab/Toolbar.tsx` — `isDocument` 일 때
  TabDbChip mount (Run 직전).

## 의사결정

- **D-76**: chip 은 *display only*. workspace store 가 `(connId, db)` 로
  key 되어 있어 tab.database 변경은 workspace slot 이동이라는 무거운
  작업. inline chip 의 클릭으로 직접 변경하지 않고, sidebar 우클릭
  명시 진입점 (Sprint 330) 으로 위임. DataGrip 도 chip 클릭이 새
  editor 를 spawn 하는 패턴 → 일치.

## 다음

- **Sprint 330 — Slice DB-Scope.3**: sidebar `DocumentDatabaseTree` 의
  database row 우클릭 컨텍스트 메뉴 → "New query here". 클릭한 row 의
  database 로 prefilled mongosh tab 생성. workspaceStore 의 addTab
  파라미터 검토 필요 (paradigm + database 명시 경로).
- **Sprint 331 — Slice DB-Scope.4**: backend `switch_active_db` Mongo
  분기 dead code 제거.
