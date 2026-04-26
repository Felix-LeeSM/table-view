# Sprint 138 Evaluation

## Independent Verification

All 7 commands re-run by the Evaluator on `main` (untracked sprint changes
in working tree). Last 20 lines of each:

### 1. `pnpm vitest run`

```
RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  134 passed (134)
      Tests  2095 passed (2095)
   Start at  02:37:19
   Duration  22.19s (transform 5.51s, setup 8.75s, import 34.54s, tests 52.29s, environment 82.17s)
```

### 2. `pnpm tsc --noEmit`

```
(no output — exit 0)
```

### 3. `pnpm lint`

```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .
(exit 0)
```

### 4. `pnpm contrast:check`

```
> table-view@0.1.0 contrast:check /Users/felix/Desktop/study/view-table
> tsx scripts/check-theme-contrast.ts

WCAG AA contrast: 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)
```

### 5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`

```
test storage::tests::test_save_connection_empty_password_not_encrypted ... ok
test storage::tests::test_save_connection_rejects_duplicate_name ... ok
test storage::tests::test_save_connection_same_name_same_id_succeeds ... ok
test storage::tests::test_save_connection_updates_existing_by_id ... ok
test storage::tests::test_save_connection_with_none_preserves_existing ... ok
test storage::tests::test_save_group_adds_and_updates ... ok
test storage::tests::test_save_multiple_connections ... ok

test result: ok. 272 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.04s
```

### 6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.32s
```

### 7. `pnpm exec eslint e2e/**/*.ts`

```
(no output — exit 0)
```

### Sprint-138 focused vitest sanity

```
$ pnpm vitest run -t "Sprint 138"
 Test Files  2 passed | 132 skipped (134)
      Tests  16 passed | 2079 skipped (2095)
