# Sprint 134 — Handoff

## Summary

ConnectionSwitcher was deleted, the Cmd+K dispatcher was removed from
`App.tsx`, the cheatsheet entry for it was dropped, the Home double-click
swap path was clarified (and locked in by new tests), a new
`<DisconnectButton>` was introduced into `WorkspaceToolbar`, and the
TabBar's dirty marker was guarded against the activeTabId regression
with two new dirty-vs-active tests.

All 7 verification gates pass:

| # | Command | Status |
|---|---|---|
| 1 | `pnpm vitest run` | 2047 passed (126 files) |
| 2 | `pnpm tsc --noEmit` | 0 errors |
| 3 | `pnpm lint` | 0 errors |
| 4 | `pnpm contrast:check` | 0 new violations |
| 5 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 268 passed, 2 ignored |
| 6 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | clean |
| 7 | `pnpm exec eslint e2e/**/*.ts` | 0 errors |

## Changed Files

| Path | Purpose |
|------|---------|
| `src/components/workspace/ConnectionSwitcher.tsx` | **DELETED** — popover removed (lesson 2026-04-27 #1, #2). |
| `src/components/workspace/ConnectionSwitcher.test.tsx` | **DELETED** — paired with the production file. |
| `src/components/workspace/WorkspaceToolbar.tsx` | Drop ConnectionSwitcher import/render, mount `<DisconnectButton>` at the trailing edge (refresh adjacency = workspace toolbar end). |
| `src/components/workspace/WorkspaceToolbar.test.tsx` | Replace combobox assertions with DB/Schema/Disconnect role checks; add a regression guard that the legacy combobox is NOT rendered. |
| `src/components/workspace/DisconnectButton.tsx` | **CREATED** — workspace toolbar control that calls `disconnectFromDatabase(focusedConnId)`. Disabled when no focused connection / not connected / mid-flight. Loading state + toast-on-failure + descriptive tooltip. |
| `src/components/workspace/DisconnectButton.test.tsx` | **CREATED** — covers aria-label, disabled-state matrix, click → store call, failure toast, busy aria-label flip, tooltip. |
| `src/App.tsx` | Remove the Sprint 133 Cmd+K useEffect that dispatched `open-connection-switcher`. Replaced with a comment marker for the chord's deprecation. |
| `src/App.test.tsx` | Flip the three Cmd+K tests to no-op assertions (event MUST NOT be dispatched). All other shortcut tests untouched. |
| `src/components/shared/ShortcutCheatsheet.tsx` | Remove the "Open connection switcher" / Cmd+K entry from the Navigation group. |
| `src/components/shared/__tests__/ShortcutCheatsheet.test.tsx` | Replace the rendering assertion with a regression guard that the label and "Cmd+K" key text are gone. |
| `src/pages/HomePage.tsx` | Add an explanatory comment re-grounding `handleActivate` as the single connection-swap path (no behavior change — the existing implementation already calls `setFocusedConn` + `setScreen`). |
| `src/pages/HomePage.test.tsx` | Add two AC-S134-04 tests: swap from connectionA→connectionB updates focusedConnId AND screen; activating the already-focused connection still swaps to workspace (boundary). |
| `src/components/layout/TabBar.test.tsx` | Add two AC-S134-06 tests: dirty marker is rendered on a non-active tab; not rendered on the active tab when only an inactive sibling is dirty. |
| `src/stores/tabStore.ts` | Update the `lastActiveTabIdByConnection` doc comment to reflect that the tracker outlived ConnectionSwitcher and is kept for future swap surfaces. |
| `e2e/keyboard-shortcuts.spec.ts` | Remove the "Cmd+K opens the connection switcher popover" scenario; remove the now-unused `ensureHomeScreen` import. |

## Acceptance Criteria Evidence

### AC-S134-01 — ConnectionSwitcher deleted, WorkspaceToolbar updated

- Files deleted: `src/components/workspace/ConnectionSwitcher.tsx`,
  `src/components/workspace/ConnectionSwitcher.test.tsx` (verified via
  `ls` of the directory — only `DbSwitcher`, `SchemaSwitcher`,
  `WorkspaceToolbar`, the new `DisconnectButton`, and existing siblings
  remain).
- `src/components/workspace/WorkspaceToolbar.tsx` no longer imports or
  renders `ConnectionSwitcher`.
- New regression test: `WorkspaceToolbar > does NOT render the legacy
  ConnectionSwitcher combobox` (passes).
- `pnpm tsc --noEmit` returns clean (gate #2 above).

### AC-S134-02 — Cmd+K useEffect removed, App.test updated to no-op

- The Sprint 133 useEffect block at `src/App.tsx` lines 168–184 was
  replaced with a comment-only block describing the deprecation.
- `src/App.test.tsx` Cmd+K trio renamed to "(deprecated)" and flipped
  to `expect(handler).not.toHaveBeenCalled()`. All three pass.
  - `App global shortcuts > Cmd+K in workspace does NOT dispatch
    open-connection-switcher (deprecated)`
  - `App global shortcuts > Cmd+K in home does NOT dispatch
    open-connection-switcher (deprecated)`
  - `App global shortcuts > Cmd+K with focus inside an editable target
    is a no-op (deprecated)`

### AC-S134-03 — ShortcutCheatsheet entry removed

- The `{ label: "Open connection switcher", keys: ["Cmd+K"] }` entry
  in `SHORTCUT_GROUPS.Navigation.items` is gone.
- The previously asserting test `renders the Open connection switcher
  label (Cmd+K)` was replaced by `does NOT render the deprecated Open
  connection switcher label`, which also asserts the bare `Cmd+K` key
  text is absent.

### AC-S134-04 — Home double-click swap

The store API actually exposes `setFocusedConn` (not `setActiveConnection`
— the spec's hypothetical name was adapted per the brief's
"adapt to the existing API"). `handleActivate` already covered the swap
path; the bug per the lesson was the toolbar `<ConnectionSwitcher>`
component's `onValueChange` only routed *tabs* without touching
`focusedConnId`, which is resolved by deleting the switcher and routing
all swaps through Home's `handleActivate`.

New tests added to `src/pages/HomePage.test.tsx`:

- `HomePage > double-click swap from connectionA to connectionB updates
  focusedConnId AND screen (AC-S134-04)`
- `HomePage > swap is idempotent when activating the already-focused
  connection (AC-S134-04 boundary)`

Both pass. The existing `onActivate from ConnectionList swaps to
workspace screen` test continues to pass.

### AC-S134-05 — DisconnectButton mounted

- `src/components/workspace/DisconnectButton.tsx` created with
  `aria-label="Disconnect"`, ghost variant + icon-xs sizing to match
  sibling toolbar controls, descriptive `title` tooltip including the
  focused connection name, and a busy state that flips `aria-label` to
  "Disconnecting…" while the call is in flight.
- Mounted in `WorkspaceToolbar` at the trailing edge (`<div
  className="ml-auto">`), which is the closest thing to "refresh
  adjacent" — refresh is keyboard-only (Cmd+R / F5), so the workspace
  toolbar is the natural toolbar slot.
- Tests in `DisconnectButton.test.tsx`:
  - exposes an aria-label of 'Disconnect' (AC-S134-05)
  - is disabled when no connection is focused
  - is disabled when the focused connection is in the disconnected state
  - is disabled while the focused connection is in the connecting state
  - is enabled when the focused connection is connected
  - calls disconnectFromDatabase with the focused id on click
  - surfaces a toast and re-enables the button on disconnect failure
  - flips aria-label to 'Disconnecting…' while a disconnect is in flight
  - renders a tooltip mentioning the focused connection's name

All 9 tests pass.

### AC-S134-06 — TabBar dirty marker is independent of activeTabId

The production code at `src/components/layout/TabBar.tsx` line 236 was
already `{dirtyTabIds.has(tab.id) && (...)}` — independent of
`activeTabId`. No production-code change was needed; only regression
guards were added.

New tests in `src/components/layout/TabBar.test.tsx`:

- `TabBar > renders the dirty mark on a tab that is NOT the active tab
  (AC-S134-06)` — dirty inactive tab carries marker, clean active tab
  does not, and `aria-selected` is asserted to confirm we're testing
  the right elements.
- `TabBar > does NOT render a dirty mark on the active tab when only an
  inactive sibling is dirty (AC-S134-06)` — three-tab scenario that
  cross-checks no leakage onto the active tab.

Both pass.

### AC-S134-07 — Regression guard

- Cmd+1..9 / Cmd+, / Cmd+W / Cmd+T / Cmd+S existing tests in
  `App.test.tsx` and `App.test.tsx` continue to pass (covered by gate
  #1, all 2047 tests green).
- `e2e/keyboard-shortcuts.spec.ts` had its "Cmd+K opens the connection
  switcher popover" scenario removed (alongside the now-unused
  `ensureHomeScreen` import). The Cmd+, scenario is preserved.
- `pnpm exec eslint e2e/**/*.ts` returns clean (gate #7).

### AC-S134-08 — All 6 verification gates green

See the table at the top of this handoff. Total: 7 commands (the brief
includes the e2e static lint as a 7th). All green.

## Grep Audit

```
$ grep -rn "ConnectionSwitcher" src/ | wc -l
10
$ grep -rn "open-connection-switcher" src/ | wc -l
10
```

Both counts reflect comments and regression-guard test names only — no
production code imports `ConnectionSwitcher`, no production code renders
`<ConnectionSwitcher>`, and no production code dispatches
`open-connection-switcher`. The remaining hits break down as:

- `WorkspaceToolbar.test.tsx` (1) — assertion that the legacy combobox
  is gone.
- `WorkspaceToolbar.tsx`, `App.tsx`, `App.test.tsx`, `HomePage.tsx`,
  `HomePage.test.tsx`, `ShortcutCheatsheet.tsx`,
  `ShortcutCheatsheet.test.tsx`, `tabStore.ts` (comments / docstrings).
- `App.test.tsx` (8 lines) — the regression-guard tests asserting
  `dispatchEvent("open-connection-switcher", …)` is NEVER called.

## Assumptions / Risks

- **Store API name**. The contract referenced `setActiveConnection` /
  `activeConnectionId`; the actual store uses `setFocusedConn` /
  `focusedConnId`. Per the brief's "adapt to the existing API" guidance
  I used the existing names, so AC-S134-04 verifies `focusedConnId`
  rather than `activeConnectionId`.
- **DisconnectButton mount location**. The contract said "refresh
  adjacent in MainArea". `MainArea` has no visible refresh button —
  refresh is keyboard-only. The natural workspace toolbar slot is
  `WorkspaceToolbar`, which is rendered immediately above `<TabBar>`
  inside `MainArea`. I placed the button at the trailing edge of
  `WorkspaceToolbar` (`ml-auto` to push it past Schema). If review
  wants it deeper inside `MainArea` itself, that would require a
  separate refresh-host element to pin against.
- **HomePage `handleActivate`**. The implementation was already correct
  for the single-path Home double-click flow. The lesson's "swap
  doesn't happen" symptom was the toolbar `<ConnectionSwitcher>`
  popover not threading `focusedConnId` — fixed by deletion. I added
  guard tests rather than refactoring `handleActivate`, which would
  have been gold-plating.
- **e2e Cmd+K removal vs deprecation**. I removed the scenario rather
  than rewriting it as a no-op. The brief allowed either, and a removed
  test is easier to read than a no-op test that would never fire (Cmd+K
  has no observable effect now).

## References

- Contract: `docs/sprints/sprint-134/contract.md`
- Spec: `docs/sprints/sprint-134/spec.md`
- Execution brief: `docs/sprints/sprint-134/execution-brief.md`
- Origin lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- Phase 9 baseline (what S134 unwinds): `docs/sprints/sprint-133/handoff.md`
