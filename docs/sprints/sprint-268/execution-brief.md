# Sprint Execution Brief: sprint-268

## Objective

- Replace the bare-name keyed `cachedColumnsByName` lookup in
  `useSqlAutocomplete` with a schema-preserving cache so
  schema-qualified autocomplete (`ns["public.users"]`,
  `ns["auth.users"]`, and their fully-quoted PG/SQLite forms) returns
  schema-correct columns rather than the last-iterated overwrite, and
  pin one explicit ambiguity policy for the bare key
  `ns["users"]`.

## Task Why

- Closes Sprint 264 Out-of-Scope item #1 (intra-DB autocomplete
  collision). Sprint 263 + 264 isolated the cache per `(connId, db)`
  but left intra-DB schema collision untouched.
- `useSqlAutocomplete` is the single CodeMirror namespace source for
  every SQL position — `SELECT`, `UPDATE SET`, `INSERT cols`,
  `WHERE`, `JOIN ON`. One fix to the cache shape covers every
  position; without it, mixed-schema users (`public.users` +
  `auth.users` in the same DB) silently see the wrong column set
  whenever they qualify a table.
- The bare-key behaviour today is "whichever schema iterated last
  wins", which is non-deterministic relative to `Object.entries`
  ordering on the schema map. A deterministic, documented policy is
  required.

## Scope Boundary

- In: `src/hooks/useSqlAutocomplete.ts` cache shape +
  bare-key policy branch; `src/hooks/useSqlAutocomplete.test.ts`
  four new AC-268 cases.
- Out: DbMismatch toast Retry button (Sprint 269). Cold-boot
  skeleton placeholders (Sprint 270). Backend `expected_database`
  guard propagation (Sprint 271). `schemaStore` cache shape — kept
  at the Sprint 263 `(connId, db, schema, table)` keying. CodeMirror
  `SQLNamespace` external shape — only the internal lookup shape
  changes. `UseSqlAutocompleteOptions` public surface — no new
  props.

## Invariants

- All Sprint 264 cross-DB isolation cases (6 cases, AC-264-01) and
  Sprint 233 fully-quoted cases (3 cases, AC-233-01..03) and Sprint
  82 dialect-quoting cases stay green.
- `schemaStore.tableColumnsCache` is read-only from this hook.
- CodeMirror `SQLNamespace` external shape unchanged.
- Legacy `TableColumnOverrides` (`Record<string, string[]>`)
  argument path keeps beating the cache via
  `pickColumns`'s first branch.
- No new ADR. No `any`. No `console.log` shipped. No empty `catch`.

## Done Criteria

1. A vitest case mounts the hook against `(connId="c1", db="db1")`
   with both `public.users {id, name}` and `auth.users {id,
   login_ip}` and asserts `ns["public.users"]` is `{id, name}` only
   and `ns["auth.users"]` is `{id, login_ip}` only. This case fails
   pre-fix and passes post-fix (AC-268-01).
2. The bare lookup `ns["users"]` follows exactly one explicit policy
   — Policy A (recommended default): union of candidate columns
   deduped by column name; OR Policy B: no bare entry / empty
   namespace when ambiguous. The chosen policy is documented as an
   inline comment in `useSqlAutocomplete.ts` near the bare-key
   registration branch (mentioning `Sprint 268 (2026-05-13)` and a
   one-line rationale) and pinned by the AC-268-02 vitest case.
   "Single-writer-wins" must not survive (AC-268-02).
3. With single-schema `public.users` only, `ns["users"]` and
   `ns["public.users"]` both expose `{id, name}` exactly as today;
   all Sprint 264 isolation cases unchanged (AC-268-03).
4. PG dialect mount: `ns['"public"."users"']` and
   `ns['"auth"."users"']` return their schema-correct column sets,
   not the cross-schema overwrite (AC-268-04).
5. `pnpm vitest run --no-file-parallelism` total case count ≥
   pre-sprint baseline + 4; `pnpm tsc --noEmit` and `pnpm lint`
   clean (AC-268-05).

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run --no-file-parallelism
     src/hooks/useSqlAutocomplete.test.ts`
  2. `pnpm vitest run --no-file-parallelism` (full suite)
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
- Required evidence:
  - Diff of `src/hooks/useSqlAutocomplete.ts` (cache shape + policy
    branch) and `src/hooks/useSqlAutocomplete.test.ts` (four new
    cases).
  - New-test-case delta and full-suite total case count.
  - Full output of the per-file vitest run; summary line of the
    full-suite vitest run; full output of tsc and lint.
  - One-line declaration of the chosen ambiguity policy (A or B)
    plus the verbatim in-code rationale comment.

## Evidence To Return

- Changed files and purpose:
  - `src/hooks/useSqlAutocomplete.ts` — new schema-preserving
    cache shape; new bare-key policy branch with inline comment.
  - `src/hooks/useSqlAutocomplete.test.ts` — four new AC-268
    cases, each with sprint id + date + rationale header.
- Checks run and outcomes:
  - Per-file vitest, full-suite vitest, tsc, lint — each with raw
    output or the relevant tail summary.
- Done criteria coverage with evidence:
  - Line numbers in `useSqlAutocomplete.ts` for the cache shape
    change and the policy branch comment.
  - Line numbers + `it()` names for each new test in
    `useSqlAutocomplete.test.ts`.
- Assumptions made during implementation:
  - Which ambiguity policy was chosen (A or B) and why.
  - Any shape decision (`Record<schema, Record<table, colNs>>` vs
    `Record<"schema.table", colNs>`) and rationale.
- Residual risk or verification gaps:
  - Note any caller that reads bare keys assuming single-table
    semantics (Generator audit; expected: none beyond CodeMirror's
    own `addNamespaceObject`).

## References

- Contract: `/Users/felix/Desktop/study/view-table/docs/sprints/sprint-268/contract.md`
- Master spec: `/Users/felix/Desktop/study/view-table/docs/sprints/sprint-268/spec.md`
- Findings: `/Users/felix/Desktop/study/view-table/docs/sprints/sprint-268/findings.md` (Evaluator output, post-run)
- Relevant files:
  - `/Users/felix/Desktop/study/view-table/src/hooks/useSqlAutocomplete.ts`
    (cache build + lookup at lines ~183–213; bare-key write at line
    ~192; bare fallback at line ~210)
  - `/Users/felix/Desktop/study/view-table/src/hooks/useSqlAutocomplete.test.ts`
    (Sprint 264 cross-DB isolation cases at lines ~689–1024 are the
    regression baseline; Sprint 233 fully-quoted cases at
    ~556–687)
  - `/Users/felix/Desktop/study/view-table/src/stores/schemaStore.ts`
    (`tableColumnsCache: {connId: {db: {schema: {table:
    ColumnInfo[]}}}}` — read-only from this hook)
