# Sprint 145 Contract — Completion engine DBMS split (AC-144-*)

## Summary

- Goal: Split the autocomplete engine into per-DBMS modules under
  `src/lib/completion/{pg,mysql,sqlite,mongo,shared}.ts` so each DBMS
  owns its keyword set + catalog-aware candidate generator, and the
  QueryEditor selects the correct module by `(paradigm, db_type)`.
- Verification Profile: `command`

## Decision (Q3 = B from spec, refined to Option C)

**Option C — Split only the dialect-divergent parts.** Move
`sqlTokenize.ts` + `sqlUtils.ts` behind `lib/completion/shared.ts`
(re-export + thin wrapper), and create `pg.ts` / `mysql.ts` /
`sqlite.ts` that own the per-DBMS keyword set and the DBMS-specific
candidate generator (RETURNING, LIMIT n,m, AUTO_INCREMENT, PRAGMA, …).
Mongo gets its own `mongo.ts` that imports only `prefixMatch` from
`shared.ts`.

Rationale: `sqlTokenize.ts` (255 LOC) and `sqlUtils.ts` (385 LOC) are
already DBMS-agnostic — relocating them is enough to satisfy AC-144-1
without rewriting them. The genuine divergence lives in
`sqlDialectKeywords.ts` + `sqlDialectMutations.ts`, which become the
internals of `pg.ts` / `mysql.ts` / `sqlite.ts`.

**Deferred:** rewriting `useSqlAutocomplete.ts` to consume the new
modules from the inside (kept as a thin orchestrator that imports the
DBMS-specific module by `db_type`); rewriting tokenizer or utils
internals; any UX change.

## In Scope

- Create `src/lib/completion/` with five files: `pg.ts`, `mysql.ts`,
  `sqlite.ts`, `mongo.ts`, `shared.ts`.
- `shared.ts` exports: `prefixMatch`, identifier-quoting helpers
  (`escapeIdentifier`, `quoteForDialect`), FROM/INTO context parser
  (`parseFromContext`), and re-exports the existing tokenizer surface.
  Internally re-exports / wraps current `sqlUtils.ts` + `sqlTokenize.ts`.
- `pg.ts`, `mysql.ts`, `sqlite.ts` each export a typed
  `createCompletionSource(ctx)` (or equivalent) plus a `keywords`
  constant and a DBMS-specific candidate generator. Internally they
  consume `shared.ts`. Each module's public type is locked to its
  DBMS so cross-wiring is a TS error.
- `mongo.ts` exports `createMongoCompletionSource` and a `db.`
  collection-method candidate set (`find`, `aggregate`, `insertOne`).
  It imports **only** `prefixMatch` from `shared.ts` and never the SQL
  keyword sets.
- `useSqlAutocomplete.ts` switches its keyword/candidate source to the
  new per-DBMS module based on `db_type`. `useMongoAutocomplete.ts`
  imports from `lib/completion/mongo.ts`.
- QueryEditor (`SqlQueryEditor.tsx` / `MongoQueryEditor.tsx`)
  remains the orchestrator; only its imports change.
- Old files `sqlDialectKeywords.ts`, `sqlDialectMutations.ts`,
  `mongoAutocomplete.ts`, `mongoTokenize.ts`, `sqlTokenize.ts`,
  `sqlUtils.ts` either move into `lib/completion/` or become thin
  re-export shims kept for backward compatibility (Generator's call:
  prefer **move + update imports** when grep finds ≤30 import sites;
  otherwise keep shim + add deprecation comment).

## Out of Scope

- Any UI/UX change in the editor.
- Any backend change.
- Any rewrite of tokenizer or `sqlUtils` internals — relocation +
  re-export façade only.
- Changing the public API of `useSqlAutocomplete` /
  `useMongoAutocomplete` (call sites stay untouched).
- Redis paradigm completion.

## Invariants

- All existing 2159 tests stay green.
- QueryEditor continues to work for all four DBMSes.
- Old import paths either still resolve via shim or are migrated to
  `@/lib/completion/*` in the same PR — no dangling imports.
- `tsc --noEmit` exits 0; mispairing surfaces as a compile-time error
  (preferred) **and** a runtime guard (defensive — see AC-144-3).

