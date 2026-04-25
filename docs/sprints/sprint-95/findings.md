# Sprint 95 — Generator Findings

## Changed Files

| File | Purpose |
|------|---------|
| `src/components/ui/dialog.tsx` | Layer-1 primitive surface: added `DialogContent.tone` (`default \| destructive \| warning`) with neutral/destructive/warning border tokens + `data-tone` attribute, added `DialogHeader.layout` (`row` default, `column` opt-in) with `data-layout` attribute (sprint-91 row default preserved), added new `DialogFeedback` primitive (props: `state`, `message?`, `loadingText?`, `slotName?`) with always-mounted outer wrapper + min-h reservation + 4-state inner content (idle placeholder, loading spinner+role=status, success/error role=alert with success/destructive tokens). Re-exports `DialogTone`, `DialogHeaderLayout`, `DialogFeedbackState`, `DialogFeedbackProps`. |
| `src/components/ui/alert-dialog.tsx` | Symmetric tone surface: `AlertDialogContent` accepts `tone?: DialogTone` (re-using the type from `dialog.tsx`) and forwards the same `data-tone` + border-token mapping. Required so `ConfirmDialog`'s `tone="destructive"` reaches the Radix AlertDialog content node (AC-05). |
| `src/components/ui/dialog.test.tsx` | Sprint-95 unit tests (13 new tests across 4 describe blocks): tone 3-variant assertions (AC-01), layout row/column assertions (AC-02), DialogFeedback 4-state + slotName override + stable-identity rerender assertions (AC-03), ConfirmDialog destructive/default tone assertions (AC-05). Sprint-91 close-button matrix preserved verbatim (AC-06). |
| `src/components/connection/ConnectionDialog.tsx` | Migrated the inline test-feedback slot to `<DialogFeedback slotName="test-feedback" loadingText="Testing..." />`. `pending` from the local discriminated union projects to the primitive's `loading` state; success/error messages flow through unchanged. Removed now-unused `CheckCircle` / `AlertCircle` imports (those icons live inside `DialogFeedback`). |
| `src/components/connection/ConnectionDialog.test.tsx` | Updated the sprint-92 idle-state assertion to query `[data-testid="dialog-feedback-idle"]` (the primitive's stable testid). All other sprint-92 assertions — `data-slot="test-feedback"` selector, `expectNodeStable` identity across idle → pending → success/error and rapid 3-click race, "Testing..." text, success/error messages, role=alert, aria-live polite, removal of pending content on resolve — pass without further edits because the primitive faithfully reproduces the inline behaviour. |
| `src/components/shared/ConfirmDialog.tsx` | Forwards `tone={danger ? "destructive" : "default"}` to `AlertDialogContent`. The Button `variant={danger ? "destructive" : "default"}` is left intact — tone is the dialog-frame signal, button variant is the action signal; they reinforce each other rather than duplicate. |

`ConfirmDialog.test.tsx` does not exist; tone assertions for `ConfirmDialog` ride in `dialog.test.tsx` alongside the rest of the sprint-95 surface tests. Existing sprint-91 close-button matrix already exercises ConfirmDialog rendering.

## Verification Plan — Required Checks

| # | Command | Result | Evidence |
|---|---------|--------|----------|
| 1 | `pnpm vitest run` | PASS | `Test Files 93 passed (93); Tests 1692 passed (1692)` (14.76s). Sprint-94 baseline was 1679 → +13 sprint-95 tests, zero regressions. |
| 2 | `pnpm tsc --noEmit` | PASS | exit 0 (no output). |
| 3 | `pnpm lint` | PASS | `> eslint .` with no diagnostics. |
| 4 | `grep -n 'tone:\|layout:\|DialogFeedback\|data-slot="dialog-feedback"' src/components/ui/dialog.tsx` | PASS | 8 matches at lines 48 (tone variant comment), 75 (`data-tone` attr), 191 (DialogFeedback section header), 211 (`DialogFeedbackState`), 213 (`DialogFeedbackProps`), 226 (function `DialogFeedback`), 233 (Props destructure), 287 (export). The literal `data-slot="dialog-feedback"` is the *default* slotName so the runtime `data-slot={slotName}` resolves to it; the test at `dialog.test.tsx:362` asserts `document.querySelector('[data-slot="dialog-feedback"]')` finds the rendered node when no override is passed. |
| 5 | `grep -rn 'DialogFeedback\|tone="destructive"' src/components` | PASS | 27 matches including: `dialog.tsx:191/211/213/226/287` (definition + exports), `dialog.test.tsx:6/291/358/360/377/393/408/423/435/440/448/453` (import + AC-01 destructive case + AC-03 DialogFeedback unit tests), `ConnectionDialog.tsx:23/24/77/574` (import + state projection + JSX usage), `ConnectionDialog.test.tsx:865` (sprint-92 update comment). |

## Acceptance Criteria — Line Citations

- **AC-01** `DialogContent.tone` 3-variant API + className.
  - `src/components/ui/dialog.tsx:54-58` defines `dialogToneClasses` mapping `default → border-border`, `destructive → border-destructive`, `warning → border-warning`.
  - `src/components/ui/dialog.tsx:64,68,75-79` adds the `tone?: DialogTone` prop with `default` default, sets `data-tone={tone}` for inspection, and merges `dialogToneClasses[tone]` into the className stack.
  - `src/components/ui/dialog.test.tsx:268-313` asserts all three variants — default tone keeps `border-border`, never gains `border-destructive` / `border-warning`; destructive tone gains `border-destructive` and `data-tone="destructive"`; warning tone gains `border-warning` and `data-tone="warning"`.

- **AC-02** `DialogHeader.layout` row/column.
  - `src/components/ui/dialog.tsx:103-108` defines `dialogHeaderLayoutClasses` mapping `row → flex flex-row items-center justify-between gap-2`, `column → flex flex-col gap-2 text-left`.
  - `src/components/ui/dialog.tsx:111-130` adds the `layout?: DialogHeaderLayout` prop with `row` default, sets `data-layout={layout}` and merges the layout classes. Sprint-91 row-based default behaviour is preserved (the legacy `min-w-0 text-left` modifiers are kept on the wrapper class chain).
  - `src/components/ui/dialog.test.tsx:317-355` asserts row default carries `flex-row` + `items-center` + `data-layout="row"` and lacks `flex-col`; column carries `flex-col` + `data-layout="column"` and lacks `flex-row`.
  - `src/components/ui/dialog.test.tsx:23-39` (sprint-91 AC-01) continues to pass — proof the row default did not regress.

- **AC-03** `DialogFeedback` 4-state + `data-slot="dialog-feedback"` + slot stability.
  - `src/components/ui/dialog.tsx:211-280` exports `DialogFeedbackState`, `DialogFeedbackProps`, and the `DialogFeedback` component. The outer `<div data-slot={slotName} data-state={state}>` is mounted on every state — only the inner branch toggles. Idle renders a min-h placeholder with `data-testid="dialog-feedback-idle"` and `aria-hidden`. Loading renders a `role=status` + `aria-live=polite` row with the spinner (`Loader2` + `animate-spin`) and `loadingText`. Success/error render a `role=alert` + `aria-live=polite` row with the `CheckCircle` / `AlertCircle` icon and the message; success uses `bg-success/10 text-success`, error uses `bg-destructive/10 text-destructive`.
  - `src/components/ui/dialog.test.tsx:358-456` covers all four states (idle empty slot, loading spinner+text, success/error message+icon+colour token), the `slotName="test-feedback"` override (sprint-92 compat), and the stable-identity contract via rerender across idle → loading → success → error (`document.querySelector('[data-slot="dialog-feedback"]')` returns the same DOM node throughout).

- **AC-04** ConnectionDialog uses `DialogFeedback` and sprint-92 `expectNodeStable` passes.
  - `src/components/connection/ConnectionDialog.tsx:574-580` renders `<DialogFeedback slotName="test-feedback" state={feedbackState} message={feedbackMessage} loadingText="Testing..." className="border-t border-border px-4 py-3" />`.
  - `src/components/connection/ConnectionDialog.tsx:74-82` projects the local `pending` state to the primitive's `loading` state and the success/error messages straight through.
  - `src/components/connection/ConnectionDialog.test.tsx:856-1038` (sprint-92 block) is unchanged in behaviour: `getSlot()` queries `[data-slot="test-feedback"]`; `expectNodeStable` proves the same DOM node persists across idle → pending → success, idle → pending → error, and 3 rapid Test clicks; "Testing..." text inside the slot during pending; success/error messages render; pending placeholder gone after success. Only the idle-state `data-testid` selector at `:865` was retargeted to `dialog-feedback-idle` (the primitive's stable id) — the assertion semantics ("idle slot is a placeholder") are preserved.

- **AC-05** ConfirmDialog destructive → tone="destructive".
  - `src/components/shared/ConfirmDialog.tsx:32-35` forwards `tone={danger ? "destructive" : "default"}` to `AlertDialogContent`.
  - `src/components/ui/alert-dialog.tsx:6-15,53-62` adds the symmetric tone surface on `AlertDialogContent` (re-using `DialogTone` from `dialog.tsx`) so the Radix AlertDialog content node receives `data-tone` + the destructive border token.
  - `src/components/ui/dialog.test.tsx:460-498` asserts `danger=true` produces `data-tone="destructive"` + `border-destructive` on the AlertDialog content; `danger=false` (default) produces `data-tone="default"` and lacks `border-destructive`. Both flows query the AlertDialog content via `[data-slot="alert-dialog-content"]`.

- **AC-06** sprint-91 9-dialog matrix close-count.
  - `src/components/ui/dialog.test.tsx:249-263` (close-button matrix) is unchanged. All 9 matrix entries (ConnectionDialog, GroupDialog, ImportExportDialog, BlobViewerDialog, CellDetailDialog, SqlPreviewDialog, MqlPreviewModal, AddDocumentModal, ConfirmDialog) continue to pass with `closes.length` ≤ `expectedMax` (max 1) and `< 2`. Test run output confirms: `Tests 1692 passed (1692)` includes the 9 matrix cases.

- **AC-07** Regression 0.
  - sprint-94 baseline: 93 test files / 1679 tests passing.
  - post-sprint-95: 93 test files / 1692 tests passing → +13 tests (3 tone + 2 layout + 6 DialogFeedback + 2 ConfirmDialog tone), zero regressions.
  - sprint-92 sprint-94 invariants checked specifically: ConnectionDialog sprint-92 block (sprint-92: test-feedback slot stability + 4-state model), all sprint-91 close-button matrix entries, all sprint-79 footer/width/aria-live tests — all pass.

## Migration Sites Table

| Site | Before | After | Sprint compatibility |
|------|--------|-------|----------------------|
| `ConnectionDialog.tsx` test-feedback slot | Hand-written `<div data-slot="test-feedback">` with inline 4-branch ternary (idle / pending / success / error), local Loader2/CheckCircle/AlertCircle imports | `<DialogFeedback slotName="test-feedback" state=… message=… loadingText="Testing..." />`. Local Loader2 retained for the Test button spinner; CheckCircle/AlertCircle imports removed. | sprint-92 `data-slot="test-feedback"` selector preserved via `slotName` prop (option **(b)** from the brief). `expectNodeStable` keeps passing because the primitive's outer wrapper is unconditionally mounted. |
| `ConfirmDialog.tsx` destructive frame | Button-only destructive signal (`variant={danger ? "destructive" : "default"}`); the dialog frame had no semantic tone | Adds `tone={danger ? "destructive" : "default"}` on `AlertDialogContent`. Button variant still flips destructive — both signals reinforce each other. | No prior tone API existed; the `data-tone` attribute is new and observable but does not affect button or layout behaviour. |

## Slot-Compatibility Decision

Chose **option (b) — `DialogFeedback` accepts `slotName?` to override `data-slot`**, defaulting to `"dialog-feedback"`. ConnectionDialog passes `slotName="test-feedback"` so the sprint-92 selector contract holds without changing sprint-92's expectation. Rejected option (a) (dual `data-slot` values via separate attributes) because HTML's `data-slot` is single-valued and dual-marking would require a second attribute (`data-test-id` etc.) that breaks the "one selector, one slot" mental model. The override prop is documented in `DialogFeedbackProps.slotName` JSDoc and explicitly tested in `dialog.test.tsx:422-432`.

## Test Inventory (new in sprint-95)

### `dialog.test.tsx` additions (13 tests)

1. **AC-01a** default tone keeps `border-border`, no destructive/warning leak.
2. **AC-01b** destructive tone → `data-tone="destructive"` + `border-destructive`.
3. **AC-01c** warning tone → `data-tone="warning"` + `border-warning`.
4. **AC-02a** row default → `flex-row` + `items-center`, no `flex-col`.
5. **AC-02b** column → `flex-col`, no `flex-row`.
6. **AC-03a** idle → empty placeholder, no role=alert, no role=status.
7. **AC-03b** loading → role=status, aria-live=polite, spinner, custom `loadingText`.
8. **AC-03c** success → role=alert, aria-live=polite, message, success colour tokens.
9. **AC-03d** error → role=alert, aria-live=polite, message, destructive colour tokens.
10. **AC-03e** `slotName="test-feedback"` overrides the data-slot value (sprint-92 compat).
11. **AC-03f** outer wrapper persists across idle → loading → success → error rerenders (stable identity).
12. **AC-05a** ConfirmDialog `danger=true` → `data-tone="destructive"` + `border-destructive`.
13. **AC-05b** ConfirmDialog default → `data-tone="default"`, no `border-destructive`.

## Assumptions

1. **Symmetric tone on AlertDialog.** The contract's "Write scope" listed `dialog.tsx` for tone work but AC-05 demands `ConfirmDialog` (which uses `AlertDialog`) carry `tone="destructive"`. Adding `tone` to `AlertDialogContent` is the minimal change that satisfies AC-05 without forcing ConfirmDialog onto a different primitive (which would risk regressing the sprint-91 close-button matrix entry — ConfirmDialog has 0 X buttons because AlertDialog primitives intentionally lack them). The tone enum is shared via `DialogTone` so the API stays single-sourced.
2. **`pending → loading` projection.** ConnectionDialog's local discriminated union calls the in-flight state `pending` (sprint-92 wording) but `DialogFeedback`'s contract calls it `loading`. The two-line projection in `ConnectionDialog.tsx:74-82` is intentional — renaming the local state would have rippled into sprint-92 comments and the existing test names.
3. **`loadingText` carries "Testing..." for ConnectionDialog.** The sprint-92 test asserts `screen.getByText("Testing...")` lives inside the slot during pending. Passing `loadingText="Testing..."` to `DialogFeedback` reproduces that exact wording.
4. **Default `loadingText="Loading..."`.** Other future call sites (sprint-96+ migrations) will probably want a generic default; "Loading..." is the conventional shadcn/Tailwind copy. ConnectionDialog overrides explicitly.
5. **`text-left` survives in column layout.** Sprint-91's row-default header had `text-left` baked in; preserved in the column layout class so callers don't lose horizontal alignment when opting in.
6. **`ConfirmDialog.test.tsx` does not exist.** The brief noted "if it exists" — confirmed it does not. Coverage moves into `dialog.test.tsx` next to the rest of the primitive surface so the destructive-tone signal is asserted in the same file as the tone API definition.

## Residual Risk

- **Other dialogs not yet migrated.** The brief explicitly listed `GroupDialog`, `ImportExportDialog`, `BlobViewerDialog`, `CellDetailDialog`, `SqlPreviewDialog`, `MqlPreviewModal`, `AddDocumentModal` as out of scope. None of them currently use a feedback slot or destructive frame, so no behavioural regression risk; the Layer-2 composite work in sprint-96+ will sweep through them and is the intended owner of any further migrations.
- **Latent**: A future sprint might want a `pending` alias on `DialogFeedbackState` to ease ConnectionDialog's projection. Not required today; documented here so the next agent doesn't redesign the enum.
- **Latent**: `border-warning` is wired through `--color-warning: var(--tv-status-connecting)` (`src/index.css:27`). If that token is ever retired, the warning tone would silently fall back to the browser default. No active risk; tracking only.
