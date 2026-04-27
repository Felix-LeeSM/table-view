# Sprint 144 — Execution Brief

## Objective

Make PG sidebar auto-expand all schemas on mount (AC-145-1), and lock
in the existing flat-list (AC-145-2) and Functions-layout-stable
(AC-145-3) behaviors with regression tests.

## Task Why

Feedback #7-schema (2026-04-27): PG users with multiple custom schemas
have to click every chevron individually after connecting — repetitive
friction before they can see any tables. AC-145-2/-3 are already
working correctly in code but lack test coverage, leaving them
vulnerable to future regression. This sprint converts both to tested
invariants.

## Scope Boundary

- No changes to `treeShape.ts` mapping rules.
- No changes to `Sidebar.tsx` width constants or resize logic.
- No backend changes.
- No changes to DocumentDatabaseTree (Mongo) — its own path.

## Invariants

- MySQL/SQLite auto-expand-all-schemas path (already in
  SchemaTree.tsx ~540-554) keeps working.
- Function/procedure row layout (`w-full` + `truncate`) untouched.
- Existing SchemaTree test suite (~100 cases) does not regress.

## Done Criteria

1. PG schemas auto-expand on first paint after the schema list lands;
   `loadTables` fires for each schema.
2. New test: MySQL has no `[label='X schema']` button — flat list only.
3. New test: SQLite renders table rows directly with no schema/category
   headers.
4. New test: Functions expand → sidebar width delta ≤1px.
5. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` all green.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - Changed files + purpose
  - Test counts
  - Test names mapped to AC-145-1/-2/-3

## Evidence To Return

- Changed files + one-line purpose each
- Verification command results
- AC coverage table
- Assumptions, risks, deferred items
