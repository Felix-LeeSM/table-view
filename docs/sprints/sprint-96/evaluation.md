# Sprint 96 Evaluation — Dialog 2-Layer Layer 2 Preset Wrappers

**Evaluator:** Claude (Opus 4.7)
**Verification Profile:** `command` (file inspection + commands)
**Date:** 2026-04-25

## Scorecard (System rubric)

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 9/10 | Sprint-93 `commitError` banner contract preserved verbatim through `PreviewDialog` (`src/components/ui/dialog/PreviewDialog.tsx:129-148` — `role="alert"`, `aria-live="assertive"`, `data-testid="sql-preview-commit-error"`, "executed: N, failed at: K of M" + raw SQL). Asserted by `PreviewDialog.test.tsx:71-96`. Sprint-95 invariants — `tone`, `headerLayout`, `DialogFeedback` — are forwarded through preset props (`FormDialog.tsx:101-107`, `PreviewDialog.tsx:104`, `TabsDialog.tsx:77`). Each preset uses `onOpenChange={(next) => !next && (loading ? ... : onCancel())}` so loading-gated dismissal still works. |
| **Completeness** | 7/10 | All 7 enumerated dialogs migrated; 4 presets exist; 21 preset tests; `docs/dialog-conventions.md` written; ConnectionDialog escape-hatch comment is real (only lines 1-22 added, body unchanged — verified by `git diff HEAD -- src/components/connection/ConnectionDialog.tsx`, 30 diff lines, all additions). Gap: spec §1 lists "9 dialogs" including "`StructurePanel`'s confirm modal **등** (etc.)". The codebase has at least 8 additional inline `<DialogContent>` call-sites outside the preset layer (`SchemaTree.tsx:882`, `SchemaTree.tsx:923`, `IndexesEditor.tsx:79`, `ConstraintsEditor.tsx:122`, `EditableQueryResultGrid.tsx:427`, `DataGrid.tsx:457`, `ConnectionItem.tsx:322`, `QuickOpen.tsx:184`). The Generator's findings.md acknowledges SchemaTree's drop/rename modals but explicitly leaves them un-migrated, citing the brief's "쓰기 허용" list. This is contract-correct (the brief's allow-list is explicit), but it means the dialog convention's promise — "Application dialogs should pick one of these — they should not import Layer 1 primitives directly" (`docs/dialog-conventions.md:48-49`) — is violated by these other call-sites the same day the document is published. |
| **Reliability** | 9/10 | All 1713 tests pass (Generator-claimed and orchestrator-confirmed; re-run locally: 97 files / 1713 tests / 15.6s). Sprint-91 close-button matrix (`dialog.test.tsx:248-263`) covers 9 cases; re-run confirms all pass. ConnectionDialog's 56 tests (sprint-92 `expectNodeStable` matrix included) pass. Preset `onOpenChange` handlers correctly gate dismissal on `loading`/`isSubmitting`. `PreviewDialog` separates `error` (build-time) from `commitError` (runtime) into distinct banners — no chance of one masking the other. Minor: `BlobViewerDialog`'s byte-count footer is duplicated across both tabs (residual risk acknowledged by Generator); cosmetic only. |
| **Verification Quality** | 9/10 | Vitest, tsc, lint all exit 0 (re-run confirmed). Findings.md cites line numbers for AC evidence. Migration matrix is concrete and complete for the 7 dialogs in scope. Escape-hatch comment lines 1-22 confirmed unchanged-body via `git diff HEAD`. Sprint-93 commitError test cited and re-runs. The one weakness: no test asserts that `SchemaTree`'s inline confirm modal still passes the close-button matrix — it shouldn't break (it sets `showCloseButton={false}`), but the matrix doesn't enumerate it. |
| **Overall** | **8.5/10** | All score dimensions ≥ 7. |

## Verdict: **PASS**

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** — 4 preset wrappers exist + Layer 1 only.
  - `src/components/ui/dialog/{ConfirmDialog,FormDialog,PreviewDialog,TabsDialog}.tsx` all present.
  - Preset import lists (verified via Grep): only `@components/ui/{dialog,alert-dialog,tabs,button}` + `@/lib/utils` + `react`. Zero `radix-ui` imports inside the preset directory.
