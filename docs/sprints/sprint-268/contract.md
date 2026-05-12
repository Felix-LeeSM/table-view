# Sprint Contract: sprint-268

## Summary

- Goal: Eliminate the last-writer-wins collision in
  `useSqlAutocomplete`'s column lookup when two schemas in the same
  `(connId, db)` hold a table of the same name (`public.users` vs
  `auth.users`). After this sprint, autocomplete for `SELECT`,
  `UPDATE SET`, `INSERT cols`, `WHERE`, and `JOIN ON` returns columns
  from the schema the user actually qualified, and the bare /
  unqualified key follows a single explicit, documented ambiguity
  policy.
- Audience: Generator + Evaluator agents under the harness loop.
- Owner: Generator (Sprint 268).
- Verification Profile: `command`

## In Scope

- `src/hooks/useSqlAutocomplete.ts` — replace the
  `cachedColumnsByName: Record<tableName, Record<col, SQLNamespace>>`
  cache (today written at lines ~183–195) with a shape that preserves
  schema identity. The bare-name registration path must apply the
  chosen ambiguity policy (see Done Criteria #2).
- `src/hooks/useSqlAutocomplete.ts` — keep the existing
  `pickColumns(objectName, qualifiedName)` contract semantically
  intact for the schema-qualified path (qualified lookup returns the
  schema-correct column set), and for the bare path apply the chosen
  policy.
- `src/hooks/useSqlAutocomplete.test.ts` — add the four AC cases
  (AC-268-01 through AC-268-04) and pin the chosen ambiguity policy in
  the AC-268-02 case.

## Out of Scope

- No DbMismatch toast change. The Retry-button work is Sprint 269 and
  must not be touched here.
- No skeleton placeholders. Cold-boot perceived-performance work is
  Sprint 270.
- No backend `expected_database` guard propagation. The remaining RDB
  command audit is Sprint 271.
- No `schemaStore` shape change. The cache has been
  `(connId, db, schema, table)`-keyed since Sprint 263 and stays that
  way.
- No CodeMirror `SQLNamespace` external shape change. Only the
  internal `cachedColumnsByName` shape inside `useSqlAutocomplete`
  changes. Callers (`SqlEditor`, `useSqlExtensions`) and the dialect
  / quoting helpers remain untouched.
- No new public option, no new prop on `UseSqlAutocompleteOptions`.

## Invariants

- All existing Sprint 264 cross-DB isolation cases
  (`useSqlAutocomplete.test.ts` lines ~689–1024, six `AC-264-01` cases
  for tables, ghost-cache, rerender, schema-qualified, fully-quoted
  PG, views) must still pass byte-equivalent.
- All existing Sprint 233 fully-quoted PG/SQLite cases
  (`AC-233-01` … `AC-233-03`, ~556–687) must still pass.
- All existing Sprint 82 dialect-aware quoting cases (~365–488) must
  still pass.
- `schemaStore.tableColumnsCache` shape (`{connId: {db: {schema:
  {table: ColumnInfo[]}}}}`) is read-only from this hook and is not
  modified.
- CodeMirror `SQLNamespace` external shape is unchanged: top-level
  keys are still functions, keywords, bare table names,
  `schema.table`, dialect-quoted aliases, and (per Sprint 233)
  fully-quoted `"schema"."table"`. Only the column-lookup intermediate
  cache changes.
- The legacy `TableColumnOverrides` (`Record<string, string[]>`)
  argument path is preserved: when present it still beats the cache
  via `pickColumns`'s first branch (line ~203). That branch's `if
  (tableColumns && tableColumns[objectName])` semantics do not change.
- No new ADR. No `any` (TS) and no `console.log` shipped.

## Acceptance Criteria

- `AC-268-01` — Collision regression test. A vitest case mounts the
  hook against a fixture where `(connId="c1", db="db1")` holds both
  `public.users {id, name}` and `auth.users {id, login_ip}`. The
  schema-qualified lookup `ns["public.users"]` exposes only `{id,
  name}`; `ns["auth.users"]` exposes only `{id, login_ip}`. This
  case MUST fail on the current `useSqlAutocomplete.ts` (because the
  loop at lines 188–195 overwrites `cachedColumnsByName["users"]` on
  the second schema iteration, leaking columns through the bare
  fallback at line 210) and MUST pass after the fix.
- `AC-268-02` — Unqualified key behaviour is specified. For a bare
  lookup `ns["users"]` when the same DB holds multiple schemas with a
  table of that name, the hook implements **exactly one** of the
  following policies, and **that policy is pinned by a vitest case
  and documented in an inline comment in
  `useSqlAutocomplete.ts`**:
  - Policy A (recommended default): union of all candidate columns
    across schemas, deduped by column name. With `public.users {id,
    name}` and `auth.users {id, login_ip}`, `ns["users"]` exposes
    `{id, name, login_ip}` and never silently drops `login_ip`.
  - Policy B: register no bare entry at all when ambiguous;
    `ns["users"]` resolves to an empty namespace `{}` (or is absent),
    forcing the user to qualify the name.
  - The Generator MUST pick exactly one of A or B, document the
    choice + rationale as a code comment near the bare-key
    registration path, and pin the choice with the AC-268-02 test.
    The pre-fix "single-writer-wins" behaviour (whichever schema is
    iterated last wins `ns["users"]`) MUST NOT survive.
- `AC-268-03` — Single-schema parity preserved. When `(connId="c1",
  db="db1")` has `public.users` only, `ns["users"]` and
  `ns["public.users"]` both expose `{id, name}` exactly as today, and
  every Sprint 264 cross-DB isolation case continues to pass
  unchanged.
- `AC-268-04` — Fully-quoted aliasing follows the same rule. For a
  Postgres dialect mount with `public.users {id, name}` and
  `auth.users {id, login_ip}` in the same DB,
  `ns['"public"."users"']` exposes only `{id, name}` and
  `ns['"auth"."users"']` exposes only `{id, login_ip}` (i.e. the
  fully-quoted PG/SQLite path established by Sprint 233 also returns
  schema-correct columns rather than the cross-schema overwrite).
- `AC-268-05` — Regression gate. `pnpm vitest run
  --no-file-parallelism` baseline preserved (case count is ≥ the
  pre-sprint count plus the four new cases above), `pnpm tsc
  --noEmit` and `pnpm lint` are clean.

## Design Bar / Quality Bar

- The new cache shape MUST preserve schema identity in its key
  structure (e.g. `Record<schema, Record<table, colNs>>` or
  `Record<"schema.table", colNs>`). Encoding schema in a value side
  channel rather than the key is rejected as a regression risk
  because the lookup at line ~209 is keyed on `qualifiedName` /
  `objectName` strings.
- The bare-key policy decision (Policy A or B) MUST be expressed as
  a single explicit code branch with a comment that names the
  sprint (`Sprint 268 (2026-05-13)`) and states the rationale in 1–2
  lines.
- Each new test gets a header comment with sprint id + date +
  rationale, per the project testing convention (project rule:
  `feedback_test_documentation.md`).
- `any` is forbidden. The existing test casts (`Record<string,
  Record<string, unknown>>`) are acceptable; new test code follows
  the same shape.
- No `console.log`, no `unwrap`-style ignored errors. No empty
  `catch` blocks.

## Verification Plan

### Required Checks

1. `pnpm vitest run --no-file-parallelism
   src/hooks/useSqlAutocomplete.test.ts` — must pass; case count is
   the pre-sprint count for this file plus exactly the four new
   AC-268 cases.
2. `pnpm vitest run --no-file-parallelism` — full suite must pass;
   total test case count is monotonically non-decreasing relative to
   the Sprint 267 baseline.
3. `pnpm tsc --noEmit` — 0 errors.
4. `pnpm lint` — 0 errors, 0 new warnings.

### Required Evidence

- Generator must provide:
  - Diff of `src/hooks/useSqlAutocomplete.ts` covering (a) the new
    `cachedColumnsByName` shape and (b) the bare-key policy branch
    with its inline comment.
  - Diff of `src/hooks/useSqlAutocomplete.test.ts` covering the four
    new AC-268 cases. Each case header carries sprint id + date +
    rationale per the testing-doc rule.
  - New-test-case delta count for both this file and the full suite.
  - Full output of `pnpm vitest run --no-file-parallelism
    src/hooks/useSqlAutocomplete.test.ts` and a summary line for the
    full-suite run.
  - Full output of `pnpm tsc --noEmit` and `pnpm lint`.
  - One-line statement of which ambiguity policy (A or B) was
    chosen for AC-268-02 and the rationale, mirroring the in-code
    comment.
- Evaluator must cite:
  - Actual line numbers in `src/hooks/useSqlAutocomplete.ts` where
    the new cache shape is built and where the bare-key policy
    branch lives, plus the literal comment text naming the sprint
    and policy.
  - Actual line numbers + `it()` names of the four new test cases
    in `src/hooks/useSqlAutocomplete.test.ts`.
  - The full-suite pass count and the per-file pass count
    (transcribed from the test runner summary).
  - Any AC where the evidence is missing, weak, or contradicts the
    code as a finding.

## Test Requirements

### Unit Tests (필수)

- One new vitest case per AC (AC-268-01, AC-268-02, AC-268-03,
  AC-268-04). AC-268-05 is a meta gate, not a case.
- AC-268-02's case MUST assert the chosen policy explicitly:
  - Policy A: `expect(ns.users).toHaveProperty("id");
    expect(ns.users).toHaveProperty("name");
    expect(ns.users).toHaveProperty("login_ip");`
  - Policy B: `expect((ns.users ?? {})).toEqual({});` and `expect(
    Object.keys(ns.users ?? {})).toHaveLength(0);` (or equivalent
    absence assertion).
- AC-268-03's case asserts both `ns.users` and `ns["public.users"]`
  match the single-schema baseline.
- An additional "no regression" assertion is encouraged but not
  required: a `it` block that re-runs one of the pre-existing
  Sprint 264 fixtures and asserts the new behaviour is identical
  for the cross-DB-only case.

### Coverage Target

- Modified file (`useSqlAutocomplete.ts`): line coverage ≥ 70% over
  the touched region. The hook's single function is already heavily
  exercised; the goal is "the new branch is covered", not a global
  number.
- CI baseline: line ≥ 40%, function ≥ 40%, branch ≥ 35%
  (unchanged).

### Scenario Tests (필수)

- [ ] Happy path — schema-qualified lookup returns schema-correct
      columns (AC-268-01).
- [ ] Ambiguity / collision — bare key under multi-schema collision
      follows the documented policy (AC-268-02).
- [ ] Boundary — single-schema fixture is byte-equivalent to today
      (AC-268-03).
- [ ] Quoting axis — fully-quoted PG path follows the same rule
      (AC-268-04).
- [ ] Regression — Sprint 264 cross-DB isolation cases unchanged
      (covered by full-suite gate).

## Test Script / Repro Script

1. `git checkout` the Sprint 268 working branch.
2. `pnpm vitest run --no-file-parallelism
   src/hooks/useSqlAutocomplete.test.ts` — confirm all AC-268 cases
   pass.
3. `pnpm vitest run --no-file-parallelism` — confirm full suite
   passes and the total case count is ≥ pre-sprint baseline + 4.
4. `pnpm tsc --noEmit` — 0 errors.
5. `pnpm lint` — 0 errors.
6. Open `src/hooks/useSqlAutocomplete.ts`, locate the bare-key
   policy branch, and verify the inline comment names Sprint 268 +
   the chosen policy + the one-line rationale.

## Ownership

- Generator: Sprint-268 generator agent (single PR).
- Write scope:
  - `src/hooks/useSqlAutocomplete.ts`
  - `src/hooks/useSqlAutocomplete.test.ts`
  - No other file in the repo is touched by this sprint.
- Merge order: Sprint 268 first; Sprints 269 / 270 / 271 follow
  independently per the master spec dependency order.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
