# Sprint 268 Evaluation Scorecard

## Inputs

- Contract: `/Users/felix/Desktop/study/view-table/docs/sprints/sprint-268/contract.md`
- Execution Brief: `/Users/felix/Desktop/study/view-table/docs/sprints/sprint-268/execution-brief.md`
- Spec (Sprint 268 section): `/Users/felix/Desktop/study/view-table/docs/sprints/sprint-268/spec.md`
- Implementation file: `/Users/felix/Desktop/study/view-table/src/hooks/useSqlAutocomplete.ts`
- Test file: `/Users/felix/Desktop/study/view-table/src/hooks/useSqlAutocomplete.test.ts`
- Verification profile: `command` (vitest + tsc + lint).

## Verification Results (re-run by Evaluator)

| Check | Command | Result |
|-------|---------|--------|
| Per-file vitest | `pnpm vitest run --no-file-parallelism src/hooks/useSqlAutocomplete.test.ts` | **1 file passed, 35 tests passed** (was 31 pre-sprint; +4 monotonic) |
| Full vitest | `pnpm vitest run --no-file-parallelism` | **260 files passed, 3205 tests passed** (Generator measured baseline 3201 pre-sprint, +4 monotonic) |
| TypeScript | `pnpm tsc --noEmit` | **exit 0** (no output) |
| ESLint | `pnpm lint` | **exit 0** (no output) |

## Acceptance Criteria Trace

| AC | Status | Evidence |
|----|--------|----------|
| AC-268-01 — qualified lookup schema-correct under intra-DB collision | PASS | Test at `useSqlAutocomplete.test.ts:980` (`schema-qualified lookup returns schema-correct columns under intra-DB collision (AC-268-01)`). Asserts `ns["public.users"]` has `{id, name}` and not `login_ip`; `ns["auth.users"]` has `{id, login_ip}` and not `name`. |
| AC-268-02 — bare-key ambiguity policy A (union, deduped) | PASS | Test at `useSqlAutocomplete.test.ts:1061`. Asserts `ns.users` has `id`, `name`, `login_ip` and `Object.keys(ns.users!).length === 3`. Policy A documented at `useSqlAutocomplete.ts:208-215` (inline comment names `Sprint 268 (2026-05-13)`, declares Policy A, gives rationale, rejects Policy B). Implementation registers union via `unionColumns()` at `useSqlAutocomplete.ts:344-367`. |
| AC-268-03 — single-schema parity | PASS | Test at `useSqlAutocomplete.test.ts:1139`. Asserts both `ns.users` and `ns["public.users"]` expose `{id, name}` (length 2). |
| AC-268-04 — PG fully-quoted path | PASS | Test at `useSqlAutocomplete.test.ts:1192`. Asserts `ns['"public"."users"'].children` has `{id, name}` (no `login_ip`) and `ns['"auth"."users"'].children` has `{id, login_ip}` (no `name`). |
| AC-268-05 — regression gate | PASS | Per-file 35/35, full suite 3205/3205, tsc 0, lint 0. Case count monotonically non-decreasing relative to Generator-measured baseline (+4). |

## Code Review

### Cache shape (Done Criteria #1, Design Bar)

- `useSqlAutocomplete.ts:196-206` — replaces the old single map `cachedColumnsByName: Record<tableName, colNs>` with two parallel maps:
  - `byQualified: Record<"schema.table", colNs>` — exact lookup, schema-correct.
  - `byBareName: Record<bare, colNs[]>` — list of candidate column-sets, one per schema holding that bare name.
