# Sprint 252 — Evaluator Findings

- Verification Profile: `command` (all 7 required checks executed independently)
- Evaluator stance: harsh-but-fair, with explicit instruction to catch
  "아주 작은 디테일의 누락"
- Date: 2026-05-09

## Sprint 252 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness (35%)** | 9/10 | Carrier called once with correct arg (verified via PreviewDialog.copy.test.tsx:81-99 + DataGrid.preview-copy.test.tsx:161-184 + MqlPreviewModal.copy.test.tsx:63-89). State machine `idle → success (1500 ms) → idle` and `idle → failure (2000 ms) → idle` implemented at PreviewCopyButton.tsx:75-95 with proper `clearTimeout` before each new schedule (PreviewCopyButton.tsx:63-73). Empty/whitespace `text` self-suppresses at PreviewCopyButton.tsx:99. Carrier-missing branch surfaces failure path + console.error (PreviewCopyButton.tsx:77-83). One subtle nit: in the carrier-missing synchronous branch, `scheduleRevert` is called without re-checking `mountedRef.current`, but since the path is fully synchronous (no await between mount-check and timer install) this cannot leak — benign. |
| **Completeness (25%)** | 9/10 | All 9 ACs (252-01..09) mapped and verified. New file `PreviewCopyButton.tsx` extracts the carrier + state machine in one place (avoids drift between PreviewDialog header and DataGrid inline preview). 4 production files modified: PreviewDialog.tsx (props + slot), SqlPreviewDialog.tsx (1-line prop), MqlPreviewModal.tsx (1-line prop + plain fallback comment), DataGrid.tsx (header Copy button + per-`<pre>` SqlSyntax wrap). 3 new test files (PreviewDialog.copy, MqlPreviewModal.copy, DataGrid.preview-copy). 8 existing PreviewDialog callers regress-free per full vitest pass (3017/3017). Existing `PreviewDialog.test.tsx` and `SqlPreviewDialog.test.tsx` unchanged (`git diff` clean). |
| **Reliability (20%)** | 8/10 | `clearTimeout` always invoked before new `setTimeout` install (PreviewCopyButton.tsx:64-66, 67-72) — rapid-double-click race resolved. Unmount cleanup correct (PreviewCopyButton.tsx:52-61): `mountedRef.current = false` AND `clearTimeout(timerRef.current)`. Carrier promise rejection caught and logged once (PreviewCopyButton.tsx:89-94). Carrier missing → same failure path (PreviewCopyButton.tsx:77-83). One soft concern: the unmount-cleanup test (PreviewDialog.copy.test.tsx:205-242) asserts only that `console.error` does NOT contain "unmounted component", but React 19 (the project version per package.json) no longer emits that warning — so the assertion is effectively vacuous. The cleanup IS correctly implemented in production code, but the test does not actively prove the timer was cancelled (e.g. via a setStatus spy or by re-rendering and checking for stale state). |
| **Verification Quality (20%)** | 9/10 | All 7 required commands re-run independently and passing: tsc (0 errors), lint (0/0), vitest (3017/3017 — baseline 3003 + 14 new), cargo test --lib (627/0/2), cargo clippy (no warnings), `rg "preview-dialog-copy" src/` (6 files: PreviewCopyButton, 2 test files for it, DataGrid, DataGrid test, PreviewDialog test), `rg "navigator.clipboard.writeText" src/components/ui/dialog/` (PreviewCopyButton.tsx — extracted location explicitly permitted by user-supplied evaluator brief). AC ↔ test:line mappings in handoff are accurate after spot-check. |
| **Overall** | **8.75/10** | All 4 dimensions ≥ 7. PASS. |

## Verdict: PASS

All 9 ACs satisfied. All 7 verification commands independently re-run and pass.
Two minor improvement notes documented under "Feedback for Generator" but
neither blocks acceptance.

## Sprint Contract Status (Done Criteria)

