# Sprint Execution Brief: sprint-246

## Objective

ADR 0022 Phase 2 — `ConfirmDangerousDialog` 를 `ConfirmDestructiveDialog` 로
rename + 재작성한다:
- 헤더는 `environment` prop 으로 분기 (`PRODUCTION DATABASE` /
  `Destructive statement` + `Safe Mode (strict)`).
- type-to-confirm 입력 / `Run anyway` 버튼 → 단순 `Confirm` + `Cancel` (Confirm
  은 항상 enabled, Enter 키 submit).
- Phase 3 에서 채울 dry-run preview 영역을 `data-testid="dry-run-placeholder"`
  로 잡아둔다.
모든 호출자 (15+) 의 import / JSX / 테스트를 새 API 로 정렬한다.

## Task Why

Phase 1 (Sprint 245) 가 정책을 destructive-only 로 통일했으므로 dialog UI 도
"warn-tier 만의 type-to-confirm" 가정에서 벗어나야 한다. ADR 0022 의 핵심 약속
중 하나가 "dialog 단일 진입점, mental model 단순화" 인데, 그 단순화의 첫 시각
적 체현이 헤더 환경 인지 + Yes/No 통일이다. Phase 3 에서 dry-run preview 를
실제 백엔드와 연결할 때 이 placeholder 영역이 그 자리를 잡아준다.

## Scope Boundary

- 변경: dialog 컴포넌트 자체 (`workspace/ConfirmDestructiveDialog.tsx`),
  모든 호출자 (rename + `environment` prop 주입), 호출자 테스트 (type-to-confirm
  → Confirm click).
- 변경 금지:
  - `decideSafeModeAction` 본문 (Phase 1 결과 그대로).
  - dry-run 실행 백엔드 (Phase 3).
  - "Dry Run" 별도 버튼 / Cmd+Shift+Enter (Phase 4).
  - Cmd+Z pending undo (Phase 5).
  - Mongo 분류기 / 정책.
  - Tauri IPC 시그니처.
  - safeModeStore mode enum / persistence.

## Invariants

- `useDataGridEdit.pendingConfirm` / `useQueryExecution.pendingRdbConfirm` /
  `pendingMongoConfirm` / DDL editor `pendingConfirm` shape 보존.
- 기존 `[AC-186-06]` (DataGrid warn-tier dialog mount) / `[AC-186-04b]`
  (`confirmDangerous` → executeQueryBatch) / `[AC-186-05b]` (RawGrid Confirm) 의
  *behavioral* 의도 보존.
- non-production + warn / off → dialog 마운트 안 됨 (Phase 1 결과 그대로).
- production + safe write → dialog 마운트 안 됨 (Phase 1 결과 그대로).

## Done Criteria

1. `ConfirmDestructiveDialog.tsx` 신규 — Yes/No + 환경 인지 헤더 + dry-run
   placeholder.
2. `ConfirmDangerousDialog.tsx` 및 그 테스트 파일 삭제. `rg "ConfirmDangerous"
   src/` = 0.
3. 모든 15+ 호출자가 신규 dialog 사용 + `environment` prop 주입.
4. `[AC-246-D1..D7]` (dialog), `[AC-246-R1..R3]` (rename guard), `[AC-246-W1..W4]`
   (호출자 보존), `[AC-246-E1]` (env 파생) 테스트 매핑 완료.
5. Verification Plan 7개 check 모두 pass.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 errors / 0 warnings)
  3. `pnpm vitest run` (전체 통과 + AC-246 매핑 증거)
  4. `rg "ConfirmDangerousDialog" src/` (0 hits)
  5. `rg "confirm-dangerous-input" src/` (0 hits)
  6. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀 가드)
  7. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` (회귀 가드)
- Required evidence:
  - 변경 / 신규 / 삭제 파일 목록 (1줄 의도)
  - 7 check stdout 발췌
  - AC ↔ 파일:라인 매핑
  - 기존 `[AC-186-03a..e]` 처리 (삭제) 명시
  - rename 흐름 sample (`DropTableDialog.test.tsx` 1 곳 인용)
  - 가정 / 잔여 위험 (예: `environment` 가 `null` 인 connection 의 fallback)

## Evidence To Return

- 변경 파일과 purpose
- Checks run and outcomes (7개)
- Done criteria coverage with evidence
- Assumptions (env null 처리, dialog 호출자 헬퍼 위치 등)
- Residual risk or verification gaps

## References

- Contract: `docs/sprints/sprint-246/contract.md`
- Phase 1 (baseline): `docs/sprints/sprint-245/contract.md` + `findings.md`
- ADR 0022: `docs/archives/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`
- Relevant files:
  - `src/components/workspace/ConfirmDangerousDialog.tsx` (deleted in this
    sprint — see contract)
  - `src/components/workspace/ConfirmDangerousDialog.test.tsx` (deleted)
  - `src/components/rdb/DataGrid.tsx`
  - `src/components/query/QueryTab.tsx`
  - `src/components/query/EditableQueryResultGrid.tsx`
  - `src/components/datagrid/useDataGridEdit.ts`
  - `src/components/query/useRawQueryGridEdit.ts`
  - `src/components/schema/{DropTable,DropColumn,AddColumn,RenameTable,CreateTable}Dialog.tsx`
  - `src/components/structure/{Columns,Constraints,Indexes}Editor.tsx`
  - `src/components/structure/useDdlPreviewExecution.ts`
  - `src/components/workspace/SafeModeToggle.tsx`
