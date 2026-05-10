# Sprint Execution Brief: sprint-238

## Objective

DataGrid (RDB + Document) cell layout 정책을 단일 모델로 lock — 1줄 fixed + category 기반 default 폭 + drag-resize + CSS ellipsis + bidi isolation. 스크롤 중 column 폭이 변하는 회귀를 차단하고, char-truncate(200) + line-clamp-3 의 이중 cap 을 폐기.

## Task Why

- 현재 `min-w-full` + `table-fixed` 조합이 sum(column widths) < container 일 때 width-redistribution 을 트리거 → 스크롤하며 cell content 길이에 따라 column 폭이 변함.
- `truncateCell(200)` + `line-clamp-3` 가 가로폭 통제 부재 시 무력화 — 한 줄 200자 cell 이 grid 를 폭발.
- RTL/emoji 가 일시 layout 파손 (#4 사용자 보고).
- TablePlus-like 워크플로우 (master plan) 의 "끊김 없는 전환" 기준에 맞춰 1줄 fixed 가 default 가 되어야 함.

## Scope Boundary

- 건드리는 영역: DataGridTable, DataGridToolbar, DataRow, HeaderRow, columnCategory util, jsonCell util, useColumnWidths hook, Rust QueryColumn + dialect 4개.
- **건드리지 말 것**:
  - Cell editor (별도 layer, 이미 분리됨)
  - QuickLook 패널 (재사용만)
  - Structure view 의 column rendering (다른 컴포넌트)
  - cmd+R / F5 핸들러 (App.tsx) — 동작 유지
  - NULL 표시 스타일
  - localStorage / 백엔드 storage 의 width persistence (도입 금지)

## Invariants

- `data_type` 은 IPC 에서 raw 그대로 흐른다. category 추가는 보강이지 대체가 아니다.
- Structure / Records 뷰의 type 노출은 raw `data_type` 그대로.
- cmd+R / F5 = data refetch 만, layout 안 건드림.
- min/max guard 0 (drag 시 사용자 자유).
- Pre-push hook (cargo test, cargo clippy, pnpm vitest, pnpm lint, pnpm tsc, e2e) 통과.

## Done Criteria

1. AC-238-01 ~ AC-238-12 의 요구사항이 spec 그대로 구현됨 (`docs/sprints/sprint-238/spec.md` 참조).
2. Verification Plan 의 7 checks 모두 통과.
3. 기존 vitest / cargo test 0건 회귀.
4. `truncateCell` / `CELL_DISPLAY_LIMIT` / `line-clamp-3` / `min-w-full` (DataGridTable) grep 0건.
5. browser smoke 7 항목이 expected 동작.

## Verification Plan

- Profile: `mixed` (command + browser)
- Required checks:
  1. `pnpm vitest run` (전체 frontend 테스트)
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `cd src-tauri && cargo test`
  5. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  6. browser smoke (records 뷰 7 항목)
  7. grep 검증 (truncateCell / CELL_DISPLAY_LIMIT / line-clamp-3 / min-w-full 0건)
- Required evidence:
  - 각 check 의 출력 / 스크린샷.
  - 변경 파일 목록 + 변경 의도.
  - AC ↔ 테스트 매핑 표.

## Evidence To Return

- 변경 파일 목록 (Rust + TS) + 각 파일이 어떤 AC 를 cover 하는지.
- 7 checks 의 실제 출력.
- AC ↔ test file/test name 매핑.
- 가정 (예: Mongo column-level category 정책), residual risk.

## References

- Contract: `docs/sprints/sprint-238/contract.md`
- Spec (master): `docs/sprints/sprint-238/spec.md`
- Findings: `docs/sprints/sprint-238/findings.md` (작성 예정)
- Handoff: `docs/sprints/sprint-238/handoff.md` (작성 예정)
- Relevant files:
  - `src-tauri/src/models/query.rs` (또는 동등 위치)
  - `src-tauri/src/db/{postgres,mysql,sqlite,mongo}.rs`
  - `src/components/datagrid/DataGridTable.tsx`
  - `src/components/datagrid/DataGridTable/DataRow.tsx`, `HeaderRow.tsx`
  - `src/components/datagrid/DataGridToolbar.tsx`
  - `src/types/query.ts`
  - `src/lib/format.ts`
