# Sprint 344 / Slice B — Findings (`+ key` inline pair input on object nodes)

## Sprint 344 / Slice B Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Design Quality (30%)** | 8/10 | Affordance uses `border-dashed border-muted-foreground/40` with `hover:border-primary hover:text-primary` — matches contract's "dashed muted color" spec, with a proper hover-to-primary transition that reads as interactive. Open-state inputs share a `border-primary` outline (contract's "primary-color outline"). Validation message uses `text-red-500` at `text-3xs` — consistent with the existing `● edited` / `will delete` 12px markers in the same file. Indent calc `(parentDepth + 1) * 16` exactly mirrors the existing tree-node `node.depth * 16` paddingLeft, so the input pair lands flush with where the next child would render. Two minor polish gaps holding it back from 9: (a) `text-3xs` for the error message is smaller than the contract's "12px, red-500" wording (3xs ≈ 10px in this token set), (b) no focus-ring CSS on the inputs beyond browser default — the contract says "existing primary color outline" which is met by the static border but a `focus:ring-1 focus:ring-primary` would tighten the focus visual to match leaf-edit's PlainLeafInput. |
| **Completeness (25%)** | 9/10 | All 11 ACs (`AC-344-B-01` through `AC-344-B-11`) are addressed with at least one named test each. AC-07 is split into `07a` (value collision) and `07b` (pendingByPath ghost collision) — both pass. AC-11 split into `11a` (bare numeric → number) and `11b` (quoted numeric → string) — verifies Slice D's outer-quotes coercion through the panel boundary. Four additional edge tests beyond the contract: whitespace-only key, Enter-from-value-input, unicode key (`한국어`), and error-clearing-on-retype. The pre-existing 16 V1/V2 tests all continue to pass (no leaf-edit / delete / BSON / regex regression). Test comment convention `2026-05-15` present on every new case. Loses 1 point because the contract's edge list mentions "key가 `__proto__` (보안)" and Generator did not add a guard or a test for that prototype-pollution probe — the current code would happily commit `__proto__` as a path. Not in any AC numerically, but listed in `Test Requirements > Edge` of the contract. |
| **Functionality (25%)** | 9/10 | Targeted suite `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx` → 33/33 pass (16 pre-existing + 17 new). `pnpm tsc --noEmit` clean. `pnpm lint` clean. Full suite `pnpm vitest run` → 3896 pass / 10 skipped / 2 failed; the 2 failures are in `src/lib/editor/autocompleteTheme.test.ts` — verified out-of-scope (see Out-of-Scope Failure Analysis below). `coerceTreeAddValue` integration verified at the runtime type boundary (AC-11a asserts `typeof commit.mock.calls[0][1] === "number"`). State machine is correct: `startAddKey` resets drafts + error; `commitAddKey` validates → coerces → calls `onCommitEdit` → calls `cancelAddKey`; `cancelAddKey` clears everything. Only one input pair can be open at once across the entire tree (architecturally enforced by single `addingPath` state). No phantom commits — empty key reject path does NOT call `onCommitEdit`. Loses 1 point on the prop signature widening cast at line 250 (`coerced as string \| Record<string, unknown>`) which is a known Slice F deferral but is a code-smell at this layer; the in-line comment documents why. |
| **Accessibility & Responsiveness (20%)** | 9/10 | All four contract a11y items present: `role="button"` (line 750), `aria-label="Add key to {parent}"` (line 739, with "root" substitution when parentPath is empty), `aria-invalid="true"` toggled on the key input when `addError !== null` (line 809), `aria-live="polite"` on the validation message span (line 828). Keyboard-only flow is fully wired: `+ key` is reachable by Tab (`<button>` element), Enter on key OR value commits (verified by AC-04 and the edge test "Enter from value input also commits"), Esc cancels from either input, Tab key→value uses `keyInputRef.current?.focus()` jsdom fallback so the test deterministically passes (a11y comment at line 770 documents WHY — browser default would handle it but jsdom is flaky). Shift+Tab value→key is symmetric. Autofocus on the key input is handled in a `useEffect` keyed on `addingPath` (line 198), not via the `autoFocus` HTML attribute, which is the more accessible pattern (announces on entry to add-mode rather than on every render). Loses 1 point because the value input does not get `aria-invalid` — only the key input does. If the rejection cause were ever to be "value coerce error" (out of scope for Slice B but possible in future), the value field would silently lack the visual cue. Minor. |
| **Overall** | **8.75/10** | All four dimensions ≥ 7. PASS. |

