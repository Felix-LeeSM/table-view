# Sprint 151 — Evaluator Findings

## Sprint 151 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** (35%) | 9/10 | Loop guard is genuinely deterministic — origin-id self-echo drop (`envelope.origin === originId`) is the primary mechanism, with `applyingInbound` flag as the in-process belt-and-suspenders. Try/finally restores the previous flag value (re-entrant safe). Allowlist enforcement is at the bridge layer (`pickAllowlisted` outbound, `filterInboundState` inbound) — a future store cannot widen the broadcast surface by passing extra keys. Malformed payload path (`validateEnvelope`) defends against null, non-object, missing `origin`, missing/non-object/array `state` — silently returns `null` and the caller short-circuits with no throw. Two-store convergence test (`AC-151-02d`) genuinely uses a module-scoped `Map`-based bus shared by both `vi.mock` consumers; distinct origin ids `winA`/`winB` and distinct stores route through one bus, exactly mirroring the two-window topology. `crypto.randomUUID()` is guarded with feature-detect + `Math.random/Date.now` fallback. No `any` in production module surface; `unknown` used at the IPC boundary and narrowed via `validateEnvelope`. |
| **Completeness** (25%) | 9/10 | All 6 ACs satisfied. AC-151-02 demanded ≥4 contract cases + 1 error path; the test file ships 12 cases covering local→emit, inbound→no re-emit (twice), allowlist outbound (clean + mixed), allowlist inbound (clean + mixed), two-store convergence, no-op write skip, malformed payload (6 shapes in one block), self-origin echo drop, and dispose tear-down. JSDoc/header (`zustand-ipc-bridge.ts:1–63`) explicitly documents all four contracts: sync-safe key shape (JSON-serialisable, immutable, secret-free), window-local key categories, loop-guard mechanism (origin-id + applyingInbound + try/finally), and why-allowlist (defaults to "window-local" so new fields don't accidentally broadcast). Sprint 150 outputs untouched (verified `git diff HEAD` empty across all 10 files). `src/test-setup.ts` deliberately unmodified — mock colocated with test file via `vi.mock`. |
| **Reliability** (20%) | 8/10 | Subscribe correctly tracked and `unsubscribeStore()` + `unlisten()` both called in dispose; the dispose test confirms no further outbound emits after tear-down. `emit` errors swallowed with documented justification (best-effort: a failed emit means the next mutation retries; no state corruption). `lastBroadcast` is updated on inbound apply too, so a local "revert to inbound value" doesn't spuriously re-emit. Minor residual: dispose ordering is `unsubscribeStore` then `unlisten` — a remote event arriving between those two calls could still hit `setState` on the not-yet-disposed listener. Generator self-flagged this in the handoff; harmless because the outbound subscriber is already gone, but worth fixing in Sprint 152 by reversing the order (unlisten first). Not blocking. |
| **Verification Quality** (20%) | 9/10 | All 7 verification commands re-run by evaluator and confirmed PASS:<br>1. `pnpm vitest run src/lib/zustand-ipc-bridge.test.ts` → 1 file / 12 tests / 0 errors.<br>2. `pnpm vitest run` → 150 files / **2260 passed + 5 todo (2265)** — matches Generator's claim, baseline 2248+5 preserved, 12 new tests added.<br>3. `pnpm tsc --noEmit` → exit 0.<br>4. `pnpm lint` → exit 0.<br>5. `grep -rE "zustandIpcBridge\|zustand-ipc-bridge" src/stores/` → empty.<br>6. Skip-grep on bridge files → empty.<br>7. `git diff HEAD src/test-setup.ts` → empty (Generator's claim verified).<br>8. `git diff HEAD <Sprint 150 outputs>` → empty.<br>9. `git status` shows only the 3 expected untracked artifacts.<br>TDD red-state log (`tdd-evidence/red-state.log`) is a genuine pre-implementation failure signature: `Failed to resolve import "@lib/zustand-ipc-bridge"`, `Test Files 1 failed (1)`. The durable file approach addresses Sprint 150 evaluator feedback #1. Per-AC mapping in handoff is concrete with line numbers. |
| **Overall** | **8.75/10** | |

Weighted: 9·0.35 + 9·0.25 + 8·0.20 + 9·0.20 = 3.15 + 2.25 + 1.60 + 1.80 = **8.80/10**.

## Verdict: **PASS**

All four dimensions ≥ 7/10; pass threshold met. Zero P1/P2 findings. Sprint 151 is approved and Sprint 152 may proceed to opt the first production store (recommend `themeStore` — smallest surface, JSON-safe).

## Sprint Contract Status (Done Criteria)

