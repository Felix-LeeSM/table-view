# Sprint 270 — Evaluator Findings

Date: 2026-05-13
Evaluator: Claude (harness Evaluator role)
Verification profile: `mixed` — gating is `command` (vitest + tsc + lint).
Browser visual: NOT executed (informational-only per contract).

---

## Gating Command Results

| Check | Command | Exit | Result |
|-------|---------|------|--------|
| Targeted vitest (5 files) | `pnpm vitest run --no-file-parallelism src/stores/connectionStore.test.ts src/components/workspace/WorkspaceSidebar.test.tsx src/components/layout/MainArea.test.tsx src/components/ui/skeleton.test.tsx src/components/workspace/firstPaintSkeleton.test.tsx` | 0 | 5 files / 102 tests passed |
| Full vitest | `pnpm vitest run --no-file-parallelism` | 0 | 262 files / **3232 tests** passed (Sprint 269 baseline 3217 → +15, monotonic ≥ +4 required) |
| TypeScript | `pnpm tsc --noEmit` | 0 | Clean — no diagnostics |
| ESLint | `pnpm lint` | 0 | Clean — 0 errors, 0 warnings |

All four gating checks pass.

---

## Sprint 270 Evaluation Scorecard (system rubric)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | `hasLoadedOnce` initialised `false` at `connectionStore.ts:112`, flipped to `true` in BOTH branches of `loadConnections` (success at L123, error at L125). `SYNCED_KEYS` (L99-104) audit-fixed to `[connections, groups, activeStatuses, focusedConnId]` only — `hasLoadedOnce` confirmed absent. `Skeleton` primitive (`src/components/ui/skeleton.tsx`) matches the shadcn canonical class-composition exactly. Sidebar gate at `WorkspaceSidebar.tsx:50-58` is the contract's two-step `if (connections.length === 0) { if (!hasLoadedOnce) return <Skeleton/>; … existing empty card … }`. MainArea fallback at `MainArea.tsx:272-275` is the contract's `hasLoadedOnce ? <EmptyState /> : <MainAreaSkeleton />` ternary at the no-active-tab branch only — table/query tab branches untouched. `EmptyState` and post-hydrate empty-card JSX byte-equivalent. |
| Completeness | 9/10 | All 5 Done Criteria + all 5 AC-270-NN pinned by tests. AC-270-01 at `WorkspaceSidebar.test.tsx:127`; AC-270-02 at `MainArea.test.tsx:199`; AC-270-03 swap-order in 3 cases at `firstPaintSkeleton.test.tsx:112` (sidebar→empty), `:147` (main→EmptyState), `:182` (error branch); AC-270-04 at `WorkspaceSidebar.test.tsx:147` + `:159` (remount) and `MainArea.test.tsx:219` (remount). `hasLoadedOnce` flag covered at `connectionStore.test.ts:826-856` (initial/success/error flips) plus the SYNCED_KEYS allowlist regression at `:813-815`. Test count delta is +15 vs the Sprint 269 baseline of 3217 (≥ +4 minimum). |
| Reliability | 9/10 | Error-branch flip explicitly tested (`connectionStore.test.ts:840` and the rejecting swap-order case in `firstPaintSkeleton.test.tsx:182`) — skeleton can never get stuck shimmering after a backend failure. Swap-order tests assert "No connections yet" is NOT present at `t=0` before the deferred promise resolves, killing the visual-flash bug this sprint targets. Post-hydrate remount cases prove the selector reads the live flag, not a captured-at-mount snapshot. No `unwrap()` / `any` / `console.log` in any touched file (verified via grep). `setupStore`/`setConnections` helpers default `hasLoadedOnce: true` to keep 50+ pre-existing tests green; pre-hydrate tests explicitly opt in with `hasLoadedOnce: false` (justified inline in the helper JSDocs). |
| Verification Quality | 9/10 | Generator's evidence packet matches the actual repo state — every claimed `file:line` was verified. Test files include the sprint id annotation "Sprint 270 (2026-05-13)" before each new case. `data-testid="workspace-sidebar-skeleton"` / `main-area-skeleton` chosen deliberately because `role="status"` is shared with the existing empty cards; documented in the test file and the component JSDoc. Skeleton primitive's class composition is locked by 3 dedicated unit cases at `skeleton.test.tsx:12-45`. The full vitest run is included (3232 tests passed, no skipped). Only minor gap: no manual browser screenshot — but the contract marks that as informational, non-gating. |
| **Overall** | **9/10** | |

## Verdict: PASS

All gating checks green. Every Done Criterion and AC-270-NN has both code and a regression test that pin it. Out-of-scope items (Sprint 271 backend, measured cold-boot AC, `loading` semantic change, `SYNCED_KEYS` widening, schema-tree skeletons in `RdbSidebar`/`DocumentSidebar`) are not touched.

---

## Sprint Contract Status (Done Criteria)

