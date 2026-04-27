# Sprint 145 — Generator Handoff

## Changed Files

### Created

- `src/lib/completion/shared.ts` — façade re-exporting `tokenizeSql` /
  `splitSqlStatements` / `formatSql` / `uglifySql` from
  `@lib/sqlTokenize` + `@lib/sqlUtils`; adds `prefixMatch`,
  `escapeIdentifier`, `parseFromContext`, `CompletionPairingError`.
- `src/lib/completion/pg.ts` — PG keyword set + locked-to-`postgresql`
  candidate generator (`createCompletionSource`).
- `src/lib/completion/mysql.ts` — MySQL keyword set + locked-to-`mysql`
  candidate generator; surfaces `LIMIT n,m` hint after `LIMIT ` cursor.
- `src/lib/completion/sqlite.ts` — SQLite keyword set + locked-to-`sqlite`
  candidate generator.
- `src/lib/completion/mongo.ts` — re-exports `createMongoCompletionSource`
  / `createMongoOperatorHighlight` from `@lib/mongoAutocomplete`; adds
  `dbMethodCandidates` and `createDbMethodCompletionSource` (locked to
  `mongodb`). Imports only `prefixMatch` from `./shared`.
- `src/lib/completion/pairing.ts` — `selectCompletionModule(paradigm,
  db_type)` resolver. Throws `CompletionPairingError` on mispairs.
- `src/lib/completion/{shared,pg,mysql,sqlite,mongo,pairing}.test.ts` —
  TDD tests covering every AC.

### Modified

- `src/hooks/useSqlAutocomplete.ts` — replaced
  `getKeywordsForDialect` import with the per-DBMS keyword arrays
  imported from `@/lib/completion/{pg,mysql,sqlite}`. Added a small
  `keywordsForDbType` helper. Public API unchanged.
- `src/hooks/useMongoAutocomplete.ts` — switched
  `createMongoCompletionSource` / `createMongoOperatorHighlight` import
  to `@/lib/completion/mongo`. Public API unchanged.

### Deleted

- None. Original `sqlTokenize.ts`, `sqlUtils.ts`,
  `sqlDialectKeywords.ts`, `sqlDialectMutations.ts`,
  `mongoAutocomplete.ts`, `mongoTokenize.ts` remain on disk as the
  underlying implementation (the new `lib/completion/*` modules
  re-export from them). This is the "shim" path the contract permits;
  no dangling imports exist because nothing was deleted.

## Checks Run

| Command | Result | Detail |
|---|---|---|
| `pnpm vitest run` | pass | 145 files, 2225 tests passed (was 2159, +66 new) |
| `pnpm tsc --noEmit` | pass | exit 0 |
| `pnpm lint` | pass | exit 0 |

## Per-AC Test Mapping

| AC | Test File | `it(...)` Names |
|---|---|---|
| AC-144-1 (files exist + non-empty keyword + candidate generator) | `pg.test.ts` / `mysql.test.ts` / `sqlite.test.ts` / `mongo.test.ts` | `pg.keywords > is a non-empty array`; `mysql.keywords > is a non-empty array`; `sqlite.keywords > is a non-empty array`; `mongo.dbMethodCandidates > is non-empty`; `pg.createCompletionSource > returns a non-null candidate generator`; `pg.createCompletionSource > produces non-empty candidates for SELECT … FROM cursor context` |
| AC-144-2 (shared exports + mongo only imports prefixMatch) | `shared.test.ts` | `shared.prefixMatch > matches case-insensitive prefix`; `shared.escapeIdentifier > wraps with double quotes for ansi/postgres/sqlite`; `shared.escapeIdentifier > wraps with backticks for mysql`; `shared.parseFromContext > returns table list after FROM`; `shared.parseFromContext > captures aliases via AS`; `shared re-exports > re-exports tokenizeSql`. Mongo-only-imports-prefixMatch is enforced by the `import { prefixMatch } from "./shared"` line in `mongo.ts` (verifiable via `grep`); compile-clean tsc proves it works. |
| AC-144-3 (CompletionPairingError on mispair) | `pairing.test.ts` | `selectCompletionModule > throws CompletionPairingError for ('rdb', 'mongodb')`; `… for ('document', 'postgresql')`; `… for ('rdb', 'redis')`; `CompletionPairingError message names both paradigm and db_type`; matched-pair tests `returns pg module for ('rdb', 'postgresql')`, etc. |
| AC-144-4 (per-DBMS keyword presence/absence + LIMIT n,m hint) | `pg.test.ts`, `mysql.test.ts`, `sqlite.test.ts`, `mongo.test.ts` | `pg.keywords > contains PG-only RETURNING`; `pg.keywords > does NOT contain MySQL-only AUTO_INCREMENT`; `mysql.keywords > contains MySQL-only AUTO_INCREMENT`; `mysql.keywords > does NOT contain PG-only RETURNING`; `mysql.LIMIT n,m hint > LIMIT_HINTS surfaces a 'LIMIT n,m' shape`; `mysql.LIMIT n,m hint > source surfaces LIMIT n,m hint when cursor is after 'LIMIT '`; `sqlite.keywords > contains SQLite-only PRAGMA`; `sqlite.keywords > contains SQLite-only WITHOUT ROWID`; `sqlite.keywords > does NOT contain PG-only RETURNING`; `mongo.dbMethodCandidates > includes find / aggregate / insertOne`; `mongo.dbMethodCandidates > never includes SELECT` |
| AC-144-5 (db. returns find/aggregate/insertOne; SELECT never appears) | `mongo.test.ts` | `mongo.createDbMethodCompletionSource > returns find / aggregate / insertOne after 'db.'`; `… > never returns SELECT regardless of cursor position`; `… > filters by prefix on db.<prefix>`; `mongo.dbMethodCandidates > never includes SELECT` |

