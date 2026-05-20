# sprint-413 — documentStore catalog/query split

## Scope

Split the document read-path store by lifecycle:

- catalog: databases, collections, inferred field cache
- query: find and aggregate results

Keep the existing test reset helper available while moving runtime call sites to
the focused stores.

## Acceptance Criteria

- AC-413-01: catalog state and actions live in `documentCatalogStore`.
- AC-413-02: find/aggregate result state and actions live in
  `documentQueryStore`.
- AC-413-03: query stale guards are independent from catalog reloads.
- AC-413-04: connection/DB switch invalidation clears both catalog and query
  document caches.
- AC-413-05: existing Mongo find, aggregate, autocomplete, data grid, and tree
  flows keep their observable behavior.

## Non-Goals

- Do not change Mongo wire payload shape.
- Do not change document grid rendering or query execution behavior.
- Do not remove the compatibility reset surface used by tests in this sprint.
