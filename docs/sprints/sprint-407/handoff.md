# sprint-407 handoff

## Summary

Added `useQueryExecution.test.tsx` as the broad scaffold for the six core
execution paths that future decomposition work must preserve.

## Guardrails

- No production source changes.
- Tauri barrel IPC in the scaffold uses `setupTauriMock`; the DbMismatch
  recovery test stubs the `verifyActiveDb` API wrapper directly.
- Query history is disabled inside the scaffold so assertions stay focused on
  execution state and IPC routing, not best-effort history persistence.

## Validation

- `pnpm test useQueryExecution`
- `pnpm exec vitest run useQueryExecution --coverage --coverage.include=src/components/query/QueryTab/useQueryExecution.ts --coverage.thresholds.lines=60 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0`
  - `useQueryExecution.ts` line coverage: 76.59%
- `pnpm exec tsc --noEmit`
- `pnpm lint` (existing max-lines warnings only)
- `pnpm build` (existing Vite chunk/dynamic import warnings only)
- `pnpm test`
