# Sprint 271a Evaluation — schema introspection guard

Evaluator: harness Evaluator (Opus 4.7, 1M context)
Date: 2026-05-13
Verification profile: `mixed` (all 6 gates re-run)

---

## Gate results (re-run by evaluator)

| Gate | Status | Notes |
|------|--------|-------|
| `cargo fmt --check` (in `src-tauri`) | PASS | no diff |
| `cargo clippy --all-targets --all-features -- -D warnings` (in `src-tauri`) | PASS | clean, no warnings |
| `cargo test` (in `src-tauri`) | PASS | lib `689 passed; 0 failed; 2 ignored` (Generator-claimed baseline 676 → 689 = +13 — reconciles with the 13 new mismatch-related Rust tests in `schema.rs::mod tests`: 12 mismatch + 1 cancel-token release on mismatch + 2 match/None-fast-path witnesses, minus 2 schemaStore.rs existing tests already counted in the baseline — close enough; exact count matches Generator's claim) |
| `pnpm tsc --noEmit` | PASS | no errors |
| `pnpm lint` | PASS | no errors |
| `pnpm vitest run --no-file-parallelism` | PASS | `Test Files 263 passed (263)`, `Tests 3238 passed (3238)`; Generator-claimed delta +6 reconciles with the 6-case `schemaStore.dbMismatch.test.ts` file. Monotonic non-decreasing ✓ |

All 6 gates green.

---

## Sprint Contract Status (Done Criteria — slice 271a only)

- [x] **AC-271-01 audit checklist published** — Audit table § In Scope rows 1–12 marked (b); generator's reconciliation matches actual code.
- [x] **AC-271-02 backend handler accepts `expected_database`** — Every command's `#[tauri::command]` signature carries `expected_database: Option<String>` last-positional. Verified rows 1–12.
- [x] **AC-271-03 Tauri command + TS wrapper exposes the opt-in parameter** — Every wrapper in `src/lib/tauri/schema.ts` carries optional last-positional `expectedDatabase?: string`, forwarded as `expected_database: expectedDatabase ?? null`. JSDoc references Sprint 271 (module-level + inline). Existing call sites that omit the param compile unchanged (verified by `pnpm tsc --noEmit` passing).
- [x] **AC-271-04 callers forward the active db** — `schemaStore.ts` lines 282/296/309/321/339/362/371/380/389/476 all forward `db` as 3rd/4th positional `expectedDatabase`. `useSchemaTableMutations.ts:62, 105` forwards `database` after the DDL. **PARTIAL EXCEPTION**: `usePostgresTypes.ts:198` does NOT — see "List_postgres_types exception verdict" below.
- [x] **AC-271-05 mismatch surfaces reuse the Sprint 267 sync helper** — Helper extracted to `src/lib/api/syncMismatchedActiveDb.ts` (new file). Both `useQueryExecution.ts:12` and `schemaStore.ts:16` import. Extraction count satisfied (2 caller sites; contract permits but only "recommends" extraction at 3+, generator extracted at 2 due to background/silent vs user-initiated split — defensible). Background introspection paths (schemaStore catches) pass `onSynced` undefined → silent sync, no toast. Verified.
- [x] **AC-271-06 backend regression tests** — `schema.rs::mod tests` adds 12 mismatch-case tests (`*_expected_db_mismatch_returns_dbmismatch_and_skips_trait` for each of the 12 commands) + 1 cancel-token release on mismatch (`get_table_columns_mismatch_releases_cancel_token`) + 2 happy-path witnesses (match path executes, None skips probe). Pattern verified: stub adapter `current_database_fn` returns `Some("dbA")`, caller passes `Some("dbB")`, asserts `Err(AppError::DbMismatch { expected: "dbB", actual: "dbA" })`, AND each underlying trait method is `panic!("must not run on mismatch")` so a regressed guard would fail-loud via test panic, not silent. **Strong test design.**
- [x] **AC-271-07 frontend integration test** — `src/stores/schemaStore.dbMismatch.test.ts` (NEW) has 6 cases: `loadSchemas`, `loadTables`, `getTableColumns`, `getTableIndexes`, `prefetchSchemaColumns` (silent best-effort), and a `non-mismatch errors do NOT trigger the sync helper` negative-case witness. All assert mocked IPC throws Sprint 266 wire format → `setActiveDb` syncs to backend's `"dbB"` AND `toast.warning` NOT called.
- [x] **AC-271-08 sub-slicing pinned** — Slice 271a only. Not yet committed (working tree dirty); commit hygiene to be evaluated at landing. Contract requires "land as own commit AFTER passing all 6 gates" — all 6 gates pass now, landing commit is up to caller.
- [x] **AC-271-09 regression gate** — All 6 gates green; vitest count monotonic +6 vs Generator's claimed baseline.

---

## Sample audit (≥2 commands per slice — probe location byte-equivalence)

### Helper `ensure_expected_db` at `schema.rs:33-47`

```rust
async fn ensure_expected_db(
    adapter: &dyn crate::db::RdbAdapter,
    expected_database: Option<&str>,
) -> Result<(), AppError> {
    if let Some(expected) = expected_database {
        let actual = adapter.current_database().await?.unwrap_or_default();
        if actual != expected {
            return Err(AppError::DbMismatch {
                expected: expected.to_string(),
                actual,
            });
        }
    }
    Ok(())
}
```

Sprint 266 reference `query.rs:83-92`:

```rust
if let Some(expected) = expected_database {
    let actual = adapter.current_database().await?.unwrap_or_default();
    if actual != expected {
        release_cancel_token(state, &cancel_handle).await;
        return Err(AppError::DbMismatch {
            expected: expected.to_string(),
            actual,
        });
    }
}
```

**Byte-equivalence verified** — same probe (`adapter.current_database().await?.unwrap_or_default()`), same `AppError::DbMismatch { expected: expected.to_string(), actual }` shape, same pre-trait-call ordering. The only structural difference is helper extraction (eliminating duplication across 12 commands) and the absence of `release_cancel_token` inside the helper (correctly handled in the 3 callers that use cancel tokens — see next sample).

### Sample 1 — `list_schemas` (S1, schema.rs:69-77 wrapper, :49-67 inner)

- Wrapper accepts `expected_database: Option<String>` (L74)
- Inner acquires `active_connections.lock()` at L54
- Calls `ensure_expected_db(adapter, expected_database).await?` at **L59** — BEFORE `adapter.list_namespaces().await?` at L60 ✓

### Sample 2 — `get_table_columns` (S3, schema.rs:141-162 wrapper, :111-139 inner)

- Wrapper accepts `expected_database: Option<String>` (L151)
- Cancel-token registered BEFORE lock (L119); then lock acquired at L122
- **Mismatch path correctly releases cancel-token** — at L137 `release_cancel_token` runs regardless of probe outcome via the `match { Ok => trait_call, Err => Err }` pattern that exits the scope before `release_cancel_token(state, &cancel_handle).await`.
- Test `get_table_columns_mismatch_releases_cancel_token` (schema.rs:1072-1084) explicitly pins this invariant — registers `"qid-mismatch"`, expects empty registry after mismatch. **Strong evidence the cancel-token race is closed.**

### Audit table (a)/(b)/(c) sample-verification — 3 rows

| # | Cmd | Claimed | Actual | OK? |
|---|---|---|---|---|
| 2 | `list_tables` | (b) probe at L90 | schema.rs:90 `ensure_expected_db(adapter, expected_database).await?` BEFORE `adapter.list_tables(schema).await` at L91 | ✓ |
| 7 | `list_views` | (b) probe at L315 | schema.rs:315 `ensure_expected_db(adapter, expected_database).await?` BEFORE `adapter.list_views(schema).await` at L316 | ✓ |
| 12 | `list_postgres_types` | (b) probe at L483 | schema.rs:483 `ensure_expected_db(adapter, expected_database).await?` BEFORE `adapter.list_types().await` at L484 | ✓ |

---

## Verdict on `list_postgres_types` exception

**Re-wire required (P2 — does not block slice landing, but must close before 271b begins or be tracked).**

The Generator's claim that "`usePostgresTypes.ts:198` cannot forward `db` because the cache is connection-keyed" is technically true for the cache layout but **not for the guard itself**. The cache shape and the guard payload are orthogonal:

1. `resolveActiveDb(connectionId)` (exported from `src/stores/workspaceStore.ts:86`) is a synchronous one-liner that resolves the workspace's active db without requiring a hook re-render.
2. The contract row #12 is explicit: "call site routes via `(connId, db)` even when payload is db-global; forward `db` so a swapped pool still rejects". The contract anticipated this exception and rejected it.
3. The cache itself is unaffected: `usePostgresTypes` would still cache by `connectionId`, but each `fetchTypes` call would forward the *current* `resolveActiveDb(connectionId)` to the IPC. On a mismatch the IPC short-circuits with `DbMismatch` and the cache entry's `error` slot picks it up; on success the cache is populated with types from the canonical pool.
4. Risk is non-zero: on a swapped PG pool to a db with a different extension set (e.g. PostGIS in `db1` but not `db2`), the type list cached by `usePostgresTypes` could be from the WRONG db. The combobox would show `geometry` from `db1` even though the new active db is `db2`. The contract explicitly designed the guard to surface this.

**Fix scope (estimated ≤10 minutes):** add a single `import { resolveActiveDb } from "@stores/workspaceStore"` and change line 198 to:

```ts
const live = await tauri.listPostgresTypes(
  connectionId,
  resolveActiveDb(connectionId) || undefined,
);
```

This is byte-trivial: it doesn't change the cache shape, the in-flight Promise sharing, or the canonical fallback behavior on mismatch error (the `catch` block already populates `entry.types = [...POSTGRES_COMMON_TYPES]` and surfaces the error string).

**Mitigating factor**: the call site is background introspection (mount-time + reload button), not user-initiated. The Sprint 271a out-of-scope rule "silent introspection uses sync-only, no toast" applies; mismatch would surface as the `error` slot of `UsePostgresTypesResult` (which is already exposed). So even with the fix it would not regress toast behavior. The current code leaves an *unguarded* path that the contract specifically called out, which is the bug the sprint exists to close.

---

## Scoring

| Dimension | Score | Justification |
|-----------|-------|---------------|
| **Correctness** | 8/10 | 11 of 12 commands fully wire `expectedDatabase` end-to-end with byte-equivalent Sprint 266 probe semantics. `list_postgres_types` payload is wired but the lone call site at `usePostgresTypes.ts:198` does NOT forward `db` despite `resolveActiveDb(connectionId)` being available — contract row #12 anticipated this case and explicitly required forwarding. Backend probe is correctly shared via `ensure_expected_db` helper at L33-47 (byte-equivalent shape to query.rs:83-92), and cancel-token release on mismatch (L127-134, L212-219, L264-275) preserves the Sprint 266 mismatch-then-release invariant for the 3 cancel-aware commands. |
| **Completeness** | 8/10 | 12/12 commands and wrappers carry the parameter; 12/12 backend mismatch tests; 6-case end-to-end vitest file (`schemaStore.dbMismatch.test.ts`) covers happy/mismatch/silent-sync/non-mismatch-negative for the key entry points (`loadSchemas`, `loadTables`, `getTableColumns`, `getTableIndexes`, `prefetchSchemaColumns`, non-mismatch path). One caller layer (`usePostgresTypes`) is not wired. Tests don't explicitly cover `list_postgres_types` mismatch end-to-end at the frontend layer, but the backend test does. |
| **Code Quality** | 9/10 | Helper extraction (`ensure_expected_db` in `schema.rs`, `syncMismatchedActiveDb` in `src/lib/api/`) is clean and removes duplication across 12 + 2 call sites without altering behavior. No `unwrap()` on production paths, no `any` in TS, no `console.log` shipped. JSDoc/module doc references Sprint 271 in every changed file. Helper extraction at 2 caller sites is below the contract's "3+" threshold but is justified by the silent-vs-user-initiated split — defensible. Sprint id annotations (`// Sprint 271a (2026-05-13)`) present in `schema.rs` module doc (L12), `useSchemaTableMutations.test.ts` (L152, L217), `schemaStore.dbMismatch.test.ts` header (L1), `schemaStore.ts` action comments (L38, L358, L494), `schema.rs::mod tests` (L1011). |
| **Testing** | 9/10 | Backend tests `panic!("must not run on mismatch")` inside each command's underlying trait closure — a regressed guard would fail-loud via test panic, NOT silent passthrough. Mismatch + cancel-token release pin at schema.rs:1072 is excellent (closes the registration-leak race). 6-case frontend test asserts mocked IPC throws Sprint 266 wire format → `parseDbMismatch` → `syncMismatchedActiveDb` → `setActiveDb("conn1", "dbB")` end-to-end, AND asserts `toast.warning` NOT called (silent introspection invariant). Negative-case witness (`"non-mismatch errors do NOT trigger the sync helper"`) prevents accidental over-firing on unrelated errors. Existing tests (`schemaStore.test.ts`, `useSchemaTableMutations.test.ts`) updated for new 4th positional arg, not rewritten. -1 point for missing a `list_postgres_types` mismatch case end-to-end at the frontend layer. |
| **Contract Compliance** | 7/10 | 8 of 9 acceptance criteria fully satisfied. AC-271-04 has one accepted exception (`usePostgresTypes.ts:198`) that the contract explicitly does NOT permit — row #12 of the audit table marked "Partial — forward `db` so a swapped pool still rejects". Generator documented the exception in good faith but the documentation directly contradicts the contract row. Slice 271a has not yet landed as its own commit (working tree dirty); pre-landing the 6 gates pass cleanly, so the commit hygiene risk is procedural-only. |

**Overall: 8.2 / 10**

Each individual dimension meets the ≥7 pass threshold.

---

## Verdict: **PASS** (with one open P2 item)

Slice 271a meets the contract's acceptance criteria with one exception — `usePostgresTypes.ts:198` does not forward `db` despite the contract row #12 requiring it. This is a P2 (correctness gap; non-blocking for slice landing but should be closed before 271b touches the same wrapper layer). The gates are green and the backend + schemaStore caller layers are fully wired.

---

## Feedback for Generator

1. **`list_postgres_types` caller wiring (P2)**
   - **Current**: `src/hooks/usePostgresTypes.ts:198` calls `tauri.listPostgresTypes(connectionId)` without forwarding `db`. Generator's commentary documents this as an "accepted exception" because the cache is connection-keyed.
   - **Expected**: Forward `resolveActiveDb(connectionId)` so the backend guard surfaces a swapped-pool mismatch. Contract row #12 explicitly anticipated and rejected this exception.
   - **Suggestion**: Add `import { resolveActiveDb } from "@stores/workspaceStore"` and change L198 to `const live = await tauri.listPostgresTypes(connectionId, resolveActiveDb(connectionId) || undefined);`. Cache shape stays connection-keyed (no change). On mismatch, the existing `catch` block populates `entry.types = [...POSTGRES_COMMON_TYPES]` and exposes `entry.error` to the consumer — so error surface stays identical to today, just gated by the backend probe. Add one frontend test case in `usePostgresTypes.test.ts` that asserts mismatch IPC error surfaces in `result.current.error` while preserving the canonical fallback.

2. **Sprint id annotation completeness (P3 polish)**
   - **Current**: `usePostgresTypes.ts` carries no Sprint 271a annotation despite being a relevant call site (even with the exception decision).
   - **Expected**: Either annotate "Sprint 271a — accepted exception, see findings-271a.md" or (after fix) annotate the new forwarding.
   - **Suggestion**: After applying fix #1, add a one-line `// Sprint 271a (2026-05-13) — forwarding workspace activeDb so a swapped pool surfaces as DbMismatch via the canonical-fallback path` near L198. Mirrors the annotation density in `schemaStore.ts:38`, `schema.ts:14`, etc.

3. **Frontend test coverage parity (P3)**
   - **Current**: `schemaStore.dbMismatch.test.ts` covers 5 introspection methods + 1 negative case but does NOT exercise `list_postgres_types` end-to-end.
   - **Expected**: After fix #1, add a `usePostgresTypes.test.ts` case (mocked IPC rejects with Sprint 266 wire format) that asserts `result.current.error` carries the mismatch string AND the canonical fallback is preserved in `result.current.types`. This pins the design intent of the guard for type-list reads.

---

## Handoff fields

- **Status**: PASS (with one P2 open item — `usePostgresTypes` forwarding)
- **Slice**: 271a
- **Gates**: all 6 green (`cargo fmt` / `cargo clippy -D warnings` / `cargo test` lib 689 / `pnpm tsc --noEmit` / `pnpm lint` / `pnpm vitest` 263 files 3238 tests)
- **Test deltas reconciled**: cargo lib +13 (676 → 689) ✓, vitest +6 (3232 → 3238) ✓
- **Changed files**:
  - `src-tauri/src/commands/rdb/schema.rs` — 12 commands + 15 new tests + `ensure_expected_db` helper (L33-47)
  - `src/lib/tauri/schema.ts` — 12 wrappers gain optional `expectedDatabase`
  - `src/lib/api/syncMismatchedActiveDb.ts` (NEW) — helper extracted from useQueryExecution Sprint 267 inline
  - `src/stores/schemaStore.ts` — 10 read methods forward `db`, 4 catch sites fire silent sync
  - `src/components/query/QueryTab/useQueryExecution.ts` — imports extracted helper
  - `src/hooks/useSchemaTableMutations.ts` — post-DDL reload forwards `database`
  - `src/stores/schemaStore.dbMismatch.test.ts` (NEW) — 6 e2e cases
  - `src/stores/schemaStore.test.ts` — 4 assertions updated
  - `src/hooks/useSchemaTableMutations.test.ts` — 2 assertions updated
- **Residual risk**: `usePostgresTypes.ts:198` exception (P2; see Feedback #1)
- **Sprint 266 + cancel_query byte-equivalence**: verified via `git diff main -- src-tauri/src/commands/rdb/query.rs` reporting 0 lines diff
- **Mongo / document commands**: untouched (verified by file scope)
