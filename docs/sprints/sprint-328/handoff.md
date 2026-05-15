# Sprint 328 Handoff — Slice DB-Scope.1 (Toolbar DbSwitcher hidden for Mongo)

날짜: 2026-05-15

## 결과

- Mongo (document) paradigm 에서 toolbar `DbSwitcher` 가 `null` 반환.
- 영향받는 테스트 케이스 4건 삭제 + 1건 invert + 1건 (WorkspaceToolbar) invert.
- 회귀: 0 — `pnpm vitest run --no-coverage` 3769 통과 / 10 skipped
  (sprint-327 기준 3773 → -4 케이스 삭제 / -1 invert / +1 새 case → net -4).
- tsc / lint exit 0.

## 변경 파일

- `src/components/workspace/DbSwitcher.tsx` — `paradigm === "document"` 시
  `return null`. hook 호출 후 early return (rules-of-hooks 준수).
- `src/components/workspace/DbSwitcher.test.tsx`:
  - L259 case invert → "renders nothing when paradigm is document".
  - Sprint 131 Document switch 블럭 2건 삭제 (dispatch path 무효).
  - "shows focused connection's activeDb (document)" 삭제 (display path
    무효).
  - "falls back to the document tab database when paradigm is document"
    삭제.
- `src/components/workspace/WorkspaceToolbar.test.tsx`:
  - "shows mongo database labels for document query tabs" case invert →
    "hides the DbSwitcher entirely for document query tabs".

## 의사결정 cross-reference

- DataGrip 패턴 채택 — `docs/explorations/mongo-db-scope-patterns.html`
  의 conclusion 블럭.
- 사용자 grill 합의 (Q1=B tab-level, Q2=(i)+(ii) 결합).
- Mongo database ≈ PG schema (직전 대화) — toolbar global state 가
  semantic mismatch.

## 다음 (Sprint 329~331 라인업)

- **Sprint 329 — Slice DB-Scope.2**: Query tab inline DB chip 컴포넌트
  + popover. tab.database 변경 가능하도록.
- **Sprint 330 — Slice DB-Scope.3**: Sidebar database row 우클릭 → "New
  query here" 컨텍스트 메뉴. 명시적 sidebar→tab 다리.
- **Sprint 331 — Slice DB-Scope.4**: backend Mongo `switch_active_db` /
  `current_active_db` / connection 의 `active_db` 필드 dead code 제거.
  RDB 경로 무영향. 같은 sprint 에서 Sprint 327 D-72 표의 backend 후속
  라인업 +1 shift.
