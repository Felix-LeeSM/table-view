# Sprint 153 — Generator Handoff

## Generator Handoff

### Changed Files

**Production stores (in scope):**
- `src/stores/tabStore.ts` — adds `SYNCED_KEYS = ["tabs", "activeTabId"]`
  with workspace-only attach guard (`if (getCurrentWindowLabel() === "workspace")`).
  Excludes `dirtyTabIds` (Set, non-serializable) and `closedTabHistory` (per-window undo scope).
- `src/stores/mruStore.ts` — adds `SYNCED_KEYS = ["lastUsedConnectionId"]`,
  symmetric attach on channel `"mru-sync"`.
- `src/stores/themeStore.ts` — adds `SYNCED_KEYS = ["themeId", "mode"]`,
  symmetric attach on channel `"theme-sync"`. Adds a side-effect subscriber
  that re-runs `applyTheme()` when an inbound bridge merge mutates
  `themeId`/`mode` so DOM `data-theme`/`data-mode` attributes converge.
  Excludes `resolvedMode` (per-window derived from `prefers-color-scheme`).
- `src/stores/favoritesStore.ts` — adds `SYNCED_KEYS = ["favorites"]`,
  symmetric attach on channel `"favorites-sync"`.
- `src/stores/appShellStore.ts` — Sprint 153 decision recorded as
  option (b) deprecate-and-narrow. JSDoc `@deprecated` tags on
  `AppShellScreen`, `screen` field, and `setScreen` action explain the
  field is window-scoped (NOT bridge-wired) and will be retired in
  Sprint 154 once real `WebviewWindow.show()/hide()` lands. Removal
  rejected because it would force coordinated edits across 7+ files
  outside the store-only sprint scope.

**Test files (in scope):**
- `src/__tests__/cross-window-store-sync.test.tsx` (NEW, 15 cases):
  TDD-first cross-window sync coverage. Per-store emit + inbound apply +
  malformed-payload error paths; tab-store workspace-only allowlist +
  launcher-attach-guard via `vi.resetModules`/`vi.doMock`; appShellStore
  no-broadcast.
- `src/stores/tabStore.test.ts` — adds 3-case `SYNCED_KEYS` regression
  block (membership pin + dirtyTabIds exclusion + closedTabHistory exclusion).
- `src/stores/mruStore.test.ts` — adds 1-case `SYNCED_KEYS` regression.
- `src/stores/themeStore.test.ts` — adds 2-case `SYNCED_KEYS` regression
  (membership pin + resolvedMode exclusion).
- `src/stores/favoritesStore.test.ts` — adds 1-case `SYNCED_KEYS`
  regression.

**Test-mock patches (Sprint 152 precedent — `emit` stub addition):**
- `src/App.test.tsx` — adds `emit: vi.fn(() => Promise.resolve())` to
  `@tauri-apps/api/event` mock. Required because mruStore/themeStore/
  favoritesStore now subscribe to setState at module load; AppRouter's
  boot-time setState would throw without an emit stub.
