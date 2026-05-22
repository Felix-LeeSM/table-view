# Sprint 437 Handoff — Workspace Query Boundaries

## Summary

- Replaced the old broad workspace `QueryMode` export with `WorkspaceQueryMode`, limited to persisted tab hints: `"sql" | "find" | "aggregate"`.
- Moved history recording inputs to discriminated `RecordHistoryEntryArgs`, with document mode using `DocumentRecordHistoryQueryMode` plus legacy `"countDocuments"` adapter input.
- Added a central workspace query-mode adapter so persisted raw values and future history restore values map to the narrow workspace hint.
- Extracted `patchRunningQueryTab` / `isRunningQueryTab` inside `querySlice.ts` so all four completion/failure actions share one stale-query guard.

## L8 Audit

`src/stores/workspaceStore/selectors.ts` already exists and contains the nine selector hooks called out by L8. This worker did not edit shared risk registries, so marking RISK-041/L8 resolved in registry docs remains an orchestrator follow-up.

## Tests

- `pnpm exec vitest run src/stores/workspaceStore.queryMode.test.ts src/stores/workspaceStore.queryStaleGuard.test.ts src/lib/history/recordHistoryEntry.test.ts src/components/settings/HistorySettings.disable.test.tsx src/components/shared/QuerySyntax.test.tsx src/components/query/QueryTab/useQueryExecution.parserDispatch.test.tsx src/components/query/QueryTab/useQueryExecution.writeDispatch.test.tsx` — 7 files / 62 tests passed.
- `pnpm exec tsc -b --pretty false` — passed.
- `git diff --check` — passed.
- `pnpm exec lefthook validate` — passed.

## Risks

- `loadQueryIntoTab` remains a legacy/backward-compat action; it now accepts document history modes and maps them to the narrow workspace tab hint before storing. No current call sites were found.
