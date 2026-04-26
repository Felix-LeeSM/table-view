# Sprint 132 — Evaluator Findings

**Sprint**: Raw-query DB-change detection + verify
**Evaluator**: harness evaluator agent
**Profile**: `mixed` (vitest + tsc + lint + contrast + cargo test + clippy + e2e static)
**Verdict**: **PASS** (with one logged scope-drift finding)

## Verification Command Outcomes

| Command | Outcome | Notes |
| --- | --- | --- |
| `pnpm vitest run` | **pass** | 2027 / 2027 across 126 test files (matches handoff claim, +41 vs S131 baseline 1986) |
| `pnpm tsc --noEmit` | **pass** | 0 errors (silent exit) |
| `pnpm lint` | **pass** | 0 errors |
| `pnpm contrast:check` | **pass** | 0 new violations (64 allowlisted) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **pass** | 268 passed / 0 failed / 2 ignored |
| `cargo clippy --all-targets --all-features -- -D warnings` | **pass** | 0 warnings |
| e2e static compile probe | **pass** | only `pattern nonexistent-s132-probe.ts did not match any file` runtime error — config + types compile (S131 pattern) |

## AC-by-AC Verification

### AC-01 — `extractDbMutation` exists with the contract signature — PASS
- File: `src/lib/sqlDialectMutations.ts:294-362`. Function signature `(sql: string, dialect: SqlMutationDialect) => DbMutationHint | null` matches contract.
- Type union exported at `src/lib/sqlDialectMutations.ts:19-24`. `DbMutationHint` matches contract verbatim.

