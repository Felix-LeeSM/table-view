# Sprint Execution Brief: sprint-151 — Cross-Window State Bridge

## Objective

Ship a generic Zustand-over-Tauri-events bridge primitive (`src/lib/zustand-ipc-bridge.ts`) with a TDD-locked contract: per-channel broadcast + listen with deterministic loop guard and explicit per-key allowlist. NO production store wiring this sprint.

## Task Why

Sprints 152–153 will sync 5–6 production stores across launcher and workspace windows; without this primitive each store would re-derive (and accidentally vary) the loop-guard, allowlist, and event-name conventions. Locking the contract once with a comprehensive test file keeps later sprints to a one-line opt-in per store.

## Scope Boundary

- **DO**: ship `src/lib/zustand-ipc-bridge.ts` + `src/lib/zustand-ipc-bridge.test.ts`; modify `src/test-setup.ts` ONLY if a shared event-bus mock is needed for cross-store-in-same-process tests.
- **DO NOT**: opt in any store under `src/stores/`; touch `connectionStore`/`tabStore`/`mruStore`/`themeStore`/`favoritesStore`/`appShellStore`; change Sprint 150 outputs (`launcher.rs`, `LauncherPage.tsx`, `AppRouter.tsx`, `tauri.conf.json`); edit `window-lifecycle.ac141.test.tsx`; edit ADR 0011 body or `RISKS.md` RISK-025.

## Invariants

- 2248 + 5 todo from Sprint 150 baseline preserved.
- ADR 0011 body frozen.
- TS strict; lint clean.
- `grep -rE "zustandIpcBridge|zustand-ipc-bridge" src/stores/` is empty after this sprint.
- TDD strict: test file authored + observed failing BEFORE the production module.

## Done Criteria

1. `src/lib/zustand-ipc-bridge.ts` exposes the broadcast + listen primitive with loop guard + per-key allowlist enforced at the bridge layer.
2. `src/lib/zustand-ipc-bridge.test.ts` has ≥ 4 contract cases (local→emit, inbound→no re-emit, allowlist filter both directions, two-store convergence) + at least 1 error-path case.
3. JSDoc/header documents sync-safe vs window-local key contract.
4. TDD red-then-green proof (separate commits or captured output).
5. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0; total ≥ 2248 + new tests; 5 todos retained.
6. No production store call sites; no skips/todos introduced.

## Verification Plan

- **Profile**: command
- **Required checks**:
  1. `pnpm vitest run src/lib/zustand-ipc-bridge.test.ts` — green.
  2. `pnpm vitest run` — green; total ≥ 2248 + N new.
  3. `pnpm tsc --noEmit` — 0.
  4. `pnpm lint` — 0.
  5. `grep -rE "zustandIpcBridge|zustand-ipc-bridge" src/stores/` — empty.
  6. `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip" src/lib/zustand-ipc-bridge.test.ts src/lib/zustand-ipc-bridge.ts` — empty.
  7. Inspect bridge module for JSDoc contract documentation.
- **Required evidence**: per-AC mapping, command outcomes, TDD ordering proof.

## Evidence To Return

- Changed files + purpose.
- Commands run + outcomes.
- AC-151-01..06 mapping with concrete artifacts.
- TDD ordering proof (commit ordering OR pre-implementation failing output snapshot).
- Assumptions made.
- Residual risks.

## References

- Contract: `docs/sprints/sprint-151/contract.md`
- Master spec: `docs/sprints/sprint-150/spec.md` (Sprint 151 section)
- Phase 11 closing findings (still authoritative for store list): `docs/sprints/sprint-149/findings.md`
- Sprint 150 outputs (must not regress): `docs/sprints/sprint-150/handoff.md`
- Conventions: `memory/conventions/memory.md`
- Skip-zero gate: `memory/lessons/2026-04-27-phase-end-skip-accountability-gate/memory.md`