## Done Criteria Coverage

- **AC-144-1** — Five files created: `pg.ts`, `mysql.ts`, `sqlite.ts`,
  `mongo.ts`, `shared.ts` (plus `pairing.ts` per the resolver
  requirement). Each per-DBMS module exports a non-empty `keywords`
  array and a `createCompletionSource` (or
  `createDbMethodCompletionSource` for Mongo) factory.
- **AC-144-2** — `shared.ts` exports `prefixMatch`, `escapeIdentifier`,
  `parseFromContext`. `pg.ts` / `mysql.ts` / `sqlite.ts` import
  `prefixMatch`, `parseFromContext`, `FromContext` from `./shared`.
  `mongo.ts` imports only `prefixMatch` from `./shared`. The
  CodeMirror MQL surface (`createMongoCompletionSource`,
  `createMongoOperatorHighlight`) is re-exported from the existing
  `@lib/mongoAutocomplete` module so editor wiring is unchanged.
- **AC-144-3** — `selectCompletionModule(paradigm, db_type)` in
  `pairing.ts` throws `CompletionPairingError` for incompatible pairs.
  Concrete error message format:
  `CompletionPairingError: paradigm 'rdb' is incompatible with db_type 'mongodb'.`
  Compile-time guard: each module's `dbType` is a literal type
  (`"postgresql"`, `"mysql"`, `"sqlite"`, `"mongodb"`) so
  cross-wiring is also a TS error at the call site.
- **AC-144-4** — Concrete keyword assertions per DBMS in each test
  file, plus a `LIMIT n,m` hint test that exercises the cursor-aware
  branch. All 6 sub-criteria covered.
- **AC-144-5** — `mongo.test.ts` asserts `find`, `aggregate`,
  `insertOne` are returned after `db.` and that `SELECT` is never
  present.
- **All gates green**: vitest 2225 pass / tsc exit 0 / lint exit 0.

## Assumptions

1. **Move vs. shim.** Per contract, ≤30 import sites → migrate. We
   counted 15 import sites total. However, the original implementation
   files (`sqlTokenize.ts`, `sqlUtils.ts`, `sqlDialectKeywords.ts`,
   `sqlDialectMutations.ts`, `mongoAutocomplete.ts`,
   `mongoTokenize.ts`) carry their own substantial test surfaces (e.g.
   `sqlDialectKeywords.test.ts`, `sqlDialectMutations.test.ts`,
   `mongoAutocomplete.test.ts`, `sqlUtils.test.ts`,
   `sqlTokenize.test.ts`, `mongoTokenize.test.ts`) covering the
   internals. Rather than relocating all of these and breaking
   existing test paths, we kept the originals on disk as the canonical
   implementation and added the new `lib/completion/*` modules as a
   re-export façade. The hooks were migrated to import from
   `@/lib/completion/*` so the public migration target is satisfied.
   This is consistent with the contract's explicit allowance: "either
   move into `lib/completion/` or become thin re-export shims kept for
   backward compatibility (Generator's call)".
2. **`LIMIT n,m` hint shape.** The hint is surfaced as three explicit
   "documentation-style" candidates with `type: "hint"`: `LIMIT n,m`,
   `LIMIT offset,count`, `LIMIT count,offset`. They appear in the
   candidate stream when the regex `/\blimit\s+$/i` matches the buffer
   up to the cursor (i.e. user typed `LIMIT ` and is awaiting an
   argument). Other DBMSes (PG / SQLite) deliberately do not surface
   this hint because their `LIMIT` clause does not accept the
   two-argument comma form.
3. **`db.` regex.** The regex `\bdb\.([A-Za-z_][A-Za-z0-9_]*)?$`
   matches both bare `db.` and `db.<partial>` cursors, anchored to the
   end of the buffer. Cursors elsewhere in the document (e.g. inside a
   filter body) return an empty candidate list.
4. **`dbType` discriminator.** Each per-DBMS source exposes `dbType` via
   `Object.defineProperty` (non-enumerable index trick replaced with
   simple `enumerable: true` so test assertions pass via direct
   property read). The TS type intersects the call signature with a
   readonly literal field, locking the discriminator at compile time.
5. **`useSqlAutocomplete` hook.** The hook continues to import the
   keyword lists per `db_type`. We added a new local
   `keywordsForDbType` helper that delegates to the new modules; we
   left the original `getKeywordsForDialect` in place because
   `sqlDialectKeywords.test.ts` still asserts on it. The new helper's
   shape (returns the same `readonly string[]`) keeps the namespace
   builder unchanged, satisfying the "no public API change"
   invariant.

## Residual Risk

- **Eventual cleanup of legacy files.** The contract permits the shim
  path; a future sprint can collapse `sqlDialectKeywords.ts` /
  `sqlDialectMutations.ts` into `lib/completion/*.ts` outright now
  that the façade is in place. Tests would need to be retargeted at
  that time.
- **Hint candidates.** The `LIMIT n,m` hints are emitted as plain
  `{label, type: "hint"}` entries; CodeMirror's autocomplete UI does
  not currently style `hint` differently from `keyword`, so they
  appear as ordinary candidates. A future UX sprint can add a
  dedicated icon/colour for `type: "hint"`.
- **`db.` cursor inside JSON value.** The Mongo `createDbMethodCompletionSource`
  fires whenever the buffer up to the cursor ends in `db.<name>`. If a
  user puts a literal `"db.find"` inside a string value, the regex
  could fire there. The CodeMirror integration in
  `useMongoAutocomplete` uses the existing `createMongoCompletionSource`
  (operator-aware), not this new factory, so the risk is theoretical
  until/unless the QueryEditor wires the `db.` source directly.
