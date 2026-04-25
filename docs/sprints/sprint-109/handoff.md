# Handoff: sprint-109

## Outcome

- Status: PASS
- Summary: `SqlPreviewDialog`'s plain `<pre>` SQL block has been replaced with
  the existing `SqlSyntax` token renderer for theme-token syntax highlighting
  (`text-syntax-keyword`, `text-syntax-string`, …). Empty/whitespace-only SQL
  falls back to the original `-- No changes to preview` placeholder rendered
  in `italic text-muted-foreground`. The outer `<pre>` (scroll/border/bg/
  font-mono) is preserved verbatim, and the `PreviewDialog` prop surface is
  unchanged.

## Verification Profile

- Profile: `command`
- Overall score: 8.25/10
- Final evaluator verdict: PASS

## Sprint 109 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 8/10 | `SqlPreviewDialog.tsx` imports `SqlSyntax` and only swaps the inner content of the existing `<pre>`. Conditional `sql.trim() ? <SqlSyntax sql={sql}/> : <span className="italic text-muted-foreground">…</span>` matches the contract for both happy path and the empty placeholder. Outer `<pre>` retains `max-h-scroll-lg overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs font-mono text-foreground`, so scroll/border/bg invariants are intact. `confirmDisabled={!sql.trim()}` is consistent with the new trim-based empty check. `PreviewDialog` props (`title/description/error/commitError/onConfirm/onCancel/loading/confirmLabel`) are untouched. |
| Completeness | 9/10 | All 4 ACs covered. AC-01 verified by `dialog.querySelectorAll("span.text-syntax-keyword")` containing `CREATE` and `TABLE`. AC-02 verified twice — canonical empty (`sql=""`) and whitespace-only (`"   \n  "`) — both render the placeholder text and confirm zero keyword spans. AC-03 split into Execute and Cancel cases, each asserting the expected callback fires once and the other does not. AC-04 (regression 0) verified by full suite passing 1797/1797, which is the prior 1792 baseline plus exactly the 5 new tests in `SqlPreviewDialog.test.tsx`. |
| Reliability | 8/10 | The whitespace-only branch is a defensive improvement over the original `sql || …` and aligns with the existing `confirmDisabled={!sql.trim()}` semantics — no chance of a "Execute" enabled state with an empty rendered preview. Placeholder uses `text-muted-foreground` which correctly overrides the `<pre>`'s `text-foreground`. No console.log / TODO / `any` introduced. The two `StructurePanel.test.tsx` assertions migrated from `getByText` to `pre.textContent` are limited to two specific call sites (line ~860 and ~1419) and preserve the original semantic ("the SQL appears in the preview body"). The cast `as HTMLPreElement \| null` plus `expect(preview).not.toBeNull()` is acceptable; a `getByRole("dialog")` lookup before the `querySelector` keeps the assertion scoped to the open dialog. |
| Verification Quality | 8/10 | All three required checks (`pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`) executed and pass cleanly: vitest 1797/1797 (104 files), `tsc --noEmit` 0 errors, `eslint .` 0 errors. Targeted run of `SqlPreviewDialog.test.tsx` confirms 5/5 in the new file. ACs are mapped 1:1 to test cases in the findings table. |
| Overall | 8.25/10 | |

## Verdict: PASS

## Sprint Contract Status (Done Criteria)

- [x] AC-01: keyword span exists for `CREATE TABLE foo (id INT);` — `SqlPreviewDialog.test.tsx:14-34` queries `span.text-syntax-keyword` inside the dialog and asserts `CREATE` and `TABLE` text content.
- [x] AC-02: `sql=""` shows `-- No changes to preview` — `SqlPreviewDialog.test.tsx:36-52` plus whitespace-only variant at `:54-66`.
- [x] AC-03: `onConfirm`/`onCancel` callbacks fire — split into Execute test (`:68-84`) and Cancel test (`:86-102`).
- [x] AC-04: 0 regressions — full suite 1797/1797 (1792 prior + 5 new). `tsc --noEmit` 0 errors. `eslint .` 0 errors.

