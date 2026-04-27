# Sprint 144 — Handoff to Sprint 145

## What's Live

- PG schemas auto-expand on first paint (AC-145-1).
- MySQL/SQLite flat-list invariant locked with regression tests
  (AC-145-2).
- Functions category overflow-safety pinned via 3 structural invariants
  (AC-145-3).

## What's Next (Sprint 145)

- **AC-144-*** — Completion engine split: `pg.ts` / `mysql.ts` /
  `sqlite.ts` / `mongo.ts` + `shared.ts`. Today's monolithic
  `completion.ts` makes the per-DBMS reserved-word/system-table
  rules hard to evolve in isolation.

## Open Issues / Carry-Over

- **e2e width-delta assertion for AC-145-3** — the unit-test proxy
  (structural invariants) covers the *cause*, but a Playwright check
  measuring `window.getBoundingClientRect()` before/after expanding the
  Functions category would directly assert the *effect*. Deferred to
  the e2e sprint.
- **Large schema performance** — the auto-expand-all behavior is
  acceptable for the 1-30 schema range users typically have. If a
  dogfood report comes in from a 100+ schema PG instance, we'll
  profile and add a per-schema lazy expand fallback.

## Invariants to Preserve

- `expandedSchemas` mount-time seeding is *idempotent* with explicit
  user clicks — clicking an already-expanded schema MUST collapse it.
  Sprint 144 added a regression test for this; do not remove.
- The existing `loadSchemas → loadTables-per-schema` prefetch loop in
  SchemaTree.tsx is the single source of `loadTables` calls; the new
  auto-expand effect must NOT fire `loadTables` directly.
- Function/procedure row layout (`w-full` button + `truncate` args span
  + `data-category-overflow="capped"` wrapper) — these three together
  guarantee the ≤1px width delta. Removing any one re-opens the
  horizontal-overflow regression.
