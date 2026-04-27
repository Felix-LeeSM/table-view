# Sprint Contract: sprint-151 — Cross-Window State Bridge

## Summary

- **Goal**: Introduce a generic Zustand-over-Tauri-events bridge so a state mutation in one window propagates to the other. Lock the contract via TDD-first tests. NO production store wired this sprint — harness only.
- **Audience**: Generator + Evaluator
- **Owner**: harness orchestrator
- **Verification Profile**: `command`

## In Scope

- `src/lib/zustand-ipc-bridge.ts` (new) — broadcast-and-listen primitive with loop guard and per-key allowlist.
- `src/lib/zustand-ipc-bridge.test.ts` (new, TDD-first) — contract tests.
- `src/test-setup.ts` (modify if needed) — shared mock for `@tauri-apps/api/event` so two stores in the same test process can exchange events.

## Out of Scope

- Wiring any production store (`connectionStore`, `tabStore`, `mruStore`, `themeStore`, `favoritesStore`, `appShellStore`) to the bridge — Sprints 152–153.
- Real `WebviewWindow.show()/hide()` lifecycle — Sprint 154.
- Converting `it.todo()` in `window-lifecycle.ac141.test.tsx` — Sprint 155.
- Editing ADR 0011 body or `RISKS.md` RISK-025 row — Sprint 155.

## Invariants

- Existing 2248 vitest tests + 5 todos must remain green/pending. Total ≥ 2248 + new bridge tests.
- TS strict; lint clean.
- ADR 0011 body frozen.
- TDD strict: bridge tests authored BEFORE the bridge module.
- No production store call sites added — `grep "zustandIpcBridge\|zustand-ipc-bridge" src/stores/` returns empty after this sprint.
- Sprint 150 invariants preserved: launcher/workspace `tauri.conf.json` entries, `LauncherPage`, `AppRouter`, `launcher.rs` module remain intact.

## Acceptance Criteria

- `AC-151-01` — `src/lib/zustand-ipc-bridge.ts` exports a function that, given a Zustand store + a stable channel name + an allowlist of synced keys, broadcasts state diffs over Tauri events and applies inbound events without re-broadcasting (loop guard).
- `AC-151-02` — `src/lib/zustand-ipc-bridge.test.ts` has at minimum these cases: (a) local `setState` on synced key triggers exactly one outbound emit; (b) inbound emit applies to local state and does NOT re-emit; (c) keys NOT in the allowlist (e.g. `password`) are not broadcast on either direction; (d) two stores attached to the same channel name in different "windows" (simulated) converge after a write on either side.
- `AC-151-03` — TDD ordering: bridge test file created and observed failing BEFORE the module ships. Captured via either two commits (test red commit before code green commit) or a clear note in the handoff with the failing-output snapshot.
- `AC-151-04` — Bridge module documents (via JSDoc or top-of-file comment) the contract: which kinds of keys are sync-safe (e.g. plain JSON-serializable values) vs window-local (e.g. ephemeral UI state).
- `AC-151-05` — `grep -rE "zustandIpcBridge|zustand-ipc-bridge" src/stores/` returns empty (no production wiring this sprint).
- `AC-151-06` — `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0; total tests ≥ 2248 + new bridge tests; 5 todos retained; no new `it.skip` / `it.todo` introduced.

## Design Bar / Quality Bar

- The bridge must work with a **mocked event bus** in tests so two stores can exchange events without a real Tauri runtime.
- Loop guard must be deterministic — not "best-effort with a counter" but a clear flag/origin-id pattern.
- Allowlist enforcement is at the bridge layer, not at the call-site — so future stores can't accidentally widen the broadcast surface by passing extra keys.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/lib/zustand-ipc-bridge.test.ts` — green; covers 4 contract behaviors above.
2. `pnpm vitest run` — full suite green; total ≥ 2248 + N new; 5 todos retained.
3. `pnpm tsc --noEmit` — exit 0.
4. `pnpm lint` — exit 0.
5. `grep -rE "zustandIpcBridge|zustand-ipc-bridge" src/stores/` — empty.
6. `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip" src/lib/zustand-ipc-bridge.test.ts src/lib/zustand-ipc-bridge.ts` — empty.
7. Inspect bridge module — confirm JSDoc/header documents the sync-safe vs window-local key contract.

### Required Evidence

- Generator must provide:
  - Changed files with one-line purpose each.
  - All 7 commands above with PASS/FAIL outcomes.
  - Per-AC mapping with concrete artifacts.
  - TDD red-then-green ordering proof (commit ordering OR captured failing output).
- Evaluator must cite:
  - Concrete evidence per pass/fail decision.
  - Any missing/weak evidence as a finding.

## Test Requirements

### Unit Tests (필수)
- `zustand-ipc-bridge.test.ts`: at minimum 4 `it()` cases per AC-151-02, plus at least one error-path case (e.g. malformed inbound payload ignored).

### Coverage Target
- New code (`zustand-ipc-bridge.ts`): line coverage ≥ 70%.

### Scenario Tests (필수)
- [x] Happy path — local set → outbound emit.
- [x] 에러/예외 — inbound emit re-broadcast suppressed; malformed payload ignored.
- [x] 경계 조건 — key not in allowlist, two-store convergence.
- [x] 기존 기능 회귀 없음 — Sprint 150's 2248 + 5 todo preserved.

## Test Script / Repro Script

1. `pnpm vitest run src/lib/zustand-ipc-bridge.test.ts` — new test file passes.
2. `pnpm vitest run` — full suite green.
3. `pnpm tsc --noEmit` && `pnpm lint` — both 0.
4. `grep -rE "zustandIpcBridge|zustand-ipc-bridge" src/stores/` — empty.

## Ownership

- Generator: general-purpose Agent.
- Write scope: paths in "In Scope" only.
- Merge order: 151 must precede 152.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- All 7 required checks passing.
- TDD ordering documented.
- No new `it.skip` / `it.todo`.