- [x] **AC-02** — 7 application dialogs migrated. Migration matrix in findings.md §"Migration Matrix" is accurate; each migration site imports from `@components/ui/dialog/<Preset>` (verified via Grep `from "@components/ui/dialog/"` — 8 product hits + 4 test hits + 1 re-export).
- [x] **AC-03** — `ConnectionDialog` escape-hatch comment.
  - `src/components/connection/ConnectionDialog.tsx:1-22` — banner present.
  - `git diff HEAD -- src/components/connection/ConnectionDialog.tsx` is 30 lines total, all under hunk `@@ -1,3 +1,25 @@` — body unchanged. ✅
- [x] **AC-04** — `docs/dialog-conventions.md` documents preset selection table (`docs/dialog-conventions.md:51-56`) + escape-hatch policy (`:92-119`) + invariant checklist (`:121-135`) + migration map (`:78-90`).
- [x] **AC-05** — Preset unit tests ≥ 1 each.
  - `ConfirmDialog.test.tsx` (4 cases), `FormDialog.test.tsx` (6 cases), `PreviewDialog.test.tsx` (6 cases including sprint-93 `commitError` regression at `:71-96`), `TabsDialog.test.tsx` (5 cases). 21 tests total — re-run shows 47 tests pass across the 5 dialog test files.
- [x] **AC-06** — Sprint-91~95 invariant regressions: 0.
  - Sprint-91 close matrix (`dialog.test.tsx:248-263`) re-runs green for all 9 cases.
  - Sprint-92 ConnectionDialog `expectNodeStable` re-runs green (58 tests in ConnectionDialog suite).
  - Sprint-93 commit-error test (`useDataGridEdit.commit-error.test.ts`) and `PreviewDialog.test.tsx:71` both pass.
  - Sprint-94 `GlobalQueryLogPanel`/`QueryLog` toast hookups still use `@components/shared/ConfirmDialog` re-export path (file `src/components/shared/ConfirmDialog.tsx:12-13` is a thin re-export of `@components/ui/dialog/ConfirmDialog`).
  - Sprint-95 `tone`/`headerLayout`/`DialogFeedback`: presets forward these explicitly (see `FormDialog.tsx:77-78,101-107`, `PreviewDialog.tsx:93,104`, `TabsDialog.tsx:67,77`).
- [x] **AC-07** — Visual/behavioural regression: 0. Full vitest run: 1713/1713 pass.

## Critical Checks (Evaluator-Specific)

| # | Check | Result |
|---|---|---|
| 1 | sprint-91 9-dialog close matrix at `dialog.test.tsx:248-263` still passes | ✅ Re-ran `vitest run src/components/ui/dialog.test.tsx` — close-button matrix passes for all 9 cases (≤ 1 close button per dialog). |
| 2 | sprint-92 ConnectionDialog body unchanged (only comment 1-22 added) | ✅ `git diff HEAD -- src/components/connection/ConnectionDialog.tsx` produces exactly 30 lines, single hunk `@@ -1,3 +1,25 @@` — pure prepended comment block. The earlier-cycle confusion was caused by `git diff HEAD~1` (which crosses sprint-95). |
| 3 | sprint-93 commitError "executed: N, failed at: K of M" preserved through PreviewDialog | ✅ `PreviewDialog.tsx:139-142` renders `executed: {statementIndex}, failed at: {statementIndex+1} of {statementCount}` verbatim with `role="alert"`, `aria-live="assertive"`, `data-testid="sql-preview-commit-error"`. `SqlPreviewDialog.tsx:54,69` wires the prop straight through. Test asserts: `PreviewDialog.test.tsx:88-95`. |
| 4 | preset files only import from Layer 1 — no direct Radix, no inline `<DialogContent>` outside Layer 1 (in scope) | ✅ Preset imports verified — no `radix-ui` direct imports in `src/components/ui/dialog/`. The 4 preset files only render `<DialogContent>` inside their own bodies (`PreviewDialog.tsx:104`, `TabsDialog.tsx:77`, `FormDialog.tsx:98`) — `ConfirmDialog.tsx` uses `<AlertDialogContent>` (Layer 1 alert primitive). |
| 5 | `docs/dialog-conventions.md` documents preset selection table + escape hatch | ✅ Selection table at lines 51-56; escape-hatch policy at lines 92-119 (3 explicit conditions); migration map at lines 78-90; invariant checklist at lines 121-135. |
| 6 | 4 preset tests (≥ 1 each) | ✅ 21 tests across the 4 preset test files. Coverage is broad — render, dismiss, button states, tone forwarding, sprint-93 regression. |

