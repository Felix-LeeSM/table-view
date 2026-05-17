# Sprint 376 — Reset-to-Default Audit Checklist (Q21)

작성 2026-05-17. state-management-strategy Q21 (line 1673-1683) 의 9
affordance audit. 본 sprint 머지 기준: 9 항목 모두 `[x]`. 누락 발견 시
sprint 종료 금지 — UI 추가 후 재검증.

각 항목 wire: 영속 키 → 사용자 entry point → IPC → frontend wrapper →
RTL test 파일 → e2e 시나리오 번호.

본 checklist 는 `scripts/check-reset-affordance-audit.sh` 로 grep
검증된다 — `^- \[x\]` 9 개 미만이면 exit 1.

## 9 Affordance

- [x] **1. Settings panel "Reset settings" 버튼** — sprint-377
  (2026-05-17) 에서 사용자 직접 요청으로 settings panel UI 제거. IPC
  `reset_setting` 는 유지 — 4 setting key (`theme` / `safe_mode` /
  `query_history_retention_days` / `query_history_enabled`) 는 추후
  command palette / per-section reset 로 재배치 예정. 회귀 가드:
  `src/pages/HomePage.reset-affordance.test.tsx` AC-377-01 가 settings
  panel 의 두 reset 버튼 부재를 lock. e2e 시나리오 1 은
  sprint-377 follow-up 에서 갱신.

- [x] **2. Home Recent 헤더 우클릭 "Reset"** —
  `reset_setting("home_recent_collapsed")` 1회. 구현:
  `src/pages/HomePage.tsx` 의 home-recent footer wrapper. Test:
  `src/pages/HomePage.reset-affordance.test.tsx`. e2e 시나리오 2.

- [x] **3. Sidebar handle 우클릭 "Reset sidebar width"** — IPC
  `reset_setting("sidebar_width")`. sprint-377 (2026-05-17) 에서
  settings panel 의 두 번째 entry point (`ResetSettingsButton` 의
  "Reset sidebar width" 버튼) 가 사용자 요청으로 제거되어 현재 entry
  point 는 sidebar handle 우클릭 1개. 구현:
  `src/components/layout/Sidebar.tsx`. Test:
  `src/components/layout/Sidebar.reset-affordance.test.tsx`. e2e 시나리오
  3.

- [x] **4. Group 헤더 우클릭 "Reset collapse states"** — 모든 group
  의 `collapsed = false` UPDATE. 구현:
  `src/components/connection/ConnectionGroup.tsx`. Test:
  `src/components/connection/ConnectionGroup.reset-affordance.test.tsx`.
  e2e 시나리오 4.

- [x] **5. DataGrid column header 우클릭 "Reset column widths"** —
  `reset_datagrid_prefs({...pk, field:"widths"})`. 구현:
  `src/components/datagrid/DataGridTable/HeaderRow.tsx` (+ `DataGridTable.tsx`
  의 prop wiring). Test:
  `src/components/datagrid/DataGridTable/HeaderRow.reset-affordance.test.tsx`.
  e2e 시나리오 5.

- [x] **6. DataGrid column header 우클릭 "Show all columns"** —
  `reset_datagrid_prefs({...pk, field:"hiddenColumns"})`. 구현:
  `src/components/datagrid/DataGridTable/HeaderRow.tsx` (+ `DataGridTable.tsx`
  의 prop wiring). Test:
  `src/components/datagrid/DataGridTable/HeaderRow.reset-affordance.test.tsx`
  (Show all 케이스). e2e 시나리오 6.

- [x] **7. Sidebar 헤더 우클릭 "Collapse all"** —
  `workspaces.sidebar_expanded_json` 빈 array UPDATE (in-memory
  `setExpanded(connId, db, [])`). 구현:
  `src/components/layout/Sidebar.tsx` 의 header context menu. Test:
  `src/components/layout/Sidebar.reset-affordance.test.tsx`. e2e 시나리오 7.

- [x] **8. Home "Clear recent"** — `clear_mru` IPC. 구현:
  `src/pages/HomePage.tsx` 의 action bar 메뉴. Test:
  `src/pages/HomePage.reset-affordance.test.tsx`. e2e 시나리오 8.

- [x] **9. Favorites entry remove (이미 존재)** — `removeFavorite(id)`
  store action. 구현: `src/components/query/FavoritesPanel.tsx` (회귀
  가드만). Test:
  `src/components/query/FavoritesPanel.reset-affordance.test.tsx`. e2e
  시나리오 9.

## E2E

- `e2e/reset-to-default-audit.e2e.ts` — 위 9 시나리오 모두 한 spec
  안에서 검증. `pnpm test:e2e:docker` 환경에서 실행. 본 sprint
  scope 는 spec 컴파일 + lint pass — host docker 실행은 머지 게이트.

## Backend IPC 신규 (sprint-376)

- `reset_setting(key: String)` — `settings` 테이블 row 삭제 +
  `state-changed` payload `{domain:"setting",op:"reset",entityId:key}`.
  구현: `src-tauri/src/commands/persist_settings.rs`. Test:
  `src-tauri/tests/reset_setting.rs`.
- `clear_mru()` — `mru` 테이블 비우기 + `state-changed` payload
  `{domain:"mru",op:"bulk",entityId:null}` (mru 도메인 변경은
  `EventOp::Bulk` 가 contract). 구현:
  `src-tauri/src/commands/persist_mru.rs`. Test:
  `src-tauri/tests/clear_mru.rs`.
- `reset_datagrid_prefs` — 이미 존재 (`src-tauri/src/commands/datagrid_prefs.rs:231,296`).
  본 sprint 는 호출 wiring 만.

## 비-기능 룰

- Confirm dialog 도입 0 (Q21 contract — 모든 reset 클릭은 직접 IPC).
- 키보드 단축키 도입 0 (별 sprint).
- `console.*` 금지 — production code 는 `@lib/logger` 사용.
- 테스트 작성 사유 + 날짜 (2026-05-17) 헤더 코멘트 필수.