- [x] **AC-252-01**: PreviewDialog renders Copy button with `data-testid="preview-dialog-copy"` and explicit `aria-label` when `copyText` is non-empty after trim.
  - Production: `src/components/ui/dialog/PreviewCopyButton.tsx:104-117` (testid + aria-label propagated) + `src/components/ui/dialog/PreviewDialog.tsx:134-142` (header-right slot).
  - Test: `src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx:49-79` (default `aria-label="Copy"` + override via `copyAriaLabel`).
- [x] **AC-252-02**: Copy click invokes `navigator.clipboard.writeText` exactly once with the body text.
  - Production: `src/components/ui/dialog/PreviewCopyButton.tsx:75-95` (`await carrier(text)`).
  - Tests: `PreviewDialog.copy.test.tsx:81-99` (asserts `toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith("SELECT * FROM users")`); `MqlPreviewModal.copy.test.tsx:63-89` (joined lines); `DataGrid.preview-copy.test.tsx:161-184` (joined SQL with `;\n`).
- [x] **AC-252-03 success**: Transient "Copied" label appears for 1500 ms then reverts.
  - Production: `PreviewCopyButton.tsx:84-87` (sets status), `:32` (`SUCCESS_TIMEOUT_MS = 1500`), `:35-39` (LABEL map), `:101-102` (Icon swap to `Check`).
  - Test: `PreviewDialog.copy.test.tsx:101-131` (assert "Copied" present then advance 1600 ms then assert reverted to "Copy").
- [x] **AC-252-03 failure**: Transient "Copy failed" label + console.error on rejection.
  - Production: `PreviewCopyButton.tsx:89-94` (catch block sets status, logs error), `:33` (`FAILURE_TIMEOUT_MS = 2000`).
  - Test: `PreviewDialog.copy.test.tsx:133-166` (carrier rejects, asserts "Copy failed" + `errSpy` called, then advance 2100 ms + revert).
- [x] **AC-252-04**: Empty/whitespace `copyText` → button NOT rendered.
  - Production: `PreviewCopyButton.tsx:99` (`if (text.trim() === "") return null;`). Also PreviewDialog only mounts the button when `copyText !== undefined` — combined with the inner trim check, both `copyText=""` and `copyText="   "` self-suppress.
  - Tests: `PreviewDialog.copy.test.tsx:168-179` (empty string), `:181-192` (whitespace), `:194-203` (omitted entirely — byte-identical render for legacy callers); `MqlPreviewModal.copy.test.tsx:91-101` (empty `previewLines`).
- [x] **AC-252-05**: SqlPreviewDialog body + DataGrid inline preview body both contain `.text-syntax-keyword` spans.
  - SqlPreviewDialog: `src/components/structure/SqlPreviewDialog.tsx:91-101` already wraps body in `<SqlSyntax>` (sprint 109, unchanged). Verified by existing regression test `SqlPreviewDialog.test.tsx:14-34`.
  - DataGrid: `src/components/rdb/DataGrid.tsx:670-674` (each `<pre>` body now wrapped in `<SqlSyntax sql={sql} />`). Test: `DataGrid.preview-copy.test.tsx:143-159` (asserts `keywordSpans.length > 0` AND that "UPDATE" is among the keyword texts).
- [x] **AC-252-06**: Read-only highlight — keyboard cannot mutate body. SqlSyntax emits only `<span>` children (`src/components/shared/SqlSyntax.tsx:26-37`, unchanged); span elements are non-editable by default. AC-109 regression coverage already exists and continues to pass.
- [x] **AC-252-07**: MqlPreviewModal body has NO `.text-syntax-keyword` markers (plain fallback).
  - Production: `MqlPreviewModal.tsx:76-82` — body remains plain `<pre aria-label="MQL commands">{previewLines.join("\n")}</pre>`. The `copyText` prop (line 48) only feeds the Copy button, NOT the body markup. Sprint 252 comment at `:44-47` documents intent.
  - Test: `MqlPreviewModal.copy.test.tsx:40-61` (renders Mongo-shaped command, asserts `dialog.querySelectorAll("span.text-syntax-keyword").length === 0` AND `aria-label="MQL commands"` preserved).
