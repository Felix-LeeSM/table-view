# Sprint 437 Handoff — Workspace Query Boundaries

## Summary

- Replaced the old broad workspace `QueryMode` export with `WorkspaceQueryMode`, limited to persisted tab hints: `"sql" | "find" | "aggregate"`.
- Moved history recording inputs to `RecordHistoryQueryMode`, based on `RdbQueryMode` / `DocumentQueryMode` plus legacy `"countDocuments"` adapter input.
- Extracted `patchRunningQueryTab` / `isRunningQueryTab` inside `querySlice.ts` so all four completion/failure actions share one stale-query guard.

## L8 Audit

`src/stores/workspaceStore/selectors.ts` already exists and contains the nine selector hooks called out by L8. No selector churn was needed.

## Tests

- `pnpm exec vitest run src/stores/workspaceStore.queryStaleGuard.test.ts src/stores/workspaceStore.queryMode.test.ts src/components/settings/HistorySettings.disable.test.tsx src/components/shared/QuerySyntax.test.tsx src/components/query/QueryTab/useQueryExecution.parserDispatch.test.tsx src/components/query/QueryTab/useQueryExecution.writeDispatch.test.tsx` — 6 files / 50 tests passed.
- `pnpm exec tsc -b --pretty false` — passed.
- `git diff --check` — passed.
- `pnpm exec lefthook validate` — passed.

## Risks

- `loadQueryIntoTab` remains a legacy/backward-compat action and now accepts only the workspace tab hint type, not arbitrary history method names. No current call sites were found.