## Done Criteria

1. **AC-144-1** — Files exist: `src/lib/completion/{pg,mysql,sqlite,
   mongo,shared}.ts`. Each per-DBMS module exports a non-empty
   `keywords` array (or equivalent) and a candidate-generator function.
2. **AC-144-2** — `shared.ts` exports `prefixMatch`, an
   identifier-quoting helper, and a FROM/INTO context parser. `pg.ts`,
   `mysql.ts`, `sqlite.ts` each import named helpers from `./shared`.
   `mongo.ts` imports **only** `prefixMatch` from `./shared`.
3. **AC-144-3** — QueryEditor switches modules by `(paradigm, db_type)`.
   Mispairing (e.g. PG connection wired to mongo completion source)
   is **rejected at runtime by throwing a `CompletionPairingError`**
   and surfaced as a unit-test assertion.
4. **AC-144-4** — Per-module DBMS-specific assertions:
   - `pg.test.ts`: `keywords` includes `"RETURNING"`; MySQL-only
     `"AUTO_INCREMENT"` is absent.
   - `mysql.test.ts`: `keywords` does **not** include `"RETURNING"`;
     `LIMIT n,m` hint is surfaced (MySQL-specific two-argument LIMIT);
     `"AUTO_INCREMENT"` is present.
   - `sqlite.test.ts`: `keywords` includes `"PRAGMA"` and
     `"WITHOUT ROWID"`; `"RETURNING"` absent (matches today's
     `sqlDialectKeywords.ts`).
   - `mongo.test.ts`: `db.` triggers candidates including `"find"`,
     `"aggregate"`, `"insertOne"`; `"SELECT"` never appears in any
     Mongo result.
5. **AC-144-5** — Mongo `db.<cursor>` returns at least
   `{ find, aggregate, insertOne }`; assert
   `!result.options.some(o => o.label === "SELECT")`.
6. All gates pass: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run` — all suites green (existing + new).
  2. `pnpm tsc --noEmit` — exit 0; mispairing across modules is a TS
     error at the call site.
  3. `pnpm lint` — exit 0.
- Required evidence:
  - Generator: file-change manifest with one-line purpose; per-AC
    test name table; command outputs (counts + exit codes).
  - Evaluator: concrete test names per AC; concrete error message of
    `CompletionPairingError` from the rejection unit test.

## Test Requirements

### Unit Tests (필수)

- `src/lib/completion/pg.test.ts` — keyword presence/absence; candidate
  generator returns non-empty for a `SELECT … FROM` cursor context.
- `src/lib/completion/mysql.test.ts` — keyword absence (`RETURNING`),
  `LIMIT n,m` hint, `AUTO_INCREMENT` presence.
- `src/lib/completion/sqlite.test.ts` — `PRAGMA` presence, `RETURNING`
  absence.
- `src/lib/completion/mongo.test.ts` — `db.` candidates include
  `find/aggregate/insertOne`; `SELECT` never present.
- `src/lib/completion/shared.test.ts` — `prefixMatch`, identifier
  quoting, FROM-context parser smoke tests (heavy coverage migrated
  alongside).
- `src/lib/completion/pairing.test.ts` — wiring a PG `db_type` to the
  mongo completion source throws `CompletionPairingError`; matched
  pair returns a valid completion source.

### Scenario Tests (필수)

- [x] Happy path: each of PG/MySQL/SQLite/Mongo loads its own module
      and produces candidates.
- [x] 에러/예외: mispaired `(db_type, paradigm)` throws.
- [x] 경계 조건: empty schema cache; cursor at start of buffer;
      Mongo cursor at `db.` with no collection name.
- [x] 기존 기능 회귀 없음: existing 2159 tests stay green;
      `useSqlAutocomplete.test.ts` / `useMongoAutocomplete.test.ts`
      pass without modification.

## Ownership

- Generator write scope: `src/lib/completion/**`,
  `src/hooks/useSqlAutocomplete.ts`, `src/hooks/useMongoAutocomplete.ts`,
  plus delete/shim of the six legacy files. **No** edits to
  components, stores, or backend.
