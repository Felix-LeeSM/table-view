# Sprint 328 Contract — Slice DB-Scope.1 (Toolbar DbSwitcher hidden for Mongo)

날짜: 2026-05-15

## Scope

Mongo (document) paradigm 에서 toolbar 의 `DbSwitcher` 컴포넌트를 완전히
숨긴다. RDB paradigm 은 그대로 유지 (PG database 강 격리 때문에 toolbar
chip 이 여전히 의미 있음).

상위 결정 — DataGrip 패턴 채택. tab-level scope (옵션 B), inline DB chip
은 후속 sprint (329). 본 sprint 는 toolbar 의 redundancy 만 제거.

## Done Criteria

1. `src/components/workspace/DbSwitcher.tsx` — paradigm 이 `document` 일 때
   `null` 반환. 새 RTL 케이스 1개 가드:
   - "renders nothing when active tab paradigm is document".
2. 기존 document 관련 케이스 (5건) 정리:
   - L259 "renders an active switcher when … paradigm is document and connected"
     → "renders nothing …" 으로 반전.
   - L447 "clears the document store … after a successful Mongo switch"
     → 삭제 (switching path 자체 무효).
   - L495 "does NOT clear the schema store on a Mongo paradigm switch"
     → 삭제 (위와 동.
   - L710 "shows focused connection's activeDb when no tab is open (document)"
     → 삭제 (display path 자체 무효).
   - L758 "falls back to the document tab database when paradigm is document"
     → 삭제.
3. WorkspaceToolbar 는 무변경 (DbSwitcher 자체가 self-hide).
4. tsc / lint / 전체 vitest sweep exit 0; 회귀 0.
5. `docs/sprints/sprint-328/handoff.md` — 후속 sprint (inline chip / sidebar
   우클릭) 의 작업 항목 명시.

## Out of Scope

- Query tab inline DB chip (Sprint 329 — Slice DB-Scope.2).
- Sidebar database row 우클릭 "New query here" (Sprint 330 — Slice DB-Scope.3).
- backend `switch_active_db` / `current_active_db` / Mongo connection 의
  `active_db` 필드 dead-code cleanup — Mongo 한정 (Sprint 331 — Slice
  DB-Scope.4). RDB sub-pool 전환 경로 는 그대로 유지.

## Invariants

- RDB paradigm 사용자가 보는 toolbar 동작 회귀 0.
- kv / search paradigm 의 read-only chrome 회귀 0.
- 새 sprint-327 placeholder 컴포넌트들 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run --no-coverage src/components/workspace/DbSwitcher.test.tsx`
     — 케이스 카운트 5건 감소 (35 → 30 예상), 새 케이스 +1.
  2. `pnpm vitest run --no-coverage` — sprint-327 기준 3773 통과 / 10 skipped
     에서 net 변화 = -4 (5 삭제 + 1 추가) 또는 -5 (5 삭제, 1 invert in-place).
  3. `pnpm tsc --noEmit` exit 0.
  4. `pnpm lint` exit 0.
- Required evidence:
  - 변경 파일 / 삭제 case 행수.
  - 신규 vitest 카운트.
