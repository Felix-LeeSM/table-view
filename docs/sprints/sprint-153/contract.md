# Sprint Contract: sprint-153 — Sync Remaining Shared Stores

## Summary

- **Goal**: Apply the Sprint 151 bridge to `tabStore`, `mruStore`, `themeStore`, `favoritesStore` with per-store allowlists and channel names. Decide and lock the fate of `appShellStore.screen` (deprecate or window-scope).
- **Audience**: Generator + Evaluator
- **Owner**: harness orchestrator
- **Verification Profile**: `command`

## In Scope

- `src/stores/tabStore.ts` — opt in (workspace-only sync semantics — see Design Bar).
- `src/stores/mruStore.ts` — opt in.
- `src/stores/themeStore.ts` — opt in.
- `src/stores/favoritesStore.ts` — opt in.
- `src/stores/appShellStore.ts` — deprecate or window-scope `screen`.
- `src/__tests__/cross-window-store-sync.test.tsx` (new, TDD-first) — cross-window sync per store + allowlist enforcement + appShell handling.
- Each opted-in store's `*.test.ts` — extend with a `SYNCED_KEYS` membership regression mirroring Sprint 152's pattern.

## Out of Scope

- Real `WebviewWindow.show()/hide()` lifecycle (Sprint 154).
- Converting `it.todo()` in `window-lifecycle.ac141.test.tsx` (Sprint 155).
- Editing ADR 0011 body or `RISKS.md` RISK-025 (Sprint 155).
- Any production code in `src/pages/*` or `src/components/*` (this sprint is store-only).
- Re-touching `connectionStore.ts` (Sprint 152 final).

## Invariants

- Sprint 150 / 151 / 152 outputs unchanged: `tauri.conf.json`, `launcher.rs`, `lib.rs`, `AppRouter.tsx`, `LauncherPage.tsx`, `App.tsx`, `main.tsx`, `window-label.ts`, `window-bootstrap.test.tsx`, `zustand-ipc-bridge.ts/.test.ts`, `connectionStore.ts`, `connectionStore.test.ts`, `cross-window-connection-sync.test.tsx`, `window-lifecycle.ac141.test.tsx`.
- Existing tests on each opted-in store remain passing.
- `connection-sot.ac142.test.tsx` AC-142-* invariants remain green.
- Total vitest count ≥ Sprint 152's 2271 + N new; 5 todos retained; no new `it.skip` / `it.todo`.
- ADR 0011 body frozen.
- TDD strict: cross-window test authored BEFORE the wirings.

## Acceptance Criteria

