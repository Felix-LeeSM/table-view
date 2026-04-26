# Sprint 134 Evaluation

## Independent Verification

### `pnpm vitest run`
```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table

 Test Files  126 passed (126)
      Tests  2047 passed (2047)
   Start at  01:18:10
   Duration  23.96s (transform 5.30s, setup 7.86s, import 37.96s, tests 66.97s, environment 81.71s)
```
PASS — matches Generator's claim of 2047 tests across 126 files.

### `pnpm tsc --noEmit`
```
(no output)
```
PASS — exit code 0, 0 type errors.

### `pnpm lint`
```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .
```
PASS — exit code 0, no ESLint errors emitted.

### `pnpm contrast:check`
```
> table-view@0.1.0 contrast:check /Users/felix/Desktop/study/view-table
> tsx scripts/check-theme-contrast.ts

WCAG AA contrast: 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)
```
PASS — 0 new contrast violations.

### `cargo test --manifest-path src-tauri/Cargo.toml --lib`
```
test storage::tests::test_save_connection_with_none_preserves_existing ... ok
test storage::tests::test_save_group_adds_and_updates ... ok
test storage::tests::test_save_multiple_connections ... ok

test result: ok. 268 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.08s
```
PASS — 268 tests passed, 2 ignored, 0 failures (matches Generator's claim).

### `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
```
    Blocking waiting for file lock on package cache
    Blocking waiting for file lock on package cache
    Blocking waiting for file lock on package cache
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.87s
```
PASS — exit code 0, 0 warnings (the "Blocking" lines are because clippy ran in parallel with cargo test; cache contention is expected and not a failure).

### `pnpm exec eslint e2e/**/*.ts`
```
(no output)
```
PASS — exit code 0, 0 lint errors in e2e specs.

### Grep checks

`grep -rn "ConnectionSwitcher" src/` (10 hits, all comments / test labels):
- `src/pages/HomePage.tsx:93` — comment in `handleActivate`.
- `src/pages/HomePage.test.tsx:240` — test rationale comment.
- `src/App.test.tsx:431` — test rationale comment.
- `src/App.tsx:170` — comment marker for the deprecated chord.
- `src/components/shared/__tests__/ShortcutCheatsheet.test.tsx:140` — test rationale comment.
- `src/components/workspace/WorkspaceToolbar.tsx:12` — docstring.
- `src/components/shared/ShortcutCheatsheet.tsx:71` — comment.
- `src/stores/tabStore.ts:640` — docstring on `lastActiveTabIdByConnection`.
- `src/components/workspace/WorkspaceToolbar.test.tsx:110, 113` — regression-guard test that asserts the legacy combobox is gone.

No production import / mount / dispatch of `ConnectionSwitcher` remains. Files
`src/components/workspace/ConnectionSwitcher.tsx` and `.test.tsx` are deleted
on disk (verified via `git status`).

`grep -rn "open-connection-switcher" src/` (10 hits):
- `src/App.tsx:169` — comment-only deprecation marker.
- `src/App.test.tsx:430,435,438,444,447,450,456,462,481` — the three regression
  guard tests asserting the event is NEVER dispatched.

No `dispatchEvent("open-connection-switcher", …)` call remains in production.

`grep -rn "ConnectionSwitcher" e2e/` (3 hits): comments only in
`e2e/db-switcher.spec.ts` (stale scaffold comment from S133, body is
`this.skip()`) and in `e2e/keyboard-shortcuts.spec.ts` (deprecation marker).

`grep -rn "open-connection-switcher" e2e/` → 0 matches.

## AC Verdict

| AC | Verdict | Evidence |
|----|---------|----------|
| AC-S134-01 | PASS | `git status` shows `src/components/workspace/ConnectionSwitcher.tsx` + `ConnectionSwitcher.test.tsx` deleted. `WorkspaceToolbar.tsx` no longer imports `ConnectionSwitcher` (only `DbSwitcher`, `SchemaSwitcher`, `DisconnectButton`). `pnpm tsc --noEmit` is clean. `WorkspaceToolbar.test.tsx:113` regression guard `does NOT render the legacy ConnectionSwitcher combobox` passes. |
| AC-S134-02 | PASS | `App.tsx` lines 168–172 are now a comment-only deprecation marker; the Cmd+K useEffect is gone. `App.test.tsx:435/447/459` flipped to `expect(handler).not.toHaveBeenCalled()` for both home + workspace + editable-target focus cases. All 3 tests pass under gate #1. |
| AC-S134-03 | PASS | `ShortcutCheatsheet.tsx` lines 64–73: `Navigation` items list no longer contains `Open connection switcher` (only Quick open / Refresh / Cancel running query). `ShortcutCheatsheet.test.tsx:142` regression guard asserts both the label AND the bare `Cmd+K` key text are gone. |
| AC-S134-04 | PARTIAL PASS — see P2 finding | Two new tests in `HomePage.test.tsx:245` and `:274`. The boundary test (idempotent self-activation) is correct. The "swap from connectionA to connectionB" test name is misleading — the mocked `ConnectionList` only emits `onActivate("c1")` (not `c2`), so the test verifies that activating the already-focused c1 keeps `focusedConnId === "c1"` and flips `screen` → `workspace`. The actual cross-connection swap is exercised indirectly by the existing `onActivate from ConnectionList swaps to workspace screen` test plus the unconditional `setFocusedConn` + `setScreen` body in `HomePage.tsx:94–97`. The behaviour is correct (the production code calls `setFocusedConn(id)` unconditionally, regardless of prior focus), but the dedicated swap-A-to-B test does not actually exercise A→B. Adapter justification (`setFocusedConn` instead of `setActiveConnection`) is correct: the actual store API at `src/stores/connectionStore.ts:37` is `setFocusedConn`. |
| AC-S134-05 | PASS | `DisconnectButton.tsx` created with `aria-label="Disconnect"` (default), focused-conn name in the `title` tooltip, busy-state aria-label flip to "Disconnecting…", spinner via `Loader2`, ghost variant + icon-xs sizing matching siblings, `disabled` when `!focusedConnId || !isConnected || busy`, dark-mode-aware classes (`text-muted-foreground hover:text-destructive disabled:opacity-40`). 9 tests in `DisconnectButton.test.tsx` cover aria-label, all 4 disabled-state branches, click → store call, failure → toast + re-enable, busy aria-label flip, tooltip text. Mounted in `WorkspaceToolbar.tsx:34` at `ml-auto` trailing edge. |
| AC-S134-06 | PASS | Production code at `TabBar.tsx:236` is `{dirtyTabIds.has(tab.id) && (…)}` — independent of `activeTabId`. Two new tests in `TabBar.test.tsx:548` and `:582` directly assert (a) dirty inactive tab carries marker, clean active tab does not (b) three-tab scenario where active+clean tab is unmarked while inactive sibling is marked. Both tests cross-check `aria-selected` to confirm the elements being queried are correct. |
| AC-S134-07 | PASS | All 2047 vitest tests green (gate #1). e2e static `pnpm exec eslint e2e/**/*.ts` clean (gate #7). The Cmd+, scenario in `e2e/keyboard-shortcuts.spec.ts:104` is preserved; only the Cmd+K scenario was removed. Cmd+1..9, Cmd+W, Cmd+T, Cmd+S existing App.test.tsx assertions untouched. |
| AC-S134-08 | PASS | All 6 mandated gates green: vitest (2047/2047), tsc (clean), lint (clean), contrast (0 new violations), cargo test (268 passed), cargo clippy (0 warnings). The 7th brief gate (e2e static) also clean. |

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | Deletions and modifications satisfy all ACs. The Home swap "bug" was correctly diagnosed as the `<ConnectionSwitcher>`'s `onValueChange` not threading focus rather than a real bug in `HomePage.handleActivate`; `handleActivate` was already correct, and removing the switcher is the actual fix. The dirty-marker bug's "fix" is a regression guard since the production code was already correct — flagged in handoff. DisconnectButton behaviour is sound. -1 because the "swap from A to B" test does not actually swap to B. |
| Test quality | 7/10 | DisconnectButton (9 tests), TabBar dirty-marker (2 tests), App.test Cmd+K trio, ShortcutCheatsheet guard, WorkspaceToolbar ConnectionSwitcher-gone guard — all assert real behavior, no tautologies. The two AC-S134-06 tests cross-check `aria-selected` to avoid layout-coincidence false positives. -3 because the "double-click swap from connectionA to connectionB" test name promises an A→B transition that the body does not exercise (only `c1` button is wired in the mocked ConnectionList; the test starts focused on c1 and ends focused on c1). It is essentially a copy of the boundary case with a more exciting name. |
| Regression safety | 9/10 | Cmd+, / Cmd+1..9 / Cmd+W / Cmd+T / Cmd+S / DbSwitcher / SchemaSwitcher / Connection list / `lastActiveTabIdByConnection` tracker preserved. `connectionStore` signatures untouched. e2e Cmd+, scenario preserved. -1 because the stale `<ConnectionSwitcher>` comment in `e2e/db-switcher.spec.ts:9` is now inaccurate (the spec body is `this.skip()` so it is harmless functionally, but the docstring should have been updated for hygiene). |
| Code quality | 9/10 | DisconnectButton: PascalCase file, single component per file, props as exported `interface`, no `any`, dark mode classes, semantic icon-xs variant matching siblings, busy-state aria-label flip, descriptive tooltip, error path with toast. `setFocusedConn` adaptation over the contract's `setActiveConnection` is correct (verified against `connectionStore.ts`). `WorkspaceToolbar.tsx` adaptation (trailing edge of toolbar instead of MainArea — because MainArea has no visible refresh) is justified in the handoff. -1 for the comment update in `tabStore.ts` (line 640) — keeping the `lastActiveTabIdByConnection` tracker because "future swap surfaces" might use it is borderline gold-plating; if it is truly unused after S134, removing it would be cleaner, but keeping it is defensible per the handoff note. |
| Evidence completeness | 9/10 | Handoff has a clear table of changed files with one-line purposes, AC-by-AC evidence with test names, grep audit with breakdown of remaining hits (with caveat that they are all comments / regression guards), and explicit `Assumptions / Risks` section calling out the 4 contract adaptations (store API, mount location, no production change to handleActivate, e2e removal vs no-op). The future maintainer can trace each AC to a specific test file and line via the handoff. -1 because the AC-S134-04 evidence section claims "swap from connectionA to connectionB" verifies the swap but does not flag that the test mock only exposes a c1 activator. |
| **Overall** | 8.6/10 | Strong pass. All 7 gates green, all 8 ACs functionally satisfied, with one test-quality nit on AC-S134-04 that is cosmetic rather than load-bearing because the production path is independently correct. |

## Findings

### P1 (블로커)
- _None._ All 8 ACs functionally pass; all 7 verification gates green.

### P2 (개선 권장)
- **AC-S134-04 swap-A-to-B test does not actually swap A→B.** `src/pages/HomePage.test.tsx:245` is named `double-click swap from connectionA to connectionB updates focusedConnId AND screen`, but the mocked `ConnectionList` only exposes `list-activate-c1`. The test sets `focusedConnId: "c1"`, fires `onActivate("c1")`, and asserts `focusedConnId === "c1"` afterwards — which is the same logic as the boundary test below it, just with a misleading title. **Suggestion**: extend the mocked ConnectionList in `HomePage.test.tsx` to also expose a `list-activate-c2` button, then have the test fire `onActivate("c2")` while focus is on c1 and assert (a) `focusedConnId` flips to `"c2"`, (b) `screen` flips to `"workspace"`. This is the actual scenario the lesson reported as broken pre-S134, and the production code at `HomePage.tsx:94–97` calls `setFocusedConn(id)` unconditionally so it would pass. Without this change, the production path is verified only indirectly by the existing `onActivate from ConnectionList swaps to workspace screen` test (which starts with `focusedConnId: null`, also not exercising A→B).

### P3 (info)
- **Stale `<ConnectionSwitcher>` comment in `e2e/db-switcher.spec.ts:9`.** The doc-comment block describes the long-form scenario as "Press Cmd+K to open the `<ConnectionSwitcher>` popover. Pick a connected PG connection. …" — this is now obsolete (the spec body is `this.skip()`, so the obsolescence is documentary only, but a future maintainer might be confused). **Suggestion**: a one-line edit to replace the reference with "Open the workspace from Home → double-click" would close the loop. Not blocking — the file lints clean and runtime-skips.
- **`tabStore.ts` `lastActiveTabIdByConnection` tracker retained.** The Generator kept the per-connection last-active-tab Map even though its sole consumer (`<ConnectionSwitcher>`) was removed. The handoff justifies this as "future swap surfaces (Quick Open scoped jumps, etc.) … removing it now would force a re-introduction." This is defensible YAGNI-wise but represents code retained without an active consumer. If S135–S140 do not pick it back up, a future cleanup sprint should consider its removal.
- **DisconnectButton location is at WorkspaceToolbar trailing edge, not MainArea.** The contract said "refresh adjacent in MainArea". The handoff documents the adaptation (MainArea has no visible refresh button — refresh is keyboard-only Cmd+R / F5). Acceptable per the evaluator brief's allowance, but the user-visible outcome ("a Disconnect control near the workspace toolbar") is delivered.

## Feedback for Generator (only if FAIL)

_N/A — verdict is PASS. The P2 finding is a recommended polish, not a re-do
trigger. The next sprint can fold it in opportunistically when touching
HomePage.test.tsx, or leave it as-is._

## Verdict: PASS
