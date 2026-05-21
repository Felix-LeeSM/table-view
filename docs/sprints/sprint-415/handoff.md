# Sprint 415 Handoff — Flaky Timer Tests

## Summary

Replaced fixed real-time waits in flaky TS tests with fake timers or microtask
flushes, and replaced Rust cancel-test start sleeps with Tokio virtual-time
advance windows.

## Changes

- TS debounce waits now use `vi.useFakeTimers()` +
  `vi.advanceTimersByTimeAsync()`.
- `CreateTableDialog.test.tsx` no longer uses `setTimeout(0)` for sequential
  chain detection; it now uses microtask yielding and count deltas around the
  Execute action.
- `themeStore.cross-window-sync.test.ts` bridge attach wait now flushes
  microtasks instead of sleeping 1ms loops.
- Rust cancel tests use `tokio::time::pause()` / `advance()` / `resume()` and
  enable Tokio `test-util`.

## Validation

- `pnpm exec vitest run src/lib/snapshot/loadAll.timing.test.ts src/lib/perf/bootInstrumentation.test.ts src/stores/themeStore.cross-window-sync.test.ts src/components/schema/CreateTableDialog.dbMismatch.test.tsx src/components/schema/DropTableDialog.dbMismatch.test.tsx src/components/schema/CreateTriggerDialog.test.tsx src/components/schema/StructurePanel.columns.test.tsx src/components/schema/CreateTableDialog.test.tsx`
- `cargo check --manifest-path src-tauri/Cargo.toml --tests`
- `cargo test --manifest-path src-tauri/Cargo.toml --test query_integration cancel -- --nocapture`
- `cargo test --manifest-path src-tauri/Cargo.toml --test cancel_pg -- --nocapture`
- `cargo test --manifest-path src-tauri/Cargo.toml --test cancel_mysql -- --nocapture`
- `pnpm exec tsc --noEmit`
- `pnpm run lint` (0 errors, existing max-lines warnings only)
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`

## Notes

- `src/lib/snapshot/loadAll.timing.test.ts` still contains `setTimeout(50)`,
  but only inside a fake-timer-controlled IPC mock.
- `src-tauri/tests/query_integration.rs` remains an existing god-file-sized
  integration test; this sprint only changes the flaky timer seam.
