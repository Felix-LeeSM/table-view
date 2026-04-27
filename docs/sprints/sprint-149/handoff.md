# Handoff: sprint-149 — Launcher/Workspace lifecycle (AC-141-*) — single-window stub

## Outcome

- Status: **PASS**
- Summary: AC-141-1~5 are locked on the single-window stub via `src/__tests__/window-lifecycle.ac141.test.tsx` (5 it() + 5 it.todo()). The 4-fold forcing mechanism (ADR 0011 + RISK-025 + it.todo + findings Deferred Work) is fully wired so the phase-12 real-window split cannot silently rot. All three gates exit 0.

## Verification Profile

- Profile: `command`
- Overall score: **8.5 / 10**
- Final evaluator verdict: **PASS**

## Evidence Packet

### Checks Run (re-executed by evaluator)

- `pnpm vitest run`: **pass** — 148 files / 2244 passed | 5 todo (2249 total). Duration 37.41s. (Pre-S149 baseline 2239 → +5 active = 2244 ✓; +5 todos visible in summary ✓.)
- `pnpm vitest run src/__tests__/window-lifecycle.ac141.test.tsx`: **pass** — 1 file / 5 passed | 5 todo (10).
- `pnpm tsc --noEmit`: **pass** — exit 0.
- `pnpm lint`: **pass** — exit 0.

### Acceptance Criteria Coverage (1:1 AC ↔ it())

| AC | Test name (single-window stub) | Asserts what the AC claims? |
|---|---|---|
| AC-141-1 | `AC-141-1: app boot lands on the launcher equivalent (appShellStore.screen === 'home')` | ✓ Reads `useAppShellStore.getState().screen === "home"` after fresh init. |
| AC-141-2 | `AC-141-2: double-clicking a connection from the launcher activates the workspace screen` | ✓ Renders `HomePage`, fires `doubleClick`, asserts `screen === "workspace"` and `focusedConnId === "c1"`. |
| AC-141-3 | `AC-141-3: 'Back to connections' returns to launcher AND preserves the backend connection pool` | ✓ Clicks Back button on `WorkspacePage`, asserts (a) `screen === "home"`, (b) `activeStatuses["c1"] === { type: "connected" }`, (c) `disconnectMock` not called — pool preservation is the spec invariant. |
| AC-141-4 | `AC-141-4: Disconnect (unlike Back) DOES evict the pool — the two paths must reach distinct final states` | ✓ Drives `disconnectFromDatabase("c1")` store action, asserts `disconnectMock` called with `"c1"` and `activeStatuses["c1"] === { type: "disconnected" }`. Uses store action rather than DisconnectButton click; comment explicitly references AC-142-3 (Sprint 148) for button-level coverage — acceptable scope choice. |
| AC-141-5 | `AC-141-5: full lifecycle — boot → activate → back (pool kept) → reactivate (no reconnect cost) → disconnect (pool gone)` | ✓ Stage 1 boot screen=home, Stage 2 doubleClick → workspace, Stage 3 Back → home + pool intact + disconnect not called, Stage 4 `connectMock` not re-invoked, Stage 5 disconnect → pool gone. Stage 4 only asserts the absence of reconnect cost (no re-render of HomePage); minor but consistent with the contract framing of "reactivation should be free". |

| AC (phase-12 real-window) | Status | Evidence |
|---|---|---|
| AC-141-1 (real) | deferred | `it.todo("AC-141-1 (real): launcher window mounted at 720×560, fixed (no resize/maximize), centered")` |
| AC-141-2 (real) | deferred | `it.todo("AC-141-2 (real): launcher.connect success emits 'workspace:open'; workspace.show()+focus(), launcher.hide()")` |
| AC-141-3 (real) | deferred | `it.todo("AC-141-3 (real): workspace 'Back' emits 'launcher:show'; workspace.hide(), launcher.show(); pool intact")` |
| AC-141-4 (real) | deferred | `it.todo("AC-141-4 (real): launcher.close → app exit; workspace.close → launcher recovery (same as Back)")` |
| AC-141-5 (real) | deferred | `it.todo("AC-141-5 (real): WebviewWindow mock-based 4-stage visibility integration test")` |

### Forcing Mechanism (4-fold lock — verified live)

