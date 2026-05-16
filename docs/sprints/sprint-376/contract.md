# Sprint Contract: sprint-376

## Summary

- Goal: Phase 6 Reset-to-default UI 구현 + audit (Q21). 9 reset affordance 모두 — settings panel / Home Recent / Sidebar / group header / DataGrid / Sidebar header / launcher / favorites — 구현 + 머지 보류 audit.
- Audience: state-management-strategy Q21 — 영속 상태의 reset 가능성 직관 보장.
- Owner: Generator (sprint-376)
- Verification Profile: `frontend` + e2e (pnpm vitest + e2e + pnpm tsc + pnpm lint)

## In Scope

- 9 affordance:
  1. **Settings panel "Reset settings" 버튼** (`src/pages/SettingsPage.tsx` 또는 `src/components/settings/ResetSettingsButton.tsx`) — `theme` / `safe_mode` / `query_history_retention_days` / `query_history_enabled` 4개 `reset_setting` IPC 4회 호출.
  2. **Home Recent 헤더 우클릭 "Reset"** (`src/pages/HomePage.tsx` 의 Recent section) — `reset_setting("home_recent_collapsed")`.
  3. **Sidebar handle 우클릭 + 설정 panel Layout 섹션 "Reset sidebar width"** (`src/components/layout/Sidebar.tsx` + `src/components/settings/LayoutSection.tsx`) — `reset_setting("sidebar_width")`.
  4. **Group header 우클릭 "Reset collapse states"** (`src/components/connection/ConnectionGroup.tsx`) — 모든 group `collapsed = false` UPDATE.
  5. **DataGrid column header 우클릭 "Reset column widths"** (`src/components/datagrid/DataGridHeader.tsx`) — `reset_datagrid_prefs({...pk, field:"widths"})`.
  6. **DataGrid column header 우클릭 "Show all columns"** — `reset_datagrid_prefs({...pk, field:"hiddenColumns"})`.
  7. **Sidebar 헤더 우클릭 "Collapse all"** (`src/components/layout/Sidebar.tsx` 의 header) — `workspaces.sidebar_expanded_json` 모두 false 로 set.
  8. **Home / launcher 메뉴 "Clear recent"** (`src/pages/HomePage.tsx` 의 menu) — `clear_mru` IPC.
  9. **Favorites panel 각 entry 별 remove** (이미 존재) — audit only.
- 테스트:
  - 9 affordance × 1+ RTL test (`*.reset-affordance.test.tsx`).
  - `e2e/reset-to-default-audit.e2e.ts` — 9 affordance 시나리오.
  - `scripts/check-reset-affordance-audit.sh` — audit checklist (handoff 의 audit table 과 매핑).

## Out of Scope

- ADR (sprint-374).
- Cleanup (sprint-375).
- 새 reset 가능 항목 도입.

## Invariants

- 9 affordance 가 모두 구현 — 머지 보류 audit checklist 통과.
- 각 affordance 의 호출 IPC + 응답 후 store mutate / event 수신 → 다른 window 도 적용.
- Confirm dialog 도입 안 함 — Q21 9 affordance 계약에 confirm 요구 0. 모든 reset 클릭은 직접 IPC. confirm 은 향후 별 sprint.
- 키보드 단축키 도입 안 함 (Q21 계약은 9 affordance 만, shortcut 별 sprint).

## Acceptance Criteria

- `AC-376-01` Settings panel "Reset settings" 클릭 → 4 setting key `reset_setting` IPC 4회 호출. Test.
- `AC-376-02` Home Recent 우클릭 "Reset" → `reset_setting("home_recent_collapsed")` 1회. Test.
- `AC-376-03` Sidebar handle 우클릭 + 설정 panel 둘 다 → 같은 IPC `reset_setting("sidebar_width")`. Test 2.
- `AC-376-04` Group 우클릭 "Reset collapse states" → 모든 group `collapsed = false` UPDATE → group store 모두 expanded. Test.
- `AC-376-05` DataGrid column header 우클릭 "Reset column widths" → `reset_datagrid_prefs({..pk, field:"widths"})` + widths 만 default, hidden 보존. Test.
- `AC-376-06` DataGrid column header 우클릭 "Show all columns" → `reset_datagrid_prefs({..pk, field:"hiddenColumns"})` + hidden 만 default, widths 보존. Test.
- `AC-376-07` Sidebar 헤더 우클릭 "Collapse all" → workspace 의 `sidebar_expanded_json` 빈 array UPDATE. Test.
- `AC-376-08` Home "Clear recent" 클릭 → `clear_mru` IPC (Q21 9 affordance 계약, confirm dialog 추가는 별 sprint). Test.
- `AC-376-09` Favorites entry remove (기존) audit: 1 entry remove 후 UI 즉시 갱신. Test.
- `AC-376-10` 머지 보류 audit: `docs/sprints/sprint-376/audit-checklist.md` 의 9 affordance 모두 ✅. 누락 시 sprint 종료 금지. Test: checklist content check.

## Design Bar / Quality Bar

- TDD: 9 RTL 시나리오 먼저 — sprint 시작 시 모두 red. 각 affordance 구현 → green.
- 우클릭 메뉴는 `<ContextMenu>` shadcn 컴포넌트 — 접근성 (`aria-haspopup`, keyboard navigation).
- Confirm dialog 도입 0 — Q21 계약은 9 affordance 만, confirm 은 향후 별 sprint.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/pages/SettingsPage src/pages/HomePage src/components/layout/Sidebar src/components/connection/ConnectionGroup src/components/datagrid/DataGridHeader src/components/favorites`
2. `pnpm test:e2e:docker -- e2e/reset-to-default-audit.e2e.ts`
3. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
4. `bash scripts/check-reset-affordance-audit.sh`

### Required Evidence

- 9 affordance × RTL test name + 결과.
- e2e 9 시나리오 video / driver log.
- audit checklist content + 9 ✅.

## Test Requirements

- Vitest: 9+ RTL.
- e2e: 9 시나리오.
- Coverage: 각 affordance 컴포넌트 70%.

## Test Script / Repro Script

1. `pnpm vitest run src/pages/SettingsPage src/pages/HomePage src/components/layout/Sidebar src/components/connection/ConnectionGroup src/components/datagrid/DataGridHeader src/components/favorites`
2. `pnpm test:e2e:docker -- e2e/reset-to-default-audit.e2e.ts`
3. `bash scripts/check-reset-affordance-audit.sh`
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope.
- Merge order: 368 + 371 + 373 + 375 이후 (cleanup → audit 순). 최종 sprint.

## Exit Criteria

- Open P1/P2: 0
- AC 10/10 PASS
- 9 affordance audit ✅
- 모든 phase 머지 완료 시점에 본 sprint = strategy 문서 종료
