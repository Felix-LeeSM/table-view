# Sprint Contract: sprint-406

## Summary

- Goal: centralize exact `@lib/tauri` / `@/lib/tauri` barrel mocks behind one
  global test scaffold and per-test override helper.
- Audience: frontend Vitest suites that exercise IPC-facing stores,
  components, and hooks.
- Owner: Generator (sprint-406).
- Verification Profile: frontend (`pnpm test`, `pnpm exec tsc --noEmit`,
  `pnpm lint`).

## In Scope

- Add `src/test-utils/tauriMock.ts` with stable `vi.fn` mocks for the
  `src/lib/tauri/index.ts` barrel exports.
- Register a global default mock in `src/test-setup.ts` for both aliases:
  `@lib/tauri` and `@/lib/tauri`.
- Replace direct per-file exact-barrel `vi.mock("@lib/tauri")` /
  `vi.mock("@/lib/tauri")` calls with `setupTauriMock(...)`.
- Keep submodule mocks separate when the SUT imports subpaths directly.

## Out of Scope

- `@lib/tauri/window`, `@/lib/tauri/ddl`, `@/lib/tauri/datagrid_prefs`,
  `@/lib/tauri/meta_sentinel`, and other subpath mocks.
- Production code changes.
- Reshaping test fixtures beyond the mock registration mechanism.

## Invariants

- Default unhandled barrel IPC calls throw `Error("unmocked: <name>")`.
- Mock function identities remain stable; per-test setup changes
  implementations, not exported function objects.
- Tests using local `vi.fn` spies still assert against those spies by
  delegating from the shared barrel mocks.
- `vi.resetAllMocks()` users must reinstall their Tauri overrides afterward.

## Acceptance Criteria

- `AC-406-01`: `setupTauriMock(overrides)` is exported from
  `src/test-utils/tauriMock.ts`.
- `AC-406-02`: every default exact-barrel IPC mock throws
  `unmocked: <name>`.
- `AC-406-03`: direct exact-barrel `vi.mock("@lib/tauri")` /
  `vi.mock("@/lib/tauri")` and exact-barrel `vi.importActual` usages are gone
  from test files.
- `AC-406-04`: full Vitest suite passes.

## Verification Plan

- `rg 'vi\\.(mock|doMock|doUnmock)\\([\"'\\''"](@/lib/tauri|@lib/tauri)[\"'\\''"]|vi\\.importActual.*@/?lib/tauri' src --glob '*.{test,spec}.{ts,tsx}'`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test`