## Verification Commands Re-Run

| # | Command | Result |
|---|---|---|
| 1 | `pnpm vitest run` | 1713/1713 pass (97 files), 15.6s |
| 2 | `pnpm tsc --noEmit` | exit 0 |
| 3 | `pnpm lint` | exit 0 |
| 4 | `find src/components/ui/dialog -name "*.tsx"` | 4 presets + 4 tests, no extras |
| 5 | `grep "from \"@components/ui/dialog/" src` | 7 product + 4 test + 1 re-export sites detected |
| 6 | `ls docs/dialog-conventions.md` | 6.4 KB, present |
| 7 | `git diff HEAD -- src/components/connection/ConnectionDialog.tsx` | 30 lines, all in `@@ -1,3 +1,25 @@` (comment-only) |

## Feedback for Generator (Non-Blocking — All P3)

1. **Coverage gap on inline `<DialogContent>` call-sites outside the preset migration list** — P3.
   - Current: `SchemaTree.tsx:882,923`, `IndexesEditor.tsx:79`, `ConstraintsEditor.tsx:122`, `EditableQueryResultGrid.tsx:427`, `DataGrid.tsx:457`, `ConnectionItem.tsx:322`, `QuickOpen.tsx:184` all import Layer 1 primitives directly. The new convention document (line 48-49) tells future contributors not to.
   - Expected: Either (a) extend the migration list in a follow-up sprint, or (b) annotate these call-sites in `docs/dialog-conventions.md` so the rule reads "...except the following pre-existing inline confirm/rename modals" until they are migrated.
   - Suggestion: Add a "Known un-migrated inline call-sites (sprint-96 carry-over)" subsection to `docs/dialog-conventions.md` and either schedule a sprint-97 or mark each with a `// TODO(sprint-N): migrate to ConfirmDialog` comment so the rule and the code agree.

2. **`BlobViewerDialog` byte-count footer duplicated across tabs** — P3 (already in residual-risk).
   - Current: byte-count footer rendered inside both Hex and Text tab panes.
   - Expected: a single footer below the tab list.
   - Suggestion: Add an optional `footer` slot prop to `TabsDialog` in a follow-up.

3. **Migration matrix says "8 product hits" but contract claims 7 dialogs migrated** — P3 (cosmetic).
   - Current: `grep "from \"@components/ui/dialog/" src/components` returns 8 product files (the 7 migrated dialogs + `shared/ConfirmDialog.tsx` re-export). The findings.md "7 application-dialog migration sites + 1 re-export + 4 preset tests" wording is accurate but the contract's "7 dialogs migrated" claim could be misread without that context.
   - Suggestion: No code change. Future sprint findings could include the exact `find`/`grep` invocation so the count is auditable.

4. **`PreviewDialog`'s `commitError` prop relies on caller's `+1` indexing convention** — P3.
   - Current: `PreviewDialog.tsx:140-141` renders `failed at: {statementIndex + 1} of {statementCount}`. This works for SqlPreviewDialog because `useDataGridEdit.commitError.statementIndex` is 0-indexed. If a future caller passes 1-indexed data, the banner will display "failed at: K+1" wrongly.
   - Suggestion: Document the 0-indexed contract on `PreviewDialogCommitError.statementIndex` in JSDoc (the type currently has no field-level comment).

## Handoff

- **Status:** PASS
- **Findings:** All ACs met. Three P3 follow-ups (above) — none block sprint-96 close.
- **Required-checks evidence:** included above.
- **Open P1/P2 findings:** 0.
- **Recommendation:** Mark sprint-96 done and either open a sprint-97 ticket for the inline-modal migrations enumerated in feedback item 1 or annotate the dialog-conventions document.
