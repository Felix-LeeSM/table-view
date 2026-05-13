# Sprint Execution Brief: sprint-270 — Cold-boot skeleton placeholders

## Objective

- Replace the empty pre-hydrate render of the sidebar and main area with
  shadcn/ui `Skeleton` placeholders so the user sees app chrome immediately
  on first paint instead of a blank window during the IPC round-trip that
  populates `connections`.

## Task Why

- Sprint 175 retired its measured cold-boot AC (≥30% improvement) after
  shipping only 5.8% (1490 ms → 1404 ms); the WKWebView OS-parallel spawn
  floor blocks further wall-clock gains. This is the *perceived*-performance
  follow-up: at first paint the user should see structured shimmer (sidebar
  rows + welcome card silhouette) instead of a blank background, making the
  ~1.4 s feel near-instant.

## Scope Boundary

- IN: `src/components/ui/skeleton.tsx` (new shadcn primitive), `hasLoadedOnce`
  flag on `connectionStore`, pre-hydrate branches in `WorkspaceSidebar.tsx`
  and `MainArea.tsx`, new + extended vitest cases.
- OUT: Sprint 271 backend `expected_database` guard, measured cold-boot
  reduction targets, animation tuning beyond `animate-pulse`, `App.tsx` boot
  order changes, conversion of the `loading` flag, schema-tree skeletons
  inside `RdbSidebar` / `DocumentSidebar`.

## Invariants

- `SYNCED_KEYS` shape unchanged — `hasLoadedOnce` is window-local, not
  broadcast.
- `loadConnections` return type, error shape, and `loading` flag transition
  timing byte-equivalent for callers.
- `WorkspaceSidebar` post-hydrate branches (active-tab priority, driving
  connection fallback, `!driving` early return, connecting / error cards,
  `pickSidebar` dispatch) byte-equivalent.
- `EmptyState` internal logic byte-equivalent.
- Existing tests continue to pass — extend, don't rewrite.
- No `unwrap()` / `any` / `console.log`. No new ADR.

## Done Criteria

1. `Skeleton` primitive exists at `src/components/ui/skeleton.tsx` as a
   named export `Skeleton` with body
   `<div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />`.
2. `connectionStore.ts` has `hasLoadedOnce: boolean` initialised `false`,
   flipped to `true` on BOTH success and error branches of `loadConnections`.
   `SYNCED_KEYS` is unchanged.
3. `WorkspaceSidebar.tsx`: when `connections.length === 0 && !hasLoadedOnce`
   render 4 stacked `Skeleton` rows (h-8, ~w-full / w-4/5, vertically
   gapped). When `hasLoadedOnce && connections.length === 0` render the
   existing "No connections yet" card.
4. `MainArea.tsx`: when no active tab AND `!hasLoadedOnce` render a skeleton
   (logo block h-20 w-20, two line blocks ~60% / ~40% width, a button
   block). When `hasLoadedOnce && no active tab` render the existing
   `EmptyState`.
5. Swap-order vitest with delayed-resolve `listConnections` mock asserts
   skeleton at t=0; post-resolve no flash of "No connections yet" before
   final render.
6. Post-hydrate remount vitest asserts skeleton is absent when
   `hasLoadedOnce === true`.
7. `pnpm vitest run --no-file-parallelism`, `pnpm tsc --noEmit`,
   `pnpm lint` all clean; test count ≥ Sprint 269 baseline 3217 + 4.

## Verification Plan

- Profile: `mixed` — primarily `command`, browser visual informational.
- Required checks:
  1. `pnpm vitest run src/stores/connectionStore.test.ts src/components/workspace/WorkspaceSidebar.test.tsx src/components/layout/MainArea.test.tsx src/components/workspace/firstPaintSkeleton.test.tsx`
  2. `pnpm vitest run --no-file-parallelism` — test count ≥ 3217 + 4.
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
  5. (Optional, non-gating) `pnpm tauri dev` with devtools network throttling
     to observe the skeleton at first paint.
- Required evidence:
  - Diffs of touched files + new files.
  - Test names + `file:line` for each AC-270-NN case.
  - Full output tails of each gating command.
  - Skeleton primitive class-composition verification
    (`animate-pulse rounded-md bg-muted`).
  - Confirmation that `SYNCED_KEYS` does NOT include `hasLoadedOnce`.

## Evidence To Return

- Changed files and purpose (skeleton primitive, store flag, sidebar branch,
  main-area branch, test files).
- Checks run and outcomes (`pnpm vitest run --no-file-parallelism`,
  `pnpm tsc --noEmit`, `pnpm lint` — full tails).
- Done-criteria coverage with concrete evidence (test names, `file:line`).
- Assumptions made during implementation (e.g. inline skeleton sub-component
  vs extraction to its own file).
- Residual risk or verification gaps (e.g. manual browser visual not gated;
  document any browser observation in `findings.md`).

## References

- Contract: `docs/sprints/sprint-270/contract.md`
- Findings: `docs/sprints/sprint-270/findings.md` (Evaluator writes)
- Master spec: `docs/sprints/sprint-268/spec.md` — Sprint 270 section, Visual
  Direction, Sprint 270 edge cases.
- Sprint 175 cold-boot context:
  `~/.claude/projects/-Users-felix-Desktop-study-view-table/memory/sprint_175_cold_boot_results.md`
- Relevant files:
  - `src/App.tsx` (lines 24, 48-57 — `loadConnections()` boot effect).
  - `src/stores/connectionStore.ts` (lines 90-95 `SYNCED_KEYS`, lines
    105-113 `loadConnections`).
  - `src/components/workspace/WorkspaceSidebar.tsx` (lines 48-64
    `connections.length === 0` branch).
  - `src/components/layout/MainArea.tsx` (lines 137-194 `EmptyState`, line
    244 fallback render).
  - `src/components/ui/skeleton.tsx` (to be created).