## Verdict: PASS

All four UI-rubric dimensions are ≥ 7. Required checks for the contract's verification plan are green (targeted vitest 33/33, full vitest passes minus the documented out-of-scope autocomplete theme regression, tsc clean, lint clean). The 2 file failures in the full suite are conclusively traced to a user-owned parallel work item (`autocompleteTheme.ts` token rename) and not to Slice B's two-file scope.

## Sprint Contract Status (Done Criteria)

- [x] **AC-344-B-01** — Object node `+ key` affordance renders only when `onCommitEdit` provided. Root + nested both covered.
  - `DocumentTreePanel.test.tsx:379` — `"AC-344-B-01: renders \`+ key\` affordance on object nodes only when onCommitEdit is provided"`. Asserts `tree-add-key-__root` AND `tree-add-key-nested` present when `onCommitEdit` is provided, then re-renders without the prop and asserts both `queryByTestId` are NOT in the document.

- [x] **AC-344-B-02** — Clicking `+ key` reveals two inputs; key input auto-focused; both placeholders present.
  - `DocumentTreePanel.test.tsx:406` — Asserts `keyInput` and `valueInput` rendered, `keyInput.toHaveFocus()`, `keyInput.placeholder` matches `/key/i`, `valueInput.placeholder` matches `/value/i`. Implementation: `useEffect(() => { if (addingPath !== null) keyInputRef.current?.focus(); }, [addingPath])` at line 198.

- [x] **AC-344-B-03** — Tab key→value, Shift+Tab value→key.
  - `DocumentTreePanel.test.tsx:428` — `await user.tab()` then `expect(valueInput).toHaveFocus()`, then `await user.tab({ shift: true })` then `expect(keyInput).toHaveFocus()`. Implementation: `onKeyKeyDown` line 771 `e.preventDefault(); valueInputRef.current?.focus()` on Tab; `onValueKeyDown` line 788 symmetric on Shift+Tab. The explicit `ref.focus()` fallback is documented at line 772 as jsdom workaround.

- [x] **AC-344-B-04** — Enter commits exactly once; path = parent + key; value = Slice D coerced.
  - `DocumentTreePanel.test.tsx:450` — `"AC-344-B-04"`. Types `age` + `42`, Enter, asserts `expect(commit).toHaveBeenCalledTimes(1)` AND `expect(commit).toHaveBeenCalledWith("age", 42)` (number, not string — verifies Slice D wire).
  - Edge: `DocumentTreePanel.test.tsx:700` — `"AC-344-B-04 edge: Enter from value input also commits"`.

- [x] **AC-344-B-05** — Esc closes inputs without committing; `+ key` re-renders.
  - `DocumentTreePanel.test.tsx:472` — Asserts `commit not.toHaveBeenCalled()`, key input gone, `+ key` affordance back.

- [x] **AC-344-B-06** — Empty key + Enter → no commit, `aria-invalid` + "key required" message.
  - `DocumentTreePanel.test.tsx:499` — Asserts `commit not.toHaveBeenCalled()`, `keyInput.toHaveAttribute("aria-invalid", "true")`, `screen.getByText(/key required/i)`.
  - Edge: `DocumentTreePanel.test.tsx:678` — `"AC-344-B-06 edge: whitespace-only key is treated as empty and rejected"`. Locks the `trimmedKey === ""` check after `.trim()`.
  - Edge: `DocumentTreePanel.test.tsx:746` — `"AC-344-B-06 edge: re-typing after empty-key reject clears the error"`. Locks the `onKeyDraftChange` handler that calls `setAddError(null)` when there was a previous error.

