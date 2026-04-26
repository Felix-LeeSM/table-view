# Sprint 130 — Evaluator Findings

## Sprint 130 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness (35%)** | 8/10 | Sub-pool LRU + `switch_active_db` race-resolution + 2-phase locking are implemented soundly (`src-tauri/src/db/postgres.rs:304-412`). Pure helper `select_eviction_target` (`postgres.rs:158-160`) cleanly skips `current_db`. All 26 prior pool-using methods now route through `active_pool()` (`active_pool` count = 23 occurrences confirmed via grep; legacy `pool.lock().await` / `guard.as_ref()` patterns are 0). Trait override and Tauri command paradigm dispatch (`meta.rs:85-108`) correctly mirror the contract. **Minor weakness**: the cache-hit unit test (`postgres.rs:2269-2302`) re-implements the LRU mutation in the test body instead of calling `adapter.switch_active_db("db2").await` — it asserts the bookkeeping shape but never exercises the actual `pools.contains_key(...)` hit branch. Generator's rationale ("PgPool cannot be cheaply mocked") is acceptable because the LRU branch is fully covered by the pure helper tests + the production code uses the same `retain + push_back` sequence verbatim. |
| **Completeness (25%)** | 9/10 | All 12 ACs map to file:line evidence. Every Done Criterion (1-11) has corresponding code + tests. RDB autofill (AC-09 / AC-12) handles RDB query/table tabs, fallback to `connection.database`, explicit-override preservation, document paradigm exclusion, and persisted no-migrate — 6 dedicated tests in `tabStore.test.ts:1517-1629`. `connectionStore` adds seed + 5 setActiveDb cases. `schemaStore.clearForConnection` shares one helper with `clearSchema` and adds 2 tests. DbSwitcher gets 7 new tests covering dispatch/setActiveDb/clearForConnection/popover-close/success-toast/error-toast/no-op-on-same-db plus 4 label-resolution tests. `switchActiveDb.ts` thin wrapper has 5 tests (command name, void resolve, Validation/Unsupported/NotFound rejections). |
| **Reliability (20%)** | 8/10 | Two-phase locking inside `switch_active_db` (lock → decide hit/miss → release lock during `connect_with` await → re-lock to commit) correctly prevents holding the mutex across awaits. The race-resolution branch (`postgres.rs:370-378`) closes the just-built pool when another task installed the same `db_name` during the await. `disconnect_pool` drains pools without holding the mutex across `close().await` (`postgres.rs:258-275`). PG `list_databases` permission fallback (S128 invariant) preserved at `postgres.rs:1857-1866`. Document tab migration in `loadPersistedTabs` (S129 invariant) preserved at `tabStore.ts:573-595`. DbSwitcher disabled state for non-rdb/non-document paradigms preserved at `DbSwitcher.tsx:65-66`. `setActiveDb` correctly no-ops on disconnected/error/missing — 3 tests confirm. **Minor concerns**: (1) live PG cache-miss test is `#[ignore]` so the actual `connect_with` branch never runs in CI; pure-helper coverage is acceptable but the race-resolution branch (`postgres.rs:370-378`) is not tested at all. (2) Trigger label resolution priority (`activeDb` → tab.database → tab.schema → "(default)") is sound, but a stale `tab.database` from before a switch could disagree with `activeStatuses[id].activeDb` after a switch — Generator notes this in residual risks for S132. |
| **Verification Quality (20%)** | 9/10 | All 7 required checks executed and pass independently of Generator's claims: `pnpm vitest run` 124 files / 1981 tests pass (S129 baseline 1957 + 24 new = matches). `pnpm tsc --noEmit` 0 errors. `pnpm lint` 0. `pnpm contrast:check` 864 pairs / 0 new violations (64 allowlisted unchanged). `cargo test --lib` 258 passed / 0 failed / 1 ignored (correctly the live-PG cache-miss test). `cargo clippy --all-targets --all-features -- -D warnings` 0 errors. e2e static compile: `e2e/` files unchanged in git diff (only `src-tauri/`, `src/`, and new `src/lib/api/switchActiveDb.{ts,test.ts}` modified per `git status --short`); root `tsconfig.json` `include: ["src"]` excludes e2e from `tsc --noEmit` so regression is genuinely 0. **Tiny gap**: the cache-hit test should call `switch_active_db` directly (even with a stub PgPool) to fully exercise the production hit branch — current test re-implements the LRU mutation. |
| **Overall** | **8.5/10** | |