- Encoding preserves schema identity in the key (per the contract's Design Bar — encoding schema in a value side-channel was rejected). `Record<"schema.table", colNs>` form was chosen over `Record<schema, Record<table, colNs>>`; both are acceptable per the contract.

### Bare-key policy comment (Done Criteria #2)

- `useSqlAutocomplete.ts:208-215` — required inline comment present. Mentions `Sprint 268 (2026-05-13)`, explicitly names "Policy A", gives one-line rationale ("silently dropping a column candidate is a worse failure mode than offering a superset; the user can always schema-qualify to narrow"), and documents the rejected alternative (Policy B). Matches the contract's Quality Bar.
- A second Sprint 268 comment at `useSqlAutocomplete.ts:300-313` documents the deferred bare-key registration (tables vs views collected separately so views never silently union into tables).
- A third Sprint 268 comment at `useSqlAutocomplete.ts:344-348` documents the final union-and-register loop.

### Tests-doc convention

- All four new tests carry the Sprint 268 (2026-05-13) section header at `useSqlAutocomplete.test.ts:965-976` with the required rationale (작성 이유 + chosen policy + AC mapping). Each individual case also has a `// AC-268-NN — …` comment immediately above the `it(`. This satisfies the `feedback_test_documentation.md` rule (sprint id + date + reason).

### No-`any`, no-`console.log`, no empty `catch`

- Grep across `useSqlAutocomplete.ts` and the test file: **0 hits** for `: any`, `as any`, `console.log`, or empty `catch {`. Test casts use `Record<string, …>` shapes consistent with the existing Sprint 264 cases.

### Out-of-scope changes

- `git diff HEAD --name-only` returns exactly two paths: `src/hooks/useSqlAutocomplete.ts`, `src/hooks/useSqlAutocomplete.test.ts`. No toast, no skeleton, no backend, no `schemaStore` shape change, no new `UseSqlAutocompleteOptions` prop. Conforms to the contract's "In Scope" boundary.

### Invariant audit

- CodeMirror `SQLNamespace` external shape unchanged — top-level entries are still functions, keywords, bare names, qualified names, dialect-quoted aliases, and fully-quoted `"schema"."table"` (Sprint 233). Only the internal cache was touched.
- `pickColumns`'s first branch — `if (tableColumns && tableColumns[objectName])` — preserved verbatim at `useSqlAutocomplete.ts:240-244`. Legacy `TableColumnOverrides` path still beats the cache.
- All 6 Sprint 264 cross-DB isolation cases + 3 Sprint 233 fully-quoted cases + Sprint 82 dialect-quoting cases pass byte-equivalent (full suite delta is exactly +4, not −anything+more).

## Evaluator-Specific Observations

### Regression-pin claim verified

- The Generator's caveat — that AC-268-01 / AC-268-03 / AC-268-04 **already passed against the pre-change code** at `a3f7efc`, and only AC-268-02 fails pre-fix — is **correct**.
- Trace of `a3f7efc` baseline: the loop wrote both `cachedColumnsByName[tableName] = colNs` (last-writer-wins, bare) AND `cachedColumnsByName[\`${schemaName}.${tableName}\`] = colNs` (unique). Subsequently `pickColumns` queries `cachedColumnsByName[qualifiedName]` first, so a qualified lookup at `ns["public.users"]` always returned the schema-correct entry. Only the bare `ns["users"]` was overwritten by the second iteration. The fully-quoted PG alias is built from the per-iteration `colNs` (schema-correct), so AC-268-04 also passed pre-fix.
- Therefore only AC-268-02 strictly satisfies the spec's "must FAIL on `a3f7efc`" wording. The other three are regression pins / safety nets that lock in current correct behaviour against future refactors.
- **Spec-vs-test mismatch (Evaluator finding, INFO only)**: The master spec's AC-268-01 wording ("the current implementation lets the second-loaded schema overwrite the bare `ns["users"]` key — the new test must FAIL on `a3f7efc`") conflates the bare-key fail with a qualified-key fail. The bare-key fail is actually AC-268-02. The Generator made the right call retaining all four cases as regression pins. Not a fix-required finding; flag for the Planner to tighten future wording.

### Sprint 264 view-isolation guard preserved (Edge case from spec)

- Spec edge case: "Same table name AND a view with the same name in another schema — fix must not regress view exposure or accidentally union views and tables."
- Implementation handles this at `useSqlAutocomplete.ts:300-367`: tables and views are collected into separate `bareTableCandidates` / `bareViewCandidates` maps. Tables are registered first; views register only `if (!ns[bareName])` — mirrors the pre-Sprint-268 `if (!ns[v.name])` guard. Verified via the Sprint 264 view-axis case at `useSqlAutocomplete.test.ts:1280` still passing.

## Scorecard

| Dimension | Score | Justification |
|-----------|-------|---------------|
| Correctness | 9/10 | Cache shape and pickBareColumns correctly fix AC-268-02; trace of qualified-lookup path under collision matches the assertion. Tables-first / views-second ordering preserves the Sprint 264 view-isolation invariant. Three- or N-way schema collision scales (union over arbitrary list). |
| Completeness | 9/10 | All 5 Done Criteria met. All 4 ACs covered by named vitest cases. Single explicit policy chosen, documented, and pinned by test. The "regression pin" framing of AC-268-01/03/04 is honest about which case is the true post-fix delta. |
| Code Quality | 9/10 | Clean separation of concerns (`byQualified` vs `byBareName`, `pickBareColumns` helper, deferred bare-key registration to support union). Three Sprint-268 inline comments document the WHY at each touchpoint. No `any`, no `console.log`, no empty `catch`, no unwrap-style ignores. Lint and tsc clean. Minor: `pickBareColumns` is defined but only invoked through `pickColumns`'s `byQualified[qualifiedName] ?? pickBareColumns(objectName) ?? {}` fallback — slight duplication with the post-loop `unionColumns` helper. Both helpers do the same dedup; consolidating would shave ~12 lines, but the current shape is readable. |
| Testing | 9/10 | 4 new cases, one per AC. Each test sets up `tableColumnsCache` + `tables` (PG mount also injects `dialect: PostgreSQL`, `dbType: "postgresql"`). Assertions are tight: positive + negative properties + length. Section header documents Sprint 268 + date + reason + policy choice per `feedback_test_documentation.md`. Minor: no test exercises the 3-way schema collision (`public.users` + `auth.users` + `tenant.users`), which is in the spec's Edge Cases. Acceptable since the union helper is N-ary, but a single 3-way test would lock that in. |
| Contract Compliance | 10/10 | Only the two in-scope files were modified (`git diff HEAD --name-only` confirms). No DbMismatch toast change, no skeleton, no backend, no schemaStore change, no new public option. Required-evidence list (line numbers, `it()` names, full vitest summary, tsc, lint, policy declaration) all provided. Verification profile honored (command, no Playwright). Sprint id and date present in every required location. |
| **Overall** | **9.2/10** | Threshold (7/10 each) cleared on every dimension. |

## Verdict: PASS

## Sprint Contract Status (Done Criteria)

- [x] **#1 — schema-correct qualified lookup**: AC-268-01 test at `useSqlAutocomplete.test.ts:980` passes; backed by `byQualified` map at `useSqlAutocomplete.ts:196-206`.
- [x] **#2 — bare-key policy single & documented**: AC-268-02 test at `useSqlAutocomplete.test.ts:1061` passes; Policy A declared at `useSqlAutocomplete.ts:208-215` with sprint id + date + rationale + rejected alternative.
- [x] **#3 — single-schema parity**: AC-268-03 test at `useSqlAutocomplete.test.ts:1139` passes; `unionColumns` short-circuits single-candidate at `useSqlAutocomplete.ts:353`.
- [x] **#4 — fully-quoted PG aliasing**: AC-268-04 test at `useSqlAutocomplete.test.ts:1192` passes; `addFullyQuotedAlias` (unchanged from Sprint 233) consumes per-iteration `colNs` which is now schema-correct.
- [x] **#5 — regression gate**: Per-file 35/35; full suite 3205/3205 (baseline +4); tsc 0; lint 0.

## Feedback for Generator

None blocking. The implementation passes all gates with margin.

Optional polish items for a follow-up commit, only if convenient:

1. **Helper consolidation** (Code Quality): `pickBareColumns` (`useSqlAutocomplete.ts:216-232`) and `unionColumns` (`useSqlAutocomplete.ts:350-361`) do the same dedup-by-name union. Consider extracting a single `unionByColumnName(candidates: Record<string, SQLNamespace>[])` helper to remove the duplication. Not load-bearing; current shape is clear.
2. **3-way collision test** (Testing): Spec Edge Cases mentions "Three or more same-named tables across schemas." A single test with `public.users` + `auth.users` + `tenant.users` would lock in N-ary union behaviour. Helpful but optional — the union helper is already N-ary by construction.
3. **Spec wording note (planner-side, not generator)**: The master spec AC-268-01 wording ("the new test must FAIL on `a3f7efc`") describes a bare-key overwrite but the AC-268-01 test as written probes qualified keys (which were already isolated in the baseline). Only AC-268-02 actually fails pre-fix. Generator's framing of AC-268-01/03/04 as regression pins is correct. For the next planning cycle, the spec wording should be tightened to either (a) point AC-268-01 at the bare-key overwrite or (b) explicitly state that AC-268-01/03/04 are regression pins and only AC-268-02 is the must-fail-pre-fix case.

## Handoff Evidence (for `handoff.md`)

- Changed files:
  - `src/hooks/useSqlAutocomplete.ts` — cache shape (L196-206), Policy A comment (L208-215), `pickBareColumns` (L216-232), tables loop with deferred bare-key (L318-328), views loop with deferred bare-key (L332-342), post-loop bare-key registration with `unionColumns` (L344-367).
  - `src/hooks/useSqlAutocomplete.test.ts` — Sprint 268 section header + rationale (L965-976), AC-268-01 (L978-1055), AC-268-02 (L1057-1134), AC-268-03 (L1136-1188), AC-268-04 (L1190-1277).
- Tests added: 4 (35 in file, was 31; full suite 3205, was 3201).
- Verification commands run:
  - `pnpm vitest run --no-file-parallelism src/hooks/useSqlAutocomplete.test.ts` → 35/35 pass.
  - `pnpm vitest run --no-file-parallelism` → 260/260 files, 3205/3205 tests pass.
  - `pnpm tsc --noEmit` → exit 0.
  - `pnpm lint` → exit 0.
- Ambiguity policy: **Policy A** (union of candidate columns across schemas, deduped by column name). Rationale (verbatim from `useSqlAutocomplete.ts:208-215`): "silently dropping a column candidate is a worse failure mode than offering a superset; the user can always schema-qualify to narrow."
- Out-of-scope items deferred per spec dependency order: Sprint 269 (DbMismatch toast Retry), Sprint 270 (cold-boot skeletons), Sprint 271 (`expected_database` propagation).
- Open P1/P2 findings: **0**.