## Evidence Packet

### Checks Run

- `pnpm vitest run`: pass — Test Files 104 passed (104), Tests 1797 passed (1797), 17.21s.
- `pnpm tsc --noEmit`: pass — exit 0, zero output.
- `pnpm lint`: pass — `eslint .` exit 0, zero issues.
- `pnpm vitest run src/components/structure/SqlPreviewDialog.test.tsx`: 5/5 pass, 631ms.

### Acceptance Criteria Coverage

- `AC-01`: `SqlPreviewDialog.test.tsx` "AC-01: highlights SQL keywords with the text-syntax-keyword token" — finds keyword spans containing `CREATE` and `TABLE`.
- `AC-02`: `SqlPreviewDialog.test.tsx` "AC-02: renders the placeholder when sql is empty and skips SqlSyntax" + "AC-02: whitespace-only sql is treated as empty (placeholder shown)".
- `AC-03`: `SqlPreviewDialog.test.tsx` "AC-03: clicking Execute invokes onConfirm" + "AC-03: clicking Cancel invokes onCancel".
- `AC-04`: vitest 1797/1797 with 0 regressions; `tsc` 0 errors; lint 0 errors.

### Screenshots / Links / Artifacts

- Findings: `docs/sprints/sprint-109/findings.md`
- Implementation: `src/components/structure/SqlPreviewDialog.tsx` (lines 3, 65-73)
- Tests (new): `src/components/structure/SqlPreviewDialog.test.tsx` (5 cases)
- Tests (regression fix-up): `src/components/schema/StructurePanel.test.tsx` (two `getByText` → `pre.textContent` migrations at the two SqlPreviewDialog assertion sites; diff-confirmed minimal, no behavior change)

## Changed Areas

- `src/components/structure/SqlPreviewDialog.tsx`: added `SqlSyntax` import; replaced the inline `{sql || "-- No changes to preview"}` with a `sql.trim()` ternary that renders `<SqlSyntax sql={sql} />` when non-empty and a muted/italic `<span>` placeholder otherwise. Outer `<pre>` styling and `PreviewDialog` prop wiring untouched.
- `src/components/structure/SqlPreviewDialog.test.tsx` (new): 5 tests pinning AC-01 (keyword span tokenisation), AC-02 (empty + whitespace-only placeholder), and AC-03 (Execute/Cancel callbacks).
- `src/components/schema/StructurePanel.test.tsx`: two existing assertions previously used `screen.getByText("ALTER TABLE …")` / `screen.getByText("CREATE INDEX …")` to find the SQL inside the preview `<pre>`. Because `SqlSyntax` splits the SQL into per-token `<span>`s, the single-text-node matcher no longer applies. Migrated both to `screen.getByRole("dialog").querySelector("pre")?.textContent` equality checks. Diff is exactly two localised hunks; no other lines touched.

## Assumptions

- The contract's "muted-foreground italic" placeholder requirement is satisfied by `<span className="italic text-muted-foreground">` rendered inside the existing `<pre>`. The span's `text-muted-foreground` overrides the `<pre>`'s `text-foreground`, which matches the intended muted appearance.
- Whitespace-only SQL counts as "empty" for the placeholder branch; this is consistent with the existing `confirmDisabled={!sql.trim()}` and avoids an inconsistent state where Execute is disabled but a blank tokenised preview is rendered.
- `getByRole("dialog").querySelector("pre")` in the StructurePanel migration is acceptable RTL practice for asserting on a tokenised text body when text-node matchers no longer apply.

## Residual Risk

- None for the in-scope behavior. The sprint-93 commit-error banner contract is in a separate `PreviewDialog` code path and is unaffected. CodeMirror integration and MQL preview highlighting remain explicitly out of scope per the contract.

## Next Sprint Candidates

- Apply the same `SqlSyntax` swap to MQL preview (called out as out-of-scope here).
- Consider read-only CodeMirror for the structure SQL preview if richer affordances (line numbers, copy-on-select) are desired beyond inline tokenisation.