1. **ADR 0011** — `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md` exists with frozen body (결정/이유/트레이드오프). ADR index `memory/decisions/memory.md` row added at `0011`, index `updated: 2026-04-27`. ✓
2. **RISK-025 deferred** — `docs/RISKS.md:50` row present with `status=deferred`, area `frontend/architecture`, origin sprint `149`, resolution note pointing back to ADR 0011 + it.todo + findings. Summary counts re-tallied by evaluator: Active=15, Resolved=8, Deferred=2, Total=25 — matches table reality (`awk` count). ✓
3. **`it.todo()` block** — `describe.skip("AC-141-* real-window invariants (DEFERRED to phase 12 — see ADR 0011)")` contains exactly 5 `it.todo(...)` entries (one per AC sub-clause). vitest run summary shows `5 todo` line — permanent reminder. ✓
4. **findings.md Deferred Work** — section "Deferred Work (phase 12 진입 트리거 + 영향 면적)" enumerates entry triggers, 5-store impact list (connection/tab/appShell/mru/theme + favorites mention), and new-file manifest (`tauri.conf.json` windows, `launcher.rs`, `zustand-ipc-bridge.ts`, `LauncherPage.tsx`, `e2e/window-lifecycle.spec.ts`, superseding ADR). ✓

### Scoring (System rubric)

| Dimension | Score | Notes |
|---|---|---|
| **Correctness (35%)** | 9/10 | Each it() asserts exactly what its AC label claims. Pool preservation (AC-141-3) is the spec-critical invariant and is asserted three ways (screen, activeStatuses, mock-not-called). Disconnect path (AC-141-4) cleanly contrasts the two final states. The single-window mapping is justified in ADR + comment header of the test file. |
| **Completeness (25%)** | 9/10 | All 5 contract Done Criteria satisfied: 5 it() + 5 it.todo + ADR + ADR index + RISK-025 + summary recount + findings Deferred Work. Nothing in scope is missing. Minor nit: AC-141-5 stage 4 ("reactivate, no reconnect cost") is verified only by `connectMock not called`; a re-render + second double-click would be more rigorous, but consistent with contract intent. |
| **Reliability (20%)** | 8/10 | beforeEach resets all three relevant stores (appShell/connection/tab) so tests are independent. Tauri `@lib/tauri` is fully mocked. WorkspacePage children (Sidebar/MainArea) are stubbed to keep the surface narrow — sound test isolation. Risk: if a future store key is added, beforeEach reset will silently miss it; acceptable for stub scope. |
| **Verification Quality (20%)** | 9/10 | All three required commands re-run and exit 0; test counts (2244 pass + 5 todo) and todo count delta verified live. AC↔test mapping table 1:1, forcing mechanism locations cited with file paths and line numbers. RISK summary counts independently re-tallied. |
| **Overall** | **8.75 / 10** (weighted) | Above 7.0 threshold on every dimension. |

### Screenshots / Links / Artifacts

- `src/__tests__/window-lifecycle.ac141.test.tsx` (new test file)
- `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md` (frozen ADR)
- `memory/decisions/memory.md` (ADR index — row 0011 added)
- `docs/RISKS.md:50` (RISK-025 deferred row)
- `docs/sprints/sprint-149/contract.md` / `execution-brief.md` / `findings.md`

## Changed Areas

- `src/__tests__/window-lifecycle.ac141.test.tsx`: lifecycle invariants regression lock for AC-141-1~5.
- `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md`: ADR freezing the deferral decision.
- `memory/decisions/memory.md`: ADR index updated (row + `updated` date).
- `docs/RISKS.md`: RISK-025 deferred + summary recount.
- `docs/sprints/sprint-149/{contract,execution-brief,findings}.md`: Sprint artifacts.

## Assumptions

- The mapping `appShellStore.screen` toggle ↔ phase-12 real-window show/hide is treated as the user-observable equivalent. Spec discovery in the contract pre-amble explicitly accepts this mapping (Option B).
- AC-141-4 chooses to drive the store action instead of clicking the DisconnectButton because the button click is already locked in `connection-sot.ac142.test.tsx (AC-142-3)` from Sprint 148 — verified by the in-test comment.
- `it.todo()` count dropping to zero is necessary but not sufficient for phase-12 completion — the WebviewWindow integration e2e must also ship (called out in findings).

## Residual Risk

- WebviewWindow lifecycle (`show/hide/focus/close` events) is not exercised by the stub — phase 12 must add a `WebviewWindow` mock harness.
- Cross-window store sync layer is unimplemented; phase 12 must add the IPC bridge for all five stores or two-window state will diverge.
- Existing e2e suite assumes single window; phase 12 must re-walk every e2e scenario.
- These three risks are listed in `findings.md` "Risks / Deferred" — not blockers for sprint-149 PASS.

## Final Verdict

**PASS** — All three gates exit 0, all five Done Criteria satisfied, 4-fold forcing mechanism fully wired with cited locations, every it() asserts what its AC label claims, and every dimension scores ≥ 7.0.

## Next Sprint Candidates

- **Phase 12 — Real two-window lifecycle**: flip `it.todo` → `it`, add `tauri.conf.json` windows, new `launcher.rs` module, `zustand-ipc-bridge.ts`, `LauncherPage.tsx`, e2e suite. Supersede ADR 0011 with new ADR; transition RISK-025 deferred → resolved. Trigger conditions documented in `findings.md` "진입 트리거".