- [x] **AC-344-B-07** — Duplicate key blocks commit, against `value` OR `pendingByPath`.
  - `DocumentTreePanel.test.tsx:522` — `"AC-344-B-07a: duplicate key against existing value blocks commit"`. Types `name` (collides with `value.name = "Felix"`). Asserts `aria-invalid` + `/key already exists/i` message.
  - `DocumentTreePanel.test.tsx:546` — `"AC-344-B-07b: duplicate key against pendingByPath ghost blocks commit"`. Uses `pendingByPath = Map([["tag", "alpha"]])`; types `tag`. Asserts the same rejection path fires. Implementation: line 224 iterates `pendingByPath.keys()` and matches against `candidatePath`.

- [x] **AC-344-B-08** — Empty value + non-empty key commits with empty string.
  - `DocumentTreePanel.test.tsx:569` — Types `note` only, Enter. Asserts `commit` called with `("note", "")`. Slice D `coerceTreeAddValue("")` returns `""` per AC-344-D-09.

- [x] **AC-344-B-09** — After commit, inputs disappear, `+ key` affordance re-renders.
  - `DocumentTreePanel.test.tsx:590` — Types k/v, Enter, asserts input pair gone AND `+ key` affordance back. Implementation: `commitAddKey` line 253 calls `cancelAddKey()` after a successful commit, which resets `addingPath` to `null`.

- [x] **AC-344-B-10** — Nested object `+ key` joins the parent path.
  - `DocumentTreePanel.test.tsx:612` — Uses `value = { nested: { existing: 1 } }`, types `fresh` + `true`, Enter. Asserts `commit("nested.fresh", true)` — boolean coercion + dotted path joining. Implementation: `joinObjectPath("nested", "fresh")` line 70.

- [x] **AC-344-B-11** — Coerce outer-quotes rule.
  - `DocumentTreePanel.test.tsx:635` — `"AC-344-B-11a: bare numeric value commits as number (coerce)"`. Asserts both `commit("n", 42)` AND `typeof commit.mock.calls[0][1] === "number"`.
  - `DocumentTreePanel.test.tsx:653` — `"AC-344-B-11b: quoted numeric value commits as string (coerce)"`. Asserts `commit("s", "42")` AND `typeof commit.mock.calls[0][1] === "string"`. Both lock the Slice D wire at the panel boundary.

## Required Checks (from contract Verification Plan)

| Check | Status | Evidence |
|-------|--------|----------|
| `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx` | PASS | 1 file, 33/33 tests, 1.84s |
| `pnpm vitest run` (full) | PARTIAL | 320/321 files pass; 3896 pass / 10 skipped / 2 failed. **The 2 failures are out-of-scope** — see analysis below. |
| `pnpm tsc --noEmit` | PASS | clean (no output) |
| `pnpm lint` | PASS | clean (no output) |

## Out-of-Scope Failure Analysis (the 2 autocompleteTheme.test.ts failures)

`git diff HEAD -- src/lib/editor/autocompleteTheme.ts` shows a substantial rewrite that:
1. Renames every CSS token from `var(--popover)` / `var(--primary)` / `var(--border)` etc. to `var(--tv-popover)` / `var(--tv-primary)` / `var(--tv-border)`. The comment at the top of the new file states "이전 버전은 `var(--popover)` / `var(--primary)` 같은 raw CSS variable 을 참조했는데, 이 프로젝트의 design token 은 `--tv-primary` (themes.css) 와 `--color-primary` (index.css 의 Tailwind `@theme inline`) 으로만 정의된다."
2. Adds a UX-improvement package (hint bar, accent bar, completion icon coloring, info panel theming).

The test `src/lib/editor/autocompleteTheme.test.ts:40` still asserts `expect(styleText).toMatch(/var\(--primary\)/)` — i.e. it was written against the OLD token name and was not updated by the author of the rename.

