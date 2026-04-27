# Sprint Execution Brief: sprint-153 — Sync Remaining Shared Stores

## Objective

Wire `attachZustandIpcBridge` into `tabStore` (workspace-only), `mruStore`, `themeStore`, `favoritesStore` with per-store channels and allowlists. Decide+lock the fate of `appShellStore.screen` (prefer removal). Each store exports `SYNCED_KEYS`; each `*.test.ts` gains a membership regression mirroring Sprint 152.

## Task Why

Sprint 154 wires real `WebviewWindow.show()/hide()`; without the rest of the shared stores synced, the launcher and workspace will diverge — wrong tabs, stale theme, missing favorites/MRU updates. `appShellStore.screen` becomes redundant once real windows take over routing.

## Scope Boundary

- **DO**: opt 4 stores into the bridge with the channel and allowlist scheme below; export `SYNCED_KEYS` from each; add per-store regressions; add `cross-window-store-sync.test.tsx`; deprecate-or-remove `appShellStore.screen`.
- **DO NOT**: re-touch `connectionStore` (Sprint 152 final); modify Sprint 150/151 outputs; touch `src/pages/*` or `src/components/*`; touch `window-lifecycle.ac141.test.tsx`; edit ADR 0011 body or `RISKS.md`.

## Invariants

- 2271 + 5 todo from Sprint 152 baseline preserved.
- Sprint 150/151/152 outputs unchanged.
- AC-142-* invariants green.
- TS strict; lint clean.
- TDD strict — sync test authored + observed failing BEFORE wirings.

## Done Criteria

1. Four stores opt in (tab/mru/theme/favorites) with channel names `tab-sync` / `mru-sync` / `theme-sync` / `favorites-sync`.
2. `tabStore` workspace-only via attach guard `if (getCurrentWindowLabel() === "workspace")` — explicit and tested.
3. Each opted-in store exports `SYNCED_KEYS`; each `*.test.ts` has a membership regression.
4. `appShellStore.screen` either removed or window-scoped + documented; no production top-level routing on it.
5. `cross-window-store-sync.test.tsx` covers per-store sync, allowlist filter, error path, tab workspace-only.
6. TDD red-state proof captured at `docs/sprints/sprint-153/tdd-evidence/red-state.log`.
7. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0; total ≥ 2271 + N new; 5 todos retained.
8. `git diff HEAD <Sprint 150/151/152 outputs>` empty.
9. `grep attachZustandIpcBridge src/stores/` returns exactly 5 files.

## Verification Plan

- **Profile**: command
- **Required checks**:
  1. `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx` — green.
  2. `pnpm vitest run src/stores/{tabStore,mruStore,themeStore,favoritesStore,appShellStore}.test.ts` — green.
  3. `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` — green.
  4. `pnpm vitest run` — green.
  5. `pnpm tsc --noEmit` && `pnpm lint` — 0.
  6. Skip-grep on touched files — empty.
  7. `git diff HEAD <Sprint 150/151/152 protected scope>` — empty.
  8. `grep attachZustandIpcBridge src/stores/` — exactly 5 files.
  9. Each store inspected for `SYNCED_KEYS` export.
  10. `appShellStore.screen` decision recorded in code.
- **Required evidence**: per-AC mapping + TDD red-state proof.

## Evidence To Return

- Changed files + purpose.
- Commands run + outcomes.
- AC-153-01..11 mapping.
- TDD ordering proof.
- Assumptions made.
- Residual risks.

## References

- Contract: `docs/sprints/sprint-153/contract.md`
- Master spec: `docs/sprints/sprint-150/spec.md` (Sprint 153 section)
- Sprint 151 bridge primitive: `src/lib/zustand-ipc-bridge.ts`, `.test.ts`
- Sprint 152 wiring template: `src/stores/connectionStore.ts` (lines 111–152, 398–405), `src/__tests__/cross-window-connection-sync.test.tsx`
- Sprint 152 findings (advisories): `docs/sprints/sprint-152/findings.md`
- Stores to opt in: `src/stores/{tabStore,mruStore,themeStore,favoritesStore,appShellStore}.ts`
- Conventions: `memory/conventions/memory.md`
- Skip-zero gate: `memory/lessons/2026-04-27-phase-end-skip-accountability-gate/memory.md`
