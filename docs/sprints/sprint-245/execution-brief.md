# Sprint Execution Brief: sprint-245

## Objective

ADR 0022 Phase 1 — Sprint 244 의 production+strict = read-only 정책을 lib + 모든 호출 경로 + Sprint 243 의 `useSafeModeReadOnly` UI 게이트까지 원복하고, `decideSafeModeAction` 을 새 destructive-only 정책 (+ non-prod strict-mode 에서 destructive 에 대해서도 confirm) 으로 재작성한다. mode 3-tier 의미만 재정의 — store / UI / persistence 변경 없음.

## Task Why

사용자 신고 ("dialog가 통일되지 않음 + production 일상 작업 friction") 와 grill-me 토론 (`/grill-me` 흐름) 결과 ADR 0022 가 채택됨. 5 phase 중 첫 번째로 lib + UI 게이트 원복이 가장 시급 — 현재 production 사용자가 INSERT / UPDATE WHERE 일상 작업을 못함. 후속 phase (dialog UI / dry-run / Cmd+Z) 는 이 phase 의 정책 원복 위에 쌓아 올림.

## Scope Boundary

**변경 허용 (In Scope)**:
- `src/lib/safeMode.ts` — `decideSafeModeAction` 본문 재작성, `SQL_WRITE_KINDS` 제거.
- `src/hooks/useSafeModeGate.ts` — `useSafeModeReadOnly` 제거.
- `src/components/rdb/DataGrid.tsx` — 4 guarded handler + safeModeReadOnly flag + import 제거, raw handler 직결.
- `src/components/datagrid/DataGridToolbar.tsx` — `readOnly` prop 제거.
- `src/components/workspace/SafeModeToggle.tsx` — `MODE_META` tooltip 텍스트 갱신 (icon / 토글 순환은 그대로).
- 위 6 파일에 대응하는 테스트 파일 정렬 (`safeMode.test.ts`, `useSafeModeGate.test.ts`, `DataGrid.editing.test.tsx`, `useDataGridEdit.safe-mode.test.ts`, `EditableQueryResultGrid.safe-mode.test.tsx`, `QueryTab.safe-mode.test.tsx`, `SafeModeToggle.test.tsx`).

**변경 금지 (Out of Scope)**:
- Dialog UI (`ConfirmDangerousDialog`) 의 헤더 / 라벨 / reason-타이핑 흐름 — Phase 2.
- 새 `dry_run_query` IPC + Rust transaction wrapper — Phase 3.
- 별도 "Dry Run" 버튼 + Cmd+Shift+Enter 단축키 — Phase 4.
- Cmd+Z pending undo 단축키 — Phase 5.
- Mongo 정책 — 변경 없음.
- IPC 시그니처 — 변경 없음.
- safeModeStore 의 mode enum / persistence — 변경 없음.

## Invariants

- prod + warn + destructive → confirm dialog (현재 텍스트 그대로 유지, Phase 2 에서 변경).
- prod + off + destructive → block 또는 confirm (정책 함수 리턴 변경에 따라 호출자 동작 결정 — Phase 2 에서 dialog 통일 시 confirm 으로 일원화). Phase 1 에서는 ADR 0022 의 매트릭스에 따라 prod + any-mode + destructive → confirm 으로 통일하되, 호출자가 confirm 을 dialog 로 띄우는 흐름은 기존 그대로.
- non-prod + warn / off → 항상 통과.
- SELECT / Mongo read pipeline → 항상 통과.
- IPC / store / cross-window IPC channel 변경 0.

## Done Criteria

1. `decideSafeModeAction` 매트릭스 8 케이스 (`AC-245-L1..L8`) 가 새 정책에 맞게 동작.
2. `useSafeModeReadOnly` symbol 이 코드베이스에서 부재 (`useSafeModeGate.ts` export + 모든 호출처).
3. `DataGridToolbar.readOnly` prop 부재.
4. `DataGrid` cell-edit / Add / Delete / Duplicate 가 production+strict 에서 정상 동작.
5. raw editor (`useQueryExecution`) + commit-preview hook (`useDataGridEdit`, `EditableQueryResultGrid`) 의 prod+strict + safe write → executeQuery / executeQueryBatch 호출 (Sprint 244 block 원복).
6. raw editor + non-prod + strict + DROP TABLE → confirm dialog (`AC-245-N1` 신규 흐름).
7. `SafeModeToggle` tooltip 이 새 정책 의미 반영.
8. `pnpm tsc --noEmit` / `pnpm lint` / `pnpm vitest run` / `cargo test --lib` / `cargo clippy` 모두 통과.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm lint`
  3. `pnpm vitest run` (전체) — 신규 AC 매핑 명시.
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml`
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- Required evidence:
  - 위 5 checks 의 stdout/stderr 발췌 (passing 확인).
  - 변경 파일 목록 + 각 파일의 변경 의도 (1 줄).
  - 신규 AC `AC-245-*` 가 어떤 테스트 파일의 어떤 `it(...)` 로 매핑되는지 명시.
  - Sprint 244 invert 된 AC (`AC-244-09..14`) 의 처리 (삭제 / rename / 본문 변경).

## Evidence To Return

- Changed files and purpose (1 줄씩).
- Checks run and outcomes (위 5 checks 의 결과).
- Done criteria coverage (8 항목별로 어떤 코드 / 테스트 가 증명하는지).
- Assumptions (예: prod + off 의 dialog vs block 결정이 Phase 2 로 이월되어 임시로 confirm 리턴 — Phase 2 에서 dialog 통일 시 자연스럽게 흐름).
- Residual risk / verification gaps (예: SafeModeToggle tooltip 텍스트는 snapshot 이 아니라 contains 검증으로 lock).

## References

- Contract: `docs/sprints/sprint-245/contract.md`
- ADR: `docs/archives/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`
- 직전 sprint 의 코드 변경: commit `13b297f` (Sprint 243), `f0276ee` (Sprint 244 lib), `2126063` (Sprint 244 정렬)
- Relevant files:
  - `src/lib/safeMode.ts`
  - `src/hooks/useSafeModeGate.ts`
  - `src/components/rdb/DataGrid.tsx`
  - `src/components/datagrid/DataGridToolbar.tsx`
  - `src/components/workspace/SafeModeToggle.tsx`
  - 테스트 파일 7 개 (Contract In Scope 참조)