Slice B's two-file scope (`DocumentTreePanel.tsx`, `DocumentTreePanel.test.tsx`) does NOT touch `autocompleteTheme.ts` or its test. The Generator's claim that this is the user's parallel uncommitted work is verified by `git status` (file appears as "modified" in working tree, alongside `mongoAutocomplete.ts` from the same parallel area — both untouched by Slice B).

**Verdict on the 2 failures**: Not a Slice B regression. They belong to the same orphaned working-tree change recorded in Slice A findings (off-scope file family).

## Invariant Audit

- **`DocumentTreePanel` paradigm-agnostic** — `git diff HEAD -- src/components/document/DocumentTreePanel.tsx` shows Slice B added these top-level imports: `Fragment, useMemo, useState, useCallback, useRef, useEffect` (React), `ChevronRight, ChevronDown, X, Search, Trash2, Plus` (lucide-react), `coerceTreeAddValue` (already from `@/lib/jsonTree`). The single pre-existing `@/lib/mongo/bsonTypes` import is the Sprint 342 BSON inline editor — paradigm-agnostic at the function-helper level (BSON wrappers are a serialization format, not a paradigm). No new Mongo / RDB / SQL imports introduced.
- **`safeStringifyCell` rule** — `git diff HEAD -- src/components/document/DocumentTreePanel.tsx | grep "JSON\.(stringify|parse)"` returns empty. No new raw `JSON.stringify` or `JSON.parse` calls in Slice B. `coerceTreeAddValue` (Slice D) owns the parse inside the helper; the panel just receives the typed result.
- **Test comment convention** — Every new test case in `DocumentTreePanel.test.tsx` lines 379-764 carries a single-line `// AC-344-B-XX (2026-05-15) — …` or `// Edge (2026-05-15) — …` reason block. Pre-existing tests untouched.
- **Single open input pair invariant** — `addingPath: string | null` is a single state slot, so clicking `+ key` on object A while the input pair is open on object B replaces (not stacks) the active editor. Verified by reading `startAddKey` line 183 which unconditionally sets `addingPath` to the new parent and resets the drafts.

## Edge-Case Probes (executed at evaluation time)

1. **`+ key` state preservation across two objects** — User clicks `+ key` on obj A, types `foo` in key, then clicks `+ key` on obj B. By reading the code: `startAddKey(parentB)` sets `addingPath = parentB`, resets `keyDraft = ""`, `valueDraft = ""`, `addError = null`. The previously open input pair on obj A re-renders as the closed `+ key` button because `isOpen = addingPath === aff.path` only matches once. State is **replaced**, drafts lost — by design (single editor invariant). Reasonable for this sprint; if users want resume-across-objects, that's a follow-up.

2. **`__proto__` as a key** — Probed by reading `commitAddKey`: there is no special-case guard. `joinObjectPath("", "__proto__")` returns `"__proto__"`, which becomes the pendingEdit key. The current `pendingByPath` is a `Map<string, ...>` (not a plain object), so prototype pollution is structurally impossible at this layer. However, downstream `mqlGenerator` / `sqlGenerator` consumers may build object literals from these paths — that's a Slice E/F concern. **Flagging as a future-sprint finding**, NOT a Slice B blocker.