- `src/__tests__/window-bootstrap.test.tsx` — same one-line `emit` stub
  addition. The contract lists this file as protected, but the
  execution brief explicitly authorizes this exact mock-only edit
  ("if adding the bridge attach makes the existing test files break,
  add a `vi.fn()` `emit` to those tests' Tauri event mock — Sprint 152
  set the precedent"). The diff is mock-only; no test logic changed.

**Evidence:**
- `docs/sprints/sprint-153/tdd-evidence/red-state.log` — captured
  pre-implementation RED state (9 failed / 6 passed).

### Checks Run

| # | Command | Result |
|---|---------|--------|
| 1 | `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx` | 15/15 PASS |
| 2 | `pnpm vitest run src/stores/{tabStore,mruStore,themeStore,favoritesStore,appShellStore}.test.ts` | 129/129 PASS |
| 3 | `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` | PASS (no AC-142 regression) |
| 4 | `pnpm vitest run` (full suite) | 152 files, 2293 PASS + 5 todo (baseline 2271 + 22 new) |
| 5 | `pnpm tsc --noEmit` | exit 0 |
| 6 | `pnpm lint` | exit 0 |
| 7 | skip/todo grep on touched files | empty (exit 1 = no matches) |
| 8 | `git diff HEAD -- <Sprint 150/151/152 outputs>` | only `window-bootstrap.test.tsx` mock-only `emit` line, per execution-brief authorization |
| 9 | `grep -lrE "^\s*void attachZustandIpcBridge" src/stores/` | exactly 5 files (connectionStore, tabStore, mruStore, themeStore, favoritesStore) |
| 10 | `SYNCED_KEYS` export inspection | all 5 stores export the constant |
| 11 | `appShellStore.screen` decision | option (b) deprecate-and-narrow; documented; NOT bridge-wired |

### Done Criteria Coverage

- **AC-153-01** — `tabStore.ts` opted in on channel `"tab-sync"` with
  workspace-only attach guard at line 713 (`if (getCurrentWindowLabel() === "workspace")`).
  Tested by `cross-window-store-sync.test.tsx` cases asserting both the
  workspace-emit path and the launcher-no-attach path (via
  `vi.resetModules` + `vi.doMock` to re-import with a different label).
- **AC-153-02** — `mruStore.ts` opted in on channel `"mru-sync"`.
  Symmetric. Tested by emit + inbound + malformed-payload cases.
- **AC-153-03** — `themeStore.ts` opted in on channel `"theme-sync"`.
  Side-effect subscriber re-applies DOM on inbound merges. Tested by
  emit + inbound + malformed cases.
- **AC-153-04** — `favoritesStore.ts` opted in on channel `"favorites-sync"`.
  Tested by emit + inbound + malformed cases.
- **AC-153-05** — `appShellStore.screen` decision option (b) recorded.
  `useAppShellStore` is NOT in the call-site grep result. JSDoc
  `@deprecated` tags + Sprint 154 retirement plan documented inline.
  Test: `cross-window-store-sync.test.tsx` "appShellStore is NOT
  bridge-wired" case asserts no broadcast on any known channel.
- **AC-153-06** — Each opted-in store exports a `SYNCED_KEYS` constant.
  Membership regression tests: tabStore (3 cases), mruStore (1),
  themeStore (2), favoritesStore (1) — total 7 new cases.
- **AC-153-07** — `cross-window-store-sync.test.tsx` covers per-store
  sync direction, allowlist filtering (tab-store excluded keys not
  broadcast), error path (malformed payload silently ignored — 4 cases:
  null, garbage string, missing state, null state), and tab-store
  workspace-only semantics (launcher-attach-guard case).
- **AC-153-08** — TDD ordering captured in
  `docs/sprints/sprint-153/tdd-evidence/red-state.log`. Test file
  authored before any production wiring.
- **AC-153-09** — `pnpm vitest run` 2293 PASS + 5 todo (≥ 2271 + 22 new),
  `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0.
- **AC-153-10** — `connection-sot.ac142.test.tsx` runs green; no AC-142
  case affected (this sprint touches no connectionStore code).
- **AC-153-11** — No new `it.skip` / `this.skip()` / `it.todo` / `xit` /
  `describe.skip` introduced. Skip-grep on all touched files returns empty.

### Assumptions

1. **Mock-only `emit` stub addition to `window-bootstrap.test.tsx` is in scope.**
   The execution brief explicitly authorizes this minimal precedent
   ("Sprint 152 set the precedent"). The contract's protected-files
   list applies to test logic; a mock-only addition that fixes a
   transitive boot-time failure caused by my new wirings is the same
   class of edit Sprint 152 made to `connectionStore.test.ts`.
2. **`appShellStore.screen` retention via JSDoc deprecation is the
   correct option-b interpretation.** Removal would touch 7+ files
   outside the store-only sprint scope (App.tsx, HomePage.tsx,
   WorkspacePage.tsx, App.test.tsx, HomePage.test.tsx,
   WorkspacePage.test.tsx, window-lifecycle.ac141.test.tsx,
   connection-sot.ac142.test.tsx). Sprint 154's window-lifecycle
   work is the natural retirement point.
3. **`themeStore`'s post-merge subscriber is correct DOM-application
   behavior.** The bridge's `setState({themeId, mode})` shallow merge
   skips the store actions, so without this subscriber, an inbound
   theme broadcast would update store state but leave the DOM stale.
   The subscriber's `lastApplied` cache prevents loops; idempotent
   `applyTheme()` calls are no-ops at the DOM level.
4. **`originId: getCurrentWindowLabel() ?? "unknown"`** — Sprint 152
   evaluator advisory #1 honored: `"unknown"` not `"test"` keeps the
   loop guard distinct between any future stores that share a fallback.

### Residual Risk

- **Sprint 154 will need to retire `appShellStore.screen` entirely.**
  The `@deprecated` JSDoc carries the Sprint 154 plan inline; until
  then, the field exists as window-local state with no cross-window
  bleed (it is NOT in any allowlist; the bridge does not attach).
- **`themeStore` DOM subscriber loop guard is `lastApplied` string
  cache (`themeId|mode`).** If a future contributor adds a third
  state field that affects DOM application, they must extend the
  cache key. The current trade-off favors simplicity over generality.
- **`tabStore` attach guard uses `getCurrentWindowLabel()` at module
  load.** If a future test re-imports `tabStore` with a different
  label, it must use `vi.resetModules() + vi.doMock(...)` like the
  cross-window-store-sync test's launcher-attach-guard case does.
  This is a known vitest pattern, not a regression risk in production.
- **`emit` stub addition to `window-bootstrap.test.tsx` is the only
  edit to a Sprint 150 protected file.** It is mock-only (no test
  logic changed), authorized by the execution brief, and required
  for the bridge wiring to not crash boot-time setState calls.
  Evaluator may want to confirm this edit is acceptable; if not, the
  alternative is to make each bridge subscriber wrap the emit call
  in a try/catch (defensive code), which would push a defensive
  pattern into production for a test-only failure mode.
