# Sprint 415 Contract — Flaky Timer Tests

## Goal

Remove fixed wall-clock sleeps from the flaky timer backlog so tests no longer
depend on pre-push or CI scheduler timing.

## Scope

- TS tests from audit 04 real `setTimeout` findings.
- Rust cancel tests from audit 04 `sleep(50ms/100ms)` findings.
- No production behavior changes.

## Acceptance Criteria

- AC-415-01: TS debounce/catch-settle tests use `vi.useFakeTimers()` and
  `vi.advanceTimersByTimeAsync()` instead of real sleep.
- AC-415-02: TS tick-only tests use microtask yielding instead of
  `setTimeout(0/1)`.
- AC-415-03: Rust cancel tests use Tokio virtual time for the start window and
  resume real time before cancel/timeout assertions.
- AC-415-04: The remaining `setTimeout(50)` in `loadAll.timing.test.ts` is
  inside a fake-timer-controlled IPC mock.
- AC-415-05: Targeted TS and Rust cancel tests pass.

## Non-Goals

- Splitting existing large test files.
- Changing application debounce durations.
- Reworking DB cancel semantics beyond deterministic test start windows.
