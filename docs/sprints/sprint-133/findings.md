# Sprint 133 — Evaluator Findings

## Verdict: PASS

All 12 ACs pass with code-level evidence. All 7 verification commands re-run green. Out-of-scope: clean (no backend, WDIO config, or unrelated rebinds touched).

## Per-AC Verdict

| AC | Status | Evidence |
|----|--------|----------|
| AC-01 — Cmd+, repurpose | **PASS** | `src/App.tsx:117-124` — branch calls `setScreen(current === "workspace" ? "home" : "workspace")`. `isEditableTarget` guard at line 119; Shift/Alt guard at line 118; `preventDefault` at line 120. The previous `open-settings` `dispatchEvent` is fully removed — `grep open-settings src/` returns only comments and one regression-test that asserts the event is NOT dispatched (`src/App.test.tsx:238-248`). |
| AC-02 — Cmd+1..9 effect | **PASS** | `src/App.tsx:148-166`. Modifier check (line 150), Shift/Alt reject (151), digit string range `"1"-"9"` (153), `isEditableTarget` (154), `screen !== "workspace"` no-op (155-156), `tabs[index]` existence check (158-160), `preventDefault` only on the matched-tab path (161). Note: store API is `setActiveTab` (not the contract's typo `setActiveTabId`); `src/stores/tabStore.ts:183,338` confirms. |
| AC-03 — Cmd+K effect | **PASS** | `src/App.tsx:171-184`. Modifier check (173), Shift/Alt reject (174), key match `"k"\|"K"` (175), `isEditableTarget` (176), `screen !== "workspace"` no-op (177-178), `preventDefault` (179), `dispatchEvent(new CustomEvent("open-connection-switcher"))` (180). Event name matches contract exactly. |
| AC-04 — ConnectionSwitcher listener | **PASS** | `src/components/workspace/ConnectionSwitcher.tsx:74` — controlled `useState(false)`. `:82-87` — `useEffect` adds `window.addEventListener("open-connection-switcher", handler)` with cleanup `removeEventListener` in the cleanup return. `:130-131` — `<Select open={open} onOpenChange={setOpen}>`. **External props signature unchanged** — component still accepts no props (line 62 `export default function ConnectionSwitcher()`). |
| AC-05 — SHORTCUT_GROUPS | **PASS** | `src/components/shared/ShortcutCheatsheet.tsx:45-91`. Tabs group line 53 adds `"Switch to tab 1–9"` with U+2013 en-dash (verified via hexdump: `e2 80 93`). Navigation group line 71 adds `"Open connection switcher"` with `["Cmd+K"]`. Panels group line 79 fully replaces `"Settings"` → `"Toggle Home/Workspace"` (no co-existing "Settings" entry). Group order Tabs → Editing → Navigation → Panels → Misc preserved. |
| AC-06 — App.test.tsx Cmd+, scenarios | **PASS** | `src/App.test.tsx:200-248` replaces the legacy `:193-201` block with four real-behavior assertions: workspace→home toggle (200-206), home→workspace toggle (208-214), editable-target no-op (216-236, asserts screen unchanged), legacy `open-settings` no-event (238-248). Not tautological — they read `useAppShellStore.getState().screen` and a real `addEventListener` mock. |
| AC-07 — App.test.tsx new scenarios | **PASS** | Cmd+1 first-tab activation `:358-368`; Cmd+2 second-tab `:370-379`; Cmd+5 with 3 tabs no-op `:381-391`; Cmd+1 in home no-op `:393-402`; Cmd+1 in editable no-op `:404-427`; Cmd+K in workspace dispatches `:431-442` (also asserts `CustomEvent` instance and call count = 1); Cmd+K in home no-event `:444-454`; Cmd+K in editable no-op `:456-479`. Cmd+N/Cmd+P regression at `:165-196` preserved. |
| AC-08 — ConnectionSwitcher.test.tsx event scenario | **PASS** | `src/components/workspace/ConnectionSwitcher.test.tsx:330-352` — asserts the popover starts closed (`[aria-label="Connection: Alpha"]` is null), dispatches `open-connection-switcher`, then asserts both option rows surface in the DOM. Real-behavior assertion, not internal-state inspection. |
| AC-09 — ShortcutCheatsheet.test.tsx labels | **PASS** | `src/components/shared/__tests__/ShortcutCheatsheet.test.tsx:125-143` — three new tests, each opens the cheatsheet via `?` and asserts label visibility. Sanity check at line 130 confirms legacy `"Settings"` is gone. |
| AC-10 — New e2e specs | **PASS** | `e2e/db-switcher.spec.ts:26-59` — describe with `before()` skip on `!E2E_PG_HOST` (line 27-34); two `it` cases with body-deferred `this.skip()` and Mongo-specific `E2E_MONGO_HOST` gate at line 53. `e2e/raw-query-db-change.spec.ts:19-39` — same skip pattern. Both files lint clean (`pnpm exec eslint e2e/db-switcher.spec.ts e2e/raw-query-db-change.spec.ts` returns 0 issues). `wdio.conf.ts:18` glob `./e2e/**/*.spec.ts` automatically picks them up. |
| AC-11 — 7 verification commands | **PASS** | Re-ran all locally, see "Verification Re-Run" below. |
| AC-12 — Zero user-visible regression | **PASS** | All 2042 vitest tests pass. Existing keyboard-shortcut regressions in `src/App.test.tsx` (Cmd+W `:93-100`, Cmd+T `:102-115`, Cmd+. `:117-135`, Cmd+R `:137-149`, F5 `:151-161`, Cmd+N/S/P `:165-196`, Cmd+I `:278-287`) all green. `appShellStore.setScreen` API unchanged. ConnectionSwitcher external props signature unchanged. ShortcutCheatsheet group order preserved. |

## Out-of-Scope Audit

**PASS**. `git status` shows only the contracted write-scope files modified plus the two new e2e specs and the `docs/sprints/sprint-133/` artifacts:

```
M  src/App.tsx
M  src/App.test.tsx
M  src/components/workspace/ConnectionSwitcher.tsx
M  src/components/workspace/ConnectionSwitcher.test.tsx
M  src/components/shared/ShortcutCheatsheet.tsx
M  src/components/shared/__tests__/ShortcutCheatsheet.test.tsx
?? e2e/db-switcher.spec.ts
?? e2e/raw-query-db-change.spec.ts
?? docs/sprints/sprint-133/
```

No backend (`src-tauri/**`) changes, no `wdio.conf.ts` change, no other shortcut rebinds, no mock fixtures.

## Verification Re-Run Outcomes

| Command | Outcome |
|---------|---------|
| `pnpm vitest run` | **PASS** — 126 files / 2042 tests / 0 failures (matches Generator's claim, +15 over 2027 baseline). |
| `pnpm tsc --noEmit` | **PASS** — empty output, exit 0. |
| `pnpm lint` | **PASS** — empty output, exit 0. |
| `pnpm contrast:check` | **PASS** — 72 themes / 144 modes / 864 pairs / 0 new violations. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **PASS** — 268 passed; 0 failed; 2 ignored. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **PASS** — 0 warnings. |
| e2e static (lint over `e2e/**`) | **PASS** — `eslint.config.js:59` `files: ["**/*.{ts,tsx}"]` covers `e2e/**`; `pnpm lint` exit 0 means new spec files lint clean. `tsconfig.json` `include` is `["src"]` so e2e is not in `pnpm tsc --noEmit`, mirroring existing convention. |

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Completeness | 9/10 | All 12 ACs implemented per contract; e2e specs are intentionally body-deferred per the contract's "skip pattern" guidance, which is documented in the handoff. |
| Correctness | 9/10 | Code matches contract semantics exactly. Editable / screen / Shift / Alt guards are consistently ordered. `preventDefault` is correctly scoped to the matched-tab branch (avoids hijacking unmatched Cmd+digit). Event listener cleanup is wired. ConnectionSwitcher's promotion to controlled state preserves the previous uncontrolled behavior via `onOpenChange={setOpen}`. |
| Test Quality | 8/10 | Tests assert real behavior (store reads, event-listener mocks, DOM querying for popover rows). Editable-target / out-of-range / wrong-screen edge cases are explicitly covered. CustomEvent instance + call-count assertion in Cmd+K test is a nice extra. e2e specs are scaffolds (intentional, contract-allowed) — full bodies deferred. |
| Code Quality | 9/10 | No dead imports, no commented-out code, no scope creep. Inline comments cite Sprint 133 and explain *why* (e.g. "Numpad digit keys intentionally NOT matched"). Style matches existing App.tsx effect handlers (early-return pyramid; `useEffect` per shortcut group). |
| Verification Discipline | 9/10 | All 7 commands re-ran green. Generator's reported numbers match the actual re-run exactly. No silent regressions, no skipped checks. |
| **Overall** | **8.8/10** | All dimensions ≥ 7. PASS. |

## Findings / Notes

1. **Contract typo, code-correct**: Contract & brief reference `setActiveTabId` but the real store API is `setActiveTab` (`src/stores/tabStore.ts:183`). Generator correctly used the actual API. Non-issue.
2. **Cmd+1..9 preventDefault scope**: `preventDefault` only fires on the matched-tab path. For out-of-range / wrong-screen / editable cases the keystroke is left to the browser. Acceptable — Cmd+digit has no native browser action in Tauri webview; preventing only when we act keeps the contract literal ("preventDefault on a successful match").
3. **Mongo `it` skip ordering**: `e2e/db-switcher.spec.ts:51-58` has `if (!process.env.E2E_MONGO_HOST) this.skip()` followed by an unconditional `this.skip()`. Both reach the same outcome (test skips). Body is intentionally deferred; the env-gate is harmless dead code while the body-deferred skip is in place. Documented as "deferred" in the handoff.
4. **`open-settings` cleanup is total**: All event-dispatch callsites are gone; only comments and a regression test that asserts non-dispatch remain. Clean repurpose.

## Final Verdict: PASS

No required-check failures. No P1/P2 findings. Sprint 133 ships as-is.