- [x] **DC-1: Skeleton primitive at `src/components/ui/skeleton.tsx`** — named export `Skeleton` with body `<div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />` at `skeleton.tsx:13-23`. Class composition pinned by `skeleton.test.tsx:12-20`.
- [x] **DC-2: `hasLoadedOnce` flag** — initialised `false` at `connectionStore.ts:112`; flipped to `true` on both success (`:123`) and error (`:125`) branches of `loadConnections`. `SYNCED_KEYS` unchanged — pinned by `connectionStore.test.test.ts:813-815`.
- [x] **DC-3: Sidebar pre-hydrate branch** — at `WorkspaceSidebar.tsx:50-58`. Skeleton renders 4 stacked rows (`h-8 w-full` / `h-8 w-4/5`, vertically gapped) at `:163-178`. Empty card byte-equivalent at `:59-72`. Pinned by `WorkspaceSidebar.test.tsx:127`.
- [x] **DC-4: Main-area pre-hydrate branch** — at `MainArea.tsx:272-275`. Skeleton shape (`h-20 w-20` logo + `h-4 w-3/5` + `h-4 w-2/5` + `h-8 w-32` button) at `:145-160`. `EmptyState` byte-equivalent at `:162-219`. Pinned by `MainArea.test.tsx:199`.
- [x] **DC-5: Swap-order vitest** — `firstPaintSkeleton.test.tsx:112` (sidebar happy), `:147` (main happy), `:182` (rejection). Each uses a deferred-resolve `listConnections` mock and asserts the absence of "No connections yet" / `EmptyState` at t=0 plus presence after `resolveList`/`rejectList`.
- [x] **DC-6: Post-hydrate non-re-render** — `WorkspaceSidebar.test.tsx:159` and `MainArea.test.tsx:219` both unmount/remount with `hasLoadedOnce=true` and reassert skeleton absence.
- [x] **DC-7: Gating checks clean** — see "Gating Command Results" above. Test count 3232 ≥ 3217 + 4.

## Required Evidence Citations (per contract)

1. **`hasLoadedOnce` declaration + flip sites** — `src/stores/connectionStore.ts:38` (typedef), `:112` (initial `false`), `:123` (success flip), `:125` (error flip).
2. **Sidebar pre-hydrate branch** — `src/components/workspace/WorkspaceSidebar.tsx:50-58` (decision), `:163-178` (`WorkspaceSidebarSkeleton` JSX).
3. **Main-area pre-hydrate branch** — `src/components/layout/MainArea.tsx:272-275` (decision), `:145-160` (`MainAreaSkeleton` JSX).
4. **Swap-order vitest + no-flash assertion** — `src/components/workspace/firstPaintSkeleton.test.tsx:131` (`queryByText(/no connections yet/i)).toBeNull()` at t=0), `:140-141` (post-resolve inversion).
5. **`SYNCED_KEYS` does NOT include `hasLoadedOnce`** — `src/stores/connectionStore.ts:99-104` (array is exactly `[connections, groups, activeStatuses, focusedConnId]`); regression-locked at `src/stores/connectionStore.test.ts:813-815`.

---

## Code Review Observations

Positive:
- Skeleton primitive is the canonical shadcn shape — no surface-area drift.
- `hasLoadedOnce` is genuinely runtime-only: not in `SYNCED_KEYS`, not in `persistFocusedConnId`/`persistActiveStatuses`, not in any localStorage path.
- Skeleton sub-components inlined in their parents (single use, < 20 lines) per the contract's "Generator picks based on what keeps the parent readable" — appropriate given they are not reusable elsewhere.
- `role="status"` + `aria-busy="true"` + `aria-label` on each skeleton container — matches the accessibility bar of the existing empty/error cards.
- `setupStore`/`setConnections` helpers default `hasLoadedOnce: true` with an inline JSDoc explaining why (50+ pre-existing post-hydrate tests). New pre-hydrate cases explicitly opt in to `false`.
- Loadbearing WHY comments at `connectionStore.ts:30-37` (flag rationale), `:119-122` (dual-branch flip rationale), `WorkspaceSidebar.tsx:51-55` (sidebar pre-hydrate rationale), `MainArea.tsx:226-228` (gating rationale), `MainAreaSkeleton`/`WorkspaceSidebarSkeleton` JSDocs (visual contract + reflow reasoning).

Minor observations (no action required, all within contract tolerance):
- The error-branch swap-order test asserts `getByText(/no connections yet/i)` post-rejection. That's correct for the current contract: the sidebar's branch is keyed off `connections.length === 0` only, and the store records the error separately. If a future iteration wants to surface an error-specific card instead, the assertion will need to follow.
- `firstPaintSkeleton.test.tsx:162` uses `queryByAltText("Table View")` to confirm the `EmptyState` logo wordmark is absent at t=0. That's a stable selector — the logo's alt text is locked in `LogoWordmark`.

## Anti-Patterns Audit (per evaluator prompt)

- Self-praise bias: not detected — every positive scoring entry above cites a specific `file:line`.
- Generic UI aesthetic: skeleton uses the shadcn primitive verbatim per spec "Visual Direction"; design bar pinned by the class-composition test. Not generic — explicit.
- Missing states: pre-hydrate (skeleton), post-hydrate happy (empty card / EmptyState), post-hydrate error, post-hydrate remount all covered.
- Over-engineering: no animation tuning, no `prefers-reduced-motion` override (default `animate-pulse` handles this at the browser level per contract Out-of-Scope #3), no extracted-file skeleton component, no schema-tree skeleton extension. Within scope.
- Under-engineering: no placeholder text, no `// TODO`. Generator-produced code is production-grade.
- Tiny detail misses: confirmed `aria-busy="true"` (string, not boolean attribute — matches existing convention), confirmed the 4 sidebar rows (`w-full`/`w-4/5` alternating per spec Visual Direction), confirmed `h-20 w-20` logo block per AC-270-02 spec.

## Handoff Summary (for handoff.md)

- Sprint id: 270
- Status: COMPLETE — PASS
- Open P1/P2 findings: 0
- Required checks: vitest targeted (5/5 files, 102/102 tests), vitest full (262 files, 3232 tests), `pnpm tsc --noEmit` clean, `pnpm lint` clean — all green.
- Test count delta from Sprint 269 baseline (3217): +15 (≥ +4 required).
- ADR drift: none (per spec global AC #2).
- SYNCED_KEYS audit: unchanged — `hasLoadedOnce` confirmed absent, pinned by regression test.
- Next sprint: Sprint 271 — propagate `expected_database` guard to remaining RDB commands.
