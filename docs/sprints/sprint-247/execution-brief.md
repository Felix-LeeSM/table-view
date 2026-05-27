# Sprint Execution Brief: sprint-247

## Objective

ADR 0022 Phase 3 — destructive 문장에 대한 dry-run 백엔드 (PG `BEGIN; ... ROLLBACK;`)
+ dialog preview 영역 통합. 새 IPC `execute_query_dry_run`, lib wrapper
`executeQueryDryRun`, hook `useDryRun`, 컴포넌트 `<DryRunPreview>` 추가;
`ConfirmDestructiveDialog` 의 placeholder 영역을 실제 미리보기로 교체. 모든
호출자 (15+) 가 `connectionId / statements / paradigm` 을 dialog 에 주입.

## Task Why

Phase 1 (정책) + Phase 2 (dialog UI 단순화) 가 destructive 만 dialog 로 모이는
구조를 만들어 놓았으므로, 이제 그 dialog 의 핵심 기능 — "commit 전 결과를
보여줘서 사용자가 안전하게 결정" — 을 채워야 ADR 0022 의 "Cmd+Z 안 닿는 commit
경로 보호" 약속을 완성할 수 있다. PG 의 transaction rollback 은 이미 검증된
패턴 (`execute_query_batch`) 이므로 risk 가 낮다.

## Scope Boundary

- 변경: 새 trait method `dry_run_sql_batch`, PG impl, 새 IPC
  `execute_query_dry_run`, lib wrapper, hook `useDryRun`, `<DryRunPreview>`
  컴포넌트, dialog `<ConfirmDestructiveDialog>` 의 placeholder → 실제 preview
  영역 교체, 호출자 15곳 신규 prop 추가, 호출자 테스트 mock 추가.
- 변경 금지:
  - `execute_query_batch` IPC / commit-path 로직.
  - `decideSafeModeAction` 매트릭스.
  - dialog 헤더 / Yes/No 푸터 / 환경 분기.
  - 별도 Dry Run 버튼 / Cmd+Shift+Enter (Phase 4).
  - Cmd+Z (Phase 5).
  - Mongo 분류기 / 정책.
  - `safeModeStore` / persistence.
  - MySQL/SQLite 어댑터 dry-run 실제 구현 (default Unsupported 만).

## Invariants

- `execute_query_batch` IPC 시그니처 / 동작 보존.
- `pendingConfirm` shape (모든 hook) 보존.
- `decideSafeModeAction` 본문 / 시그니처 보존.
- AC-246-D1..D7 (Phase 2 dialog), AC-245-L1..L8 (매트릭스), AC-186-*, AC-185-*
  보존.
- Tauri IPC 채널 / store / persistence 변경 0.

## Done Criteria

1. Rust trait `RdbAdapter::dry_run_sql_batch` 추가 + PG 구현 (BEGIN / 실행 /
   ROLLBACK).
2. Tauri command `execute_query_dry_run` + `lib.rs` handler 등록.
3. lib wrapper `executeQueryDryRun` + `index.ts` re-export.
4. hook `useDryRun` (status idle/running/success/error/unsupported).
5. 컴포넌트 `<DryRunPreview>` (status별 렌더 + testid).
6. `<ConfirmDestructiveDialog>` 신규 props (`connectionId`, `statements`,
   `paradigm`) 추가, placeholder 자리에 `<DryRunPreview>` mount.
7. 호출자 15곳 신규 prop 주입 + 호출자 테스트 dry-run IPC mock.
8. 신규 AC `AC-247-B1..B7`, `AC-247-H1..H5`, `AC-247-D8..D11`, `AC-247-L1`,
   `AC-247-W1..W3` 매핑 완료.
9. Verification Plan 7개 check 모두 pass.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0/0)
  3. `pnpm vitest run` (전체 통과 + AC-247 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (신규 dry-run 단위
     테스트 포함)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` (clean)
  6. `rg "execute_query_dry_run" src-tauri/src/lib.rs` (handler 등록 확인 = 1)
  7. `rg "executeQueryDryRun" src/lib/tauri/index.ts` (re-export 확인 = 1)
- Required evidence:
  - 변경 / 신규 / 삭제 파일 목록 (1줄 의도)
  - 7 check stdout 발췌
  - AC ↔ 파일:라인 매핑
  - PG `dry_run_sql_batch` 본문 인용 (`tx.rollback().await`).
  - dialog `<DryRunPreview>` mount 조건 (`open=true`) 코드 인용.
  - 가정 / 잔여 위험 (시간 의존 statement, MySQL/SQLite UX, Mongo
    disclaimer).

## Evidence To Return

- 변경 파일과 purpose
- Checks run and outcomes (7개)
- Done criteria coverage with evidence
- Assumptions
- Residual risk or verification gaps

## References

- Contract: `docs/sprints/sprint-247/contract.md`
- Phase 1 baseline: `docs/sprints/sprint-245/contract.md`, `findings.md`
- Phase 2 baseline: `docs/sprints/sprint-246/contract.md`, `findings.md`
- ADR 0022: `docs/archives/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`
- Relevant files:
  - `src-tauri/src/db/traits.rs`
  - `src-tauri/src/db/postgres/queries.rs` (또는 `mutations.rs`)
  - `src-tauri/src/commands/rdb/query.rs`
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/db/tests.rs`
  - `src/lib/tauri/query.ts`, `index.ts`
  - `src/hooks/useDryRun.ts` (신규) + `.test.ts`
  - `src/components/workspace/DryRunPreview.tsx` (신규) + `.test.tsx`
  - `src/components/workspace/ConfirmDestructiveDialog.tsx` + `.test.tsx`
  - 호출자 15곳 (DataGrid, QueryTab, EditableQueryResultGrid, schema editors,
    structure editors, useDdlPreviewExecution)
