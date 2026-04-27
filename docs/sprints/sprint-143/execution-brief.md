# Sprint 143 — Execution Brief

## Objective

Land the visible row-count UX baseline (`~N` for PG/MySQL, `?` for
SQLite + `null` rows) and persist Mongo `activeDb` across reopen.
Defer the lazy exact-count fetch (AC-148-3) — the visible baseline is
the prerequisite that lets that later sprint focus purely on backend
+ cache wiring.

## Task Why

User feedback #10 (2026-04-27) reported confusion: the bare number
(`12,345`) makes the row count look exact when it's actually
`pg_class.reltuples`. Adding `~` flips the read from "exact" to
"estimate" at a glance — the cheapest cue we can give before the
hover-fetch lands. Feedback #12 reported that switching the workspace
DB in Mongo silently reverts after a reopen — a stateful UX bug rooted
in `activeDb` living only in memory.

## Scope Boundary

Hard stops:

- No Rust changes. No backend command additions.
- No new debounce / hover handler wiring. The new `?` cell is a static
  marker, not an interactive trigger.
- No edit to `list_tables` row_count emission for any DBMS.

## Invariants

- `data-row-count="true"` is the stable selector.
- Existing PG/MySQL aria-label/title strings are preserved.
- `tableview:` localStorage prefix.
- No regression in sprint-137/142 tests.

## Done Criteria

1. PG/MySQL non-null `row_count` renders `~12,345`.
2. PG/MySQL **null** `row_count` renders `?` (was: hidden cell). Test
   updated to match.
3. SQLite renders `?` regardless of `row_count` value.
4. SQLite cell aria-label/title updated to the new "exact not yet
   fetched" copy.
5. `setActiveDb(id, db)` writes `localStorage["tableview:activeDb:"+id]`.
6. `connectToDatabase` restores `activeDb` from the localStorage key
   when present, else defaults to `conn.database`.
7. `disconnect` clears the key (so a deleted/forgotten connection
   doesn't leave a dangling entry).
8. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` all green.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - Changed files + purpose.
  - Test counts (files, tests).
  - Specific test names covering each AC.

## Evidence To Return

- Changed files with one-line purpose each.
- Commands run + exit codes / output deltas.
- AC coverage table: AC-148-1 / -2 / -4 → test name(s) → status.
- Assumptions, risks, deferred items (AC-148-3).
