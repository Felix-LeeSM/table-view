# Sprint 145 — Findings

## Outcome

**PASS** — Evaluator scorecard 9/10 overall, every dimension ≥7. All
five Done Criteria met. AC-144-1…5 each map to passing assertions.
Three commands all exit 0.

## Verification

- `pnpm vitest run` — 145 files / **2225 tests** (+66 from baseline).
- `pnpm tsc --noEmit` — exit 0.
- `pnpm lint` — exit 0.

## Changed Files

### Created (`src/lib/completion/`)
| File | Purpose |
|---|---|
| `shared.ts` | DBMS-agnostic helpers (`prefixMatch`, `escapeIdentifier`, `parseFromContext`) + `CompletionPairingError`. Wraps `sqlTokenize.ts` / `sqlUtils.ts`. |
| `pg.ts` | PG keywords (`RETURNING` etc.) + `createPgCompletionSource`. dbType locked to `"postgresql"`. |
| `mysql.ts` | MySQL keywords (`AUTO_INCREMENT`, no `RETURNING`) + `LIMIT n,m` hint regex. dbType locked to `"mysql"`. |
| `sqlite.ts` | SQLite keywords (`PRAGMA`, `WITHOUT ROWID`). dbType locked to `"sqlite"`. |
| `mongo.ts` | Mongo `db.` collection-method candidates (`find`, `aggregate`, `insertOne`). Imports only `prefixMatch` from `./shared`. |
| `pairing.ts` | `selectCompletionModule(paradigm, db_type)` resolver; throws `CompletionPairingError` on mispairing. |
| 6 matching `.test.ts` files | TDD-first per-AC tests. |

### Modified
| File | Purpose |
|---|---|
| `src/hooks/useSqlAutocomplete.ts` | Imports keyword arrays from `@/lib/completion/{pg,mysql,sqlite}` instead of `sqlDialectKeywords`. Public API unchanged. |
| `src/hooks/useMongoAutocomplete.ts` | Imports from `@/lib/completion/mongo` instead of `@lib/mongoAutocomplete`. |

### Untouched (kept on disk as underlying implementation)
- `sqlTokenize.ts`, `sqlUtils.ts`, `sqlDialectKeywords.ts`,
  `sqlDialectMutations.ts`, `mongoAutocomplete.ts`, `mongoTokenize.ts` —
  permitted by contract ("Generator's call: shim vs migrate").

## AC Coverage

| AC | Status | Evidence |
|---|---|---|
| AC-144-1 (5 files exist + non-empty exports) | ✅ | `pg.test.ts: keywords > non-empty array`, `pg.test.ts: createCompletionSource > produces non-empty candidates for SELECT … FROM cursor context`, plus mysql/sqlite/mongo equivalents. |
| AC-144-2 (shared exports prefix/quote/parseFrom; mongo imports only prefixMatch) | ✅ | `shared.test.ts: prefixMatch / escapeIdentifier / parseFromContext / re-exports tokenizeSql`. `mongo.ts:9` imports only `prefixMatch` from `./shared` (verified by grep). |
| AC-144-3 (mispairing throws `CompletionPairingError`) | ✅ | `pairing.test.ts:32,38,44`: 3 throws + `:50` message-format check. `CompletionPairingError` defined `shared.ts:173`, thrown at `pairing.ts:87,99,103`. |
| AC-144-4 (per-DBMS keyword presence/absence) | ✅ | `pg.test.ts:11/23` (RETURNING present, AUTO_INCREMENT absent); `mysql.test.ts:10/18/49` (AUTO_INCREMENT present, RETURNING absent, LIMIT n,m hint surfaces); `sqlite.test.ts:10/14` (PRAGMA + WITHOUT ROWID present). |
| AC-144-5 (Mongo `db.` returns find/aggregate/insertOne; SELECT never present) | ✅ | `mongo.test.ts:14`: `includes find / aggregate / insertOne`; `:21,42`: `never includes SELECT` regardless of cursor. |

## Assumptions

- **`LIMIT n,m` hint as type-`hint` candidates** — three candidates
  (`LIMIT n,m`, `LIMIT offset,count`, `LIMIT count,offset`) gated on
  the regex `/\blimit\s+$/i`. CodeMirror UI doesn't yet style hints
  separately from keywords (cosmetic only).
- **Shim path** — legacy `sqlDialect*`/`mongoAutocomplete`/`*Tokenize`
  files remain on disk as the underlying implementation. Façade
  re-exports them; the contract explicitly permitted either path.

## Risks / Deferred

- **P3** Cross-imports for shared SQL types: `mysql.ts` and `sqlite.ts`
  import `CompletionCursor` / `CompletionCandidate` / `CompletionResult`
  as types from `./pg` rather than `./shared`. `import type` is erased
  at runtime, but moving these to `shared.ts` would make each per-DBMS
  module fully sibling-independent. Future-sprint cleanup.
- **P3** `mongo.test.ts:64` re-export smoke check uses
  `typeof === "function"`. Underlying behaviour is covered by the
  existing `mongoAutocomplete.test.ts` so risk is low; harden in a
  later sprint if useful.
- **Future sprint** — relocate the 6 underlying legacy files (or
  delete the shims) so `src/lib/completion/` becomes the single
  source of truth. Out of scope here.