- [x] **AC-252-08**: 8 existing PreviewDialog callers + DataGrid existing tests regress-free. Full `pnpm vitest run` reports `Test Files 239 passed (239) / Tests 3017 passed (3017)`. `git diff HEAD -- src/components/ui/dialog/__tests__/PreviewDialog.test.tsx src/components/structure/SqlPreviewDialog.test.tsx` is empty (existing tests unmodified). DataGrid editing/undo/lifecycle test files (`src/components/rdb/__tests__/`) untouched.
- [x] **AC-252-09**: Commit error / generation error / loading / `headerStripe` props unchanged. PreviewDialog interface diff (`PreviewDialog.tsx:84-90`) adds only `copyText?: string` and `copyAriaLabel?: string`. The `commitError` block (`:159-177`), `error` block (`:150-157`), footer (`:180-200`), and `headerStripe` slot (`:121`) are byte-unchanged. Existing 6-case regression suite (`PreviewDialog.test.tsx`) passes without modification.

## Independent Verification — Command Output Excerpts

```
$ pnpm tsc --noEmit
(no output, exit 0)

$ pnpm lint
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .
(no findings, exit 0)

$ pnpm vitest run
RUN  v4.1.3 /Users/felix/Desktop/study/view-table
Test Files  239 passed (239)
     Tests  3017 passed (3017)
  Duration  57.02s

$ cargo test --lib --manifest-path src-tauri/Cargo.toml
test result: ok. 627 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 42.33s

$ cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.96s
(no warnings, exit 0)

$ rg "preview-dialog-copy" src/ -l
src/components/ui/dialog/PreviewCopyButton.tsx
src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx
src/components/ui/dialog/PreviewDialog.tsx
src/components/document/MqlPreviewModal.copy.test.tsx
src/components/rdb/DataGrid.tsx
src/components/rdb/DataGrid.preview-copy.test.tsx
(6 files — far above ≥ 3)

$ rg "navigator.clipboard.writeText" src/components/ui/dialog/
src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx:7
src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx:23,24,41,81
src/components/ui/dialog/PreviewCopyButton.tsx:76 (carrier call site)
src/components/ui/dialog/PreviewCopyButton.tsx:80 (error message string)
(carrier present in PreviewCopyButton.tsx — explicitly permitted by evaluator brief)
```

## Static Spot-Check — Code Review

### `src/components/ui/dialog/PreviewCopyButton.tsx`

- **State machine**: `idle → success (1500 ms) → idle`, `idle → failure (2000 ms) → idle`. Correctly implemented.
- **Unmount cleanup** (`:52-61`):
  ```tsx
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
  ```
  `useRef` + cleanup pattern correct. `mountedRef.current = true` is also set in the effect body so a remount inside React StrictMode (double-invoke) is handled. **Note**: `useRef(true)` initializes to `true`, so even before the effect commits, mount-check returns true — this is intentional and safe.
- **`scheduleRevert` race guard** (`:63-73`):
  ```tsx
  const scheduleRevert = useCallback((ms: number) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current) {
        setStatus("idle");
      }
    }, ms);
  }, []);
  ```
  `clearTimeout` BEFORE schedule prevents leak across rapid clicks. Inner callback re-checks `mountedRef.current` to avoid setState on dead component. Correct.
- **Carrier call** (`:75-95`):
  - `navigator.clipboard?.writeText?.bind(navigator.clipboard)` defensively probes — matches handoff claim.
  - Try/catch wraps the awaited carrier; rejection logs `console.error("Clipboard writeText failed:", err)` exactly once and surfaces "Copy failed".
  - Carrier-missing branch logs `"Clipboard API unavailable: navigator.clipboard.writeText is missing"` once and routes to the same failure UX.
