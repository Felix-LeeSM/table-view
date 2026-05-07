# Sprint 231 Evaluation Scorecard

P0 — Safe Mode raw RDB query path closure.

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | Single-pass gate; matrix dispatch correct (file:line evidence below). |
| Completeness | 9/10 | All 8 ACs covered with concrete test or audit memo evidence. |
| Reliability | 9/10 | All 16 freeze invariants = 0 diff; 2846 tests PASS; cargo clippy + cargo test PASS. |
| Verification Quality | 9/10 | TDD red-state credible (6/8 fail in pre-fix code with right error mode); tests assert behavior (executeQuery NOT called on block; one dialog for batch). |
| **Overall** | **9.0/10** | |

## Verdict: PASS

All 4 dimensions ≥ 7. Ready to commit.

## 16 verification check results — independent

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run` | PASS — 220 files / 2846 tests / 0 failed (independently re-run) |
| 2 | `pnpm tsc --noEmit` | PASS — exit 0 |
| 3 | `pnpm lint` | PASS — exit 0 |
| 4 | `cargo build --manifest-path src-tauri/Cargo.toml` | PASS — exit 0 |
| 5 | `cargo clippy --all-targets --all-features -- -D warnings` | PASS — exit 0 |
| 6 | `cargo test --manifest-path src-tauri/Cargo.toml` | PASS — 373 + 17 + 14 + 12 + 11 + 3 + 2 ignored = full suite green; create_table 16/16, create_index 11/11, add_constraint 12/12, list_types fixture present |
| 7 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | 0 |
| 8 | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | 0 |
| 9 | `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | 0 (cross-window-connection-sync.test.tsx + cross-window-store-sync.test.tsx + window-lifecycle.ac141.test.tsx) |
| 10 | `git diff --stat src/stores/{connectionStore,schemaStore,safeModeStore}.ts` | 0 |
| 11 | `git diff --stat src/lib/safeMode.ts src/lib/sql/sqlSafety.ts` | 0 |
| 12 | `git diff --stat` Sprint 230 frozen files (Header / IndexesTabBody / ForeignKeysTabBody / useFkReferencePicker / usePostgresTypes / postgresTypes / CreateTableTypeCombobox) | 0 |
| 13 | `grep -nE 'safeModeGate|useSafeModeGate' useQueryExecution.ts` | 5 hits (≥ 2) — line 13, 127, 406, 511, 568 |
| 14 | `grep -nE 'analyzeStatement' useQueryExecution.ts` | 2 hits (≥ 1) — line 12, 511 |
| 15 | `grep -nE 'pendingRdbConfirm' useQueryExecution.ts QueryTab.tsx` | 10 hits (≥ 3) — useQueryExecution.ts: 68/125/135/337/345/579, QueryTab.tsx: 101/236/239/240 |
| 16 | Sprint 226–230 vitest fixture (incl. `useDataGridEdit.safe-mode.test.ts`) | PASS unchanged (all 220 files green) |

**16/16 PASS.**

## Per-AC evidence

### AC-231-01 — single-statement RDB gate (PASS)
`useQueryExecution.ts:490-572` gates the SQL path BEFORE the running-state transition. The gate body at line 508-521 calls `analyzeStatement(stmt)` then `safeModeGate.decide(...)` over the post-comment-strip statements. Block dispatch (line 522-533): `updateQueryState({ status: "error", error: worstReason })` + `recordHistory({ status: "error", duration: 0 })`. **No `dispatchDbMutationHint` call** in the block branch — confirmed at line 525-532 (only the run paths invoke it via `runRdbSingleNow:241` / `runRdbBatchNow:320`). Confirm dispatch (line 534-540): `setPendingRdbConfirm({ statements, reason })` + early return. Allow dispatch falls through to `runRdbSingleNow(sql)` (line 542-550) for `length === 1` or `runRdbBatchNow(statements, sql)` (line 556) for multi.

### AC-231-02 — multi-statement strategy (PASS)
Single-pass over `statements` (the post-strip array, not raw split) at `useQueryExecution.ts:510-521`. Priority `block > confirm > allow`: a `block` hit `break`s the loop (line 515); a `confirm` hit only upgrades when `worstAction === "allow"` so the FIRST dangerous statement's reason is recorded (line 517-520). Single dialog per batch (line 538: `setPendingRdbConfirm({ statements, reason: worstReason })` — one call, all statements stuffed in `statements: string[]`). Confirm-then-execute reuses the batch helper at `runRdbBatchNow:258` which iterates `executeQuery` per statement in order. No partial execution on block (verified: `executeQuery` is unreachable from line 522-532).

### AC-231-03 — pending-confirm UI (PASS)
`QueryTab.tsx:236-244` mounts `<ConfirmDangerousDialog>` keyed on `pendingRdbConfirm`. Props match contract: `open`, `reason={pendingRdbConfirm.reason}`, `sqlPreview={pendingRdbConfirm.statements.join(";\n")}` (verbatim batch), `onConfirm={confirmRdbDangerous}`, `onCancel={cancelRdbDangerous}`. Confirm path (`useQueryExecution.ts:336-345`) clears state then re-enters `runRdbSingleNow` or `runRdbBatchNow` (skips gate). Cancel path (line 347-349) only clears `pendingRdbConfirm` — no `updateQueryState` call (running-invariant preserved).

