# Sprint 152 — Evaluation Findings

## Sprint 152 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** (35%) | 9/10 | Bridge is wired exactly per the contract: deterministic module-load attach in `connectionStore.ts:398–405`, exported `SYNCED_KEYS` (lines 147–152, `["connections","groups","activeStatuses","focusedConnId"]`), `originId` derived from `getCurrentWindowLabel() ?? "test"`, channel `"connection-sync"`. Sprint 151's bridge enforces the allowlist on both outbound (`pickAllowlisted`) and inbound (`filterInboundState`) edges; `SYNCED_KEYS` is the single source of truth and is imported by the regression test. AC-141-3 invariant test (case d) genuinely does NOT call `disconnectFromDatabase` and asserts the mock was not called (`tauri.disconnectFromDatabase as Mock).not.toHaveBeenCalled()` at line 332). Self-loop guard test (case f) drops the launcher's own echo. The "sensitive key" substitution to `loading` / `error` is genuine — `ConnectionConfig` only carries `has_password: boolean` on the wire (`src/types/connection.ts:36–37`), so the contract's "password" intent is correctly mapped to the next-best transient/window-local fields the store actually has, and the c-mix test (`Object.keys(payload.state).sort()` line 300–305) pins the exact four-key emission. |
| **Completeness** (25%) | 9/10 | All 7 acceptance criteria satisfied with concrete evidence. AC-152-01 (allowlist + bridge attach) ✓; AC-152-02 (a–e) ✓ with 9 it() cases — exceeds "≥4 + 1 error path" minimum; AC-152-03 (TDD red-state log) ✓ with the three wiring-attributable failures captured (a, b, c-mix); AC-152-04 (regression on `SYNCED_KEYS` membership) ✓ with two cases pinning exact membership and explicit non-inclusion of `loading`/`error`; AC-152-05 (suite + tsc + lint) all 0; AC-152-06 (AC-142-* invariants) green 6/6; AC-152-07 (no skips/todos introduced) ✓. Total 2271 + 5 todo = 2276, beats the contract's "≥ 2260 + N new" threshold. Excluded scope (other stores, real lifecycle, ADR, RISKS) untouched per `git status`. |
| **Reliability** (20%) | 7/10 | Strong operational behavior: bridge attach is wrapped in `.catch(() => {})` so a missing Tauri runtime doesn't break window-local store usage; `applyingInbound` flag is restored via try/finally in Sprint 151's bridge (cannot leak); allowlist is enforced at TWO layers (sender's `pickAllowlisted` + receiver's `filterInboundState`); regression test forces a deliberate decision when adding new state keys. Caveats: (a) `originId` fallback `"test"` rather than `"unknown"` is acceptable here because vitest scenarios `vi.mock("@lib/window-label")` to override per case, but if a future test forgot to mock and another store also fell back to `"test"`, both would self-loop-guard each other and silently desync — see Feedback #1. (b) The bridge catch block silently swallows attach failures with no `console.warn` in non-test environments — already flagged in handoff residual #2 but worth tightening before Sprint 154's e2e gate. (c) `vi.hoisted()` is genuinely necessary here (the bridge attaches AT MODULE LOAD via `void attachZustandIpcBridge(...)`, so the bus must exist before that module imports), well-documented in the test header — not a smell. |
| **Verification Quality** (20%) | 9/10 | Every required check executed and captured: `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx` → 9/9; `pnpm vitest run src/stores/connectionStore.test.ts` → 39/39 (37 existing + 2 new); `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` → 6/6; full suite `pnpm vitest run` → 2271 + 5 todo; `pnpm tsc --noEmit` exit 0; `pnpm lint` exit 0; skip/todo grep empty on touched files; `git diff` empty on Sprint 150/151 protected scope; `grep attachZustandIpcBridge src/stores/` returns exactly one match (`connectionStore.ts`). TDD red-state log preserved at `docs/sprints/sprint-152/tdd-evidence/red-state.log` with explanatory header documenting WHICH 3 of 9 failures are wiring-attributable (a, b, c-mix) and why the post-fix `vi.hoisted()` doesn't invalidate the proof. Minor docking: the red-state log was captured against the pre-`vi.hoisted` test version — this is honestly disclosed in the log header and the wiring-failure signature is unchanged, so the proof holds, but a cleaner protocol (Sprint 153+) would re-capture against the final test file. |
| **Overall** | **8.6/10** | Pass threshold (all dims ≥7) cleared on every dimension. |

