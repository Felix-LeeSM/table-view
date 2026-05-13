# Sprint Contract: sprint-270 — Cold-boot skeleton placeholders (perceived performance)

## Summary

- Goal: Replace the empty pre-hydrate render of the sidebar and main area with
  shadcn/ui `Skeleton` placeholders so the user sees app chrome immediately on
  first paint instead of a blank window during the IPC round-trip that
  populates `connections`. Sprint 175 closed measured cold-boot at 1404 ms
  with its AC ≥30% unmet; this sprint targets *perceived* performance via
  visible activity at first paint.
- Audience: TablePlus-style users on their first cold launch of the session
  and on warm re-entries when the workspace remounts before hydration runs.
- Owner: Generator (Sprint 270 sub-sprint of Sprint 268).
- Verification Profile: `mixed` — primarily `command` (vitest render-order +
  tsc + lint). Manual browser visual check is informational, not gating.

## In Scope

- **AC-270-01 — Sidebar skeleton at first paint** (`WorkspaceSidebar.tsx`):
  When `connections.length === 0 AND hasLoadedOnce === false`, the sidebar
  renders 4 stacked `Skeleton` rows (each `h-8`, width `w-full` or `w-4/5`,
  vertically gapped — see "Visual Direction" in
  `docs/sprints/sprint-268/spec.md`). The current "No connections yet" card
  is NOT shown during this pre-hydrate window.
- **AC-270-02 — Main-area skeleton at first paint** (`MainArea.tsx`): When
  there is no active tab AND `hasLoadedOnce === false`, the main area renders
  a skeleton block shaped roughly like the welcome card: a logo block
  (`h-20 w-20`), two line blocks (~`w-3/5` and ~`w-2/5` widths), and a
  button-sized block. After hydration completes, the existing `EmptyState`
  swaps in unchanged.
- **AC-270-03 — Swap to real content is smooth**: When `loadConnections`
  resolves and `hasLoadedOnce` flips to `true`, the skeletons unmount and the
  real content (or the existing empty card) mounts. A vitest case using a
  delayed-resolve mock for `loadConnections` asserts the render-order
  invariant: at `t=0` the skeleton (sidebar + main) is in the DOM; after the
  promise resolves there is no flash of "No connections yet" before the
  actual connection list (or the existing empty card) mounts.
- **AC-270-04 — Post-hydrate non-re-render**: Once `hasLoadedOnce === true`,
  the skeleton must NOT re-render when the component remounts (e.g. user
  navigates Connections-tab ↔ Workspace-tab). A vitest case verifies this by
  remounting `WorkspaceSidebar` / `MainArea` after the flag has flipped and
  asserting the skeleton DOM is absent.
- **AC-270-05 — Regression gate**: `pnpm vitest run --no-file-parallelism`
  baseline preserved (≥ Sprint 269 count plus new cases), `pnpm tsc --noEmit`,
  `pnpm lint` all clean. Cold-boot summary line values are NOT required to
  change — success criterion is the visible skeleton at first paint, not a
  numerical measurement.

### Pinned implementation decisions

1. **`hasLoadedOnce` flag on `connectionStore`**:
   - Added as `hasLoadedOnce: boolean` on `ConnectionState`. Initial value
     `false`.
   - Flipped to `true` inside `loadConnections` **finally-block semantics** —
     i.e. on BOTH the success branch (after `set({ connections, loading: false })`)
     and the error branch (after `set({ error: String(e), loading: false })`).
     A `loadConnections` rejection still flips the flag so the skeleton swaps
     to the existing error/empty surface instead of being stuck shimmering.
   - **NOT persisted, NOT synced across windows.** It is a runtime
     "have we ever finished a load this session" signal, not a syncable
     preference. **`SYNCED_KEYS` is left unchanged.**
   - Selector access from components reads `useConnectionStore((s) => s.hasLoadedOnce)`
     directly — no derived hook needed.
   - Distinct from `loading`: `loading` is "actively in flight"; `hasLoadedOnce`
     is "ever finished". Both coexist; neither replaces the other.

