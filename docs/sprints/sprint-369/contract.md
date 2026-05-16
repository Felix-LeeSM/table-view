# Sprint Contract: sprint-369

## Summary

- Goal: Phase 4 datagrid prefs + non-store LS 5 사이트 retire. Q20 backend IPC (`set_datagrid_prefs` partial patch + `get_datagrid_prefs` + `reset_datagrid_prefs` field-scoped). Legacy column prefs drop + 1회 toast.
- Audience: state-management-strategy Q20 — non-store hand-rolled LS 의 SQLite SOT 전환 + datagrid prefs cross-window 일관성.
- Owner: Generator (sprint-369)
- Verification Profile: `mixed` (cargo test + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/migrations/0002_groups_collapsed.sql` (이미 sprint-355 의 0001 에 포함되면 skip 가능 — Generator 가 확인 후 결정).
- `src-tauri/src/commands/datagrid_prefs.rs` — 3 IPC:
  - `set_datagrid_prefs(req: SetDatagridPrefsRequest)` — partial patch, widths or hiddenColumns 중 하나 이상 필수, 빈 patch → `AppError::Validation`.
  - `get_datagrid_prefs(pk: ColumnPrefsPk) → GetDatagridPrefsResponse` — row 없음 시 `{ widths: {}, hiddenColumns: [], updatedAt: null }`.
  - `reset_datagrid_prefs(req: ResetDatagridPrefsRequest)` — field 별 분기 (`widths` / `hiddenColumns` / `all`).
- `src-tauri/src/commands/settings_recent.rs` / `settings_sidebar_width.rs` / `groups_collapsed.rs` — Q20 의 5 사이트 backend:
  - (1) `RECENT_COLLAPSE_KEY` → `set_setting("home_recent_collapsed", bool)`.
  - (2) `WIDTH_KEY` → `set_setting("sidebar_width", N)` + drag 중 frontend D 메모리, mouseup debounce 500ms.
  - (3) `COLLAPSE_KEY` → `set_group_collapsed(group_id, bool)`.
- `src/lib/tauri/datagrid_prefs.ts` — frontend wrapper.
- Frontend 사이트 변경:
  - `src/components/datagrid/useColumnWidths.ts:19` — LS → IPC.
  - `src/components/datagrid/useHiddenColumns.ts:24` — LS → IPC.
  - `src/pages/HomePage.tsx` 의 `RECENT_COLLAPSE_KEY` 사이트 — settings store.
  - `src/components/layout/Sidebar.tsx` 의 `WIDTH_KEY` 사이트 — settings store + debounce.
  - `src/components/connection/ConnectionGroup.tsx` 의 `COLLAPSE_KEY` 사이트 — connection_groups.collapsed.
- Legacy LS migration: boot 시 column-widths/hidden-columns LS key 전체 delete + 사용자에게 1회 toast ("Per-table preferences will reset once"). Toast 1회 sentinel 은 `meta.legacy_column_prefs_drop_dismissed` (settings known key 아님 — Q21 reset audit 대상 0).
- 테스트:
  - `src-tauri/tests/datagrid_prefs_partial_patch.rs` — widths 만 / hiddenColumns 만 / 빈 patch 거부.
  - `src-tauri/tests/datagrid_prefs_field_reset.rs` — 3 field 별.
  - `src-tauri/tests/datagrid_prefs_get_default.rs` — row 없음 → `{}` / `[]` / `null`.
  - `src/components/datagrid/useColumnWidths.test.ts` — IPC 호출 + caller 회귀.
  - `src/lib/migration/legacyColumnPrefsDrop.test.ts` — toast + LS key delete.

## Out of Scope

- W2 dual-read gate (sprint-370).
- query_history backend (sprint-371).
- Theme/safeMode (sprint-368).

## Invariants

- Datagrid prefs 의 read 는 mount 시 1회 (`get_datagrid_prefs`) + event listener (sprint-365 의 receiver). drag 중엔 D 메모리.
- Partial patch — 미포함 필드는 row 의 기존 값 유지.
- 빈 patch → 400 (codex 8차 #5).
- Reset field 별 분기 — widths 만 reset 이 hidden 풀거나 그 반대 0 (codex 7차 #1).
- Legacy LS toast 는 1회 (`meta.legacy_column_prefs_drop_dismissed` — settings known key 아님, Q21 reset audit 대상 0).

## Acceptance Criteria

- `AC-369-01` `set_datagrid_prefs` widths 만 patch: 기존 row `{widths:{a:100}, hidden:[]}` → patch `{widths:{a:200}}` → row `{widths:{a:200}, hidden:[]}` (hidden 보존). Test.
- `AC-369-02` `set_datagrid_prefs` hiddenColumns 만 patch: 기존 `{widths:{a:100}, hidden:[]}` → patch `{hiddenColumns:["b"]}` → row `{widths:{a:100}, hidden:["b"]}`. Test.
- `AC-369-03` 빈 patch → 400 `AppError::Validation("at least one of widths/hiddenColumns required")`. Test.
- `AC-369-04` `get_datagrid_prefs` row 없음 → `{widths:{}, hiddenColumns:[], updatedAt:null}`. Test.
- `AC-369-05` `reset_datagrid_prefs(field="widths")` → `widths_json='{}'` UPDATE, hidden 유지. event payload `field:"widths"`. Test.
- `AC-369-06` `reset_datagrid_prefs(field="hiddenColumns")` → `hidden_columns_json='[]'`, widths 유지. Test.
- `AC-369-07` `reset_datagrid_prefs(field="all")` → row DELETE. Test.
- `AC-369-08` `useColumnWidths` 가 mount 시 `get_datagrid_prefs` IPC 호출 + drag end 시 `set_datagrid_prefs` widths patch. `column-widths:*` LS `localStorage.getItem` / `localStorage.setItem` 둘 다 0회 (strategy line 1649 정합 — read/write 모두 0). Test: RTL spy.
- `AC-369-09` `useHiddenColumns` 동일 패턴 — `hidden-columns:*` read/write 모두 0. Test.
- `AC-369-10` Q20 (1)(2)(3) — `home_recent_collapsed` / `sidebar_width` / `group.collapsed` 모두 IPC + settings/groups SQLite write. LS key (`RECENT_COLLAPSE_KEY` / `WIDTH_KEY` / `COLLAPSE_KEY`) `localStorage.getItem` / `localStorage.setItem` 모두 0회. Test.
- `AC-369-11` Legacy LS drop: boot 시 `column-widths:*` / `hidden-columns:*` LS key 모두 delete + toast 1회. Test: `legacyColumnPrefsDrop.test.ts`.
- `AC-369-12` `sidebar_width` drag 중 D 메모리 (frontend store), mouseup 500ms 후 IPC 1회. drag 중 IPC 호출 0. Test: timing.

## Design Bar / Quality Bar

- TDD: 각 IPC 의 partial patch unit test 먼저 (red) → backend 구현 → integration.
- Field-scoped reset 의 event payload 가 receiver (sprint-365) 와 정확히 매핑 — `field` 필드 mandatory.
- Drag debounce 는 `lodash.debounce` 또는 custom — 500ms 안에 mouseup 누르면 1회 IPC.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test datagrid_prefs_partial_patch --test datagrid_prefs_field_reset --test datagrid_prefs_get_default`
3. `pnpm vitest run src/components/datagrid src/lib/migration`
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
5. grep: `! rg -q 'localStorage\.(get|set)Item\("column-widths:|"hidden-columns:|"RECENT_COLLAPSE_KEY|"WIDTH_KEY|"COLLAPSE_KEY' src/`

### Required Evidence

- 3 IPC × partial / field reset / default raw.
- Legacy drop test 의 LS key after-state.
- Drag debounce timing log.
- grep CI raw.

## Test Requirements

- Cargo: 3+ integration.
- Vitest: caller + migration.
- Coverage: `commands/datagrid_prefs.rs` 70%, `useColumnWidths`/`useHiddenColumns` 70%.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test datagrid_prefs_partial_patch --test datagrid_prefs_field_reset --test datagrid_prefs_get_default`
3. `pnpm vitest run src/components/datagrid src/lib/migration`
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope.
- Merge order: 355 + 358 (`set_setting` backend) + 365 + 367 이후. 370 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 12/12 PASS
- grep CI: 5 LS key read + write 모두 0
- 1회 toast verified