## Verdict: PASS

## Sprint Contract Status (Done Criteria)

- [x] **AC-152-01** — `connectionStore.ts:147–152` exports `SYNCED_KEYS: ReadonlyArray<keyof ConnectionState> = ["connections","groups","activeStatuses","focusedConnId"] as const` with rich JSDoc explaining each inclusion AND each exclusion (`loading` transient flag, `error` last-error string, password redacted at the backend layer). Bridge attached ONCE at module load (`connectionStore.ts:398–405`) with `channel: "connection-sync"`, `syncKeys: SYNCED_KEYS`, `originId: getCurrentWindowLabel() ?? "test"`.
- [x] **AC-152-02** — `cross-window-connection-sync.test.tsx` covers (a) workspace→launcher `activeStatuses` propagation (line 205–223), (b) launcher→workspace `focusedConnId` emission with origin/state assertion (line 226–253), (c-out/in/mix) sensitive-key non-broadcast in BOTH directions including the four-key allowlist pin (line 256–306), (d) AC-141-3 invariant — workspace re-asserts connected state, launcher's `activeStatuses["c1"].type === "connected"` AND `disconnectFromDatabase` mock NOT called (line 309–333), (e) malformed inbound payloads (null, string, missing state, etc.) silently ignored without throwing (line 336–360), plus an extra (f) self-origin echo dropped by the loop guard (line 377–391). Total 9 cases — exceeds the contract's "≥4 + 1 error path" floor.
- [x] **AC-152-03** — `docs/sprints/sprint-152/tdd-evidence/red-state.log` captured pre-implementation. Header explains WHICH 3 of 9 failures are wiring-attributable (a inbound apply, b outbound emit, c-mix slice filter) — the same three the post-fix wiring genuinely makes pass. The log was captured before `vi.hoisted()` was introduced for the bus mock; that's honestly disclosed in the header and is acceptable because hoisting is a TEST setup detail, not the production wiring under test — the wiring-failure signature is unchanged either way.
- [x] **AC-152-04** — `connectionStore.test.ts:803–817` adds `describe("SYNCED_KEYS allowlist (AC-152-04)")` with two regression cases: exact membership (`expect([...SYNCED_KEYS]).toEqual([...4 keys])`) and explicit non-inclusion of `loading`/`error`. The case header (lines 787–801) documents the future-contributor protocol (1) widen `SYNCED_KEYS`, (2) update test, (3) document JSDoc, (4) add cross-window-sync case.
- [x] **AC-152-05** — `pnpm vitest run` 2271 passed + 5 todo (151 files); `pnpm tsc --noEmit` exit 0; `pnpm lint` exit 0; total 2271 + 5 todo = 2276 ≥ 2260 + 11 new = 2271 floor. Verified by direct re-execution.
- [x] **AC-152-06** — `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` → 6/6 passing (matches Sprint 151 baseline). The bridge attach inside `connectionStore.ts` is gated by the existing `vi.mock("@lib/tauri")` in that test file (no real backend calls); the inbound listener registers against the test's mocked event bus and never fires (no `busEmit` in the AC-142 file), so it cannot interfere with the AC-142 disconnect path. Test file is byte-identical to Sprint 151.
- [x] **AC-152-07** — `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip"` on the three touched files returns empty. 5-todo total preserved (those live in pre-existing files this sprint did not touch).

### Invariants (re-verified)
- Sprint 150 + 151 outputs unchanged: `git diff HEAD --` on the 12 protected files returns exit 0, no diff.
- ADR 0011 body untouched (out of scope per contract).
- TDD strict ordering — red-state log captured BEFORE the wiring; honest disclosure of the test-side `vi.hoisted` refactor that came later.

## Critical Things Caught (per evaluator instructions)