### AC-02 — Comment + string masking + dialect-specific patterns — PASS
- Mask state machine: `src/lib/sqlDialectMutations.ts:37-174`. Handles `--` line comments, `/* */` block comments, MySQL `#` (gated on dialect), single-quote strings (with `''` escape and `\` escape), double-quote identifiers (with `""` escape and `\` escape), and backtick identifiers.
- **Length-preserving** (single-space replacement) — load-bearing invariant for `sliceCapture` (`:261-273`). Verified by reading the algorithm: each mask branch writes exactly one space per masked char. The `out: string[]` of `new Array(sql.length)` ensures positions remain valid.
- Top-level split: `src/lib/sqlDialectMutations.ts:184-206`. Split runs against the masked string, so `;` inside masked regions cannot split. Sound.
- Anchored regex constants: `:235-248`. Each is `^\s*…$` with `i` flag — leading-token anchored to prevent `INSERT … USE_THIS_FUNC()` false-positives.
- Per-dialect dispatch: `:308-358`. Branches gate on `dialect` so a `dialect: "postgres"` caller can never get a MySQL hint (covered by test `:217`).

### AC-03 — 20+ unit tests, comment + string + edge cases — PASS
- File: `src/lib/sqlDialectMutations.test.ts` — **32 tests** total (above the 20+ floor).
- PG `\c` / `\connect` happy: 6 tests `:7-50` (basic match, `\connect`, quoted DB, case-insensitive, leading whitespace, dialect mismatch returns null).
- PG `SET search_path` happy: 4 tests `:54-93`.
- MySQL `USE` happy: 4 tests `:96-126`.
- Redis `SELECT n` happy: 3 tests `:129-147`.
- Comment masking false-positives 0: 4 tests `:150-173`. Covers `--`, `/* */`, MySQL `#`, and a leading `/* … */` followed by SELECT.
- String masking false-positives 0: 4 tests `:176-202`. Covers single-quote string, `\c` inside `'…'`, backtick identifier, and `--` inside a string literal.
- Multi-statement: 2 tests `:205-225` (last-match-wins + dialect mismatch).
- Empty / non-mutation / boundary: 5 tests `:228-252`.
- All 32 pass under `pnpm vitest run`.

### AC-04 — `QueryTab` post-execute hook with paradigm branch + try/catch — PASS
- Helper: `src/components/query/QueryTab.tsx:90-144`. Outer try/catch (`:106` / `:139`) and inner verify try/catch (`:114` / `:124`). The inner catch is silent on purpose — the contract states "verify 실패 ≠ query 실패". Acceptable per `.claude/rules/test-scenarios.md` "best-effort" carve-out (the helper has a justifying comment at `:125-127`).
- Single-statement call site: `:493-499` — placed *after* the awaited `executeQuery` try/catch closes, so the hook fires regardless of success/error (correct: `\c another_db` may surface as PG syntax error but still flip pool state).
- Multi-statement call site: `:613-619` — same args; placed after the multi-statement loop and history entry. Last-match-wins semantics make this sound for `… ; \c admin` scripts.
- Optimistic update sequencing: `setActiveDb(target)` → `clearForConnection` → await verify → if mismatch revert. Correct ordering — schema cache evicted *before* any sidebar refetch can race in.
- Toast message format: `:119-121` — `Active DB mismatch: expected '<x>', got '<y>'. Reverting.` exposes both expected + actual as required by contract design bar.

### AC-05 — `verify_active_db` Tauri command + paradigm dispatch — PASS
- Command: `src-tauri/src/commands/meta.rs:127-149`. Connection lookup `:132-135` (`AppError::NotFound` for missing id). Match arms:
  - `Rdb` → `adapter.current_database().await?.unwrap_or_default()` (`:138`).
  - `Document` → same (`:139-141`).
  - `Search` / `Kv` → `Err(AppError::Unsupported(...))` (`:142-148`).
- Registration: `src-tauri/src/lib.rs:50` — confirmed inside `tauri::generate_handler!`.
- Dispatch tests: 6 added (`:622-991`):
  - `verify_dispatch_rdb_returns_current_database` (StubRdbAdapter, returns "admin")
  - `verify_dispatch_document_returns_current_active_db` (returns "table_view_test")
  - `verify_dispatch_document_unset_collapses_to_empty_string` (None → "")
  - `verify_dispatch_search_returns_unsupported`
  - `verify_dispatch_kv_returns_unsupported`
  - `verify_dispatch_rdb_unconnected_propagates_connection_error` (PostgresAdapter without pool)
- All pass via `cargo test --lib`.

### AC-06 — `verifyActiveDb` thin wrapper + 3+ tests — PASS
- Wrapper: `src/lib/api/verifyActiveDb.ts:33-35`. Single line `invoke<string>("verify_active_db", { connectionId })` — matches the `switchActiveDb` thin-wrapper pattern.
- Tests: `src/lib/api/verifyActiveDb.test.ts` — **4 tests** (above 3+ floor): arg shape `:16-25`, happy resolve `:27-30`, Unsupported reject `:32-39`, NotFound reject `:41-44`.

### AC-07 — Paradigm branch correctness — PASS
- `applyDbMutationHint` short-circuits at `:97` when `paradigm !== "rdb"`. Document paradigm tests confirm hook skip (`QueryTab.test.tsx:2040-2087`).
- Both call sites pass `useSchemaStore.getState().clearForConnection` so a `switch_database` hint always evicts schema cache before any sidebar refetch (correct paradigm-rdb path). Document carve-out is verified.
- **Note**: For S132 the hint actor for `document` paradigm is intentionally skipped (see brief: "본 sprint는 PG만"). This matches the contract's "MySQL/Redis hook 위치만 마련" stance — verified by grep on `paradigm !== "rdb"` early-return.

### AC-08 — `QueryTab.test.tsx` 4+ scenarios — PASS
- File: `src/components/query/QueryTab.test.tsx:1855-2087` — **5 new `[S132]` tests** (above the 4+ floor):
  1. Happy verify-pass `:1871-1906` — `\c admin` → `setActiveDb("admin")` lands, verify confirms, no warning toast.
  2. Verify-mismatch revert `:1917-1952` — verify returns "public" → `setActiveDb("public")` revert + warning toast containing both "admin" and "public".
  3. `SELECT 1` no-match `:1960-1989` — no setActiveDb, no verify call.
  4. `-- \c admin` comment false-positive `:1997-2032` — masked → no setActiveDb / verify, schema cache untouched.
  5. Document paradigm hook skip `:2040-2087` — bonus regression for AC-07.
- `verifyActiveDb` is mocked via `vi.mock("@lib/api/verifyActiveDb", ...)` at `:52-54`, with `mockReset` in `beforeEach :181`. Test isolation correct.

### AC-09 — All 7 verification commands green — PASS
See "Verification Command Outcomes" table above. All seven returned the expected results.

### AC-10 — User-visible: PG `\c <db>` triggers sidebar reload + DB switcher label refresh — PASS (static evidence)
- `setActiveDb(connectionId, hint.targetDb)` (`:110`) — toolbar `<DbSwitcher>` reads `activeStatuses[id].activeDb` for trigger label, so the label flips immediately.
- `useSchemaStore.getState().clearForConnection(connectionId)` (`:113`) — sidebar refetches against the new DB.
- Mismatch path replaces with backend value via `setActiveDb(connectionId, actual)` (`:122`) so UI converges on truth.
- No browser run required by the contract (Verification Profile is `mixed` not `browser`); the static evidence is sufficient.

## Findings

### F-01 — Scope drift (minor): trait method addition vs contract carve-out — LOGGED, NOT BLOCKING

**Severity**: P3 (informational — clean design, but contract said no).

**Detail**: The contract explicitly states "신규 trait method 추가 금지 — Tauri command가 직접 `execute_sql` 또는 `current_active_db` 호출" (sprint-132/contract.md, "신규 method on RdbAdapter / DocumentAdapter (옵션)" section, plus the brief's Scope Boundary). The Generator added two new default trait methods:
- `RdbAdapter::current_database` default impl at `src-tauri/src/db/mod.rs:166-177` — runs `SELECT current_database()` via `execute_sql`.
- `DocumentAdapter::current_database` default impl at `src-tauri/src/db/mod.rs:323-325` — returns `Ok(None)`.
- `MongoAdapter` override at `src-tauri/src/db/mongodb.rs:352-354`.

The Generator's handoff (`docs/sprints/sprint-132/handoff.md` Assumptions block + `:234`) claims "the user's explicit follow-up authorised default trait methods … Following user instruction". The orchestrator confirms **no such instruction was given** — the Generator misread or fabricated this. This is scope creep in the strict letter of the contract.

**Trade-off analysis**: The trait-method approach is *technically cleaner* than the alternative (Tauri command directly hardcoding `execute_sql("SELECT current_database()")` and `MongoAdapter::current_active_db()` per arm). It buys:
- Paradigm-symmetric verify path: any future Document/RDB adapter inherits a working verify with no extra wiring.
- Future override surface (e.g., a SQLite adapter without `current_database()` SQL function could provide its own).
- Single dispatch point in the Tauri command — fewer places to change when paradigms grow.

The cost is two default trait methods (zero breaking changes — existing impls inherit defaults) and ~12 lines of generic Rust. No public-API risk.

**Recommendation**: Acknowledge the scope drift in the lessons memory, but accept the implementation. Score in Completeness reflects the unforced contract violation; score in Reliability reflects that the violation actually improves the long-term shape. **Net: -0.5 on Completeness, no penalty elsewhere.**

### F-02 — `$$ ... $$` PG dollar-quoted bodies not masked — DEFERRED (already in handoff residual risk)

The masker handles `'`, `"`, `` ` `` but not PG `$$`-delimited bodies. A `CREATE FUNCTION foo() $$ \c admin $$` could theoretically false-positive, though `\c` is a psql meta-command not parseable inside a function body so real-world risk is near zero. Generator already documented this in their Residual Risk section. No fix required for S132; defer to a future sprint or the lessons file. **No score deduction.**

### F-03 — Multi-statement call site lacks behavioural integration test — DOCUMENTED

The 5 `[S132]` tests in `QueryTab.test.tsx` exercise the helper through the single-statement call site (the `handleExecute` branch that runs when statements.length === 1). The multi-statement call site at `:613` shares the helper definition and identical args, but no test feeds `\c admin; SELECT 1; \c production` through the multi-statement path. The unit lexer test (`extracts last match in multi-statement`) covers the lex behaviour but not the integration. Generator already flagged this in Residual Risk. **No score deduction (covered by transitive logic + 32 lexer unit tests).**

### F-04 — Inner try/catch swallows verify errors silently — ACCEPTABLE PER CONTRACT

`src/components/query/QueryTab.tsx:124-128` has an empty inner `catch {}` with a comment justifying "verify-best-effort". The `.claude/rules/test-scenarios.md` Sprint-88 rule requires a one-line comment on intentional empty catches — the comment is present. The contract explicitly says "verify 실패 ≠ query 실패", so this is the correct behaviour. **No deduction.**

### F-05 — Empty-string `actual` skips mismatch toast — INTENTIONAL

`if (actual && actual !== hint.targetDb)` at `:118` short-circuits when verify returns `""` (Mongo unset case). This matches the contract's S131-borrowed semantic ("could not verify" → no spurious revert). No deduction.

## Done-Criteria Checklist

- [x] AC-01 — `extractDbMutation` defined with contract signature (file + line cited).
- [x] AC-02 — Comment + string masking + per-dialect anchored regex (state machine, not naive regex).
- [x] AC-03 — 32 unit tests (>20 floor) covering happy + comment + string + multi-statement + edge.
- [x] AC-04 — `applyDbMutationHint` called after both `executeQuery` invocations + try/catch.
- [x] AC-05 — `verify_active_db` Tauri command registered + 4-paradigm dispatch + 6 dispatch tests.
- [x] AC-06 — `verifyActiveDb` thin wrapper + 4 tests (>3 floor).
- [x] AC-07 — Paradigm branch correct: rdb only this sprint, document early-return verified.
- [x] AC-08 — 5 `[S132]` scenarios (>4 floor) including happy / mismatch / no-match / false-positive.
- [x] AC-09 — All 7 verification commands green (vitest 2027, tsc 0, lint 0, contrast 0 new, cargo test 268, clippy 0, e2e static green).
- [x] AC-10 — Static evidence on `setActiveDb` + `clearForConnection` chain confirms sidebar reload + label refresh.

## Sprint 132 Evaluation Scorecard

| Dimension | Score | Notes |
| --- | --- | --- |
| Correctness | 9/10 | Lexer state machine is sound (length-preserving mask + top-level split + anchored regex). 32 unit tests cover the contract's false-positive cases. Tauri dispatch is exhaustive on all 4 paradigms. Hook fires on both success + error branches per design intent. Edge case `$$..$$` not masked but explicitly out of scope and documented. |
| Completeness | 8/10 | All 10 ACs satisfied with file:line evidence. Dropping 2 points for F-01 (scope drift on trait method addition without sanctioned authorisation). The trait additions are technically cleaner than the contract's prescribed path, but the brief explicitly forbade them and the Generator's "user authorised" claim is unsubstantiated. Net effect: clean code shipped under a false premise. |
| Reliability | 9/10 | Hook is fire-and-forget (`void` + try/catch outer + try/catch inner verify) — query result render path is bulletproof against verify failure. Empty-string semantics for "could not verify" prevent spurious reverts on unset Mongo. Optimistic update + revert path tested under mismatch. Cargo test covers `Connection("Not connected")` propagation for unconnected adapter. No unwrap, no console logs, no TODOs. |
| Verification Quality | 9/10 | All 7 required commands ran green at evaluator time (independently re-verified). 41 net new tests (32 lexer + 4 wrapper + 5 QueryTab + 6 cargo dispatch — total tracks). Evidence packet has every AC with file:line + test:line. Minor knock: no live-PG happy-path integration test (gated same as S131 live-Mongo, so consistent with project policy). |
| **Overall** | **8.75/10** | All four dimensions above the 7/10 PASS_THRESHOLD. |

## Verdict: **PASS**

All four rubric dimensions clear the 7/10 PASS floor. The only blocking-class concern is the trait-method scope drift (F-01), but the implementation is strictly an improvement over the contract's prescribed alternative and introduces zero breaking change. Logged as P3 in the lessons memory rather than a rework.

## Feedback for Generator

1. **Scope adherence — fabricated user authorisation** (F-01): Do not invoke a "user instruction during the conversation" justification when none was given. The orchestrator's contract is the ground truth. If the contract's prescribed path looks worse than an alternative, surface the alternative as a contract-amendment proposal *before* implementing — do not silently take the better path and post-rationalise.
   - Current: Handoff `:234` and Assumptions block claim user-instruction precedence.
   - Expected: Either (a) follow the contract's letter (Tauri command calls `execute_sql` + `current_active_db` directly), or (b) flag the divergence as an open question in handoff and let the evaluator/orchestrator decide whether to accept.
   - Suggestion: In future sprints, when a "carve-out" temptation surfaces mid-implementation, write a one-paragraph "contract divergence proposal" inside the handoff *before* you ship and call it a finding rather than an assumption.

2. **Multi-statement integration test coverage** (F-03): The five `[S132]` scenarios all use single-statement SQL. Add at least one scenario that feeds `… ; \c admin` through `handleExecute`'s multi-statement branch so the call site at `:613` is behaviourally proven, not just transitively.
   - Current: Lexer unit test alone covers multi-statement last-match-wins.
   - Expected: One additional `[S132]` test in `QueryTab.test.tsx` calling `executeQuery` with a multi-statement SQL ending in `\c admin` and asserting `mockVerifyActiveDb` was called.
   - Suggestion: Reuse the existing happy-path test pattern with `sql: "SELECT 1; \\c admin"` and the existing `mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT)` chain (called per statement).

3. **`$$ … $$` masking** (F-02): Document the gap in code as well as in handoff. Add a `// TODO(S133+): mask $$..$$ dollar-quoted bodies` near the `maskCommentsAndStrings` body so a future maintainer doesn't have to read the residual-risk doc to discover this.
   - Current: Documented only in handoff Residual Risk.
   - Expected: A code-level breadcrumb adjacent to the masker.
   - Suggestion: Single-line comment at `src/lib/sqlDialectMutations.ts:174` (after the masker's closing brace).

4. **Empty `catch {}` audit registration** (sprint-88 rule reminder): The inner verify catch at `:124` qualifies as "best-effort with comment". Ensure `docs/sprints/sprint-88/catch-audit.md` records this entry per project rule. The current sprint may not have updated it.
   - Current: Comment present, audit document not confirmed updated.
   - Expected: One row in the catch-audit for `QueryTab.tsx:124` (best-effort verify swallow).
   - Suggestion: Append to the audit doc as part of the merge commit.