## Verdict: PASS

Each dimension ≥ 7/10 (Correctness 8, Completeness 9, Reliability 8, Verification Quality 9). All required checks green. Every Done Criterion has concrete file:line + test:line evidence.

## Sprint Contract Status (Done Criteria)

- [x] **DC-1** PostgresAdapter sub-pool 구조 + LRU + current_db 추적 — `postgres.rs:166-187` (`PgPoolState` struct), constant `PG_SUBPOOL_CAP=8` at `:149`.
- [x] **DC-2** `switch_active_db` method + 4 단위 테스트 — `postgres.rs:304-412` (method); 8 tests at `:2206-2331` covering `not_connected`/`empty_name`/`evict_oldest`/`protects_current_db`/`cache_hit_LRU_bookkeeping`/`select_eviction_target` 3 variants. Cache-miss live-PG test ignored.
- [x] **DC-3** `RdbAdapter::switch_database` trait + PostgresAdapter override — `db/mod.rs:142-158` (default `Unsupported`); `postgres.rs:1959-1964` (PG override delegates).
- [x] **DC-4** Tauri command `switch_active_db` 등록 + paradigm 분기 — `meta.rs:85-108` (4-arm match); `lib.rs:48-49` (handler registration confirmed via grep).
- [x] **DC-5** 모든 기존 PG pool-using method가 `active_pool()` helper 사용 + 회귀 0 — 23 `self.active_pool().await?` call sites; 0 `pool.lock().await` / `guard.as_ref()` legacy patterns; 258 cargo tests pass.
- [x] **DC-6** 프런트 `switchActiveDb.ts` thin wrapper + 단위 테스트 — `src/lib/api/switchActiveDb.ts:28-33`; 5 tests in `switchActiveDb.test.ts`.
- [x] **DC-7** DbSwitcher 항목 클릭 dispatch + 실패 toast + 단위 테스트 — `DbSwitcher.tsx:152-185` (handleSelect); 7 tests at `DbSwitcher.test.tsx:303-500`.
- [x] **DC-8** `connectionStore.activeStatuses[id].activeDb` + `setActiveDb` + 단위 테스트 — `types/connection.ts:88-92` (discriminated union with `activeDb?`); `connectionStore.ts:154-189` (connectToDatabase seed); `connectionStore.ts:203-219` (setActiveDb action); 5 tests at `connectionStore.test.ts:520-611`.
- [x] **DC-9** `schemaStore.clearForConnection` + 단위 테스트 — `schemaStore.ts:97,314-320`; helper `clearConnectionEntries` at `:110-145`; 2 tests at `schemaStore.test.ts:746-816`.
- [x] **DC-10** 신규 RDB 탭에 `database` 자동 채움 + 레거시 persisted 탭 마이그레이션 안 함 — `tabStore.ts:20-27` (resolveActiveDb helper); `:251-307` (addTab autofill); `:399-441` (addQueryTab autofill); 6 tests at `tabStore.test.ts:1517-1629`. `loadPersistedTabs` (`tabStore.ts:540-603`) is unchanged for RDB tabs.
- [x] **DC-11** 검증 명령 7종 그린 — vitest 1981/1981, tsc 0, lint 0, contrast 0 new, cargo test 258/258 (1 ignored), clippy 0, e2e 정적 컴파일 회귀 0 (e2e files untouched in diff; root tsconfig excludes e2e from tsc).

## Independent AC Verification

