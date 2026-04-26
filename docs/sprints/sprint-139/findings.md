# Sprint 139 Evaluation

## Independent Verification

### 1. `pnpm vitest run` (last 20 lines)
```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  137 passed (137)
      Tests  2124 passed (2124)
   Start at  02:59:39
   Duration  25.33s (transform 5.80s, setup 9.25s, import 40.76s, tests 58.31s, environment 95.60s)
```

### 2. `pnpm tsc --noEmit` (last 20 lines)
```
(no output — exit 0)
```

### 3. `pnpm lint` (last 20 lines)
```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .
(exit 0)
```

### 4. `pnpm contrast:check` (last 20 lines)
```
> table-view@0.1.0 contrast:check /Users/felix/Desktop/study/view-table
> tsx scripts/check-theme-contrast.ts

WCAG AA contrast: 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)
```

### 5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` (last 20 lines)
```
test storage::tests::test_load_storage_creates_default_when_no_file ... ok
test storage::tests::test_password_roundtrip_encrypted ... ok
test storage::tests::test_save_connection_empty_password_not_encrypted ... ok
test storage::tests::test_load_storage_redacted_omits_plaintext ... ok
test models::schema::tests::add_constraint_request_serde_roundtrip ... ok
test storage::tests::test_move_connection_to_group_changes_group ... ok
test storage::tests::test_save_connection_updates_existing_by_id ... ok
test storage::tests::test_move_connection_to_group_not_found ... ok
test storage::tests::test_save_connection_adds_new_and_loads_back ... ok
test storage::tests::test_password_presence_map_reports_correctly ... ok
test storage::tests::test_delete_connection_removes_by_id ... ok
test storage::tests::test_load_storage_with_secrets_decrypts ... ok
test storage::tests::test_save_connection_same_name_same_id_succeeds ... ok
test storage::tests::test_save_connection_with_none_preserves_existing ... ok
test storage::tests::test_save_group_adds_and_updates ... ok
test storage::tests::test_save_multiple_connections ... ok
test storage::tests::test_save_connection_rejects_duplicate_name ... ok

test result: ok. 272 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.10s
```

### 6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` (last 20 lines)
```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.35s
```

### 7. `pnpm exec eslint e2e/**/*.ts` (last 20 lines)
```
(no output — exit 0)
```

All seven gates green on the evaluator's machine, matching the Generator handoff numbers (137 test files / 2124 tests / 272 cargo tests).

## AC Verdict

