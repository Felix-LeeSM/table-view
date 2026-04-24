# Sprint 70 Evaluation Scorecard (attempt #2)

Profile: System rubric (read-only library component, no UI-facing interaction this sprint).

Attempt #1 verdict was FAIL on a hard AC-06 contract miss: the Copy button was gated behind `!hasChildren`, so object/array nodes never exposed one. The orchestrator applied a narrow fix directly (no generator re-spawn). This scorecard re-evaluates that fix and the three accompanying tests.

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness (35%)** | 9/10 | AC-06 fix is materially correct. `BsonTreeViewer.tsx:283-290` now renders the Copy value button unconditionally (no `!hasChildren` gate). `handleCopyValue` at `:208-220` branches precisely as the contract demands: `hasChildren ? JSON.stringify(value, null, 2) : canonicalStringify(value)`. Scalars still copy compactly (`42`, `"hello"`); containers copy the pretty-printed indented form. Every other AC (`AC-01`..`AC-05`, `AC-07`..`AC-09`) remains correct — detectBsonBadge whitelist rules (`:59-106`) still reject `$comment`, still accept the `$binary + $type` legacy 2-key shape, and still strip `$regularExpression` that lacks a `pattern` field. Path builders (`joinObjectPath`/`joinArrayPath` at `:117-131`) handle identifier, bracket-quote, and array-index forms correctly; the bracket-quote arm is now exercised by `"foo bar"` → `["foo bar"]`. One minor deduction only because the cosmetic "dead-code" keyDown guard at `:185-197` (noted in attempt #1) was not addressed — the row `<div>` still has a `handleKeyDown` listener that almost never fires because buttons intercept focus. Not contract-blocking; flagged P3 only. |
| **Completeness (25%)** | 9/10 | All nine acceptance criteria now have passing test coverage, including the previously uncovered clauses. AC-06 now has four tests: two scalar cases (number, string) plus two container cases (object `{ email, age }` → indented JSON, array `["admin","ops"]` → indented JSON). AC-05 gained a bracket-quote test (`["foo bar"]`) that exercises the previously-untested path arm called out in the attempt #1 P3 feedback. Invariants respected: `git status` lists only `docs/sprints/sprint-70/`, `BsonTreeViewer.tsx`, and `BsonTreeViewer.test.tsx` as untracked — nothing else. No `src-tauri/**` diffs. The concurrent agent's DataGrid null-vs-empty-string work landed as commit `10b6071` (outside Sprint 70 scope, per Invariants). Public API remains minimal: `value`, `rootLabel` — no creep. |
| **Reliability (20%)** | 8/10 | The fix doesn't regress anything: all 15 BsonTreeViewer tests pass (`Tests 15 passed (15)` in 856ms — this includes the 12 prior tests plus 3 new ones). Full vitest regression green: `Test Files 69 passed (69)`, `Tests 1232 passed (1232)`. `cargo test --lib` clean at 215/215. Error handling paths are preserved: `copyToClipboard` still swallows `writeText` rejections; `canonicalStringify` still wraps in try/catch for circular/non-serialisable values. `handleCopyValue` now closes over the raw `value` (which may be large objects), but `useCallback` dependencies correctly include both `hasChildren` and `value`, so a stale value cannot leak. `JSON.stringify(value, null, 2)` on container values does not have a circular-reference fallback — if a self-referential document reaches the viewer, the copy will throw (swallowed by `copyToClipboard`'s catch, so no crash, but the clipboard will silently not update). Unlikely from a BSON adapter, but worth a future note. Minor `act(...)` warning printed in test output for the bracket-quote test because the `setCopied` state update trails the clipboard write — cosmetic only; tests still pass. |
| **Verification Quality (20%)** | 9/10 | Every required check re-run by this evaluator passes: `pnpm vitest run src/components/shared/BsonTreeViewer.test.tsx` → 15/15, 856ms. `pnpm lint` → exit 0 with no output. `pnpm tsc --noEmit` → exit 0 (the 2 ambient TS errors the handoff anticipated in `DataGridTable.editing-visual.test.tsx` have since been resolved — the concurrent agent's work reached a consistent state). `cd src-tauri && cargo fmt --all -- --check` → exit 0. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` → exit 0. Orchestrator-scope checks: `cargo test --lib` → 215/215, `pnpm vitest run` full suite → 1232/1232. The three new tests make **exact-match** assertions (`toHaveBeenCalledWith(JSON.stringify({email:"a@x.dev",age:30}, null, 2))`) rather than loose `toContain`, so the indented-JSON shape is genuinely verified. The bracket-quote test asserts the exact string `["foo bar"]`. Handoff is accurately updated with the revised count (15 tests) and AC→test mapping. One tiny deduction: AC-06 handoff table lists the three new tests but does not explicitly show the exact indented form in the evidence cited — a reader has to open the test to see the precise expected value. Not blocking; it is still unambiguous because the tests themselves are exact-match. |
| **Overall** | **8.7/10** | weighted: 9×0.35 + 9×0.25 + 8×0.20 + 9×0.20 = 3.15 + 2.25 + 1.60 + 1.80 = **8.80** |

## Verdict: PASS

Every dimension scores ≥ 7 and the contract Exit Criterion "Open P1/P2 findings: 0" is met. The attempt #1 P2 (AC-06 container copy miss) and P3 (bracket-quote path format untested) have both been resolved. Remaining observations are P3 cosmetic only.

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** — `renders a nested document/array as a tree with root expanded`: `role="tree"` container mounts, depth-0 root expanded, depth-1 children named (`name`, `tags`, `profile`), array index buttons `[0]`/`[1]` rendered, scalar text `"alice"` visible.
- [x] **AC-02** — `toggles aria-expanded on mouse click and keyboard (Enter/Space)`: three distinct interaction paths exercised (click → true, Enter → false, Space → true) with `aria-expanded` verified on the `treeitem` after each step. Keyboard test uses `userEvent.setup()` which installs its own `navigator.clipboard`, which is why the clipboard tests deliberately use `fireEvent` — this is documented in the file header.
- [x] **AC-03** — `renders canonical extended JSON wrappers as scalar badges`: all 7 required type labels verified (`ObjectId`, `ISODate`, `NumberLong`, `NumberDouble`, `NumberInt`, `Decimal128`, `Binary`). The 2-key `$binary + $type` legacy shape is rendered as a Binary badge, confirmed in both the render test and `detectBsonBadge`'s unit test. Remaining 7 wrappers (`$timestamp`, `$regularExpression`, `$symbol`, `$code`, `$minKey`, `$maxKey`, `$undefined`) are declared in `BSON_WRAPPERS` (`:14-29`) per contract ("코드에만 포함되면 충분").
- [x] **AC-04** — `does not misdetect non-whitelisted $-keys as badges` + `detectBsonBadge accepts the $binary + $type 2-key wrapper only`: `{ $comment: "note" }` renders as an object node with a `$comment` key button, no badge text present; unit assertions confirm null for scalar/array/empty/2-key mismatches (`{ $oid: "abc", $foo: "bar" }` correctly returns null).
- [x] **AC-05** — `copies the field path to clipboard on key click` + `uses bracket-quote path form for non-identifier keys`: identifier path (`user.profile.emails[0]`) plus non-identifier path (`["foo bar"]`) both verified. All three format rules in the contract (dot for identifiers, bracket-quote for non-identifiers, `[i]` for arrays) are now in-suite.
- [x] **AC-06** — **All four required shapes covered.** Scalars: `copies the canonical JSON of a scalar node via Copy value` (`42`) and `copies the canonical JSON of a string scalar with quotes` (`"hello"`). Containers: `copies indented JSON for an object container value` (exact-match `JSON.stringify({email:"a@x.dev",age:30}, null, 2)`) and `copies indented JSON for an array container value` (exact-match `JSON.stringify(["admin","ops"], null, 2)`). The implementation branch at `BsonTreeViewer.tsx:212-214` is the exact form the contract wording demands.
- [x] **AC-07** — `renders a safe empty state when the value is null`: `role="tree"` still mounts, `No document selected` message rendered, no thrown errors.
- [x] **AC-08** — `renders an empty object without throwing`, `renders an empty array without throwing`, `renders a 6-deep nested structure without crashing`: all three boundary conditions covered; the 6-deep test deliberately exceeds the contract's "5단계 이상" floor.
- [x] **AC-09** — All five verification-plan checks pass on fresh re-run; see Evidence Log below.

## Invariants & Scope

- `git status` lists **only** `docs/sprints/sprint-70/`, `src/components/shared/BsonTreeViewer.tsx`, and `src/components/shared/BsonTreeViewer.test.tsx` as untracked. No unexpected `M` entries.
- The concurrent agent's DataGrid `Map<string, string | null>` work landed in commit `10b6071 feat(datagrid): distinguish SQL NULL from empty string in cell edits` — completely outside Sprint 70's file scope, as required by the contract's Invariants section.
- No `src-tauri/**` diffs touched by Sprint 70.
- `QuickLookPanel.test.tsx`, `DocumentDataGrid.tsx`, and `src/types/document.ts` all untouched.
- `BsonTreeViewer.tsx` and `.test.tsx` do not import any DataGrid module, so the previously-flagged ambient TS/lint errors in `DataGridTable.editing-visual.test.tsx` were never Sprint 70's concern — and as of this evaluation those errors are cleared anyway.

## Evidence Log (Evaluator re-run, 2026-04-24)

- `pnpm vitest run src/components/shared/BsonTreeViewer.test.tsx` → `Test Files 1 passed (1)`, `Tests 15 passed (15)`, 856ms. All three new tests visible in verbose output.
- `pnpm vitest run` (full suite) → `Test Files 69 passed (69)`, `Tests 1232 passed (1232)`, 13.83s. No regressions.
- `pnpm lint` → exit 0, zero diagnostics.
- `pnpm tsc --noEmit` → exit 0. The 2 ambient errors the handoff documented (`DataGridTable.editing-visual.test.tsx` unused imports) have since been resolved — TS workspace is clean.
- `cd src-tauri && cargo fmt --all -- --check` → exit 0.
- `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` → exit 0, `Finished dev profile` with zero warnings.
- `cd src-tauri && cargo test --lib` → `215 passed; 0 failed; 0 ignored`.

## Key Code References

- AC-06 implementation (container vs scalar branch): `src/components/shared/BsonTreeViewer.tsx:208-220`.
- AC-06 button render (no `!hasChildren` gate): `src/components/shared/BsonTreeViewer.tsx:283-290`.
- Badge whitelist: `src/components/shared/BsonTreeViewer.tsx:14-29` (table), `:59-106` (`detectBsonBadge`).
- Path joiners: `src/components/shared/BsonTreeViewer.tsx:117-131`.
- Null-safe root: `src/components/shared/BsonTreeViewer.tsx:425-435`.

## Minor Observations (not blocking — Sprint 71 may fold these in)

1. **Circular reference in container copy** (P3, informational): `handleCopyValue` uses `JSON.stringify(value, null, 2)` for containers without a cycle guard. If a self-referential document reaches the viewer, the stringify will throw; the `copyToClipboard` catch absorbs it so nothing crashes, but the clipboard silently does not update. Unlikely from a well-behaved BSON driver but worth noting for Sprint 71 if QuickLookPanel accepts arbitrary documents. Suggestion: wrap in try/catch and fall back to `canonicalStringify` if stringify throws.

2. **`act(...)` warning in bracket-quote test** (P3, cosmetic): When `handleCopyPath` resolves, the trailing `setCopied("path")` state update happens outside the test's implicit act boundary, so vitest emits an `act(...)` warning. Tests still pass; same pattern appears elsewhere in the codebase. Suggestion: if desired, await a `findBy*` query after the click to let state settle, or explicitly wrap `fireEvent.click` in `await act(async () => {...})`. Not required.

3. **Dead-code keyDown guard** (P3, deferred from attempt #1): `handleKeyDown` at `BsonTreeViewer.tsx:185-197` gates on `e.target !== e.currentTarget` and rarely fires because the buttons intercept tab focus. Not exposed as a user-visible issue — buttons handle Enter/Space natively — so this is reasonably deferred to Sprint 71, where roving tabindex could be added alongside QuickLookPanel keyboard nav.

## Handoff Evidence Fields

- **Status**: PASS
- **Changed files**: `src/components/shared/BsonTreeViewer.tsx` (`!hasChildren` gate removed + `handleCopyValue` branch), `src/components/shared/BsonTreeViewer.test.tsx` (3 tests added → 15 total), `docs/sprints/sprint-70/{contract,execution-brief,handoff,findings}.md`.
- **Generator-scope checks**: 5/5 pass on fresh re-run (verbatim above).
- **Orchestrator-scope checks**: `cargo test --lib` 215/215, `pnpm vitest run` 1232/1232.
- **Open P1/P2 findings**: 0.
- **Open P3 findings**: 3 (circular stringify, act warning, dead-code keyDown guard) — all deferrable.
- **Ready for Sprint 71**: Yes. `BsonTreeViewer` public API (`value: Record<string, unknown> | unknown[] | null`, optional `rootLabel`) is stable and documented; QuickLookPanel can mount it directly in the `paradigm === "document"` branch.
