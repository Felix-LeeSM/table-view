# Sprint Execution Brief: sprint-152 — Sync Connection State Across Windows

## Objective

Wire Sprint 151's `attachZustandIpcBridge` into `connectionStore` with an explicit allowlist (`connections`, `groups`, `activeStatuses`, `focusedConnId`) and a TDD-locked cross-window sync test. Sensitive keys (passwords, drafts, in-flight flags) must NOT broadcast.

## Task Why

This sprint closes AC-141-3 — when the user clicks "Back to connections" in the workspace, the launcher's view of the connection still reads `connected` (no reconnect cost). Without cross-window sync of `activeStatuses` + `focusedConnId`, the two windows would diverge the moment Sprint 154 wires real `WebviewWindow.show()/hide()`.

## Scope Boundary

- **DO**: opt `connectionStore` into the bridge (single attach call, deterministic at module load); export a `SYNCED_KEYS` constant; add `cross-window-connection-sync.test.tsx`; extend `connectionStore.test.ts` with an allowlist regression.
- **DO NOT**: wire other stores; touch `tabStore`/`mruStore`/`themeStore`/`favoritesStore`/`appShellStore`; modify Sprint 150/151 outputs; modify `window-lifecycle.ac141.test.tsx`; edit ADR 0011 body or `RISKS.md`; touch any `src/pages/*` or `src/components/*`.

## Invariants

- 2260 + 5 todo from Sprint 151 baseline preserved.
- `connection-sot.ac142.test.tsx` AC-142-* invariants remain green.
- Sprint 150 + 151 outputs unchanged (`git diff HEAD <files>` empty).
- ADR 0011 body frozen.
- TS strict; lint clean.
- TDD strict — sync test authored + observed failing BEFORE the wiring.

## Done Criteria

1. `connectionStore.ts` opts into the bridge with an exported `SYNCED_KEYS` allowlist that includes the four synced keys and EXCLUDES sensitive/transient keys.
2. `cross-window-connection-sync.test.tsx` covers AC-152-02 (a)–(d) + ≥ 1 error path.
3. `connectionStore.test.ts` has a regression that imports `SYNCED_KEYS` and asserts its exact membership (so future contributors must explicitly add or exclude new keys).
4. TDD red-state proof captured (preferred: `docs/sprints/sprint-152/tdd-evidence/red-state.log`).
5. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0; total ≥ 2260 + N new; 5 todos retained.
6. `git diff HEAD <Sprint 150/151 outputs>` empty.
7. AC-142-* invariants green.

## Verification Plan

- **Profile**: command
- **Required checks**:
  1. `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx` — green.
  2. `pnpm vitest run src/stores/connectionStore.test.ts` — green.
  3. `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` — green.
  4. `pnpm vitest run` — green.
  5. `pnpm tsc --noEmit` — 0.
  6. `pnpm lint` — 0.
  7. `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip" <touched files>` — empty.
  8. `git diff HEAD <protected scope>` — empty.
  9. Inspect allowlist constant.
- **Required evidence**: per-AC mapping + TDD red-state proof.

## Evidence To Return

- Changed files + purpose.
- Commands run + outcomes.
- AC-152-01..07 mapping with concrete artifacts.
- TDD ordering proof.
- Assumptions made.
- Residual risks.

## References

- Contract: `docs/sprints/sprint-152/contract.md`
- Master spec: `docs/sprints/sprint-150/spec.md` (Sprint 152 section)
- Sprint 151 bridge module + tests: `src/lib/zustand-ipc-bridge.ts/.test.ts`
- Bridge handoff: `docs/sprints/sprint-151/handoff.md`, `findings.md`
- Existing store: `src/stores/connectionStore.ts`, `src/stores/connectionStore.test.ts`
- AC-142 invariants: `src/__tests__/connection-sot.ac142.test.tsx`
- Window label resolver: `src/lib/window-label.ts`
- Conventions: `memory/conventions/memory.md`
- Skip-zero gate: `memory/lessons/2026-04-27-phase-end-skip-accountability-gate/memory.md`
