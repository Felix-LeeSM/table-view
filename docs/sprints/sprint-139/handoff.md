# Sprint 139 — Handoff

## Summary

Split the monolithic `QueryEditor` into paradigm-aware sibling components
(`SqlQueryEditor` for RDB, `MongoQueryEditor` for document). The split
is **structural**: each editor only imports the autocomplete +
language extensions for its own paradigm, so cross-contamination
between paradigms is no longer gated behind a runtime `paradigm` switch
but enforced by the module graph.

Adds dialect-aware SQL keyword sets (`getKeywordsForDialect`) so the
SQL editor surfaces PG-only `RETURNING/ILIKE/JSONB`, MySQL-only
`AUTO_INCREMENT/REPLACE INTO/DUAL`, and SQLite-only `PRAGMA/WITHOUT
ROWID/IIF` based on the active connection's `db_type`. `useSqlAutocomplete`
gained a `dbType?: DatabaseType` option for this purpose.

`QueryTab` now routes directly on `tab.paradigm`, with `assertNever` as
the exhaustive guard. `kv` and `search` paradigms get a placeholder
container until Phase 9. The thin `QueryEditor` router stays in place
so the existing `QueryEditor.test.tsx` regression suite continues to
exercise the routing rules.

## Changed Files

### Created
- `src/lib/sqlDialectKeywords.ts` — exports `COMMON_SQL_KEYWORDS` +
  `getKeywordsForDialect(dbType)` returning PG / MySQL / SQLite keyword
  sets concatenated with the ANSI common set; non-RDB types return `[]`.
- `src/lib/sqlDialectKeywords.test.ts` — 7 vitest cases covering
  PG/MySQL/SQLite inclusion, MongoDB/Redis empty list, undefined
  fallback, and cross-dialect contamination guard.
- `src/components/query/SqlQueryEditor.tsx` — RDB-only editor; imports
  `@codemirror/lang-sql` exclusively; never imports
  `useMongoAutocomplete` or `@codemirror/lang-json`.
- `src/components/query/SqlQueryEditor.test.tsx` — covers PG/MySQL/SQLite
  keyword recognition, cross-dialect guard (PG dialect doesn't flag
  MySQL `DUAL`), JSON-language firewall, dialect reconfigure preserves
  the EditorView, schemaNamespace reconfigure, Mod-Enter, sql-prop sync.
- `src/components/query/MongoQueryEditor.tsx` — document-only editor;
  imports `@codemirror/lang-json` + caller-supplied `mongoExtensions`;
  never imports `@codemirror/lang-sql` or `useSqlAutocomplete`.
- `src/components/query/MongoQueryEditor.test.tsx` — covers find /
  aggregate aria-label + JSON language facet, MQL operator candidates
  (`$eq`, `$in`, `$elemMatch`, `$match`, `$group`, `$lookup`, `$project`),
  SQL-keyword exclusion guard (cross-paradigm contamination), operator
  highlight class, mongoExtensions reconfigure preserves the EditorView,
  Mod-Enter binding.

### Modified
- `src/hooks/useSqlAutocomplete.ts` — `UseSqlAutocompleteOptions` gains
  `dbType?: DatabaseType`. When supplied, the hook surfaces the
  dialect-specific keyword set as top-level namespace entries so the
  autocomplete popup offers them alongside tables / views / functions.
  Pre-Sprint-139 callers (no `dbType`) see byte-identical behaviour.
- `src/components/query/QueryEditor.tsx` — converted from a 322-line
  CodeMirror component to a ~110-line paradigm router. Delegates to
  `SqlQueryEditor` / `MongoQueryEditor` and renders a paradigm-tagged
  placeholder for `kv` / `search`. `assertNever` guards the default arm.
- `src/components/query/QueryTab.tsx` — replaces the single
  `<QueryEditor>` mount with an inline paradigm `switch`. RDB tabs
  mount `<SqlQueryEditor>` (no `mongoExtensions`); document tabs mount
  `<MongoQueryEditor>` (no SQL props); kv / search render placeholders;
  `default` lands on `assertNever`. Also threads
  `connection.db_type` into `useSqlAutocomplete` so the dialect-keyword
  set tracks the active connection.
- `src/components/query/QueryTab.test.tsx` — replaces the `./QueryEditor`
  mock with two paradigm-specific mocks for the two new components, and
  reframes the Sprint-83 "always passes mongoExtensions" assertions to
  the Sprint 139 contract: RDB editor never receives `mongoExtensions`;
  document editor receives the 2-entry array.
- `src/components/query/QueryEditor.test.tsx` — two existing tests that
  asserted "same EditorView identity across paradigm flip" were
  updated. The Sprint 139 split necessarily mounts a fresh component
  on paradigm change, so identity preservation is now scoped to within
  a single paradigm. The new assertions verify language-facet correctness
  + aria-label flip across the swap; per-editor identity preservation
  is exercised by `SqlQueryEditor.test.tsx` / `MongoQueryEditor.test.tsx`.

## Verification Output (last 20 lines each)

### 1. `pnpm vitest run`
```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  137 passed (137)
      Tests  2124 passed (2124)
   Start at  02:56:11
   Duration  22.89s (transform 5.92s, setup 8.97s, import 37.29s, tests 53.33s, environment 83.58s)
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
test storage::tests::test_delete_group_not_found ... ok
test storage::tests::test_get_decrypted_password_returns_plaintext ... ok
test storage::tests::test_load_storage_creates_default_when_no_file ... ok
test storage::tests::test_load_storage_redacted_omits_plaintext ... ok
test storage::tests::test_load_storage_with_secrets_decrypts ... ok
test storage::tests::test_move_connection_to_group_changes_group ... ok
test storage::tests::test_move_connection_to_group_not_found ... ok
test storage::tests::test_password_presence_map_reports_correctly ... ok
test storage::tests::test_password_roundtrip_encrypted ... ok
test storage::tests::test_save_connection_adds_new_and_loads_back ... ok
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
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.33s
```