| AC | Verdict | Evidence |
|----|---------|----------|
| AC-S139-01 | PASS (with caveat) | `MongoQueryEditor.tsx` imports only `@codemirror/lang-json` + caller-supplied `mongoExtensions`; never imports `useSqlAutocomplete` or `@codemirror/lang-sql`. `MongoQueryEditor.test.tsx` "completion source NEVER includes SQL keywords (SELECT, FROM, WHERE)" probes `createMongoCompletionSource` directly via a real `CompletionContext` and asserts `SELECT/FROM/WHERE/RETURNING/AUTO_INCREMENT/PRAGMA` are absent (lines 140-164). The "$match/$group/$lookup" test (lines 119-133) confirms positive presence. **Caveat**: the SQL-exclusion assertion is a unit test of `createMongoCompletionSource`, NOT a probe of the mounted editor's autocomplete pipeline; structural exclusion of SQL is enforced via module imports rather than via a runtime probe of the live editor. The `useMongoAutocomplete extensions never bring in the SQL language` test (line 169-186) does mount the editor and asserts `language facet === "json"` — that probe is at the language-extension layer, not the autocomplete-source layer. |
| AC-S139-02 | PASS | `QueryTab.tsx` lines 906-958 implement an inline `switch (tab.paradigm)` that mounts `<SqlQueryEditor>` for `rdb`, `<MongoQueryEditor>` for `document`, placeholders for `kv`/`search`, with `assertNever` on the `default` arm. `QueryTab.test.tsx` mocks both editors with paradigm-tagged DOM (`data-paradigm="rdb"` / `"document"`) and `mockEditorProps.lastParadigm` recording, then asserts the correct mount in lines 1394-1409 ("does NOT pass mongoExtensions to the SQL editor on RDB tabs", "passes a 2-entry mongoExtensions array to MongoQueryEditor on document tabs"). |
| AC-S139-03 | PASS (with gap) | `getKeywordsForDialect` (`sqlDialectKeywords.ts`) returns dialect-specific concatenated lists and `sqlDialectKeywords.test.ts` covers all 7 cases including a cross-dialect contamination guard (lines 74-95) — PG `RETURNING/JSONB`, MySQL `AUTO_INCREMENT/DUAL`, SQLite `PRAGMA/WITHOUT ROWID/AUTOINCREMENT` mutual exclusion. `useSqlAutocomplete.ts` plumbs `dbType` into the namespace (line 143-149). `SqlQueryEditor.test.tsx` confirms CodeMirror's `SQLDialect` actually highlights dialect-specific keywords (lines 108-150) and the "DUAL not flagged under PG" cross-dialect guard (lines 154-165). **Gap**: `useSqlAutocomplete.test.ts` was NOT updated with a `dbType: "postgresql"` vs `dbType: "mysql"` assertion of the returned `SQLNamespace` keys — the contract explicitly said "MODIFY `src/hooks/useSqlAutocomplete.ts` (+ test) — dialect 인자에 따라 keyword 사전 swap. 사전 swap이 실제로 일어남을 vitest로 어서션." The integration is exercised end-to-end but the hook unit-level `renderHook({ dbType: "..." })` test is missing; only the helper (`getKeywordsForDialect`) and the renderer (`SqlQueryEditor`) are tested in isolation. |
| AC-S139-04 | PASS | Both `QueryTab.tsx` (lines 930-955) and the thin `QueryEditor.tsx` router (lines 106-128) render placeholders with `role="textbox"`, `aria-label`, `aria-multiline`, `data-paradigm`, and human-readable copy ("Redis editor coming in Phase 9." / "Search editor coming in Phase 9."). The `default` arm of both switches is `assertNever(tab.paradigm)`. The placeholder copy uses "Phase 9" — does NOT match the S135 stale-copy regex `/Coming in Sprint 1[2-3][0-9]/`. The `no-stale-sprint-tooltip.test.ts` guard remains green (part of the 2124 vitest pass). No `paradigm: "kv"` / `paradigm: "search"` crash. |
| AC-S139-05 | PASS (with caveat) | The Mongo→SQL direction is enforced structurally (MongoQueryEditor never imports `@codemirror/lang-sql` or `useSqlAutocomplete`). The SQL→Mongo direction is enforced structurally (SqlQueryEditor never imports `@codemirror/lang-json`, `useMongoAutocomplete`, or `mongoExtensions`). Tests: `MongoQueryEditor.test.tsx` "completion source NEVER includes SQL keywords" + `useMongoAutocomplete extensions never bring in the SQL language" + `SqlQueryEditor.test.tsx` "never swaps to the JSON language (structural firewall)" + "does not flag MySQL-only DUAL as a keyword under PG dialect" + `QueryTab.test.tsx` "does not pull fieldsCache into the SQL editor for RDB tabs" (lines 1488-1517). **Caveat**: the cross-paradigm regression test in `QueryTab.test.tsx` runs against the mocked editor components (`vi.mock("./SqlQueryEditor")` / `vi.mock("./MongoQueryEditor")`) — the assertion is on the mock prop bag (`lastMongoExtensions === undefined`) rather than the actual mounted editor's autocomplete state. The structural firewall is real (verified by reading the imports of both editor files), but the test lives at the prop-wiring level. |
| AC-S139-06 | PASS | All 7 verification commands green on independent re-run. |

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 8/10 | The paradigm split is correct: SqlQueryEditor and MongoQueryEditor share no `@codemirror/lang-*` imports nor autocomplete hooks, and `QueryTab` routes via an inline `switch` with `assertNever`. `getKeywordsForDialect` mutual exclusion is unit-tested (PG `RETURNING` not in MySQL/SQLite, etc.). One latent issue: the dialect-keyword wiring through `useSqlAutocomplete` is verified end-to-end (via the mocked editor in `QueryTab.test.tsx` and the highlight test in `SqlQueryEditor.test.tsx`) but the hook itself has no unit test that calls `useSqlAutocomplete(connectionId, { dbType: "postgresql" })` and asserts `RETURNING in returned namespace`. The implementation is correct (lines 141-149 of useSqlAutocomplete.ts), but a future regression that mistakenly excluded the keyword loop would not be caught by a hook-level test. |
| Completeness | 7/10 | All Done Criteria satisfied except the explicit "MODIFY useSqlAutocomplete.ts (+ test)" item: the hook was modified, but `useSqlAutocomplete.test.ts` was not. The contract reads "사전 swap이 실제로 일어남을 vitest로 어서션" — fulfilled at the helper level (`sqlDialectKeywords.test.ts`) and at the editor level (`SqlQueryEditor.test.tsx`), but not at the hook level. Placeholder text (Phase 9) is in line with the Roadmap and avoids the S135 stale-copy regex. The thin `QueryEditor` router preserves the old test surface as advertised. |
| Reliability | 8/10 | Cross-paradigm contamination is blocked structurally (module imports), which is the strongest possible firewall. Compartment-based dialect/schema swaps inside `SqlQueryEditor` preserve the EditorView (test "reconfigures the dialect in-place without recreating the EditorView" at lines 168-194 of SqlQueryEditor.test.tsx). However, paradigm-flip now unmounts/remounts the editor (handoff Risk #1) — cursor/selection/undo history is lost on rdb↔document flip. The handoff acknowledges this as a corner case (paradigm flip requires a connection swap). The pre-S139 `QueryEditor.test.tsx` "same EditorView identity across paradigm flip" tests were rewritten to instead assert the post-flip language facet (`expect(activeLanguageName(viewAfter)).toBe("json")`) — this is a legitimate weakening, but the trade-off is documented and consistent with the structural split. No existing test that asserted cross-paradigm cursor preservation was deleted silently. |
| Verification Quality | 7/10 | All 7 gates green and reproducible on the evaluator machine. AC-by-test mapping in the handoff is mostly accurate. Coverage is good at the helper level (7 cases for `getKeywordsForDialect`) and at the renderer level (8+ cases each for SqlQueryEditor and MongoQueryEditor). The cross-contamination tests live one layer below the live editor (helper sources / mocked editors / language facets) rather than running an `EditorView` against a `CompletionContext` to enumerate the live autocomplete options. This is acceptable because the firewall is structural, but a "live editor probe" would be the gold-standard regression guard. |

**Overall**: 7.5/10 (all dimensions ≥ 7).

## Findings

### P1
None.

### P2
None.

### P3

1. **Missing hook-level test for `useSqlAutocomplete({ dbType })`** — The contract explicitly required modifying `useSqlAutocomplete.ts` *and* its test. The implementation lands the dbType-driven keyword surface at lines 141-149 of `useSqlAutocomplete.ts`, but `src/hooks/useSqlAutocomplete.test.ts` has no `renderHook(() => useSqlAutocomplete("conn1", { dbType: "postgresql" }))` case asserting that `RETURNING`, `ILIKE`, etc. appear as top-level namespace keys (and the converse for `dbType: "mysql"`).
   - Current: helper test (`sqlDialectKeywords.test.ts`) covers the keyword arrays, and `SqlQueryEditor.test.tsx` covers CodeMirror's *highlight* output. Neither tests the hook's namespace shape directly.
   - Expected: a hook-level test that calls `renderHook(() => useSqlAutocomplete("c", { dbType: "postgresql" }))` and asserts `Object.keys(result.current).includes("RETURNING")` (and the converse for MySQL).
   - Suggestion: add 3 cases (PG / MySQL / SQLite) to `useSqlAutocomplete.test.ts` mirroring the structure of the existing `dialect` parameter tests.

2. **Cross-contamination tests are one layer below the mounted editor** — The strongest evidence (`MongoQueryEditor.test.tsx` "completion source NEVER includes SQL keywords") tests `createMongoCompletionSource` directly, not the autocomplete pipeline of a mounted `MongoQueryEditor`. Similarly, the `QueryTab.test.tsx` cross-paradigm regression asserts on mocked editor prop bags. The structural firewall (module imports) makes contamination impossible in practice, but a live-editor regression probe would be more robust against future refactors that, say, accidentally pass `useSqlAutocomplete` extensions through `mongoExtensions`.
   - Current: helper-level + mock-level assertions.
   - Expected: at least one test that mounts the real `MongoQueryEditor` with the live `useMongoAutocomplete` output and queries CodeMirror's autocomplete state for `SELECT`-prefixed candidates after typing `S`.
   - Suggestion: optional follow-up; the structural separation is genuine and S139's import structure already enforces it.

3. **Paradigm-flip cursor/selection loss is documented but untested** — The Generator's handoff Risk #1 calls out that rdb↔document paradigm flips unmount the editor, losing cursor/selection/undo history. This trade-off is intentional and acceptable for the rare flip path (requires a connection swap), but a regression-guard test in `QueryEditor.test.tsx` that asserts the post-flip language facet flipped (no cursor preservation expected) would prevent a future "fix" from reintroducing a Compartment-based monolithic editor.
   - Current: tests at lines 389-418 + 686-723 of `QueryEditor.test.tsx` were updated to assert language-facet correctness across paradigm flip without identity preservation. That covers the new contract.
   - Expected: same as current. Note this finding is informational — no action required.

4. **`COMMON_SQL_KEYWORDS` exposes `LIMIT` as a single keyword but the contract called for `LIMIT n,m` MySQL-only syntax** — `getKeywordsForDialect` adds `LIMIT` to the common set (line 41 of `sqlDialectKeywords.ts`) and not the MySQL-specific multi-arg form. Probably intentional since CodeMirror handles parsing, but worth checking: the contract said "MySQL: AUTO_INCREMENT, **LIMIT n,m**, REPLACE INTO". The autocomplete popup will not surface "LIMIT n,m" as a single MySQL-specific candidate; users learn the syntax elsewhere. This is acceptable scope.
   - Current: `LIMIT` in COMMON_SQL_KEYWORDS only.
   - Expected: depends on intent; if the contract literally meant "the literal string `LIMIT n,m` is a MySQL keyword candidate" then a MYSQL-specific entry would be needed. More likely the contract was loose about the `n,m` syntax.
   - Suggestion: confirm with the planner — likely no action needed.

## Verdict: PASS

All five rubric dimensions ≥ 7 (Correctness 8, Completeness 7, Reliability 8, Verification Quality 7). All 7 verification gates green. P1=0, P2=0, P3=4 (all minor / informational). The structural firewall between paradigms is genuine (verified by reading the imports of `SqlQueryEditor.tsx` and `MongoQueryEditor.tsx` directly), the dialect-keyword swap works end-to-end, and the cross-contamination tests cover the helper, the renderer, and the integration mocks. The two real gaps are (a) absence of a hook-level `useSqlAutocomplete({ dbType })` test and (b) cross-paradigm tests that probe mocks rather than mounted editors — both P3, neither blocking.