- **testid/aria-label propagation** (`:104-117`): `data-testid="preview-dialog-copy"` verbatim, `aria-label={ariaLabel}` (default `"Copy"` per `:43`).
- **Empty edge case** (`:99`): `if (text.trim() === "") return null;` — handles `""`, `"   "`, `"\t\n"` uniformly. ✓
- **TypeScript strictness**: No `any`. Status enum `"idle" | "success" | "failure"` is closed. Props interface exported. ✓

### `src/components/ui/dialog/PreviewDialog.tsx`

Diff vs sprint-251 baseline:
- (a) Props interface additions at `:84-90`: `copyText?: string` + `copyAriaLabel?: string` with comprehensive doc comments.
- (b) Defaults at `:110-111` (no default value — both fall through to `undefined`).
- (c) PreviewCopyButton mount in DialogHeader at `:122-143`:
  ```tsx
  <DialogHeader>
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <DialogTitle>...</DialogTitle>
        {description ? <DialogDescription>...</DialogDescription> : null}
      </div>
      {copyText !== undefined ? (
        <PreviewCopyButton text={copyText} ariaLabel={copyAriaLabel} className="shrink-0" />
      ) : null}
    </div>
  </DialogHeader>
  ```
  The wrapping `<div className="flex items-start justify-between gap-2">` IS new — it replaces the previous direct `<DialogHeader>` content with a flex split. **Risk**: this changes the DOM nesting for the 8 existing callers (one extra `<div>` wrapping the title/description column). However: vitest pass on existing 6-case `PreviewDialog.test.tsx` regression suite + 8 caller test suites confirms no observable test failure. The change is pure layout and the `<DialogTitle>` / `<DialogDescription>` text remains discoverable via `getByText` / `getByRole("dialog")`. Acceptable.
- The commit-error block (`:159-177`), error block (`:150-157`), footer (`:180-200`), `headerStripe` slot (`:121`) are byte-identical to baseline.

### `src/components/structure/SqlPreviewDialog.tsx`

- Net diff is exactly 5 lines (per `git diff --stat`):
  ```tsx
  // Sprint 252: Surface header Copy button. PreviewCopyButton self-
  // suppresses on empty/whitespace, so a stub `sql=""` keeps the
  // button hidden and existing AC-109 markup unchanged.
  copyText={sql}
  copyAriaLabel="Copy SQL to clipboard"
  ```
  at `:86-90`. Body markup (`:91-101`) untouched — SqlSyntax wrap preserved (AC-109 still passes).

### `src/components/document/MqlPreviewModal.tsx`

- Net diff: 6 lines added at `:44-49`:
  ```tsx
  // Sprint 252: Plain-text join — Mongo dialect highlighter absent so
  // SqlSyntax is intentionally NOT wrapped here (AC-252-07 plain
  // fallback). Empty previewLines → joined string is "" → button
  // self-suppresses (AC-252-04).
  copyText={previewLines.join("\n")}
  copyAriaLabel="Copy MQL commands to clipboard"
  ```
- `<pre aria-label="MQL commands">{previewLines.join("\n")}</pre>` body at `:76-82` byte-identical.
- No `<SqlSyntax>` import or wrap — AC-252-07 plain fallback satisfied. Verified by `MqlPreviewModal.copy.test.tsx:56-57` querying for `span.text-syntax-keyword` and asserting `length === 0`.

### `src/components/rdb/DataGrid.tsx` — inline preview region

