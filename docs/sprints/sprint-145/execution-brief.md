# Sprint 145 — Execution Brief

## Objective

Split the completion engine into per-DBMS modules under
`src/lib/completion/` so each DBMS owns its keyword set + candidate
generator, and the QueryEditor swaps modules by `(paradigm, db_type)`.

## Task Why

Today PG-only keywords (`RETURNING`) and MySQL-only patterns
(`LIMIT n,m`, `AUTO_INCREMENT`) live in a single parameterised helper.
As more dialect divergence accrues this becomes a tangle. Sprint 145
cleanly partitions the surface so future per-DBMS work lands in one
file, and unit tests pin each DBMS's identity (no cross-contamination,
no mongo-loaded-into-PG accidents).

## Scope Boundary

- Only `src/lib/completion/**` + the two completion hooks change.
- Tokenizer and utils internals are **not** rewritten — they are
  relocated and re-exported.
- No QueryEditor UX change. No backend change. No store change.
- Old imports either resolve via shim or get migrated in this PR; no
  dangling references.

## Invariants

- 2159 existing tests stay green.
- QueryEditor continues to render for PG / MySQL / SQLite / Mongo.
- Public API of `useSqlAutocomplete` / `useMongoAutocomplete`
  unchanged — call sites untouched.
- Mispairing throws `CompletionPairingError` at runtime **and** is a
  TS error at compile time.

## Done Criteria

1. Five files exist under `src/lib/completion/`: `pg.ts`, `mysql.ts`,
   `sqlite.ts`, `mongo.ts`, `shared.ts`.
2. Each per-DBMS module exports its own `keywords` + candidate
   generator and consumes `shared.ts` only for the agreed helpers.
3. Mongo module imports only `prefixMatch` from shared.
4. New unit tests: `pg.test.ts`, `mysql.test.ts`, `sqlite.test.ts`,
   `mongo.test.ts`, `shared.test.ts`, `pairing.test.ts`.
5. Each DBMS test file asserts ≥1 DBMS-specific keyword/hint per
   AC-144-4.
6. Mongo test asserts `SELECT` is never returned; `db.` returns
   `find` / `aggregate` / `insertOne`.
7. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` all green.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - File-change manifest with one-line purpose each.
  - Per-AC test name table.
  - Command outputs (counts + exit codes).

## Evidence To Return

- Changed/created/deleted files + one-line purpose each.
- Verification command results (exit codes + counts).
- AC coverage table mapping AC-144-1 … AC-144-5 → test name(s).
- Assumptions (e.g. shim vs. migrate decision).
- Residual risk / deferred items.