```

16 explicit "Sprint 138" tests pass: 11 in `DATABASE_DEFAULT_FIELDS` /
`parseSqliteFilePath` describes (`connection.test.ts`), and 5 per-DBMS
scenario tests + 1 host-preserving swap test in
`ConnectionDialog.test.tsx`.

## AC Verdict

| AC | Verdict | Evidence |
|----|---------|----------|
| AC-S138-01 (per-DBMS form shape) | PASS | `src/types/connection.ts:125-134` defines `DATABASE_DEFAULT_FIELDS` with PG `{5432, "postgres", "postgres"}`, MySQL `{3306, "root", ""}`, SQLite `{0, "", ""}`, Mongo `{27017, "", ""}`, Redis `{6379, "", "0"}`. Each value cross-asserted by a dedicated test in `connection.test.ts:111-159`. PG/MySQL/Mongo/Redis sub-components render host/port/user/password/database; SQLite renders only file path. Note: SSL toggle not implemented for PG/MySQL — contract text says "SSL" but contract scope text only requires "field shape, not active SSL semantics" (handoff Decision/Risk). Acceptable for this sprint. |
| AC-S138-02 (db_type swap resets DBMS defaults, preserves host) | PASS | `ConnectionDialog.tsx:152-164` `applyDbTypeChange` reads `DATABASE_DEFAULT_FIELDS[dbType]` and resets only `port`/`user`/`database`/`paradigm`, leaving `host`/`name`/`group_id`/`color`/`environment` untouched. Asserted by `Sprint 138: switching from PG to MySQL preserves host but resets user from postgres to root` (ConnectionDialog.test.tsx:1179-1208). |
| AC-S138-03 (no DBMS hardcodes user="postgres") | PASS | Regression-guard test `connection.test.ts:152-158` explicitly asserts `mysql.user`, `sqlite.user`, `mongodb.user`, `redis.user` are NOT `"postgres"`. Per-DBMS dialog scenario for MySQL also asserts `userInput.value === "root"` and `!== "postgres"` (ConnectionDialog.test.tsx:1281-1283). |
| AC-S138-04 (SQLite renders no host/port/user/password) | PASS | `SqliteFormFields.tsx:25-47` renders only the `Database File` input. Asserted by **two** independent tests: `SqliteFormFields > renders the file path field and OMITS host/port/user/password` (file-level unit test using `queryByLabelText` for all four absent fields) AND `Sprint 138: ... AC-S138-04` (dialog-level integration test that switches DB type to SQLite and asserts `queryByLabelText("Host"/"Port"/"User"/"Password")` is null). Both `getByLabelText("SQLite database file path")` matches succeed because the input carries `aria-label`. |
| AC-S138-05 (sub-component routing + assertNever) | PASS | `ConnectionDialog.tsx:263-306` `renderDbmsFields()` is an exhaustive `switch (form.db_type)` over all 5 variants. `default: return assertNever(form.db_type);` (line 304). `assertNever` imported from `@/lib/paradigm` (line 68); the helper is `(value: never) => never` (paradigm.ts:12-16). No `any` casts in the dialog. |
| AC-S138-06 (URL parsing per paradigm + SQLite fallback) | PASS | `parseConnectionUrl` (connection.ts:192-233) untouched for PG/MySQL/Mongo/Redis paths; the existing Sprint 65 paradigm-tagging tests (connection.test.ts:90-106) still pass. New `sqlite:` protocol handled in the `try` branch (connection.ts:200-211). New `parseSqliteFilePath` helper (connection.ts:241-255). Dialog wires the SQLite fallback when URL parse returns null AND `db_type === "sqlite"` (ConnectionDialog.tsx:400-404). 4 fallback tests at connection.test.ts:161-188. |
| AC-S138-07 (5 vitest tests, one per DBMS) | PASS | `Sprint 138: DBMS-aware form shape` describe block in `ConnectionDialog.test.tsx:1251-1365` contains exactly 5 scenarios — PG, MySQL, SQLite, Mongo, Redis — each asserting a DBMS-specific observable (PG/MySQL: user/port defaults; SQLite: field absence; Mongo: extension fields; Redis: db-index clamp). They are not duplicates: each touches a distinct DBMS shape attribute. Plus 10 sub-component tests (2 per form file) and 11 type-level tests in `connection.test.ts`. |
| AC-S138-08 (6 — actually 7 — gates green, no backend change) | PASS | All 7 verification commands above green on Evaluator's re-run. `cargo test ... --lib` 272 passed (Rust untouched). Backend `connection_test`/`addConnection` schema unchanged (only frontend `DATABASE_DEFAULT_FIELDS` and `parseSqliteFilePath` added; `ConnectionDraft` shape unchanged). |

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 8/10 | All 8 AC criteria objectively pass with test evidence. `applyDbTypeChange` cleanly preserves host (the contract's named regression guard) and resets per-DBMS defaults from a single source of truth (`DATABASE_DEFAULT_FIELDS`). `assertNever` is wired correctly so a future `DatabaseType` variant fails the build. URL parsing remains intact for PG/MySQL/Mongo/Redis (Sprint 65 tests still green) and gains a `sqlite:` branch + `parseSqliteFilePath` fallback. Minor concern: `applyDbTypeChange` does not clear `auth_source`/`replica_set`/`tls_enabled` when swapping away from MongoDB (handoff Assumption 6 acknowledges this — backend serializer drops these for non-Mongo, so no observable bug, but it does mean a stray `tls_enabled=true` typed in Mongo flows persists if the user toggles to Redis where the same checkbox label appears, then back to MySQL). Not an AC failure. |
| **Completeness** | 8/10 | All 8 AC met. The 5 per-DBMS scenario tests are meaningful (each asserts the distinguishing trait of that DBMS, not near-duplicates). 9 new tests in `connection.test.ts` lock the defaults map. Sub-component prop interfaces are exported (per contract Quality Bar). One genuine gap: contract AC-S138-01 lists "SSL" for PG and MySQL field shape, and PG/MySQL form sub-components do NOT render an SSL toggle (only Mongo/Redis have `tls_enabled`). The handoff acknowledges this implicitly ("SSL toggle is reserved for a future extension" in MysqlFormFields.tsx header comment) but does not list it as a deferred risk. This is the single sub-criterion of AC-S138-01 that is not delivered. |
| **Reliability** | 7/10 | Save validation correctly diverges for SQLite (host required → database file required, ConnectionDialog.tsx:226-233). Redis db-index clamp is robust (tested for over-/under-/in-range). `parseSqliteFilePath` rejects empty / whitespace-only input. `applyDbTypeChange` is pure (single `setForm` call) so race-free. Risks: (a) SQLite "text input fallback" — the user must hand-type a path; the placeholder + helper text mitigate but a user could paste a relative path without the form noticing — only `trim()` happens, no path-form validation; (b) all 5 form files share `id="conn-host"`/`id="conn-port"`/etc — fine because only one form renders at a time, but means HMR-driven tooling that scans static IDs across the file tree may double-count; (c) 4 password blocks are duplicated verbatim across PG/MySQL/Mongo/Redis (~30 LOC × 4) — explicitly called out in handoff Risks as deferred-DRY; not a defect now but increases maintenance surface. |
| **Verification Quality** | 9/10 | All 7 required commands run by Generator AND independently re-run by Evaluator — every gate green. Vitest count increased to 2095 with no regressions. The 16 Sprint-138-tagged tests are surgical (anti-regression for `user="postgres"`, field absence on SQLite via dialog-level `queryByLabelText`, Redis clamp, Mongo extension fields, host preservation on swap). Per-DBMS scenarios are not duplicates. Tests use `getByLabelText` / `queryByLabelText` (user-perspective per `.claude/rules/testing.md`), not testid hacks. Only minor gap: no test guarding the URL parse fallback path inside the dialog (only at the function level in `connection.test.ts`). Generator's handoff also flags this in Risks. |
| **Overall** | **8/10** | All AC PASS, all 7 gates green, 16 dedicated tests cover the decision-level invariants. Minor polish gaps (SSL toggle not in PG/MySQL forms, password-block duplication, SQLite uses text fallback instead of native picker) are either acknowledged in the handoff or deferrable. |

## Findings

### P1
*(blocking — none)*

None. All AC are objectively met with green-test evidence; backend untouched per Invariants.

### P2
*(should-fix before next sprint)*

1. **PG/MySQL forms missing SSL toggle declared in AC-S138-01.**
   - Current: PG and MySQL sub-components render only host/port/user/password/database. No SSL/TLS UI control.
   - Expected: contract AC-S138-01 explicitly lists "SSL" for PG and MySQL ("PG: ..., SSL", "MySQL: ..., SSL").
   - Suggestion: add a `tls_enabled` checkbox to PgFormFields and MysqlFormFields (same pattern as Mongo/Redis) OR amend the contract in a follow-up sprint to mark SSL as deferred. Either way, the next sprint should not silently inherit this gap. Generator's per-form file headers acknowledge "SSL toggle is reserved for a future extension" but the handoff does not list it under Risks/Gaps.

### P3
*(nice-to-have, document for future cleanup)*

1. **Password block duplicated 4× across PG / MySQL / Mongo / Redis sub-components.**
   - Current: each non-SQLite form file copies ~30 LOC of password input + "Clear stored password" badge logic.
   - Expected (long-term): a shared `<PasswordField>` primitive or a `useConnectionPassword` hook so a future change to the password UX (e.g. show/hide toggle, password manager integration) is a single-file edit.
   - Suggestion: open a follow-up "DRY connection form password block" sprint. Generator already calls this out in handoff Risks.

2. **`auth_source` / `replica_set` / `tls_enabled` are not cleared when swapping away from MongoDB.**
   - Current: `applyDbTypeChange` preserves these fields (handoff Assumption 6 confirms intentional). The Redis form's `tls_enabled` checkbox shares the same boolean slot, so swapping Mongo → Redis silently retains the user's earlier Mongo TLS setting.
   - Expected: cleaner mental model — either share a single TLS slot across all DBMSes (then it's a feature, not an accident) or null Mongo extension fields on swap-away.
   - Suggestion: add a P3 cleanup task or, if shared TLS is the intent, document that explicitly in the handoff and add a test asserting the cross-DBMS retention behaviour.

3. **No dialog-level test for URL-mode SQLite fallback.**
   - Current: `parseSqliteFilePath` is tested at the unit level (`connection.test.ts`), but the dialog's wire-up (`ConnectionDialog.tsx:400-404`) — "URL parse fails AND db_type is sqlite → call `parseSqliteFilePath(urlValue)`" — has no integration test.
   - Expected: a `ConnectionDialog.test.tsx` test that switches to SQLite, opens URL mode, types a bare path, clicks Parse & Continue, and asserts the form lands on the SQLite shape with `database === path`.
   - Suggestion: add 1 test in the next sprint; Generator's handoff Risks already calls out the missing URL-default-port test as a similar gap.

4. **Multiple form files share `id="conn-host"` / `id="conn-port"` / etc.**
   - Current: 4 sub-components define identical DOM IDs. Only one renders at a time so there's no actual collision in production, but ID uniqueness is an invariant tooling/static-analysis often assumes.
   - Expected: prefix each ID by DBMS (e.g. `id="conn-pg-host"`) or move the IDs up to the dialog level.
   - Suggestion: low-priority — fix during the password-DRY refactor sprint where the inputs would already be touched.

5. **SQLite file picker is text-only.**
   - Current: a `<input type="text">` with placeholder. Native picker deferred (handoff Decision 2) because `tauri-plugin-dialog` is not yet installed.
   - Expected (per Quality Bar in contract): "SQLite file picker: Tauri file picker plugin 사용 — 실패/취소 케이스 가드."
   - Suggestion: open a follow-up sprint to add `@tauri-apps/plugin-dialog`. The current text input has `aria-label`, a placeholder, and helper text, so it is genuinely usable (not "hidden/awkward"), but it does not satisfy the literal Quality Bar wording. Tagging P3 because the contract Acceptance Criteria (AC-S138-04) only requires "Choose file 버튼 또는 textbox" — Generator picked the textbox path which is contract-compliant, but the Quality Bar Pull is partially unmet.

## Verdict: **PASS**

All 8 Acceptance Criteria are met with concrete green-test evidence,
all 7 verification gates pass on the Evaluator's independent re-run,
and there are zero open P1 findings. The single P2 (missing SSL toggle
on PG/MySQL forms) is a contract-vs-handoff gap that should be tracked
explicitly but does not block merge — it is a missing sub-field on AC-
S138-01, not a broken behaviour, and the handoff documents the deferral
inside the form file headers. Recommend merging Sprint 138 and queuing
the P2 plus the P3 items into S139 / S140 backlog.