### AC-231-04 — `useDataGridPreviewCommit.ts` audit (PASS, no leak)
Audit memo `findings.md §1` validated against actual code. `useDataGridPreviewCommit.ts:413-444` — RDB branch iterates `statements` calling `safeModeGate.decide(analyzeStatement(stmt.sql))` on EVERY statement BEFORE `runRdbBatch` dispatch. Block sets `commitError` and `return`; confirm sets `pendingConfirm` and `return`. `runRdbBatch` (which actually calls `executeQueryBatch`) is unreachable except via the allow-fall-through. `clearAllPending()` only fires post-success. **File diff = 0 (verified via `git diff --stat`).**

### AC-231-05 — ConnectionDialog environment dropdown audit (PASS)
Audit memo `findings.md §2` validated. `ConnectionDialogBody.tsx:250-280` renders `<Select>` with `<label htmlFor="conn-environment">`, `<SelectTrigger id="conn-environment" aria-label="Environment">`, iterates `ENVIRONMENT_OPTIONS` (which includes `production` per `src/types/connection.ts:280-286`). `ENV_NONE_SENTINEL` maps to `null`. Existing test coverage `ConnectionDialog.test.tsx:555-629`. **File diff = 0.**

### AC-231-06 — test matrix coverage (PASS)
8 cases in `QueryTab.safe-mode.test.tsx`:
- `[AC-231-01a]` line 165 — prod+strict+DELETE→block, executeQuery 0×, status=error, history{status: error, duration: 0}.
- `[AC-231-01e]` line 197 — prod+strict+SELECT→allow, executeQuery 1×.
- `[AC-231-01b]` line 214 — prod+warn+DELETE→confirm dialog, executeQuery 0×.
- `[AC-231-01c]` line 240 — prod+off+DROP→block, error matches `/production environment forces Safe Mode/`.
- `[AC-231-01d]` line 268 — development+strict+DROP→allow, executeQuery 1×.
- `[AC-231-02a]` line 285 — prod+strict+multi (SELECT 1; DELETE FROM users)→block, executeQuery 0×.
- `[AC-231-02b]` line 305 — prod+warn+multi (UPDATE WHERE; DELETE without WHERE)→confirm-then-run; reason is the FIRST dangerous = "DELETE without WHERE clause"; both statements in preview verbatim; on confirm `executeQuery` called twice in order via `toHaveBeenNthCalledWith(1, …UPDATE…)` + `toHaveBeenNthCalledWith(2, …DELETE…)`.
- `[AC-231-03]` line 364 — cancel button → executeQuery 0×, dialog gone, queryState.status === "idle".

### AC-231-07 — no regression (PASS)
All 16 frozen-file diffs = 0 (verified via `git diff --stat` on the union of all paths). Sprint 226–230 fixtures unchanged (cargo test continues to show same counts). Vitest 220 files / 2846 tests, all PASS.

### AC-231-08 — `docs/PLAN.md` row 6 (PASS)
`docs/PLAN.md:157` row 6 shows `**231** ✓ feature (Phase 23 회귀 fix) Safe Mode raw RDB query path closure …` with full summary including AC-231-04/05 audit results and 220/2846 vitest counts. Row 7 (line 158) carries the deferred `232+` Phase 27 sprint 6 polish backlog (per contract AC-231-08 "placeholder text 분리" requirement).

## TDD red-state credibility — PASS

`tdd-evidence/red-state.log` shows the 8-case suite run against pre-fix code at 11:44:45. **6 of 8 cases fail with the diagnostically correct error**: `AssertionError: expected "vi.fn()" to not be called at all, but actually been called N times` (cases AC-231-01a/01b/01c/02a/02b show `executeQuery` was hit 1-2 times because no gate existed). The cancel case (`AC-231-03`) fails with `Unable to find role="button" and name "Cancel"` — also diagnostically correct because `pendingRdbConfirm` didn't exist pre-fix, so no dialog mounted. The 2 passing cases (`01d` non-prod allow + `01e` safe SELECT allow) correctly pass pre-fix because the un-gated path coincidentally produces the expected outcome (allow). After fix: 8/8 PASS as confirmed by independent vitest run.

## Per-dimension reasoning

