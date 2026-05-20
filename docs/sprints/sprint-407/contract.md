# sprint-407 — useQueryExecution test scaffold

## Scope

Add a test-only scaffold for `src/components/query/QueryTab/useQueryExecution.ts`
before any decomposition work.

Production code is out of scope for this sprint.

## Acceptance Criteria

- AC-407-01: `pnpm test useQueryExecution` passes with the six core scenarios.
- AC-407-02: no production source changes.
- AC-407-03: coverage report shows `useQueryExecution.ts` core-path line coverage
  at or above 60%.

## Core Scenarios

1. RDB select normal execution.
2. RDB destructive SQL routes to Safe Mode confirm state.
3. MongoDB `find` normal execution.
4. Multi-statement RDB execution stores per-statement results.
5. Running query invokes cancel IPC instead of starting a new query.
6. DbMismatch triggers active DB sync and Retry toast.

## Dependencies

- sprint-406 `setupTauriMock` global barrel mock helper.
