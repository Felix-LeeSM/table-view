# Sprint Execution Brief: sprint-252

## Objective

`PreviewDialog` 에 클립보드 Copy 버튼을 추가 (header 우측,
`data-testid="preview-dialog-copy"`, transient "Copied" / "Copy failed"
피드백) 하고, DataGrid 의 인라인 SQL Preview 에 `<SqlSyntax>` wrap +
동일 testid 의 Copy 버튼을 추가한다. SqlPreviewDialog 와 MqlPreviewModal
은 `copyText` 한 줄 추가로 자동 polish. CodeMirror 전면 교체는 out-of-
scope — 프로젝트의 기존 "SqlSyntax for compact previews" 정책 준수.

## Task Why

ADR 0022 Phase 5 + Sprint 250/251 의 안전망/지속성 작업 위에서, 사용자가
commit 직전 SQL/MQL 본문을 외부로 가져가 비교/문서화 할 수 있는 마지막
이음매 — Copy 버튼이 없어 사용자가 미리보기 본문을 마우스 드래그로 직접
선택해야 했다. 동시에 DataGrid 인라인 SQL preview 가 plain `<pre>` 라
시각적 가독성이 낮았는데, SqlSyntax 컴포넌트가 이미 존재하므로 1줄
wrap 으로 SqlPreviewDialog 와 동등한 highlight 를 인라인 preview 에도
부여한다. 본 sprint 로 R1–R5 polish 묶음의 마지막 항목이 닫히고,
Sprint 250/251/252 가 한 번의 사용자 가시 polish 사이클로 완성된다.

## Scope Boundary

- 변경: `PreviewDialog` (`copyText` / `copyAriaLabel` props +
  `navigator.clipboard.writeText` carrier + transient 피드백 + unmount
  timer cleanup), `SqlPreviewDialog` / `MqlPreviewModal` (`copyText` 1줄
  전달), `DataGrid.tsx` 인라인 preview (`<SqlSyntax>` wrap + Copy 버튼).
- 변경 금지:
  - PreviewDialog 기존 prop 시그니처.
  - SqlPreviewDialog 의 SqlSyntax 마크업 (AC-109 회귀 가드).
  - DataGrid 인라인 preview 의 environment stripe / X 버튼 / autoFocus
    Execute / commitError 배너 markup.
  - MqlPreviewModal 의 `aria-label="MQL commands"` / errors 배너 /
    Enter keydown.
  - Sprint 250 onBlur+Esc / Sprint 251 store-lift / Sprint 249 Cmd+Z.
  - Sprint 252 PreviewDialog 의 commit-path / dialog body / IPC /
    safeModeStore / persistence.
  - DDL editor / raw query grid / Mongo grid (read-only) 의 별도 form
    state.
  - CodeMirror 전면 교체 (SqlSyntax 유지).
  - MQL syntax highlighter 도입 (plain fallback 유지).

## Invariants

- PreviewDialog 기존 prop 8개 (`title` / `description` / `preview` /
  `children` / `error` / `commitError` / `loading` / `confirmDisabled` /
  `onConfirm` / `onCancel` / `confirmLabel` / `cancelLabel` / `tone` /
  `className` / `confirmAriaLabel` / `headerStripe`) byte-identical 동작.
- 기존 호출자 8 곳 모두 `copyText` 미전달 시 byte-identical render.
- AC-251-S1..S5 H1..H5 T1..T3 R1..R4 / AC-250-01..06 / AC-249-U1..U9 /
  AC-248-* / AC-247-* / AC-246-* / AC-245-* / AC-186-* / AC-185-* /
  AC-109 (SqlSyntax 마크업) 모두 회귀 0.
- IPC / safeModeStore / persistence 변경 0.
- Mongo grid read-only invariant 보존.

## Done Criteria

1. PreviewDialog `copyText` non-empty trim → header 우측 Copy 버튼
   (`testid="preview-dialog-copy"` + `aria-label`), 클릭 → `navigator.
   clipboard.writeText` carrier 호출 + transient "Copied" / "Copy failed"
   라벨 변화.
2. PreviewDialog `copyText` empty/whitespace → 버튼 미렌더.
3. PreviewDialog unmount 시 transient timer cleanup.
4. SqlPreviewDialog 가 `copyText={sql}` 1줄 추가 (header Copy 버튼
   자동 등장, SqlSyntax body 보존).
5. MqlPreviewModal 가 `copyText={previewLines.join("\n")}` 1줄 추가
   (plain fallback 명시 — `.text-syntax-keyword` 미존재).
6. DataGrid 인라인 preview 의 각 `<pre>` 가 `<SqlSyntax>` 로 wrap, 동일
   testid 의 Copy 버튼 등장.
7. AC-252-01..09 모두 매핑.
8. /tdd 흐름: 신규 테스트 먼저, fail → 구현 → pass.
9. Verification Plan 7개 check 모두 pass.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 / 0)
  3. `pnpm vitest run` (전체 통과 + AC-252 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "preview-dialog-copy" src/` (≥ 3 — testid 정의 + 적어도 2 호출자)
  7. `rg "navigator.clipboard.writeText" src/components/ui/dialog/PreviewDialog.tsx` (≥ 1)
- Required evidence:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 7 check stdout 발췌.
  - AC ↔ 파일:라인 매핑 (9 ACs).
  - PreviewDialog Copy 버튼 본문 인용 (testid + aria-label + carrier
    호출 + transient 피드백 + unmount cleanup 가드).
  - DataGrid 인라인 preview SqlSyntax wrap + Copy 버튼 본문 인용.
  - MqlPreviewModal `copyText` 전달 + plain fallback 보존 인용.
  - /tdd 흐름 증거.
  - 가정 / 잔여 위험.

## Evidence To Return

- 변경 파일과 purpose
- Checks run and outcomes (7개)
- Done criteria coverage with evidence
- Assumptions (test env clipboard mocking, transient timer race,
  MQL plain fallback 사용자 가시 영향)
- Residual risk (CodeMirror 통합 후순위, MQL highlighter 부재)

## References

- Spec (master): `docs/sprints/sprint-250/spec.md`
- Contract: `docs/sprints/sprint-252/contract.md`
- Sprint 251 baseline (store-lift): `docs/sprints/sprint-251/contract.md`
  + `findings.md`
- Sprint 250 baseline (onBlur+Esc): `docs/sprints/sprint-250/contract.md`
- ADR 0022: `docs/archives/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`
- Relevant files:
  - `src/components/ui/dialog/PreviewDialog.tsx`
  - `src/components/structure/SqlPreviewDialog.tsx`
  - `src/components/document/MqlPreviewModal.tsx`
  - `src/components/rdb/DataGrid.tsx` (인라인 preview, ~L600-704)
  - `src/components/shared/SqlSyntax.tsx` (재사용, 변경 없음)
  - `src/components/ui/dialog/__tests__/PreviewDialog.test.tsx` (회귀)
  - `src/components/structure/SqlPreviewDialog.test.tsx` (회귀)