### Correctness — 9/10
- Single-statement gate is correctly placed BEFORE running-state transition (`useQueryExecution.ts:508` precedes `runRdbSingleNow` at line 549). Block path skips both `executeQuery` and `dispatchDbMutationHint` (verified line 525-532). Confirm path skips `executeQuery` and avoids running entry (line 538-540).
- Multi-statement is single-pass (`for (const stmt of statements)` line 510) — not nested or per-statement dialog. Priority `block > confirm > allow` enforced via `worstAction` ladder + early `break` on block (line 515).
- One dialog per batch confirmed: `setPendingRdbConfirm` is called exactly once with `{ statements, reason }` (line 538).
- `confirmRdbDangerous` (line 336-345) re-enters the same helpers — single-statement uses `runRdbSingleNow`, multi uses `runRdbBatchNow` with `joinedSql` for history. Reason: first-dangerous (matches `decideSafeModeAction:31` `primary = analysis.reasons[0]`).
- Subtraction: minor — the `worstReason` for `block` carries the wrapped human copy (`Safe Mode blocked: ... (toggle Safe Mode off ...)`) which is correct for the error message but means the priority ladder mixes wrapped+raw reasons (no functional issue, just slightly inconsistent shape if a block is later replaced by a confirm — but `break` prevents this).

### Completeness — 9/10
- All 8 ACs evidenced. AC-231-04/05 are audit-only and the audit memos cite specific lines I independently verified (`useDataGridPreviewCommit.ts:419-444` + `ConnectionDialogBody.tsx:250-280`).
- Helper extraction `runRdbSingleNow` (line 211) + `runRdbBatchNow` (line 258) per Design Bar — both mirror the Mongo `runMongoAggregateNow` pattern.
- Test reset extended (`queryTabTestHelpers.ts:154` adds `useSafeModeStore.setState({ mode: "strict" })`) so cases inherit a deterministic mode.
- Subtraction: minor — `it.skip`/`eslint-disable`/`any` zero-introduction confirmed via `pnpm lint` exit 0; the `eslint-disable-next-line react-hooks/exhaustive-deps` at line 558 is a pre-existing comment retained as the contract permits.

### Reliability — 9/10
- All freeze invariants confirmed = 0 via `git diff --stat`: useDdlPreviewExecution.ts, SqlPreviewDialog.tsx, both cross-window-*.test.tsx files, window-lifecycle.ac141.test.tsx, all three stores, safeMode.ts + sqlSafety.ts (decision matrix + analyzer body), all 7 Sprint 230 frozen files, useDataGridPreviewCommit.ts.
- Sprint 226–230 backend fixture byte-equivalent: independent `cargo test` shows create_table 16, create_index 11, add_constraint 12, list_types 2 PASS — no count drift.
- 4-set verification (vitest / tsc / lint / cargo build) + clippy + cargo test all exit 0.
- `dispatchDbMutationHint` is call-once-per-actual-execution (only fired in `runRdbSingleNow:241` and `runRdbBatchNow:320`); block/cancel paths skip it (preserves active_db invariant).
- Subtraction: minor — `worstReason` only reads the FIRST dangerous statement's reason; later dangerous statements in a batch (after a non-dangerous prefix that "won" the priority) won't surface their reasons in the dialog header. Mitigated by sqlPreview rendering the full batch verbatim. Documented as residual risk in handoff.

### Verification Quality — 9/10
- TDD red-state log credible: 6/8 fail with the right error mode (`expected vi.fn() not to be called, but called 1/2 times`) — exactly the symptom of a missing gate. Cancel case fails because the dialog doesn't mount pre-fix. After fix: 8/8 PASS via independent vitest run.
- Tests assert behavior, not implementation: `not.toHaveBeenCalled()` proves block disabled execution; `toHaveBeenNthCalledWith(1, ...UPDATE...)` + `toHaveBeenNthCalledWith(2, ...DELETE...)` proves confirm-then-run preserves order; the multi-statement test verifies a SINGLE dialog mounts (one `findByLabelText("Type danger reason to confirm")` after one execute click).
- Cancel test verifies `queryState.status === "idle"` (running invariant preserved).
- Each test has the date 2026-05-07 + reason in the file header per testing rule.
- Subtraction: minor — the AC-231-02b confirm-then-run test stages `mockExecuteQuery.mockResolvedValue` (without `Once`), which is fine here but slightly less surgical than `mockResolvedValueOnce` chained twice would be.

## Top 3 concerns

1. **P3 — Multi-statement reason header truncation**: The dialog header shows only the first dangerous statement's reason; a batch with 3 dangerous statements surfaces only one. Mitigated by full-statement preview pane. Owner: backlog polish sprint. (Documented in `findings.md §residual` and `handoff.md §residual risk`.)
2. **P3 — Cancel toast missing**: `cancelRdbDangerous` clears state silently. Per running invariant, but no user-visible feedback. Owner: backlog polish sprint.
3. **P3 — Analyzer gaps**: `analyzeStatement` is frozen (correctly); CTE-prefixed DELETE/UPDATE, MERGE, REPLACE INTO, PG `DELETE … USING` bypass the gate. Documented as a hardening sprint candidate.

No P0/P1/P2 findings.

## Ready to commit: YES

All exit criteria met:
- Open P1/P2 findings: 0.
- 16/16 verification checks PASS (independently verified).
- 8/8 ACs evidenced.
- `docs/PLAN.md` row 6 → ✓.
- `tdd-evidence/red-state.log` preserved with credible RED state.
- User repro scenarios closed: production+strict UPDATE→block error inline; production+warn DELETE→confirm dialog; production+off DROP→block prod-auto; non-prod→allow.
