# Findings: sprint-251

## Verification Summary

- Profile: `command`
- Checks run (all 7 required + 8th sprint-target re-run for confidence):
  - `pnpm tsc --noEmit` → **PASS** (no output, 0 errors).
  - `pnpm lint` → **PASS** (eslint exits clean, 0 errors / 0 warnings).
  - `pnpm vitest run` → **PASS** (236 files / 3003 tests / 3003 passed in 62.00s; matches Generator's claim verbatim).
  - `cargo test --lib --manifest-path src-tauri/Cargo.toml` → **PASS** (627 passed, 0 failed, 2 ignored — Rust untouched).
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` → **PASS** (`Finished dev profile`).
  - `rg "dataGridEditStore|DataGridEditStore" src/` → **PASS** (≥3 — 7 distinct files: store source/test, hook, persist test, tabStore wire, tabStore.purge.test, test-setup).
  - `rg "purgeKey|purgeForConnection" src/stores/tabStore.ts` → **PASS** (2 matches — one for each call site at L219 and L301).
  - Targeted re-run: `pnpm vitest run` on the 7 sprint-relevant files → 7/7 files / 37/37 tests pass.
- Evidence reviewed:
  - `src/stores/dataGridEditStore.ts` (full read).
  - `src/stores/dataGridEditStore.test.ts` (full read; 6 cases).
  - `src/components/datagrid/useDataGridEdit.ts` (full read; before/after diff).
  - `src/components/datagrid/useDataGridEdit.persist.test.ts` (full read; 5 cases).
  - `src/stores/tabStore.ts` (full read; before/after diff).
  - `src/stores/tabStore.purge.test.ts` (full read; 3 cases).
  - `src/test-setup.ts` (full read; before/after diff).
  - `git diff HEAD --stat` confirms only 3 modified files + 4 new files (matches Generator's "Changed Areas").
  - Returned-shape diff on `useDataGridEdit.ts` — 30+ field return statement is byte-identical (HEAD L773-L808 ↔ working-tree L865-L900, only line offset shifted by added body).
  - Existing `no-restricted-imports` waiver precedent verified at `src/stores/tabStore/persistence.ts:14` (matches Generator's claim).

## Sprint 251 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness (35%)** | 9/10 | All 17 ACs verified. `EMPTY_ENTRY` is a top-level frozen singleton (`src/stores/dataGridEditStore.ts:62-67`), returned by `getEntry` via `entry ?? EMPTY_ENTRY` (L130) AND by the hook's selector fallback (L428-429) — both reach the SAME stable reference, so React selector equality holds across re-renders for missing-key paths. Hook 4-slice replacement verified: `useState<Map<string,string\|null>>` etc. removed (diff L20-26 of pre-251), replaced by `entry.pendingEdits` etc. (L430-436). Sibling-tab guard in `removeTab` correctly precedes the purge (L211-218). `purgeForConnection` actually deletes from the Map (L168-178) — not just emptying — and uses `if (!mutated) return state` for identity short-circuit. Returned shape byte-identical (verified by git show HEAD vs working-tree). Mongo grid path uses `database`/`collection` as schema/table (`DocumentDataGrid.tsx:118-119`); both are required string props from the parent (L33-34), so `storeKey` always composes a real key — fallback `__instance__::*` is dead code in production but defensively present. The `Object.freeze` on EMPTY_ENTRY guards the outer object only (Map/Set inside are mutable refs); since all writes route through `setSlice` (which allocates fresh containers), no mutation reaches the singleton. -1 for handoff line numbers being slightly off (cited L96 for AC-251-S4, actual L102; cited L46 for S2, actual L49) — see F-002. |
| **Completeness (25%)** | 9/10 | All 17 ACs covered (S1-S5, H1-H5, T1-T3, R1-R4) with assertion evidence (not just touched code paths). `entryKey` helper exists and is the single source of truth (`dataGridEditStore.ts:107-113`). 5 store actions present (`getEntry`, `setSlice`, `clearEntry`, `purgeKey`, `purgeForConnection`). 4 hook slices replaced with store-backed selectors + setter wrappers preserving updater-fn semantics (L445-484). `tabStore.removeTab` purges with sibling guard; `clearTabsForConnection` purges in bulk. /tdd evidence is concrete (handoff cites the import-resolution failure one-liner that proved tests-first). Out-of-scope items (cross-window, localStorage, DDL/raw-query, Mongo write, Sprint 252 polish) are explicitly NOT touched — verified by git diff stat (only 3 modified + 4 new files). Test isolation via global `beforeEach` reset in `src/test-setup.ts` is justified (singleton across test process; explained in 8-line comment block). -1 for AC-251-S4 test (`dataGridEditStore.test.ts:102-114`) NOT explicitly asserting that `purgeKey` leaves OTHER entries untouched (only verifies `entries.has(KEY_A)` is false + getEntry returns EMPTY_ENTRY). The contract grading bar said "purgeKey leaves OTHER entries alone" — implementation is correct, but the test does not lock that contract in. See F-001. |
| **Reliability (20%)** | 8/10 | Race-condition assessment: `removeTab` captures `stateBefore = get()` and `survivors` BEFORE `set()` (L169-171), runs `set()`, then fires `purgeKey` (L219). Since zustand actions are synchronous and JS is single-threaded within a stack, no other action can interleave between `set` and `purgeKey` — the "what if addTab fires mid-flight" concern is structurally impossible without an async boundary, none of which exists in the call chain. The sibling-tab decision uses the pre-set snapshot, which is the correct snapshot to compare against (the closing tab is in `stateBefore.tabs` but excluded by `filter(t => t.id !== id)` to form `survivors`). Identity short-circuits in `purgeKey` (L158: `if (!state.entries.has(key)) return state`) and `purgeForConnection` (L177: `if (!mutated) return state`) prevent spurious subscriber renders. `clearTabsForConnection` mirrors the pattern with `hadAny` snapshot before set + conditional bulk purge (L258, L300-302). The `setSlice` updater chain preserves React-style updater-fn semantics: each setter wrapper reads CURRENT state via `useDataGridEditStore.getState().getEntry(storeKey)` (e.g. L451-452) — this is correct because `set()` is synchronous and the next read sees the just-written value. `pushSnapshot` deep-copies pendingEdits/pendingNewRows/pendingDeletedRowKeys (L536-543) so snapshots never alias live state. `undo` clones again on read (L562-564). undoStack 50-cap preserved verbatim at L545: `if (next.length > UNDO_STACK_MAX) next.shift();`. -2 for two real but minor risks: (a) `EMPTY_ENTRY` outer freeze does NOT freeze inner Map/Set — accidentally calling `.set()` on `entry.pendingEdits` from a missing-key path would corrupt the singleton silently. The discipline is enforced by code review only, not by runtime guards. (b) The selector `(s) => s.entries.get(storeKey) ?? EMPTY_ENTRY` triggers a re-render on EVERY store mutation across ANY key (because the entries Map identity changes for every write, even for unrelated keys). The hook then re-runs its `entry.pendingEdits` reads — and zustand's default equality check sees a different fallback reference vs a real entry. For an idle tab in the background, every other tab's edit will still wake up its hook. Generator's "Hook selector recomputes" residual risk acknowledges this as matching the pre-Sprint-251 granularity, which is true but worth surfacing. See F-003. |
| **Verification Quality (20%)** | 8/10 | All 7 required checks passed and were re-run independently. AC mapping in handoff is mostly accurate but has line-number drift (handoff cites lines that are off by 3-7 from the actual test file — see F-002). Test assertions verify the contract, not just the code path: AC-251-S5 explicitly asserts `entries.has(KEY_OTHER_CONN)` is true (prefix isolation), AC-251-T2 force-injects a sibling tab via setState then verifies the entry survives removeTab (`tabStore.purge.test.ts:107-113`), AC-251-T3 sets up two distinct connections and verifies cross-conn isolation (L156-158). The test-setup.ts global reset is justified by the singleton contract; it does NOT mask production state-leak bugs because (i) it only resets the dataGridEditStore (not tabStore or other Zustand stores), and (ii) state accumulation across (cid,schema,table) keys is the desired production behavior, not a leak. /tdd evidence is concrete (handoff captures the failed-import message). -2 for: F-001 (AC-251-S4 lacks an explicit "other entries untouched" assertion — the contract bar said test purgeKey leaves OTHER entries alone), F-002 (handoff line citations are 3-7 lines off — accuracy bar matters when reviewing). |
| **Overall** | **8.6/10** | All thresholds met (≥7 each). Net: production-grade lift with disciplined immutability, correct lifecycle wiring, byte-identical hook contract. |

## Verdict: PASS

## Sprint Contract Status (Done Criteria)

### Store (AC-251-S1..S5)

- [x] `AC-251-S1` (cross-key isolation) — `src/stores/dataGridEditStore.test.ts:32-47`. Sets pendingEdits on KEY_A and KEY_B with distinct values, asserts each entry's pendingEdits.get("0-1") returns its own value AND each entry has size 1 (no bleed).
- [x] `AC-251-S2` (setSlice preserves other slices) — `dataGridEditStore.test.ts:49-73`. Pre-seeds 3 slices on KEY_A (newRows, deleted, undoStack), then sets pendingEdits, then asserts ALL FOUR slices have their expected values.
- [x] `AC-251-S3` (clearEntry empties all 4 slices, leaves other keys) — `dataGridEditStore.test.ts:75-100`. Seeds 3 slices on KEY_A and 1 on KEY_B, calls clearEntry(KEY_A), asserts KEY_A's 4 slice sizes are 0 AND KEY_B's pendingEdits is preserved.
- [x] `AC-251-S4` (purgeKey deletes the entry) — `dataGridEditStore.test.ts:102-114`. Seeds KEY_A, calls purgeKey, asserts entries.has(KEY_A) is false AND getEntry returns the EMPTY_ENTRY singleton (proving stable identity). **Caveat**: does not assert that OTHER entries remain — see F-001.
- [x] `AC-251-S5` (purgeForConnection prefix-scoped) — `dataGridEditStore.test.ts:116-134`. Seeds KEY_A + KEY_B (conn1) and KEY_OTHER_CONN (conn2), purges conn1, asserts conn1 entries gone AND conn2 entry preserved.

### Hook (AC-251-H1..H5)

- [x] `AC-251-H1` (unmount → re-mount preserves 4 slices) — `useDataGridEdit.persist.test.ts:110-149`. First hook does cell-edit + add-row + delete-row → asserts 4 slices populated → unmounts → re-mounts with SAME (cid, schema, table) → asserts pendingEdits.get("0-1") === "Alicia", pendingNewRows.length === 1, pendingDeletedRowKeys.size === 1, canUndo === true.
- [x] `AC-251-H2` (different key → empty state) — `useDataGridEdit.persist.test.ts:151-167`. First hook seeds pendingNewRow on table=users → unmount → mount with table=orders → asserts all 4 slices empty.
- [x] `AC-251-H3` (two same-key hooks share state) — `useDataGridEdit.persist.test.ts:169-182`. Mounts two hooks concurrently, addRow on hook A → asserts both A and B see pendingNewRows.length === 1 + canUndo === true.
- [x] `AC-251-H4` (clearAllPending wipes the entry) — `useDataGridEdit.persist.test.ts:184-211`. Seeds new row → handleDiscard → asserts hook state empty → also reads `useDataGridEditStore.getState().getEntry(key)` directly to confirm store-level state cleared → unmounts and re-mounts → asserts second mount sees empty.
- [x] `AC-251-H5` (Sprint 249/250 invariants under store) — `useDataGridEdit.persist.test.ts:213-255`. Tests handleAddRow → undo restores empty (Sprint 249); saveCurrentEdit on real value-change persists (Sprint 250); cancelEdit (Esc) does NOT push pendingEdits (Sprint 250).

### tabStore wire (AC-251-T1..T3)

- [x] `AC-251-T1` (removeTab purges when no sibling) — `tabStore.purge.test.ts:33-53`. Adds one table tab, seeds store entry, removes the tab, asserts `entries.has(key)` is false.
- [x] `AC-251-T2` (removeTab does NOT purge when sibling survives) — `tabStore.purge.test.ts:55-113`. Force-adds two tabs targeting same (cid, schema, table) via raw setState (bypasses preview-replace logic), removes the first, asserts entry survives + `entry.pendingEdits.get("0-1") === "Alicia"`. The setState bypass is acceptable (preview-replace is orthogonal to the purge contract — verified by reading addTab L131-150 which DOES collapse same-key adds).
- [x] `AC-251-T3` (clearTabsForConnection bulk purge) — `tabStore.purge.test.ts:115-159`. Adds 3 tabs (conn1×2 + conn2×1), seeds 3 entries, clears conn1, asserts conn1 keys gone AND conn2 key survives.

### Regression (AC-251-R1..R4)

- [x] `AC-251-R1` `useDataGridEdit.undo.test.ts` — verified untouched (`git diff HEAD` shows 0 changes); 9/9 pass in re-run.
- [x] `AC-251-R2` `DataGrid.undo.test.tsx` — verified untouched; 5/5 pass.
- [x] `AC-251-R3` `useDataGridEdit.onblur.test.ts` — verified untouched; 5/5 pass.
- [x] `AC-251-R4` `DataGrid.esc.test.tsx` — verified untouched; 4/4 pass.
- [x] Bonus: full vitest 3003/3003 passes (Sprint 250 baseline was 2989; new tests are 6 + 5 + 3 = 14, expected ~3003 — matches).

### Invariants

- [x] Returned 30+ field shape preserved — verified by `git show HEAD:src/components/datagrid/useDataGridEdit.ts` vs working tree at the `return {` block (L773-L808 vs L865-L900). Field order, names, and types identical.
- [x] `tabStore.dirtyTabIds` publish flow preserved — `useDataGridEdit.ts:792-808` setTabDirty effect untouched.
- [x] `setTabDirty` call sites unchanged — only the slice-source moved (useState → store), the dirty publish is still in the same useEffect with the same dependencies.
- [x] IPC / safeModeStore / persistence — no diff to those files.
- [x] Mongo grid read-only invariant — DocumentDataGrid.tsx untouched; passes database/collection as schema/table to the same hook; the store key is well-formed and entry stays empty (no write paths fire). Hook fallback `__instance__::*` exists for empty-string edge but is unreachable from DocumentDataGrid (props are required).

## Findings

### F-001 AC-251-S4 test does not lock in "other entries untouched" contract

- Severity: P3 (minor — implementation is correct; test gap)
- Repro: Open `src/stores/dataGridEditStore.test.ts:102-114` (the AC-251-S4 case).
- Expected: Test should assert that `purgeKey(KEY_A)` leaves KEY_B's entry intact (mirroring the pattern in AC-251-S3 at L97-99 and AC-251-S5 at L133).
- Actual: Test only asserts `entries.has(KEY_A) === false` and that `getEntry(KEY_A)` returns the EMPTY_ENTRY singleton. If a future regression made `purgeKey` accidentally clear the whole map (e.g. `set({entries: new Map()})`), this test would still pass.
- Evidence: `src/stores/dataGridEditStore.test.ts:102-114` shows no `KEY_B` setup or assertion in the S4 case. Implementation at `src/stores/dataGridEditStore.ts:156-162` is correct (single delete on a copied Map), so this is a pure test-coverage gap, not a bug.
- Broken Contract Line: contract `AC-251-S4` says "purgeKey → entry 삭제" — singular, so the contract is technically met. The evaluator's review brief asked for "purgeKey leaves OTHER entries alone" which IS the implicit guarantee this test should fence.
- Suggestion: Before `purgeKey(KEY_A)` add `setSlice(KEY_B, "pendingEdits", new Map([["0-1", "preserved"]]))` and after the purge add `expect(entries.has(KEY_B)).toBe(true)` + `expect(entries.get(KEY_B)?.pendingEdits.get("0-1")).toBe("preserved")`.
- Status: open

### F-002 Handoff AC line citations drift 3-7 lines from actual test file

- Severity: P3 (minor — test names/AC labels are correct; line numbers are off)
- Repro: Open `docs/sprints/sprint-251/handoff.md:96-108` and compare cited line numbers against `src/stores/dataGridEditStore.test.ts`.
- Expected: Citations point to the EXACT `it(...)` line. Handoff's job is to make eval re-verification frictionless.
- Actual: Cited L46/L70/L96/L109 for S2/S3/S4/S5. Actual lines are L49/L75/L102/L116. Off by 3, 5, 6, 7 lines respectively. Same drift in `useDataGridEdit.persist.test.ts` (handoff cites L104 for H1; actual is L110).
- Evidence: `git show HEAD --` shows no working-tree edits to the test files since handoff was written; the citations were just produced from an earlier draft of the file.
- Broken Contract Line: Contract requires "테스트 파일:라인 매핑" — the requirement is met directionally but accuracy slipped.
- Suggestion: Re-run `grep -n "AC-251-" src/stores/dataGridEditStore.test.ts` and update the handoff numbers verbatim. Same for the persist + tabStore.purge tests.
- Status: open

### F-003 Hook selector wakes up every grid mount on every other tab's pending edit

- Severity: P3 (minor — perf-only, no semantic regression vs Sprint 250 baseline)
- Repro: Mount two `useDataGridEdit` hooks on different (cid, schema, table) keys → write to one slice on KEY_A → both hooks re-render.
- Expected: Ideally only the hook bound to KEY_A re-renders (the KEY_B hook's selector value is unchanged).
- Actual: Selector `(s) => s.entries.get(storeKey)` returns a new entry reference whenever `state.entries` itself is replaced (which `setSlice`, `clearEntry`, `purgeKey`, `purgeForConnection` ALL do — they always allocate `new Map(state.entries)`). For KEY_B's hook, the selector RESULT may still be `undefined` (then `?? EMPTY_ENTRY`), which is the SAME reference as before — so React's default equality check should bail out. Actually verifying: zustand's default equality is `Object.is`, and `undefined ?? EMPTY_ENTRY` for both renders gives the same EMPTY_ENTRY ref → no re-render. So the worst case is for KEY_A's hook which legitimately needs the update.
- Evidence: After re-reading `useDataGridEdit.ts:428-429` and `dataGridEditStore.ts:130`, the EMPTY_ENTRY identity DOES hold across selector calls. **This finding partially self-resolves** — the only remaining concern is that any active hook on a key with a real entry will re-render whenever its OWN entry's identity changes (which it must, since one of its slices changed). That's the normal/desired behavior. The Generator's "Hook selector recomputes" residual risk is overstated.
- Broken Contract Line: None.
- Suggestion: Generator's residual risk note can be softened — the EMPTY_ENTRY singleton handles the cross-key idle case correctly. Real-entry case re-renders are necessary by definition. If a future profiler shows excessive renders on rapidly-changing slices, switch to per-slice selectors with shallow equality. No action required this sprint.
- Status: closeable as informational

## Pass Checklist

- `AC-251-S1`: PASS — `dataGridEditStore.test.ts:32`
- `AC-251-S2`: PASS — `dataGridEditStore.test.ts:49`
- `AC-251-S3`: PASS — `dataGridEditStore.test.ts:75`
- `AC-251-S4`: PASS (with F-001 gap) — `dataGridEditStore.test.ts:102`
- `AC-251-S5`: PASS — `dataGridEditStore.test.ts:116`
- `AC-251-H1`: PASS — `useDataGridEdit.persist.test.ts:110`
- `AC-251-H2`: PASS — `useDataGridEdit.persist.test.ts:151`
- `AC-251-H3`: PASS — `useDataGridEdit.persist.test.ts:169`
- `AC-251-H4`: PASS — `useDataGridEdit.persist.test.ts:184`
- `AC-251-H5`: PASS — `useDataGridEdit.persist.test.ts:213`
- `AC-251-T1`: PASS — `tabStore.purge.test.ts:33`
- `AC-251-T2`: PASS — `tabStore.purge.test.ts:55`
- `AC-251-T3`: PASS — `tabStore.purge.test.ts:115`
- `AC-251-R1`: PASS — 9/9 in `useDataGridEdit.undo.test.ts` (untouched)
- `AC-251-R2`: PASS — 5/5 in `DataGrid.undo.test.tsx` (untouched)
- `AC-251-R3`: PASS — 5/5 in `useDataGridEdit.onblur.test.ts` (untouched)
- `AC-251-R4`: PASS — 4/4 in `DataGrid.esc.test.tsx` (untouched)

## Feedback for Generator

1. **Test coverage (F-001)** — AC-251-S4 should explicitly assert that `purgeKey` leaves OTHER entries alone, mirroring the AC-251-S3 / AC-251-S5 pattern. Two extra lines (`setSlice(KEY_B, ...)` + `expect(entries.has(KEY_B)).toBe(true)`) close the gap. The Sprint 251 sub-task list said "purgeKey leaves OTHER entries alone" — the contract didn't formalize this specific assertion, but the evaluator brief did.
2. **Handoff accuracy (F-002)** — Cited line numbers in `handoff.md` drift 3-7 lines from actual test file positions. Re-grep before publishing the handoff. (Suggested one-liner: `grep -n "AC-251-" src/stores/*.test.ts src/components/datagrid/useDataGridEdit.persist.test.ts src/stores/tabStore.purge.test.ts`.)
3. **Residual risk wording (F-003)** — Soften the "Hook selector recomputes" note. The EMPTY_ENTRY singleton handles the idle-key case correctly because zustand's default `Object.is` equality bails when the selector returns the SAME reference (and `undefined ?? EMPTY_ENTRY` is reference-stable). Re-renders on the active key are by definition necessary.
4. **EMPTY_ENTRY inner mutability** (informational, not actionable) — `Object.freeze` on `EMPTY_ENTRY` only freezes the outer object; the inner `Map`/`Set`/`Array` are mutable. The discipline that all writes go through `setSlice` (which allocates fresh containers) keeps this safe, but a future contributor who calls `entry.pendingEdits.set(...)` directly would silently corrupt the singleton. Consider adding a runtime trap (e.g. wrap inner Map/Set in Proxies that throw on write) or a comment block at the EMPTY_ENTRY definition warning future contributors. Not a blocker.
5. **Test isolation (informational)** — The `src/test-setup.ts` global reset is justified and explained well. It does NOT mask production state-leak bugs (production accumulates state across (cid, schema, table) by design; the reset is purely a test-process singleton concern). Good comment block.

## Missing Evidence

- None blocking. The 7 required checks all have stdout evidence. Code excerpts in handoff are correct (match the working-tree files verbatim). The 4 minor improvements above are within the sprint's scope to address but do not block PASS.

## Residual Risk

- (Generator-acknowledged, accepted) Cross-window pending state NOT synced — explicitly out of scope per contract.
- (Generator-acknowledged, accepted) localStorage persistence NOT implemented — explicitly out of scope per contract.
- (Generator-acknowledged, accepted) DDL editor + raw-query grid still use per-mount useState — out of scope per contract.
- (New, low) `EMPTY_ENTRY` inner Map/Set are not deep-frozen; relies on caller discipline. Mitigated by `setSlice` always allocating fresh containers.
- (New, very low) The `__instance__::<random>::<timestamp>` fallback key uses `Math.random().toString(36)` — collision is astronomically unlikely (~52 bits) but not cryptographically guaranteed. Acceptable for an unreachable code path under current callers.

---

## Structured Scorecard Block (per evaluator prompt)

```json
{
  "sprint": "sprint-251",
  "verdict": "PASS",
  "scores": {
    "correctness": 9,
    "completeness": 9,
    "reliability": 8,
    "verification_quality": 8,
    "overall": 8.6
  },
  "rubric": "system",
  "ac_status": {
    "AC-251-S1": "pass",
    "AC-251-S2": "pass",
    "AC-251-S3": "pass",
    "AC-251-S4": "pass-with-gap",
    "AC-251-S5": "pass",
    "AC-251-H1": "pass",
    "AC-251-H2": "pass",
    "AC-251-H3": "pass",
    "AC-251-H4": "pass",
    "AC-251-H5": "pass",
    "AC-251-T1": "pass",
    "AC-251-T2": "pass",
    "AC-251-T3": "pass",
    "AC-251-R1": "pass",
    "AC-251-R2": "pass",
    "AC-251-R3": "pass",
    "AC-251-R4": "pass"
  },
  "open_findings": [
    {"id": "F-001", "severity": "P3", "title": "AC-251-S4 missing 'other entries untouched' assertion"},
    {"id": "F-002", "severity": "P3", "title": "Handoff line numbers drift 3-7 lines from test files"},
    {"id": "F-003", "severity": "P3", "title": "Residual risk wording can be softened (informational)"}
  ],
  "blocker_findings": [],
  "checks_run": {
    "tsc": "pass",
    "lint": "pass",
    "vitest": "pass (3003/3003)",
    "cargo_test": "pass (627/627)",
    "cargo_clippy": "pass",
    "rg_dataGridEditStore": "pass (>=3 matches across 7 files)",
    "rg_purgeKey_purgeForConnection": "pass (2 matches in tabStore.ts)"
  }
}
```
