# Sprint Contract: sprint-152 — Sync Connection State Across Windows

## Summary

- **Goal**: Wire Sprint 151's bridge into `connectionStore` so the launcher and workspace observe the same `connections`, `groups`, `activeStatuses`, `focusedConnId`. Load-bearing for AC-141-3 (Back preserves pool). Password / sensitive payload keys stay window-local.
- **Audience**: Generator + Evaluator
- **Owner**: harness orchestrator
- **Verification Profile**: `command`

## In Scope

- `src/stores/connectionStore.ts` — opt into the Sprint 151 bridge with an explicit allowlist for synced keys.
- `src/__tests__/cross-window-connection-sync.test.tsx` (new, TDD-first) — assert cross-window sync + sensitive-key redaction.
- `src/stores/connectionStore.test.ts` — extend with a per-key allowlist regression so the broadcast surface cannot silently widen.

## Out of Scope

- Wiring `tabStore` / `mruStore` / `themeStore` / `favoritesStore` / `appShellStore` (Sprint 153).
- Real `WebviewWindow.show()/hide()` lifecycle (Sprint 154).
- Converting `it.todo()` in `window-lifecycle.ac141.test.tsx` (Sprint 155).
- Editing ADR 0011 body or `RISKS.md` RISK-025 (Sprint 155).
- Any production code in `src/pages/*` or `src/components/*` (this sprint is store-only).

## Invariants

- Sprint 150 + 151 outputs unchanged: `tauri.conf.json`, `launcher.rs`, `lib.rs`, `AppRouter.tsx`, `LauncherPage.tsx`, `App.tsx`, `main.tsx`, `window-label.ts`, `window-bootstrap.test.tsx`, `zustand-ipc-bridge.ts/.test.ts`, `window-lifecycle.ac141.test.tsx`.
- Existing `connectionStore.test.ts` cases remain passing.
- `connection-sot.ac142.test.tsx` AC-142-* invariants remain green (Disconnect → pool eviction).
- Total vitest count ≥ Sprint 151's 2260 + N new; 5 todos retained; no new `it.skip` / `it.todo`.
- ADR 0011 body frozen.
- TDD strict: cross-window-sync test authored BEFORE the bridge wiring is applied.

## Acceptance Criteria

- `AC-152-01` — `src/stores/connectionStore.ts` opts into the Sprint 151 bridge with an explicit allowlist that includes `connections`, `groups`, `activeStatuses`, `focusedConnId` and EXCLUDES any password/sensitive/transient keys (e.g. `password` field on connection drafts, in-flight loading flags).
- `AC-152-02` — `src/__tests__/cross-window-connection-sync.test.tsx` exists, was authored BEFORE the wiring, and asserts:
  - (a) mutating `activeStatuses` in a simulated workspace store propagates to the launcher store within the same tick of the mocked event bus;
  - (b) `focusedConnId` writes from the launcher reach the workspace;
  - (c) `password` (or whatever the contract's sensitive key is) is NOT broadcast in either direction;
  - (d) AC-141-3 invariant — when the workspace fires the equivalent of "Back to connections" (i.e. the user-observable signal), the launcher's view of `activeStatuses["c1"].type` reads `connected` and `disconnectFromDatabase` is NOT called.
- `AC-152-03` — TDD ordering: red-state proof captured for the cross-window-sync test (failing-output snapshot saved to `docs/sprints/sprint-152/tdd-evidence/red-state.log` OR two-commit ordering).
- `AC-152-04` — `src/stores/connectionStore.test.ts` extended with a per-key allowlist regression (e.g. `expect(SYNCED_KEYS).toEqual([...])` or equivalent — when someone adds a new field to the store, the test forces them to opt in/out explicitly).
- `AC-152-05` — `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0; total ≥ 2260 + N new; 5 todos retained.
- `AC-152-06` — `connection-sot.ac142.test.tsx` reports same number of passing AC-142-* cases as before this sprint.
- `AC-152-07` — No new `it.skip` / `this.skip()` / `it.todo` / `xit` / `describe.skip` introduced anywhere.

## Design Bar / Quality Bar

- The bridge attachment point should be deterministic — happens at module-load time so both launcher and workspace runtimes auto-attach. (Not lazy / on-demand — would risk one window starting attached and the other not.)
- Allowlist is a top-level constant exported from `connectionStore.ts` (e.g. `export const SYNCED_KEYS: ReadonlyArray<keyof ConnectionState> = [...]`) so the regression test can import it.
- Channel name namespaced (e.g. `connection-sync`) — distinct from future stores.
- Origin id should be the current window label (passed from `getCurrentWindowLabel()`), not random — so the loop guard works deterministically across the two real windows in Sprint 154.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx` — green.
2. `pnpm vitest run src/stores/connectionStore.test.ts` — green (existing cases still pass, allowlist regression added).
3. `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` — green (AC-142-* invariants preserved).
4. `pnpm vitest run` — full suite green; total ≥ 2260 + N new; 5 todos retained.
5. `pnpm tsc --noEmit` — exit 0.
6. `pnpm lint` — exit 0.
7. `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip" src/__tests__/cross-window-connection-sync.test.tsx src/stores/connectionStore.test.ts src/stores/connectionStore.ts` — empty.
8. `git diff HEAD -- <Sprint 150 + 151 outputs>` — empty (nothing in the protected scope changes).
9. Inspect `connectionStore.ts` to confirm allowlist excludes sensitive keys.

### Required Evidence

- Generator must provide:
  - Changed files with one-line purpose.
  - Commands run + outcomes.
  - Per-AC mapping with concrete artifacts.
  - TDD red-state proof (commit ordering OR `tdd-evidence/red-state.log`).
- Evaluator must cite:
  - Concrete evidence per pass/fail decision.
  - Any missing/weak evidence as a finding.

## Test Requirements

### Unit Tests (필수)
- `cross-window-connection-sync.test.tsx`: ≥ 4 cases per AC-152-02 + at least 1 error path (e.g. inbound payload missing required field is ignored).
- `connectionStore.test.ts`: ≥ 1 new allowlist regression case.

### Coverage Target
- Modified `connectionStore.ts`: line coverage ≥ 70% (existing coverage should already be high).

### Scenario Tests (필수)
- [x] Happy path — workspace mutation reaches launcher.
- [x] 에러/예외 — sensitive key not broadcast either direction.
- [x] 경계 조건 — Back-equivalent flow preserves `activeStatuses`.
- [x] 기존 기능 회귀 없음 — AC-142-* + existing connectionStore cases preserved.

## Test Script / Repro Script

1. `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx` — green.
2. `pnpm vitest run src/stores/connectionStore.test.ts` — green.
3. `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` — green.
4. `pnpm vitest run` && `pnpm tsc --noEmit` && `pnpm lint` — all 0.

## Ownership

- Generator: general-purpose Agent.
- Write scope: only the In Scope paths.
- Merge order: 152 must precede 153.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- All 9 required checks passing.
- TDD red-state proof captured.
- No new `it.skip` / `it.todo`.
