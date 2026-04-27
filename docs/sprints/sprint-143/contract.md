# Sprint 143 Contract — Row count UX (tilde / `?`) + Mongo activeDb persistence

## Scope

Spec (`docs/sprints/sprint-141/spec.md`) topic id **AC-148-***. This sprint
covers AC-148-1, AC-148-2, AC-148-4. **AC-148-3 is explicitly deferred** —
the lazy "hover 200ms → backend `count_rows_exact` → cache" path needs a
new Rust trait method (`count_rows_exact`) across PG/MySQL/SQLite
adapters plus a connection-scoped TS cache, which is sized for its own
sprint. Sprint-143 lays the visual baseline (`~12,345` / `?`) so the
later exact-fetch sprint can simply mutate the cell text without
re-rendering surrounding chrome.

### In scope (this sprint)
- AC-148-1 PG/MySQL row count cell renders **`~12,345`** (tilde +
  locale-separator) when `row_count != null`. Tilde signals "estimate".
- AC-148-2 SQLite row count cell renders **`?`** (no estimate metadata).
  The cell is always present (so the user never sees a blank slot) but
  carries the `?` marker — independent of whatever value the SQLite
  adapter currently happens to return for `row_count`.
- AC-148-4 Mongo workspace `activeDb` persists across close/reopen via
  `localStorage` keyed by connection id (`tableview:activeDb:{connId}`).
  `setActiveDb` writes the key; `connectToDatabase` (or equivalent
  init) restores from the key when present, falling back to
  `connection.database` on a miss.

### Out of scope (deferred)
- AC-148-3 hover/focus 200ms → `invoke('count_rows_exact', ...)` →
  `connection-scoped` cache → cell flips from `~N` (or `?`) to `N`.
  Requires backend trait method + 3 adapter implementations + cache
  module + 200ms debounce. Tracked in `handoff.md`.
- Any change to the backend `list_tables` row_count source. PG keeps
  `n_live_tup`; SQLite keeps whatever it returns today (the FE renders
  `?` regardless).

## Done Criteria (완료 기준)

A reviewer (Evaluator) can confirm DONE when:

1. **AC-148-1** — In `SchemaTree.tsx`, every site that renders the
   `[data-row-count="true"]` cell prefixes the locale-separated number
   with `~` for PG (`postgresql`) and MySQL (`mysql`) connections.
   Asserted by a new test in `SchemaTree.rowcount.test.tsx` (or a new
   test file): cell `textContent === "~12,345"` for PG +
   `textContent === "~9,876"` for MySQL.

2. **AC-148-2** — For SQLite (`sqlite`) connections, the
   `[data-row-count="true"]` cell renders the literal `?` regardless of
   whether the schema fetch returned a number. Asserted by a new test:
   cell `textContent === "?"`. The aria-label / title reflect the
   "exact value not available — hover to fetch" semantics (see
   Invariants below for the canonical copy).

3. **AC-148-4** — Calling `setActiveDb(connId, "admin")` writes
   `localStorage["tableview:activeDb:" + connId] === "admin"`. On a
   subsequent `connectToDatabase(conn)` call (e.g., simulated reload),
   `activeStatuses[connId].activeDb === "admin"` (not the
   `conn.database` default). Cleared by `disconnect`. Asserted by tests
   in `connectionStore.test.ts`.

4. **All gates pass** — `pnpm vitest run`, `pnpm tsc --noEmit`,
   `pnpm lint` are green. No prior sprint test regresses.

## Out of Scope

- Backend command `count_rows_exact` and any Rust changes.
- Any change to MySQL/SQLite estimate sources.
- Tooltip copy redesign beyond what the new SQLite `?` cell needs.
- Mongo activeDb migration of pre-existing tabs (a new connect cycle
  picks up the persisted value; old in-memory tabs aren't retroactively
  rewritten).

## Invariants

- `data-row-count="true"` selector remains the test-stable hook.
- Existing aria-label/title for PG (`"Estimated row count from
  pg_class.reltuples"`) and MySQL (`"Estimated row count from
  information_schema.tables"`) are unchanged in this sprint — adding
  the visible `~` does not change the long-form description.
- SQLite aria-label/title changes to a phrase that names the new
  display semantics ("Exact row count not yet fetched — hover to load"
  or similar). The existing `"Exact row count via COUNT(*)"` test
  assertion will be updated to the new copy. This is a deliberate
  change of contract because the SQLite cell visibly switches from a
  number to `?`.
- Existing test `"row count stays hidden when the schema fetch returned
  no estimate"` (PG, `row_count: null`) — semantics may change to
  rendering `?` instead of being suppressed (per spec edge case line
  235-236 of `spec.md`). If we change behavior, the test is updated;
  if we keep the cell hidden for `null` PG/MySQL, the test stays as-is.
  **Decision: render `?` for `null` rows on PG/MySQL too** — matches
  spec edge case "추정치가 null 인 경우 → `?` 로 표시 (사용자에게
  "값을 모름"을 명시)". The existing test will be updated to assert
  `?` rendering instead of the cell being absent.
- `localStorage` key namespace: `tableview:activeDb:{connId}`. Matches
  existing `tableview:` prefix used elsewhere.

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm vitest run` — passes; new red tests now green; sprint-137
     row-count tests updated to match the new tilde / `?` rendering.
  2. `pnpm tsc --noEmit` — exit 0, 0 lines.
  3. `pnpm lint` — exit 0, 0 lines.
- **Required evidence**:
  - Generator returns: list of changed files with purpose, vitest
    counts (test files + tests passed), tsc/lint exit codes.
  - Evaluator cites: the exact test name(s) covering AC-148-1, -2, -4
    and their pass status.