- `AC-153-01` — `tabStore.ts` opts into the bridge with channel `"tab-sync"`. **Workspace-only semantics**: tabs must NOT bleed into the launcher's runtime. Achieved via origin filtering, allowlist, or by attaching the bridge only when `getCurrentWindowLabel() === "workspace"`. The chosen approach is explicit and tested.
- `AC-153-02` — `mruStore.ts` opts into the bridge with channel `"mru-sync"`. MRU updates triggered by either window converge in both.
- `AC-153-03` — `themeStore.ts` opts into the bridge with channel `"theme-sync"`. Theme changes from launcher reach workspace and vice versa.
- `AC-153-04` — `favoritesStore.ts` opts into the bridge with channel `"favorites-sync"`. Favorite toggles converge.
- `AC-153-05` — `appShellStore.ts` decision is recorded in code: either (a) the `screen` field is removed entirely, or (b) it is narrowed to a window-scoped sentinel that no longer drives top-level routing AND is documented as deprecated. Grep `useAppShellStore.*screen` outside of test seams returns no top-level routing usage in production code.
- `AC-153-06` — Each opted-in store exports a `SYNCED_KEYS` constant; each store's `*.test.ts` has a regression test asserting exact membership.
- `AC-153-07` — `src/__tests__/cross-window-store-sync.test.tsx` (or per-store equivalents) covers: per-store sync direction, allowlist filtering, error path (malformed payload), and tab-store workspace-only semantics.
- `AC-153-08` — TDD ordering: red-state proof captured (`docs/sprints/sprint-153/tdd-evidence/red-state.log` OR commit ordering).
- `AC-153-09` — `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0; total ≥ 2271 + N new; 5 todos retained.
- `AC-153-10` — `connection-sot.ac142.test.tsx` reports same number of passing AC-142-* cases as before this sprint.
- `AC-153-11` — No new `it.skip` / `this.skip()` / `it.todo` / `xit` / `describe.skip` introduced anywhere.

## Design Bar / Quality Bar

- Each store gets its OWN channel name (`<store>-sync`) — distinct so a malformed payload on one channel cannot pollute another store.
- `tabStore` workspace-only — pick ONE explicit mechanism and document it in code comment. Two acceptable approaches:
  - (A) Attach guard: `if (getCurrentWindowLabel() === "workspace") attachZustandIpcBridge(...)`.
  - (B) Origin filter: bridge attaches in both windows but inbound filter rejects non-workspace origins. (Higher complexity, not preferred for this sprint.)
- `themeStore` and `favoritesStore` are launcher+workspace symmetric — straight bridge attach.
- `mruStore` is symmetric.
- `appShellStore.screen` deprecation: prefer removal over keep-and-deprecate when feasible. If kept, write a one-line comment explaining why and Sprint 154's plan.
- Each `SYNCED_KEYS` is a top-level readonly export with brief inline justification per included/excluded key.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx` — green.
2. `pnpm vitest run src/stores/tabStore.test.ts src/stores/mruStore.test.ts src/stores/themeStore.test.ts src/stores/favoritesStore.test.ts src/stores/appShellStore.test.ts` — green.
3. `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` — green.
4. `pnpm vitest run` — full suite green; total ≥ 2271 + N new; 5 todos retained.
5. `pnpm tsc --noEmit` — exit 0.
6. `pnpm lint` — exit 0.
7. `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip" <touched files>` — empty.
8. `git diff HEAD -- <Sprint 150/151/152 outputs>` — empty.
9. `grep -rE "attachZustandIpcBridge" src/stores/` — exactly 5 files (`connectionStore.ts`, `tabStore.ts`, `mruStore.ts`, `themeStore.ts`, `favoritesStore.ts`).
10. Inspect each store for `SYNCED_KEYS` export.
11. Verify `appShellStore.screen` decision: either gone or window-scoped + documented.

### Required Evidence

- Generator must provide:
  - Changed files with one-line purpose.
  - Commands run + outcomes.
  - Per-AC mapping.
  - TDD red-state proof.
- Evaluator must cite:
  - Concrete evidence per pass/fail.
  - Any missing/weak evidence as a finding.

## Test Requirements

### Unit Tests (필수)
- `cross-window-store-sync.test.tsx`: ≥ 1 case per store + 1 allowlist negation case + 1 error-path case + 1 tab-store workspace-only case.
- Per-store `SYNCED_KEYS` regression: 1 case each.

### Coverage Target
- Modified stores: line coverage ≥ 70%.

### Scenario Tests (필수)
- [x] Happy path — symmetric sync for theme/mru/favorites.
- [x] 에러/예외 — malformed payload ignored.
- [x] 경계 조건 — tab workspace-only, allowlist filter.
- [x] 기존 기능 회귀 없음 — AC-142-* + existing per-store cases preserved.

## Test Script / Repro Script

1. `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx` — green.
2. `pnpm vitest run src/stores/` — green.
3. `pnpm vitest run` && `pnpm tsc --noEmit` && `pnpm lint` — all 0.

## Ownership

- Generator: general-purpose Agent.
- Write scope: only the In Scope paths.
- Merge order: 153 must precede 154.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- All 11 required checks passing.
- TDD red-state proof captured.
- No new `it.skip` / `it.todo`.