- **Header Copy button** mounted at `:639-656`: PreviewCopyButton + X close button siblings inside `<div className="flex items-center gap-1">`. The Copy button uses the joined SQL `editState.sqlPreview?.join(";\n") ?? ""` — empty join self-suppresses.
- **`<pre>` body wrap** at `:662-674`: each statement now `<pre key={i}><SqlSyntax sql={sql} /></pre>`, preserving the `isFailed` styling toggle.
- **Load-bearing markup preserved** — verified line by line:
  - Environment stripe at `:622-634` (`data-environment-stripe={connectionEnvironment}`, `aria-hidden="true"`) — unchanged.
  - X close button at `:649-655` with `aria-label="Close SQL preview"` — unchanged.
  - autoFocus Execute button at `:709` — confirmed via grep below.
  - commitError banner at `:680-699` (`role="alert"`, `aria-live="assertive"`, `data-testid="datagrid-commit-error"`) — byte-identical.
  - Enter → handleExecuteCommit keydown at `:615-620` — unchanged.

## Static Spot-Check — Test File Validity

- **`PreviewDialog.copy.test.tsx`**: 8 cases mapped to AC-252-01 (×2: default + override), 02, 03 success, 03 failure, 04 (×3: empty / whitespace / omitted), and unmount cleanup. The `installClipboard` helper uses `Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })` — clean, no jsdom hacking required. Each test installs and tears down the carrier in beforeEach/afterEach (`:34-47`). `vi.useFakeTimers()` allows `vi.advanceTimersByTime()` to deterministically trigger the revert. Solid.
- **`MqlPreviewModal.copy.test.tsx`**: 3 cases — AC-252-07 (no keyword spans + aria-label preserved), AC-252-02 (writeText with joined lines), AC-252-04 (empty previewLines). The Mongo-shaped command in AC-252-07 (`db.users.updateOne({ _id: ObjectId(...) }, { $set: { name: "Ada" } })`) is a realistic payload — proves the SQL tokeniser is NOT applied even when input *could* be misinterpreted (e.g. `set` is a SQL keyword).
- **`DataGrid.preview-copy.test.tsx`**: 2 cases — AC-252-05 (asserts `keywordSpans.length > 0` AND `keywordTexts.includes("UPDATE")`) + AC-252-02/08 (Copy button discoverable by shared testid + writes joined SQL). Uses `dataGridTestHelpers` for setup; mocks `tabStore` / `schemaStore`; triggers the preview via `commit-changes` event — robust integration-level test.

## Feedback for Generator (non-blocking)