- [x] **AC-151-01** — `attachZustandIpcBridge<T>(store, options)` exported from `src/lib/zustand-ipc-bridge.ts:195`. Subscribes to store, picks allowlisted slice, emits envelope with origin-id; listens on same channel and applies inbound after self-origin drop + allowlist filter + `applyingInbound` flag wrap. (zustand-ipc-bridge.ts:215–252)
- [x] **AC-151-02** — All 5 required contract cases present; total 12 `it()` cases:
  - (a) local→emit: `AC-151-02a` (line 157)
  - (b) inbound→no re-emit: `AC-151-02b` (line 182), `AC-151-02b'` (line 206)
  - (c) allowlist filter both directions: `AC-151-02c-out` (225), `AC-151-02c-mix` (239), `AC-151-02c-in` (263), `AC-151-02c-in-mix` (281)
  - (d) two-store convergence: `AC-151-02d` (299), `AC-151-02d'` no-op (336)
  - (e) malformed payload: `AC-151-02e` (353), self-origin echo: `AC-151-02e'` (379), dispose: line 398
- [x] **AC-151-03** — TDD red-state captured at `docs/sprints/sprint-151/tdd-evidence/red-state.log`. Genuine pre-implementation signature: `Failed to resolve import "@lib/zustand-ipc-bridge"`. Durable file (per Sprint 150 feedback #1).
- [x] **AC-151-04** — JSDoc/header at `zustand-ipc-bridge.ts:1–63` documents sync-safe vs window-local key contract, loop-guard mechanism, and allowlist-not-denylist rationale.
- [x] **AC-151-05** — `grep -rE "zustandIpcBridge|zustand-ipc-bridge" src/stores/` empty (verified). `git diff HEAD src/stores` empty.
- [x] **AC-151-06** — `pnpm vitest run` 2260 passed + 5 todo (≥ 2248 + 12 new); `pnpm tsc --noEmit` exit 0; `pnpm lint` exit 0; skip/todo grep empty on bridge files.

## Feedback for Generator

No blocking findings. The following are **non-blocking nits** for the Generator's awareness on Sprint 152:

1. **Reliability — dispose ordering**: A remote event arriving between `unsubscribeStore()` and `unlisten()` will still hit `store.setState`. Generator self-noted this. Trivially fixable by reversing the order in `dispose()` so `unlisten()` runs first.
   - Current (`zustand-ipc-bridge.ts:255–260`):
     ```ts
     return () => {
       unsubscribeStore();
       unlisten();
     };
     ```
   - Suggestion: `return () => { unlisten(); unsubscribeStore(); };` so no inbound event can fire after the store subscription is cut. Cosmetic safety upgrade.

2. **Documentation — wire shape stability commitment**: The handoff's first assumption ("full-slice broadcast, not minimal diff") is a real contract decision but is NOT in the JSDoc. If Sprint 152 audits a noisy store and considers a "diff-only" optimisation, the JSDoc should explicitly say "the wire shape is the full allowlisted slice; receivers should treat it as authoritative for those keys, not as a partial." This locks the contract for Sprint 153+ stores.
   - Current: only documented in the handoff (assumption #1).
   - Suggestion: append one paragraph to the module JSDoc — "**Wire shape**: the bridge always broadcasts the full allowlisted slice on every change (not a per-field diff). The receiver shallow-merges the slice via `setState`. Future micro-optimisations (diff-only) would require a wire-format version bump."

3. **Test coverage — `__transient` no-op verification**: `AC-151-02c-out` confirms `password` (a non-allowlisted key) does not emit, but never asserts that flipping `__transient` alone (also non-allowlisted) is a no-op outbound. The mixed-key case covers it implicitly. A one-line dedicated case would document the symmetry.
   - Current: only `password` is exercised as a pure non-allowlisted single-key change.
   - Suggestion: add a 4-line `it("non-allowlisted __transient setState alone produces zero emits", …)` for symmetry.

4. **Convergence test microtask flushing**: `AC-151-02d` uses `await Promise.resolve(); await Promise.resolve();` to drain microtasks. This works because `emit` is `async` (one microtask) and the listener fires synchronously inside `busEmit`. If a future change makes the bus async, this could race. Not a current bug.
   - Suggestion: replace with `await vi.waitFor(() => expect(storeB.getState().themeId).toBe("ocean"))` for resilience. Optional polish.

None of the above block Sprint 152.

## Handoff to Sprint 152 Planner

- The bridge primitive is **frozen** for Sprint 152 — opt in by calling `attachZustandIpcBridge(store, { channel, syncKeys, originId: windowLabel })` from each production store's init.
- Suggested first opt-in: `themeStore` (small, JSON-safe, low frequency).
- Per Sprint 151 residual risk #5: when wiring `connectionStore`, retire the workspace's duplicate `loadConnections / loadGroups / initEventListeners / loadPersistedFavorites / loadPersistedMru` fan-out (boot-duplication identified in Sprint 150 evaluator feedback #2).
- Sprint 152 should pass an explicit `originId` (e.g. `launcher` / `workspace`) instead of the default random id, so trace logs are human-readable.