- **AC-01** ✅ `PgPoolState { config, pools: HashMap<String,PgPool>, current_db: Option<String>, lru_order: VecDeque<String> }` at `postgres.rs:166-182`. `PostgresAdapter { inner: Arc<Mutex<PgPoolState>> }` at `:184-187`.
- **AC-02** ✅ Pure helper `select_eviction_target(lru, current)` at `postgres.rs:158-160` skips current. Three pure-helper tests (`:2225-2266`) cover single-entry-current, current-at-end, current-in-middle. The `evicts_oldest_when_cap_exceeded` test (`:2304-2317`) seeds an 8-entry LRU and verifies the helper picks `db0`. The `protects_current_db_from_eviction` test (`:2319-2331`) verifies the single-entry edge.
- **AC-03** ✅ `switch_active_db` body at `postgres.rs:304-412`. Two-phase locking implemented (lock at `:320-335`, await `connect_with` at `:347-359`, re-lock at `:365-403`). Cache hit: lines `:322-326`. Cache miss: `:327-334` then `:342-410`. Race resolution: `:370-378`. Not-connected: `:332`. Validation: `:305-307`.
- **AC-04** ✅ All prior `pool.lock().await` / `guard.as_ref()` removed (grep returns 0). 23 method bodies use `let pool = self.active_pool().await?;` pattern. Spot-checked: `execute` (`:421-429`), `ping` (`:604-611`), `list_schemas` (`:613-629`), `list_tables` (`:631-654`), `list_databases` (`:1841-1869`).
- **AC-05** ✅ Trait default at `db/mod.rs:149-158` returns `Err(AppError::Unsupported(...))`. PG override at `postgres.rs:1959-1964` delegates to `self.switch_active_db(db_name)`.
- **AC-06** ✅ `commands::meta::switch_active_db` registered at `lib.rs:49`.
- **AC-07** ✅ Paradigm dispatch at `meta.rs:96-107` — `Rdb` → `adapter.switch_database`; `Document`/`Search`/`Kv` → distinct `Unsupported` messages. 5 dispatch tests at `meta.rs:383-439` (Document/Search/Kv unsupported, Rdb unconnected→Connection, Rdb empty-name→Validation).
- **AC-08** ✅ `switchActiveDb.ts:28-33` thin wrapper. 5 tests at `switchActiveDb.test.ts` cover command-name + args, void resolve, Validation/Unsupported/NotFound rejections.
- **AC-09** ✅ `DbSwitcher.tsx:152-185` — happy path: invoke → `setActiveDb` → `clearForConnection` → close popover → success toast. Failure path: error toast, popover stays open. Same-db re-click: no-op + close. Verified via 7 tests `DbSwitcher.test.tsx:303-500`.
- **AC-10** ✅ `types/connection.ts:88-92` adds `activeDb?` to `connected` variant. `connectionStore.ts:154-189` seeds activeDb on connect (omits when `database` is empty). `setActiveDb` (`:203-219`) only mutates `connected` variant — verified by 3 no-op tests for disconnected/error/missing.
- **AC-11** ✅ `schemaStore.ts:110-145` (clearConnectionEntries helper) drops only entries keyed by `${connectionId}` or `${connectionId}:`. Tests at `schemaStore.test.ts:746-816` verify conn1 entries are cleared while conn2 stays intact.
- **AC-12** ✅ `tabStore.ts:20-27` `resolveActiveDb` helper. `:263-267` addTab autofills only when `paradigm === "rdb"` AND `tab.database === undefined`. `:418-421` addQueryTab autofills only when `paradigm === "rdb"` AND `opts.database === undefined`. `loadPersistedTabs` migration code (`:573-595`) is untouched for RDB tabs (only Document branch backfills database/collection from schema/table). 6 tests cover all paths including explicit-override preservation and document paradigm exclusion.

## Verification Plan Outcomes

