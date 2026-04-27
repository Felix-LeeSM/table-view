# Sprint 144 Contract — Sidebar unified schema view + Functions layout stability

## Scope

Spec topic id **AC-145-***. Pre-sprint discovery (sprint-144 explore
agent) revealed:

- **AC-145-1** (PG auto-expand all schemas) — **needs work**. Today PG
  schemas paint collapsed (`useState<Set<string>>(new Set())`); the
  user has to click every chevron. Spec wants every PG schema expanded
  by default once the schema list lands.
- **AC-145-2** (MySQL/SQLite flat list) — **already implemented**
  through `treeShape.ts` (`"no-schema"` for MySQL, `"flat"` for SQLite,
  document tree for Mongo). The work in this sprint is to **lock in
  the invariant with tests** so future tree-shape regressions surface
  as test failures, not user-reported bugs.
- **AC-145-3** (Functions click ≤1px width delta) — **probably stable**
  given `w-full` + `truncate` + parent-controlled sidebar width.
  Locking in with a regression test is the work here.

Topbar schema selector — already removed in sprint 135 (per
`WorkspaceToolbar.tsx` comment), so no removal work in this sprint.

### In scope (this sprint)
- AC-145-1 implementation: PG schemas auto-expand on first paint after
  the schema fetch resolves. Each schema is added to the
  `expandedSchemas` Set and `loadTables` fires (mirror of the existing
  MySQL/SQLite auto-expand path that already lives in SchemaTree.tsx
  lines 540-554).
- AC-145-2 test coverage: a SchemaTree test for each non-`"with-schema"`
  shape asserting that **no** schema-row button is rendered.
  - MySQL: `Tables` category header is the top-level expander, not a
    schema name.
  - SQLite: no category header at all — table rows render directly.
  - Mongo: collection list lives under the database row only (existing
    DocumentDatabaseTree path).
- AC-145-3 regression test: render SchemaTree with a Functions category
  expanded vs collapsed and assert
  `Math.abs(widthAfter - widthBefore) <= 1`. The test fixture
  intentionally includes a function row with a long name so a layout
  regression that adds horizontal overflow surfaces.

### Out of scope (deferred / unrelated)
- Removing/repositioning the (non-existent) topbar schema selector.
- Any change to the tree-shape resolver for Redis (paradigm = `kv`)
  beyond what's already shipped.
- Any change to the way Mongo databases are listed (DocumentDatabaseTree
  path is its own component and is governed by sprint-142 invariants).

## Done Criteria

1. **AC-145-1** — When `SchemaTree` mounts for a PG (`postgresql`)
   connection and `schemas` lands in the store, `expandedSchemas`
   contains **every** schema name returned. Asserted by a new test:
   on mount with 3 schemas, all 3 schema rows show `aria-expanded="true"`
   (or chevron-down state) without the user clicking. `loadTables`
   fires for each schema.

2. **AC-145-2** — New SchemaTree tests:
   - For MySQL: render with `dbType="mysql"`, `schemas: [{name: "appdb"}]`,
     `tables: { ...: [{name: "orders", ...}] }`. Assert that no
     `getByLabelText("appdb schema")` element exists (i.e., the schema
     row is **not** rendered) but `getByLabelText("orders table")`
     **is** rendered.
   - For SQLite: similar, asserting no schema row, no category header,
     just the table rows.

3. **AC-145-3** — A new test that:
   - Mounts SchemaTree with a Functions category that contains 5+
     function rows (one with a long name, ~80 chars).
   - Records `container.getBoundingClientRect().width`.
   - Clicks the Functions category to expand.
   - Records width again.
   - Asserts `Math.abs(after - before) <= 1`.

4. All gates pass: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`.

## Out of Scope

- Performance optimization of PG auto-expand for connections with 100+
  schemas (we trust the existing virtualization threshold to handle
  the row count; profiling is its own sprint if needed).
- Any change to `treeShape.ts` mapping logic — the discovery agent
  confirmed today's mapping matches the spec.

## Invariants

- The MySQL/SQLite auto-expand path that already exists in
  `SchemaTree.tsx:540-554` continues to work — the new PG auto-expand
  branch must not regress it.
- `w-full` + `truncate` on function/procedure row buttons stay intact.
- The `Sidebar.tsx` width constants (220/280/540) are not touched.
- Existing 100+ SchemaTree tests don't regress (in particular, the
  ones that expand schemas via clicks must keep working — the new
  auto-expand initial state must be **idempotent** with explicit
  click-to-expand, i.e., a click on an already-expanded schema must
  collapse it as before).

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm vitest run` — passes; new red tests now green.
  2. `pnpm tsc --noEmit` — exit 0.
  3. `pnpm lint` — exit 0.
- **Required evidence**:
  - List of changed files with purpose.
  - Test counts.
  - Specific test names per AC.
