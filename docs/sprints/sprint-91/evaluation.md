# Sprint 91 Evaluation Scorecard

**Sprint**: sprint-91 — `DialogHeader` row-default + dialog X-button parity (#DIALOG-1)
**Verification Profile**: `mixed` (file inspection + accept orchestrator-confirmed command outputs)
**Evaluator**: harness Evaluator (sprint-91)

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 9/10 | `DialogHeader` default class at `src/components/ui/dialog.tsx:92` is exactly `flex flex-row items-center justify-between gap-2 min-w-0 text-left`. `DialogTitle` carries `min-w-0` at `dialog.tsx:137`. Stacked-header callers (`GroupDialog.tsx:77`) explicitly override with `flex-col items-start justify-start`, preserving prior visual. ConnectionDialog workaround cleanly reverted to use `<DialogHeader>` (`ConnectionDialog.tsx:147`); `DialogHeader` import restored at `ConnectionDialog.tsx:31`. `grep "flex flex-row items-center justify-between border-b"` against ConnectionDialog returns no matches — leftover detection negative. |
| **Completeness** | 9/10 | All 5 ACs covered with assertions in `dialog.test.tsx`. Matrix covers all 9 contract dialogs at `dialog.test.tsx:141-247` with both `toBeLessThanOrEqual(expectedMax)` and a redundant `toBeLessThan(2)` "never 2+" guard at `:256/:261`. Truncate AC tested via className containment (jsdom-compatible) at `:62-65`. Both `showCloseButton={false}` (no X) and default (exactly 1) are tested at `:71-101`. Minor: `ConnectionDialog`'s expectedMax of 1 already implicitly excludes the manual ghost being doubled with the absolute X (because `showCloseButton={false}` is set), but a positive assertion that the ghost is the one matching is not isolated — fine because matrix structurally proves ≤1. |
| **Reliability** | 8/10 | Verification commands are orchestrator-confirmed: `pnpm vitest run` 1648/1648 pass, `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0. The matrix uses real component imports (not mocks) for the 9 dialogs, so any actual duplication would surface. Connection store is reset via `setupConnectionStore` per case to avoid cross-test bleed. Residual risk acknowledged in `findings.md` for out-of-scope dialogs (`SchemaTree`, `ConnectionItem` confirmation modals) where the row default may visually misalign stacked title+description — flagged as deferred follow-up, not a regression (suite green). |
| **Verification Quality** | 9/10 | AC-by-AC line-cited evidence; matrix output captured per-dialog. Required grep checks both fired (line 92 single-line match in `dialog.tsx`; 3 line matches for `name: /close/i` in matrix). `GroupDialog`'s caller-override of the new default is documented in source comments and findings, making the assumption explicit. |
| **Overall** | **8.75/10** | |

## Verdict: PASS

All four scoring dimensions clear the 7/10 threshold. Required checks (vitest, tsc, lint) green; AC-by-AC evidence linked; ConnectionDialog reversion verified clean.

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** `DialogHeader` default is row-based.
  - Source: `src/components/ui/dialog.tsx:92` — `"flex flex-row items-center justify-between gap-2 min-w-0 text-left"`.
  - Assertion: `src/components/ui/dialog.test.tsx:41-43` — asserts `flex-row`, `items-center`, `justify-between` on rendered header className.

- [x] **AC-02** Truncate-friendly `min-w-0` on header and title.
  - Source: `src/components/ui/dialog.tsx:92` (header `min-w-0`); `src/components/ui/dialog.tsx:137` (`DialogTitle` className `"min-w-0 text-lg leading-none font-semibold"`).
  - Assertion: `src/components/ui/dialog.test.tsx:62-65` — `header` and `title` both contain `min-w-0`; caller-supplied `truncate` survives `cn()` merging.

- [x] **AC-03** `showCloseButton={false}` suppresses the absolute X.
  - Source: `src/components/ui/dialog.tsx:68-76` — close primitive only renders when `showCloseButton` truthy.
  - Assertion (false → 0): `src/components/ui/dialog.test.tsx:82-83` — both `[data-slot="dialog-close"]` and `name=/close/i` are null.
  - Assertion (default → 1): `src/components/ui/dialog.test.tsx:97-100`.

- [x] **AC-04** Nine-dialog close-button matrix ≤ 1, never 2+.
  - Assertion: `src/components/ui/dialog.test.tsx:250-264` — `it.each(cases)` iterates 9 entries (`ConnectionDialog`, `GroupDialog`, `ImportExportDialog`, `BlobViewerDialog`, `CellDetailDialog`, `SqlPreviewDialog`, `MqlPreviewModal`, `AddDocumentModal`, `ConfirmDialog`) and asserts `closes.length <= expectedMax` AND `closes.length < 2`.
  - Per-dialog source verification:
    - `ConnectionDialog.tsx:143` `showCloseButton={false}` + manual ghost at `:159-166` → 1.
    - `GroupDialog.tsx:74` `showCloseButton={false}` + no manual close → 0.
    - `ImportExportDialog.tsx:35` `showCloseButton={false}` + manual `aria-label="Close dialog"` at `:51` → 1.
    - `BlobViewerDialog` no manual X, default absolute X → 1.
    - `CellDetailDialog` no manual X, default absolute X → 1.
    - `SqlPreviewDialog.tsx:31` `showCloseButton={false}` + manual `aria-label="Close dialog"` at `:46` → 1.
    - `MqlPreviewModal.tsx:52` `showCloseButton={false}` + manual `aria-label="Close MQL preview"` at `:83` → 1.
    - `AddDocumentModal.tsx:85` `showCloseButton={false}` + manual `aria-label="Close add document"` at `:100` → 1.
    - `ConfirmDialog.tsx` uses `AlertDialog` (no X primitive) → 0.

- [x] **AC-05** Existing happy-path tests regression 0.
  - Evidence: orchestrator-confirmed `pnpm vitest run` → 1648/1648 (90 files) pass.

## ConnectionDialog Reversion Audit (explicit verifier-requested check)

- `grep "flex flex-row items-center justify-between border-b border-border" src/components/connection/ConnectionDialog.tsx` → **no matches** (leftover workaround absent).
- `<DialogHeader>` is properly imported at `src/components/connection/ConnectionDialog.tsx:31` (within the `@components/ui/dialog` named-import block).
- `<DialogHeader className="border-b border-border px-4 py-3">` used at `:147`, hosting `<DialogTitle>`, `<DialogDescription className="sr-only">`, and the manual ghost `<Button aria-label="Close dialog">` on the same row — relies on the new row default.

## Required Checks

| Check | Status | Evidence |
|---|---|---|
| `pnpm vitest run` | PASS | 1648 / 1648 across 90 files (orchestrator-confirmed) |
| `pnpm tsc --noEmit` | PASS | exit 0 |
| `pnpm lint` | PASS | exit 0 |
| `grep "flex flex-row\|items-center\|justify-between" src/components/ui/dialog.tsx` | PASS | line 92 single-line match (all three tokens collocated) |
| `grep -rn "name: /close/i" src/components` | PASS | 3 matches in `dialog.test.tsx` (matrix is the central audit point) |

## Feedback for Generator

1. **Test specificity — AC-04 redundancy is fine, surface the duplication-catch comment**
   - Current: `dialog.test.tsx:256-261` asserts both `<= expectedMax` and `< 2` with an inline comment about the regex anchor.
   - Expected: The two assertions are intentionally redundant — keep both, but the comment at `:257-260` explains the *Cancel* exclusion only, not why the two `expect`s coexist. A 1-line comment "the second `<2` guard catches the case where `expectedMax` is mistakenly bumped" would make the safety net self-documenting.
   - Suggestion: Optional polish; not blocking.

2. **Out-of-scope dialog visual drift (acknowledged residual risk)**
   - Current: Findings note that `SchemaTree` confirmation, `ConnectionItem` delete confirmation, and other non-listed dialogs may visually mis-stack title+description because the row default now applies.
   - Expected: A follow-up sprint (or a single sweep PR) explicitly adds `flex-col items-start justify-start` overrides where stacked layout is desired, mirroring the `GroupDialog.tsx:77` pattern.
   - Suggestion: Open a follow-up sprint ticket so this does not slip — flagging here keeps the residual-risk register honest.

3. **`AlertDialogHeader` consistency**
   - Current: `src/components/ui/alert-dialog.tsx`'s `AlertDialogHeader` is untouched (out of contract scope per findings).
   - Expected: To prevent the same #DIALOG-1 class of bug recurring on AlertDialog flows, mirror sprint-91's row-default normalization on `AlertDialogHeader` in a future sprint.
   - Suggestion: Track in roadmap or `docs/RISKS.md` so the asymmetry is intentional and time-boxed.

4. **GroupDialog's `flex-col` override is implicit Tailwind precedence**
   - Current: `GroupDialog.tsx:77` writes `flex-col items-start justify-start`, relying on `cn()` (tailwind-merge) to overwrite the base `flex-row items-center justify-between gap-2`.
   - Expected: Working as intended (tailwind-merge handles `flex-col` ↔ `flex-row` conflict), and the assumption is documented in findings.
   - Suggestion: Optional — add a colocated `expect(header.className).toContain("flex-col")` test in `GroupDialog.test.tsx` to lock the override, so a future refactor of `cn()` cannot silently un-stack the header.

## Handoff Artifacts

- Findings: this file (`docs/sprints/sprint-91/evaluation.md`).
- Generator findings: `docs/sprints/sprint-91/findings.md`.
- Required commands all green per orchestrator-confirmed output; no re-execution needed under `mixed` profile.
- Open `P1`/`P2` findings: **0**.
- Acceptance criteria evidence linked: **yes** (per AC-01..AC-05 above).
- Exit Criteria: **met**.