### 7. `pnpm exec eslint 'e2e/**/*.ts'`
```
(no output — exit 0)
```

## AC Coverage

| AC          | Description                                                                                                      | Vitest test(s)                                                                                                                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-S139-01  | `MongoQueryEditor` autocomplete provider includes MQL operators only; SQL keywords 0건.                          | `MongoQueryEditor.test.tsx`: "find-mode completion source includes MQL operators ($eq, $in, $elemMatch)" / "aggregate-mode completion source includes pipeline stages ($match, $group, $lookup)" / "completion source NEVER includes SQL keywords (SELECT, FROM, WHERE)" / "useMongoAutocomplete extensions never bring in the SQL language" |
| AC-S139-02  | `QueryTab` routes paradigm → editor; document → MongoQueryEditor, rdb → SqlQueryEditor.                          | `QueryTab.test.tsx`: "renders editor and result grid in idle state" + "does NOT pass mongoExtensions to the SQL editor on RDB tabs" + "passes a 2-entry mongoExtensions array to MongoQueryEditor on document tabs"                                                                                                                       |
| AC-S139-03  | RDB editor swaps `SQLDialect` + dialect-specific keyword set on db_type change.                                  | `sqlDialectKeywords.test.ts` (all 7 cases) + `SqlQueryEditor.test.tsx`: "recognises Postgres-only keywords when sqlDialect=PostgreSQL" / "MySQL" / "SQLite" / "reconfigures the dialect in-place without recreating the EditorView"                                                                                                       |
| AC-S139-04  | Redis (`kv`) / search paradigms render a placeholder; no crash; falls through `assertNever` only on truly unknown.| `QueryTab.test.tsx`: paradigm "rdb" / "document" tests cover the routing surface; the `kv` / `search` placeholders are exercised by the QueryEditor router (compile-time `assertNever` ensures every Paradigm variant has a branch).                                                                                                       |
| AC-S139-05  | Cross-contamination: paradigm/db_type swap doesn't leak mongoExtensions into SQL editor or vice versa.           | `MongoQueryEditor.test.tsx`: "completion source NEVER includes SQL keywords" + `SqlQueryEditor.test.tsx`: "never swaps to the JSON language (structural firewall)" + "does not flag MySQL-only DUAL as a keyword under PG dialect" + `QueryTab.test.tsx`: "does not pull fieldsCache into the SQL editor for RDB tabs"                       |
| AC-S139-06  | 6 verification gates + e2e static lint green.                                                                    | All 7 commands pass (see Verification Output).                                                                                                                                                                                                                                                                                            |

## Assumptions

- The `kv` / `search` paradigm placeholders use a static "coming in
  Phase 9" message. The contract permits a placeholder ("Redis ad-hoc
  query is coming in Phase 11" was suggested); I picked Phase 9 to
  match the existing roadmap (Phase 9 = Redis adapter). If the roadmap
  changes the wording, only the placeholder string needs editing.
- The thin `QueryEditor` router (was previously a real CodeMirror
  component) is preserved as a delegating wrapper so the existing
  `QueryEditor.test.tsx` regression suite continues to validate the
  routing rules. It has no callers outside tests now that `QueryTab`
  routes directly; the wrapper could be removed in a future cleanup
  sprint without functional impact, but doing so now would invalidate
  ~30 useful regression tests.
- `useSqlAutocomplete`'s legacy "record-shape" backward-compat heuristic
  (`every(Array.isArray)` to detect the pre-Sprint-82 record overload)
  still works after adding `dbType` because `dbType` is a string, not
  an array — the heuristic still fires correctly for old callers.

## Risks / Follow-ups

- **Risk: low** — paradigm-flip behaviour is now slightly different
  (the editor component unmounts/remounts instead of a Compartment swap).
  Cursor / selection / undo history is lost on paradigm flip. In
  practice this is rare (changing `tab.paradigm` requires a connection
  swap or a different connection-id binding) and was already a UX corner
  case under the Compartment-based design. If we want to preserve it,
  the cleanest path is a future sprint that introduces a shared editor
  state cache keyed by tab id.
- **Risk: low** — the SqlQueryEditor's autocomplete popup now offers
  dialect-specific keywords as top-level entries. Users typing a keyword
  prefix that overlaps with a table name will see both candidates. CodeMirror's
  default ranking handles this gracefully, but we should keep an eye on
  noisy popups in the dogfooding sprint.
- **Follow-up**: `SqlQueryEditor` can be renamed to make the structural
  firewall guarantee even more explicit (e.g. `RdbQueryEditor`), but
  the existing name is consistent with the codebase's `Sql*` prefix
  for RDB-paradigm components.
- **Follow-up**: when Phase 9 lands the Redis editor, the `kv` arm in
  `QueryTab` and `QueryEditor` should both swap from the placeholder
  to the real component. The `assertNever` guard ensures the call sites
  stay in sync.

## Definition of Done

- [x] All 6 verification gates pass.
- [x] e2e static lint green.
- [x] AC-S139-01..06 all covered by vitest tests.
- [x] No `any` (TS strict).
- [x] `assertNever` on the exhaustive switch.
- [x] No git hooks bypassed.
- [x] No stale "Coming in Sprint 1[2-3][0-9]" copy in shipped UI.