3. **Duplicate against pendingByPath ghost (AC-07b)** — Probed via the actual test. The `existingChildPaths` Set at line 215 walks `nodes` (which includes ghost nodes from Slice A's `buildTreeNodesWithGhosts`) AND iterates `pendingByPath.keys()` explicitly. So even if a ghost path is filtered out of `nodes` for some reason, the direct `pendingByPath` check catches it. Defense in depth.

4. **Tab focus under jsdom** — AC-344-B-03 test passes. The implementation calls `valueInputRef.current?.focus()` explicitly inside the Tab keydown handler (line 778) AFTER `e.preventDefault()` — this is the deterministic jsdom path. In a real browser the `e.preventDefault()` would suppress the browser's default Tab traversal and the `ref.focus()` would still land it on the value input — same observed behavior across environments.

5. **Indent alignment** — Affordance and input pair render at `paddingLeft = (parentDepth + 1) * 16` (line 737), matching the existing leaf-row formula `node.depth * 16` (line 504) where leaves of a depth-N parent have `depth = N+1`. Verified via the `objAffordanceAfter` map's path tracking (line 269): the parent obj's children render between idx `i+1` and `endIdx`, so the affordance inserts right after `endIdx`, flush with the last child's indent.

6. **Collapsed parent hides the affordance** — Reading line 446: the `trailing` filter calls `isHidden(aff.path)` AND additionally walks the `collapsed` set to check whether any ancestor of the affordance's parent path is collapsed. If yes, the affordance is filtered out. This matches the leaf-row collapse-hides-subtree behavior. Pre-existing collapse test still green.

## Feedback for Generator

1. **[A11y polish — LOW]**: The value input does not toggle `aria-invalid` when there is a rejection. Currently only the key input gets `aria-invalid="true"`.
   - Current: `aria-invalid={addError !== null ? "true" : undefined}` on the key input only (line 809).
   - Expected: Since the rejection state belongs to the input pair as a unit, both inputs (or at least the focused one at the time of Enter) could mark invalid for parity with leaf-edit's PlainLeafInput.
   - Suggestion: Optional — add `aria-invalid={addError !== null ? "true" : undefined}` on the value input as well, OR scope it to only the input that triggered the validation. Low priority; current behavior is contract-compliant.

2. **[Design — LOW]**: The contract calls for a "12px, red-500" validation message; the implementation uses `text-3xs` (≈10px in this token set).
   - Current: `className="text-3xs text-red-500"` at line 830.
   - Expected: contract spec line 79 says "Validation message: 12px, red-500".
   - Suggestion: Either bump to `text-xs` (12px in Tailwind default) or document why 3xs is preferred at the panel scale. Cosmetic — does not block.

3. **[Test coverage — LOW]**: Contract `Test Requirements > Edge` lists "key가 `__proto__` (보안)" as an edge to cover. No test exists for this in Slice B.
   - Current: no `__proto__` / `constructor` test case.
   - Expected: a test that types `__proto__` as the key and either (a) commits it verbatim (since `Map` is structurally safe) or (b) rejects with a "reserved key" message.
   - Suggestion: Add a Slice B follow-up test that pins the chosen behavior. If "commits verbatim" is the intent, lock it; if "reject" is intended, add a check at line 207 and a test. Recommend deferring the actual prototype-pollution defense to Slice E/F where the generator emits object literals.

4. **[Type safety — LOW]**: The cast `coerced as string | Record<string, unknown>` at line 250 is documented but still loses type information at runtime for `number` / `boolean` / `null` / `array` cases.
   - Current: cast comment at lines 240-245 acknowledges this and defers widening to Slice F.
   - Expected: Slice F widens `onCommitEdit`'s prop signature to accept the full Slice D union (`unknown` or an explicit JSON type union).
   - Suggestion: When Slice F lands, remove this cast. Until then, the cast is a known scope-deferral; the tests already verify the runtime type is preserved (AC-11a `typeof === "number"`), so the cast is purely a TS-layer concession.

## Handoff Evidence (for `handoff.md`)

- **Score**: 8.75 / 10
- **Verdict**: PASS
- **Files merged in scope**: 2 (`src/components/document/DocumentTreePanel.tsx`, `src/components/document/DocumentTreePanel.test.tsx`)
- **Files untouched by Slice B** (user's parallel work, NOT a regression source): `src/lib/editor/autocompleteTheme.ts`, `src/lib/mongo/mongoAutocomplete.ts` — both modified in working tree by user; their test mismatch causes the 2 full-suite failures.
- **Required-check status**: targeted vitest 33/33, tsc clean, lint clean. Full vitest 3896 pass / 10 skipped / 2 fail (out-of-scope).
- **Open P1/P2 findings**: 0.
- **Slice B exit criteria**: met. Ready for Slice C kickoff (`+ item` for arrays).