| Risk | Verdict |
|------|---------|
| **Bridge attaches deterministically at module load (not lazily)** | PASS. `connectionStore.ts:398` is a top-level `void attachZustandIpcBridge(...)` call, executed once at import. |
| **Allowlist enforced at bridge layer + `SYNCED_KEYS` exports correct list** | PASS. Sprint 151's `pickAllowlisted` (sender) + `filterInboundState` (receiver) both consume `syncKeys`; `SYNCED_KEYS` is imported by the regression test. |
| **`vi.hoisted()` necessary?** | PASS. Genuinely necessary — bridge attaches AT MODULE LOAD, before the file's local `const bus = new Map()` would otherwise initialise. The bridge test (Sprint 151) attaches manually inside `it(...)` so it doesn't need hoisting. Pattern is documented in the test header. |
| **"Sensitive key" substitution genuine?** | PASS. `ConnectionConfig` carries `has_password: boolean` only — no plaintext password on the wire (`src/types/connection.ts:36–37`). The `loading`/`error` substitution is the right choice for the transient/window-local intent of the contract clause. |
| **AC-141-3 invariant genuinely exercised?** | PASS. Test (d) at `cross-window-connection-sync.test.tsx:309–333` does NOT call `disconnectFromDatabase` AND asserts `tauri.disconnectFromDatabase as Mock).not.toHaveBeenCalled()`. |
| **`emit` mock added to `connectionStore.test.ts` masking prior contract?** | PASS. The pre-Sprint-152 mock declared only `listen`. The new no-op `emit: vi.fn(() => Promise.resolve())` is structurally inert — no existing test asserted on `emit` (verified: only `listen` was used in `initEventListeners` test). All 37 prior cases re-pass in isolation. |
| **`getCurrentWindowLabel() ?? "test"` acceptable?** | MOSTLY OK, with one residual risk noted (Feedback #1). |
| **Channel name `connection-sync` distinct/scalable for Sprint 153** | PASS. Distinct from `theme-sync`/`tabs-sync`/`mru-sync` etc. that Sprint 153 will introduce. |
| **Sprint 150 + 151 outputs byte-identical?** | PASS. `git diff HEAD --` on all 12 protected paths is empty. |

## Feedback for Generator (advisory — non-blocking, no P1/P2)

1. **Reliability — `getCurrentWindowLabel() ?? "unknown"` would be safer than `"test"`** (P3, advisory)
   - Current: `connectionStore.ts:401` falls back to `"test"` when the Tauri label is unavailable.
   - Risk: if Sprint 153 wires a new store the same way and a future test forgets to `vi.mock("@lib/window-label")`, both stores fall back to `"test"` and the loop guard self-suppresses cross-store-but-same-process emits. The label `"test"` also has semantic resonance with vitest, which makes it harder to spot when a non-test runtime ends up there.
   - Suggestion: change the fallback to `"unknown"` (or generate a per-process random id at module load via `defaultOriginId()` from the bridge). Tests that need a deterministic label keep doing what `cross-window-connection-sync.test.tsx:121–123` does: `vi.mock("@lib/window-label", () => ({ getCurrentWindowLabel: vi.fn(() => "launcher") }))`. No test changes needed for this sprint's file because the mock dominates.

2. **Reliability — bridge-attach failure silently swallowed** (P3, advisory; already in handoff residual #2)
   - Current: `connectionStore.ts:402–404` catches without logging.
   - Risk: in production, if `listen` rejects (Tauri permission missing, channel collision), launcher and workspace silently desync.
   - Suggestion: in non-test environments (`if (import.meta.env.MODE !== "test")`), `console.warn` so a developer running the app picks up the failure. Sprint 154's e2e gate is the first real exercise of `listen`; better to land this before then.

3. **Verification — re-capture red-state log against the final test file** (P3, advisory)
   - Current: `tdd-evidence/red-state.log` was captured before `vi.hoisted()` was added; the header honestly discloses this.
   - Risk: a strict reader could argue the proof is against a different test file than what's checked in.
   - Suggestion: for Sprint 153, capture the red-state AFTER all test infrastructure is in place but BEFORE production wiring lands. Two-commit ordering (test commit → wiring commit) is even cleaner. Not blocking for this sprint because the failure signature is intrinsic to "no bridge wired" and is identical regardless of bus-hoisting strategy.

4. **Documentation — link `connectionStore.ts` JSDoc to the regression test** (P3, advisory, polish)
   - Current: the `SYNCED_KEYS` JSDoc (`connectionStore.ts:111–146`) explains why each key is in/out but doesn't tell readers where the regression lives.
   - Suggestion: append `@see connectionStore.test.ts SYNCED_KEYS allowlist (AC-152-04)` to the JSDoc so a future contributor changing this list lands at the locked-in expectation.

## Exit Criteria

- Open P1/P2 findings: **0**.
- All 9 required checks passing.
- TDD red-state proof captured.
- No new `it.skip` / `it.todo`.
- 4-of-4 dimensions ≥ 7/10.

**Sprint 152: PASS. Ready to merge before Sprint 153.**