1. **[Test rigor — Reliability]** The unmount cleanup test (`PreviewDialog.copy.test.tsx:205-242`) checks `console.error` calls for the substring "unmounted component" — but React 19 (the installed version per `package.json`) no longer emits that warning. The assertion is therefore vacuous and would also pass even if `clearTimeout` were removed from the cleanup function.
   - Current: relies on a deprecated React warning channel.
   - Expected: actively prove the timer was cancelled — e.g., spy on `setStatus` (not feasible since it's internal) or assert that re-mounting the component after the unmount + timer-advance does NOT show "Copied" on first render.
   - Suggestion: rewrite as: install carrier → click → unmount → spy on `clearTimeout` and assert it was called; OR remount and assert label is "Copy" not "Copied" by re-rendering with the same `text` after `vi.advanceTimersByTime(2500)`.

2. **[Carrier-missing path — Correctness nit]** In `PreviewCopyButton.tsx:77-83`, the carrier-missing branch sets status and schedules revert without re-checking `mountedRef.current` for the schedule call (only the inner callback is mount-guarded via `scheduleRevert`'s timer body). This is benign because the path is fully synchronous within the click handler, but for symmetry with the await-resolved/await-rejected paths, a defensive `if (!mountedRef.current) return;` early-out would tighten the invariant. Pure polish.
   - Current: `:77-83` schedules revert unconditionally on missing carrier.
   - Suggestion: add `if (!mountedRef.current) return;` after the `console.error` line; same for the carrier-missing branch as a uniform exit.

3. **[Doc — Verification check #7 wording]** The contract literally specifies `rg "navigator.clipboard.writeText" src/components/ui/dialog/PreviewDialog.tsx`. After extracting into `PreviewCopyButton.tsx` the literal grep string yields 0 matches (the carrier call now lives in the sibling file). The user-supplied evaluator brief expanded the search to `src/components/ui/dialog/` (directory), which DOES match. Future Generator runs should propose a contract amendment if the carrier-extraction pattern is going to persist — leaves the contract in sync with reality.
   - Current: contract check #7 grep target is the wrong file path post-extraction.
   - Suggestion: in the next sprint that touches this surface, update the verification check #7 path to `src/components/ui/dialog/` (directory) so the contract self-verifies.

4. **[Layout — Completeness nit]** The `<div className="flex items-start justify-between gap-2">` wrapper added inside `<DialogHeader>` (`PreviewDialog.tsx:123`) is new for ALL 8 existing callers — even those that did not opt into `copyText`. While vitest confirms no observable regression, this technically violates the strict reading of "byte-identical render for the 8 callers without copyText." The change is justified (header layout needs flex-split) but worth flagging as a tiny detail.
   - Current: extra `<div>` wrapping injected universally.
   - Suggestion: if "byte-identical" truly is load-bearing (e.g. CSS selectors targeting `DialogHeader > h2`), conditionally render the wrapping `<div>` only when `copyText !== undefined`. If not load-bearing, document the relaxation in the contract's invariant section explicitly.

## Anti-Pattern Sweep

- ❌ "Tests pass" claimed without independent re-run → did re-run all 7. ✓
- ❌ AC mapping pointing at comment lines → spot-checked PreviewDialog.copy.test.tsx and the citations point at real `expect()` assertions, not comments. ✓
- ❌ Transient timer leak across rapid clicks → `clearTimeout` before `setTimeout` confirmed (`PreviewCopyButton.tsx:64-66`). ✓
- ❌ console.error firing more than once per failure → exactly one call per fail-path branch (`:80` for carrier missing, `:91` for rejection). ✓
- ❌ Empty body case mishandled → both `copyText=""` and `copyText="   "` route through `text.trim() === ""` and return null (`PreviewCopyButton.tsx:99`). Verified by 3 separate test cases. ✓
- ❌ DataGrid load-bearing element drift → environment stripe / X / autoFocus Execute / commitError banner / Enter keydown all preserved (line citations above). ✓
- ❌ Mongo highlight markers leaked → MqlPreviewModal body has zero `.text-syntax-keyword` spans (verified by `MqlPreviewModal.copy.test.tsx:56-57`). ✓

## TDD Flow Evidence

- Per handoff "Tests-First (TDD)" section: tests written first by previous Generator iteration → red → current Generator implemented production code → green (`14 passed`).
- The 3 new test files contain explicit `Sprint 252 (2026-05-09)` headers documenting WHY they were written (and per project rule "all tests need date + reason" they comply).
- Final aggregate: 3017 passed (baseline 3003 + 14 new) matches the contract's expectation (≥ 3013).

## Structured Scorecard Block

```yaml
sprint: 252
verdict: PASS
scorecard:
  correctness: 9
  completeness: 9
  reliability: 8
  verification_quality: 9
  overall: 8.75
acs_satisfied: 9
acs_total: 9
verification_checks_passed: 7
verification_checks_total: 7
test_count: 3017
test_count_baseline: 3003
test_count_new: 14
findings_p1: 0
findings_p2: 0
findings_p3: 4
notable_strengths:
  - shared PreviewCopyButton avoids drift between PreviewDialog & DataGrid
  - clearTimeout-before-setTimeout race guard correct
  - empty/whitespace edge case handled in 3 separate test cases
  - 8 existing callers regress-free (full vitest 3017/3017)
notable_concerns:
  - unmount cleanup test asserts on deprecated React warning string (vacuous in React 19)
  - new flex wrapper inside DialogHeader applies to all 8 legacy callers
  - contract verification check #7 path needs updating after carrier extraction
exit_criteria_met: true
```
