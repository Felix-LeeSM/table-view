# Sprint 151 — Generator Handoff

## Generator Handoff

### Changed Files

- `src/lib/zustand-ipc-bridge.ts` (new) — Tauri-events bridge primitive: subscribe to a Zustand vanilla store, broadcast the allowlisted slice on a stable channel, listen on the same channel and apply inbound payloads with a deterministic origin-id loop guard. Exports `attachZustandIpcBridge<T>(store, options)` returning a `Promise<() => void>` dispose.
- `src/lib/zustand-ipc-bridge.test.ts` (new, TDD-FIRST) — 12 contract tests covering the 5 contract surfaces from AC-151-02 (local→emit, inbound→no re-emit, allowlist filter both directions, two-store convergence, malformed payload), plus 4 reinforcing cases (mixed-keys broadcast slice, no-op write skipped, self-origin echo dropped, dispose tear-down) and a `'b'` follow-up that the loop guard does not poison subsequent local emits.
- `docs/sprints/sprint-151/tdd-evidence/red-state.log` (new) — captured pre-implementation `pnpm vitest run src/lib/zustand-ipc-bridge.test.ts` output showing `Failed to resolve import "@lib/zustand-ipc-bridge"` (durable TDD red proof per Sprint 150 evaluator feedback #1).
- `docs/sprints/sprint-151/handoff.md` (new) — this file.

`src/test-setup.ts` was deliberately NOT modified — the cross-store-in-same-process event bus mock fits inside the test file via `vi.mock("@tauri-apps/api/event", ...)` with module-scoped state, matching the existing pattern in `src/App.test.tsx` and `src/__tests__/window-bootstrap.test.tsx`.

### Checks Run

| Command | Result |
|---|---|
| `pnpm vitest run src/lib/zustand-ipc-bridge.test.ts` (PRE-implementation) | RED — `Error: Failed to resolve import "@lib/zustand-ipc-bridge" from "src/lib/zustand-ipc-bridge.test.ts"` (captured in `tdd-evidence/red-state.log`) |
| `pnpm vitest run src/lib/zustand-ipc-bridge.test.ts` (POST-implementation) | PASS — 1 file / **12** tests / 0 errors |
| `pnpm vitest run` | PASS — 150 files / **2260 passed + 5 todo** (was 2248 + 5 in Sprint 150; 12 new bridge tests) |
| `pnpm tsc --noEmit` | PASS (exit 0) |
| `pnpm lint` | PASS (exit 0) |
| `grep -rE "zustandIpcBridge\|zustand-ipc-bridge" src/stores/` | empty — no production wiring (per AC-151-05) |
| `grep -rE "it\.skip\|this\.skip\(\)\|it\.todo\|xit\(\|describe\.skip" src/lib/zustand-ipc-bridge.test.ts src/lib/zustand-ipc-bridge.ts` | empty — no skips/todos introduced |
| `git status` | only 3 untracked artifacts: bridge module, bridge test, sprint-151 docs dir |
| `git diff src/test-setup.ts src/__tests__/window-lifecycle.ac141.test.tsx src/AppRouter.tsx src/main.tsx src/App.tsx src-tauri/tauri.conf.json src-tauri/src/launcher.rs src/pages/LauncherPage.tsx src/lib/window-label.ts src/__tests__/window-bootstrap.test.tsx` | empty — Sprint 150 outputs untouched |

### Done Criteria Coverage

- **AC-151-01** — Bridge primitive with loop guard + per-key allowlist enforced at the bridge layer.
  - Evidence: `src/lib/zustand-ipc-bridge.ts:142–215` exports `attachZustandIpcBridge<T>` accepting `{ channel, syncKeys, originId? }`. Outbound path (lines 178–195) subscribes to the store, picks the allowlisted slice via `pickAllowlisted`, skips no-op emits via `shallowEqual`, and emits `{ origin, state }` envelopes. Inbound path (lines 198–219) `listen`s on the same channel, validates the envelope, drops self-origin echoes (loop guard), filters to the allowlist (defense in depth), and applies via `store.setState` while `applyingInbound` is `true` so the outbound subscriber short-circuits.
- **AC-151-02** — Test file has all 5 required cases (a–e).
  - Evidence: `src/lib/zustand-ipc-bridge.test.ts` — `AC-151-02a` (local→emit, line 161), `AC-151-02b` (inbound→no re-emit, line 184) + `AC-151-02b'` reinforcing (line 207), `AC-151-02c-out` / `AC-151-02c-mix` / `AC-151-02c-in` / `AC-151-02c-in-mix` (allowlist filter both directions, lines 226–290), `AC-151-02d` (two-store convergence, line 296) + `AC-151-02d'` (no-op write, line 332), `AC-151-02e` (malformed payload, line 351) + `AC-151-02e'` (self-origin loop guard, line 376), plus a dispose tear-down case. Total: **12** `it()` cases, exceeding the contract's "at least 4 + 1 error path" minimum.
- **AC-151-03** — TDD ordering proof.
  - Evidence: `docs/sprints/sprint-151/tdd-evidence/red-state.log` is the captured `pnpm vitest run src/lib/zustand-ipc-bridge.test.ts` output BEFORE the production module shipped, showing `Test Files  1 failed (1)` and `Failed to resolve import "@lib/zustand-ipc-bridge"`. After the bridge module landed, the same command now passes (12/12). The red-state log is checked into the sprint folder so the proof survives outside the conversation, addressing Sprint 150 evaluator feedback #1.
- **AC-151-04** — JSDoc/header documents sync-safe vs window-local key contract.
  - Evidence: `src/lib/zustand-ipc-bridge.ts:1–63` is a top-of-file JSDoc that names three contracts: (a) sync-safe key shape (plain JSON-serialisable, immutable, secret-free), (b) window-local key categories (ephemeral UI / window-scoped / sensitive), (c) the loop-guard mechanism (origin-id envelope + `applyingInbound` flag + try/finally restore), and (d) why allowlist-not-denylist (so new fields default to "window-local"). Each public symbol carries its own JSDoc.
- **AC-151-05** — `grep -rE "zustandIpcBridge|zustand-ipc-bridge" src/stores/` empty.
  - Evidence: command run, 0 matches. No production store wired this sprint per the contract.
- **AC-151-06** — `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` all 0; total ≥ 2248 + new; 5 todos retained.
  - Evidence: full suite 2260 passed + 5 todo (Sprint 150 baseline 2248 + 12 new bridge tests = 2260). Skip-grep empty on both new files. tsc + lint exit 0.

### Assumptions

- **Full-slice broadcast (not minimal diff)**. The bridge emits the entire allowlisted snapshot on every change, not a per-field diff. This makes the wire shape stable (`{ origin, state: { ...allowlistedKeys } }`) and the receiver's `setState` a single shallow merge. Cost: a 200-byte envelope when only one byte changed. Benefit: no diff-merging logic on the receive side, no risk of out-of-order partials. The contract didn't pin this; flagged here so Sprint 152 can revisit if a future store has large synced state.
- **`applyingInbound` is module-private per bridge instance, not global**. Two bridges in the same process keep separate flags. This is correct for the convergence case (two stores in one test process) and matches the real two-window topology.
- **`originId` defaults to `bridge-<crypto.randomUUID()>`**. Sprint 152 should pass an explicit window label (`launcher` / `workspace`) for human-readable trace logs; for Sprint 151 the random default keeps the unit tests hermetic.
- **`emit` errors are swallowed**. A failed IPC emit returns the bridge to a consistent state (the next mutation will retry the broadcast). Logging would pollute test output and there's no recovery path. This is documented inline at the `void emit(...).catch(() => {})` site.
- **`@tauri-apps/api/event` mock is colocated with the test file**, not in `src/test-setup.ts`. The bus is module-scoped (one Map per test-file import) so two stores in one test see the same bus, but two test files don't cross-pollute. This matches the existing pattern in `src/App.test.tsx` and `src/__tests__/window-bootstrap.test.tsx` and avoids touching `test-setup.ts` (which would affect 149+ other test files).
- **`zustand/vanilla::createStore`** is used in tests rather than `zustand::create` so the test does not need to render a React tree to exercise the bridge. The bridge accepts any `StoreApi<T>` so React-bound stores (`zustand::create`) work the same way in production.

### Residual Risk

- **Inbound apply triggers a full subscriber re-render in real Zustand-React stores**. The bridge calls `store.setState(filtered)` which Zustand merges shallowly; React subscribers will re-render exactly as if the local code had set the same fields. This is the correct semantics, but Sprint 152 should add a per-store `equalityFn` audit so a noisy peer doesn't thrash the workspace UI on every keystroke in the launcher.
- **Real Tauri `listen` may echo the originating window's emits** (depending on the runtime). The bridge handles this via the self-origin check — confirmed in `AC-151-02e'` — but the actual echo behavior of Tauri 2.x's event bus is not yet exercised end-to-end (we mock the bus). Sprint 154's e2e gate will be the first time this is tested against a real runtime.
- **No throttle / debounce**. A burst of `setState` calls produces a burst of emits. Sprint 152 should evaluate per-store throttling for high-frequency stores (e.g. cursor position) before opting them into the bridge. Theme / favorites / connection list are low-frequency; safe.
- **Dispose ordering**. `dispose()` calls `unsubscribeStore()` then `unlisten()`. An inbound event arriving between those two calls would set state on a "soon-to-be-dead" store; harmless because `setState` on an unsubscribed store is a no-op for our purposes, but worth noting.
- **Sprint 150 boot-duplication (evaluator feedback #2)** is NOT addressed by this sprint — the bridge primitive is in place, but no store opts in yet. Sprint 152 will retire the workspace's duplicate `loadConnections / loadGroups / initEventListeners / loadPersistedFavorites / loadPersistedMru` fan-out when it wires `connectionStore` (and friends) onto the bridge.
- **TDD red-state log is captured pre-implementation** but the orchestrator commits the module + test together (per `.claude/skills/harness` workflow). Two-commit ordering would be a stronger signal; the durable log file is the contract-allowed alternative.
