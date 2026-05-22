# Sprint 437 Contract — Workspace Query Boundaries

## Scope

- Split workspace query-tab hint typing from history dispatched method typing.
- Centralize the repeated running-query stale guard in `workspaceStore` query actions.
- Audit L8 selector-hook status without changing selector code if already split.

## Acceptance

- `workspaceStore` no longer exports a broad `QueryMode` alias for history method semantics.
- `recordHistoryEntry` uses history-owned query-mode types and does not import workspace tab types.
- `completeQuery`, `failQuery`, `completeMultiStatementQuery`, and `completeQueryDryRun` share one stale-response guard path.
- `src/stores/workspaceStore/selectors.ts` is confirmed as the selector-hook sibling file for L8.

## Validation

- `pnpm exec vitest run` for focused workspaceStore/history tests touched by this sprint.
- `pnpm exec tsc -b --pretty false`.
- `git diff --check`.
- `pnpm exec lefthook validate`.