| Check | Result |
| --- | --- |
| `pnpm vitest run` | **PASS** — 124 files / 1981 tests (S129 baseline 1957 + 24 new) |
| `pnpm tsc --noEmit` | **PASS** — 0 errors |
| `pnpm lint` | **PASS** — 0 errors / 0 warnings |
| `pnpm contrast:check` | **PASS** — 864 pairs / 0 new violations / 64 allowlisted unchanged |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **PASS** — 258 passed / 0 failed / 1 ignored (live-PG cache-miss test, expected) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **PASS** — 0 errors / 0 warnings |
| e2e 정적 컴파일 | **PASS** — `git status --short` confirms zero e2e/* changes; root `tsconfig.json` `include: ["src"]` excludes e2e from `tsc --noEmit`; regression therefore 0. |

## Risks & Lessons

- **Live-PG cache-miss path is unverified in CI** — `test_switch_active_db_cache_miss_creates_lazy_pool` (`postgres.rs:2334-2352`) is correctly `#[ignore]`'d, but the race-resolution branch (`postgres.rs:370-378`) and the actual `connect_with` failure mapping (`:354-359`) are not covered by automated tests. The pure-helper LRU tests + `Validation`/`Connection` early-return tests are the safety net. Acceptable for S130 scope; the race resolution would require multi-task orchestration with a real pool — out of scope for unit tests.
- **Cache-hit unit test re-implements the production statements** — `test_switch_active_db_cache_hit_updates_lru_and_current` mirrors the production `retain` + `push_back` calls without invoking `adapter.switch_active_db("db2")`. The intent is documented in a long comment. Generator's rationale (PgPool isn't cheaply mockable) is reasonable but a follow-up should consider a feature-flagged stub pool to drive this branch end-to-end.
- **`tab.database` divergence from `activeStatuses.activeDb`** — DbSwitcher label preference is sound (`activeDb` → tab.database → tab.schema), but tabs created before a switch retain stale `tab.database` values. Generator pushes this to S132 (raw-query DB-change detection). The label-source preference at `DbSwitcher.tsx:97-116` masks the divergence at the toolbar level, so the user-visible regression risk is low.
- **Document paradigm DbSwitcher click** — Surfaces `"Failed to switch DB: Unsupported operation: Document paradigm DB switch lands in Sprint 131"`. Functional but the toast message bleeds the sprint number — S131 should soften the copy.

## Feedback for Generator

1. **Tests / cache-hit coverage**:
   - Current: `test_switch_active_db_cache_hit_updates_lru_and_current` (`postgres.rs:2269-2302`) manipulates the inner mutex directly to mirror the production statements but never actually calls `adapter.switch_active_db("db2").await`.
   - Expected: a unit test that drives the production hit branch (the `pools.contains_key(db_name)` arm at `postgres.rs:322-326`).
   - Suggestion: either (a) introduce a `#[cfg(test)] fn insert_pool_for_test(&self, name: &str, pool: PgPool)` test seam that takes a real but unused PgPool from a SQLite/dev fixture, or (b) extract the hit-branch bookkeeping into a second pure helper alongside `select_eviction_target` and call it from production + test directly. The second option is cheaper and avoids a feature flag.

2. **Tests / race resolution coverage**:
   - Current: race-resolution branch (`postgres.rs:370-378`) is untested.
   - Expected: a test that interleaves two `switch_active_db("db2")` calls and asserts the second-arrival closes the just-built pool and treats the result as a hit.
   - Suggestion: factor the "install or treat as hit" portion into a pure helper `commit_switch(state, db_name, new_pool) -> CommitResult { Hit, Installed { evicted: Option<PgPool> } }` that doesn't await — race tests can then drive two consecutive calls without standing up real pools.

3. **Toast message hygiene**:
   - Current: Document paradigm `Unsupported` message at `meta.rs:99` reads `"Document paradigm DB switch lands in Sprint 131"`. Surfacing internal sprint numbers in user-visible toasts is brittle copy.
   - Expected: a sprint-agnostic message ("Switching databases is not yet supported on this connection paradigm.") with the sprint reference relegated to a code comment.
   - Suggestion: when S131 lands the implementation, replace the message; for S130 you can soften now without re-opening scope.

4. **Trigger label vs tab.database divergence**:
   - Current: `tab.database` retains its old value after a connection-level DB switch; `DbSwitcher` label correctly prefers `activeDb` (`DbSwitcher.tsx:100-104`) but the underlying tab still references the stale db.
   - Expected: a documented invariant (TODO/RISKS entry) that explicitly defers the tab.database synchronization to S132.
   - Suggestion: add a one-line entry to `docs/RISKS.md` so the divergence is registered as `deferred → S132` instead of buried in the handoff residual-risks list. (Acceptable to skip if RISKS.md already has it.)