2. **Skeleton primitive** (`src/components/ui/skeleton.tsx`):
   - File does not yet exist. Create it as the shadcn/ui canonical primitive:
     `<div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />`
   - Exported as a **named** export `Skeleton` (matches project pattern, e.g.
     `src/components/ui/button.tsx`'s `Button`).
   - Props: `HTMLAttributes<HTMLDivElement>` with `className` passthrough via
     `cn`. No additional API surface.

3. **Sidebar pre-hydrate branch hierarchy** (`WorkspaceSidebar.tsx`):
   - Replace the current top-level `if (connections.length === 0) { … "No connections yet" … }`
     branch with a two-step gate:
     ```
     if (connections.length === 0) {
       if (!hasLoadedOnce) return <SidebarSkeleton />;
       return <ExistingEmptyCard />;   // unchanged JSX
     }
     ```
   - The "active-tab priority", `pickSidebar`, `RdbSidebar` / `DocumentSidebar`,
     "connecting / error" cards and all post-hydrate code paths are UNCHANGED.
   - The skeleton sub-component MAY be inlined in `WorkspaceSidebar.tsx` or
     extracted to `src/components/workspace/WorkspaceSidebarSkeleton.tsx` —
     Generator picks based on what keeps `WorkspaceSidebar.tsx` readable.

4. **Main-area pre-hydrate branch hierarchy** (`MainArea.tsx`):
   - The current fallback `<EmptyState />` at the no-active-tab branch (line
     244 in source as of writing) becomes:
     ```
     hasLoadedOnce ? <EmptyState /> : <MainAreaSkeleton />
     ```
   - `EmptyState` itself is UNCHANGED. Same extraction option as above for
     `MainAreaSkeleton`.

5. **Swap-order vitest** (e.g. in a new
   `src/components/workspace/firstPaintSkeleton.test.tsx`):
   - Uses `vi.mock("@lib/tauri", () => ({ listConnections: vi.fn(...) }))` or
     equivalent to return a Promise the test can resolve manually.
   - Asserts (a) at `t=0` after mount: `Skeleton`(s) present, "No connections
     yet" absent. (b) Resolve the promise → flush microtasks → skeleton
     absent and "No connections yet" present.
   - Tests added: written 2026-05-13, AC-270-03 swap-order coverage.

6. **Post-hydrate non-re-render vitest**:
   - Sets `useConnectionStore.setState({ hasLoadedOnce: true })` before mount,
     mounts `WorkspaceSidebar` / `MainArea`, asserts skeleton DOM absent.
   - Unmount + remount the component, re-assert absence. Confirms the flag
     selector path does not flip back to `false` on remount.

## Out of Scope

- Sprint 271 (`expected_database` guard propagation to remaining RDB
  commands) — separate sprint folder.
- Measured cold-boot reduction targets. Sprint 175's ≥30% AC is *retired* by
  the spec; this sprint targets perceived performance only, no rebaselined
  cold-boot trial in the contract.
- Animation timing tuning beyond the default `animate-pulse` Tailwind
  utility. No custom keyframes, no `prefers-reduced-motion` override (the
  default `animate-pulse` already respects user reduced-motion at the
  browser level).
- Restructuring of `App.tsx` boot order, `useEffect` chain, or
  `markBootMilestone` instrumentation.
- Converting the `loading` flag into `hasLoadedOnce`. They remain separate
  fields with distinct semantics (see "Pinned decisions" #1).
- Skeleton support inside `RdbSidebar` / `DocumentSidebar` post-hydrate (e.g.
  while schema tree is loading). Out of scope for this sprint.

## Invariants

- **`SYNCED_KEYS` shape unchanged** — `hasLoadedOnce` is window-local, never
  broadcast through the zustand IPC bridge. The cross-window sync allowlist
  audit comment in `connectionStore.ts` (lines 78-89) stays accurate.
- **`loadConnections` byte-equivalent for callers** — return type, error
  shape, and `loading` flag transition timing all unchanged. The only new
  side-effect is the `hasLoadedOnce: true` set inside both branches.
- **`WorkspaceSidebar` post-hydrate branches unchanged** — active-tab
  priority resolution (lines 65-91), driving connection fallback (lines
  69-74), `!driving` early return (lines 93-98), `!isConnected` connecting /
  error card (lines 105-135), `pickSidebar` dispatch (lines 137-141) are all
  byte-equivalent post-Sprint 270.
- **`EmptyState` rendering unchanged** — internal logic (MRU-first / first-
  connected fallback / no-target fallback message) is byte-equivalent. Only
  its parent's branch decides when to mount it.
- **Existing tests must continue to pass** —
  `src/components/workspace/WorkspaceSidebar.test.tsx` (if present),
  `src/components/layout/MainArea.test.tsx` (if present), and
  `src/stores/connectionStore.test.ts` (if present): extend, do not rewrite.
  Generator must surface any test that needs an updated default
  `hasLoadedOnce: true` precondition rather than rewriting its assertions.
- **No `unwrap()` / `any` / `console.log`** introduced.
- **Zero new ADR** — see spec global AC #2.

## Acceptance Criteria

- `AC-270-01` — Sidebar renders 4 stacked `Skeleton` rows when
  `connections.length === 0 && !hasLoadedOnce`. Pinned by a vitest case that
  mounts `WorkspaceSidebar` against a store with the pre-hydrate state and
  queries for the skeleton DOM (e.g. by role + `animate-pulse` class).
- `AC-270-02` — Main area renders a skeleton block (logo + two lines +
  button) when no active tab AND `!hasLoadedOnce`. Pinned by an analogous
  vitest case on `MainArea`.
- `AC-270-03` — Swap-order test (delayed-resolve `loadConnections` mock)
  asserts: t=0 skeleton present; post-resolve skeleton absent AND the
  expected post-hydrate surface (existing empty card OR connection list)
  present. No intermediate "No connections yet" flash.
- `AC-270-04` — Post-hydrate remount test asserts the skeleton DOM is absent
  after `hasLoadedOnce === true` is pre-set and the component is
  mounted/unmounted/remounted.
- `AC-270-05` — `pnpm vitest run --no-file-parallelism`,
  `pnpm tsc --noEmit`, `pnpm lint` all clean. Test count delta ≥ +4 (one
  per AC-270-01..04, possibly more if Generator splits cases). Sprint 269
  baseline 3217.

## Design Bar / Quality Bar

- Skeleton aesthetic mirrors shadcn/ui's canonical primitive: neutral muted
  background (`bg-muted`), low-contrast pulse (`animate-pulse`),
  `rounded-md` corners. No spinner, no text "Loading…", no progress bar.
- Dark and light theme variants both inherit the design-system contrast of
  `bg-muted` against `bg-background`. No theme-specific override.
- Layout pixel-stable: the skeleton block dimensions match (within ~4 px) the
  post-hydrate component dimensions so the swap does not cause a reflow
  jump.
- Accessibility: skeleton container carries `role="status"` and
  `aria-busy="true"` (matches the existing empty-state cards' `role="status"`
  pattern) plus an `aria-label` like "Loading connections" or a visually-
  hidden `<span>` so screen readers announce the load.

## Verification Plan

### Required Checks

1. Targeted vitest:
   `pnpm vitest run src/stores/connectionStore.test.ts src/components/workspace/WorkspaceSidebar.test.tsx src/components/layout/MainArea.test.tsx` —
   extend each with the new sprint cases; legacy assertions stay green.
2. New test file(s) — at minimum
   `src/components/workspace/firstPaintSkeleton.test.tsx` (or split per
   component). Optional `src/components/ui/skeleton.test.tsx` to lock the
   `Skeleton` primitive's class composition.
3. Full `pnpm vitest run --no-file-parallelism` — confirms no cross-suite
   regression and emits the new vitest case count for the baseline check
   (Sprint 269 baseline 3217).
4. `pnpm tsc --noEmit` — TypeScript clean.
5. `pnpm lint` — ESLint clean (0 errors).
6. Manual browser verification (informational only): with Chrome devtools
   "Slow 3G" or `setTimeout`-instrumented `listConnections` mock, observe
   the skeleton during the IPC round-trip. Optional screenshot in
   `findings.md`. NOT a gating check.

### Required Evidence

- Generator must provide:
  - Changed files with purpose (`src/components/ui/skeleton.tsx`,
    `src/stores/connectionStore.ts`, `src/components/workspace/WorkspaceSidebar.tsx`,
    `src/components/layout/MainArea.tsx`, plus new test file(s) and any
    existing test files extended).
  - Checks run and full output tails for each command in
    "Required Checks" — particularly the test count delta from Sprint 269
    baseline 3217.
  - Test names + `file:line` for each AC-270-NN case.
  - Concrete verification of the `Skeleton` primitive shape (the rendered
    class list contains `animate-pulse`, `rounded-md`, `bg-muted`).
  - Optional manual-check screenshot.
- Evaluator must cite, with file paths and line numbers, the location of:
  1. `hasLoadedOnce` declaration in `connectionStore.ts` (initial state) AND
     both flip sites inside `loadConnections` (success + error path).
  2. The sidebar pre-hydrate branch in `WorkspaceSidebar.tsx` — the
     `connections.length === 0 && !hasLoadedOnce` decision and the skeleton
     render JSX.
  3. The main-area pre-hydrate branch in `MainArea.tsx` — the no-active-tab
     `!hasLoadedOnce` decision and the skeleton render JSX.
  4. The swap-order vitest case (file + line) and the assertion that
     proves no "No connections yet" flash between skeleton and final
     render.
  5. Confirmation that `SYNCED_KEYS` in `connectionStore.ts` does NOT
     include `hasLoadedOnce`.

## Test Requirements

### Unit Tests (필수)

- `connectionStore.test.ts` (extend):
  - Initial state: `hasLoadedOnce === false`.
  - `loadConnections` success path: after `await`, `hasLoadedOnce === true`.
  - `loadConnections` error path (mock `listConnections` to reject):
    `hasLoadedOnce === true` AND `error` is set.
  - `SYNCED_KEYS` snapshot — `hasLoadedOnce` is NOT in the array.
- `WorkspaceSidebar.test.tsx` (extend):
  - AC-270-01 happy path — skeleton mounted with pre-hydrate state.
  - AC-270-04 post-hydrate — skeleton absent when `hasLoadedOnce === true`
    AND `connections.length === 0` (existing empty card mounted instead).
- `MainArea.test.tsx` (extend):
  - AC-270-02 happy path — skeleton mounted with pre-hydrate state and no
    active tab.
  - Post-hydrate parity — `EmptyState` mounted when `hasLoadedOnce === true`
    AND no active tab.
- New file `firstPaintSkeleton.test.tsx`:
  - AC-270-03 swap-order with delayed-resolve `listConnections` mock.

### Coverage Target

- New / modified code: line coverage ≥ 70%.
- Overall CI thresholds (line 40 / function 40 / branch 35) unchanged and
  monotonically non-decreasing.

### Scenario Tests (필수)

- [x] Happy path — pre-hydrate skeleton, post-hydrate swap.
- [x] Error path — `loadConnections` rejects, flag still flips, skeleton
      unmounts.
- [x] Edge case — `hasLoadedOnce === true` AND `connections === []` →
      existing empty card (NOT skeleton).
- [x] Edge case — very fast hydration (< 50 ms): skeleton may render for a
      single frame; the swap-order test tolerates this (assert post-resolve
      state, not duration).
- [x] Regression — every pre-existing case in the touched test files keeps
      passing.

## Test Script / Repro Script

1. `git checkout <generator-branch>`
2. `pnpm install` (if Generator added dependencies — not expected).
3. `pnpm vitest run src/stores/connectionStore.test.ts src/components/workspace/WorkspaceSidebar.test.tsx src/components/layout/MainArea.test.tsx src/components/workspace/firstPaintSkeleton.test.tsx`
4. `pnpm vitest run --no-file-parallelism` → assert test count ≥ 3217 + 4.
5. `pnpm tsc --noEmit`
6. `pnpm lint`
7. (Optional) `pnpm tauri dev`, throttle network in devtools, observe
   skeleton at first paint.

## Ownership

- Generator: Claude (sprint-build harness).
- Write scope: `src/components/ui/skeleton.tsx` (new),
  `src/stores/connectionStore.ts` (add `hasLoadedOnce` + flip sites),
  `src/components/workspace/WorkspaceSidebar.tsx` (pre-hydrate branch),
  `src/components/layout/MainArea.tsx` (pre-hydrate branch), test files
  listed under "Test Requirements". No production code outside this scope.
- Merge order: single Conventional Commit:
  `feat(sprint-270): first-paint skeleton placeholders for sidebar + main area`.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
- `SYNCED_KEYS` audit confirmed unchanged.
- Sprint 175 perceived-performance gap closed; ADR not required (per spec
  global AC #2).
