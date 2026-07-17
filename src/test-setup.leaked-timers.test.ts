import { describe, it, expect } from "vitest";

// #1293 — regression guard for the `test-setup.ts` leaked-timer drain.
//
// `@tanstack/virtual-core` schedules a real `window.setTimeout` debounce on
// scroll (`isScrollingResetDelay`) that its `Virtualizer.cleanup()` does not
// clear on unmount. If such a timer outlives the vitest run it fires react
// state updates after the jsdom `window` is torn down -> `ReferenceError:
// window is not defined` unhandled error (Frontend Checks flake). The
// `afterEach` drain in `test-setup.ts` must cancel any timer still pending when
// a test finishes so none can leak into a later test or the environment
// teardown. This encodes that exact class: a timer set in one test must never
// fire during a later one.
describe("test-setup leaked-timer drain (#1293)", () => {
  let fired = false;

  it("a timer scheduled in a test body but never awaited", () => {
    setTimeout(() => {
      fired = true;
    }, 20);
    // Test ends immediately. Without the `afterEach` drain the 20ms timer would
    // survive and fire during the next test's wait below.
  });

  it("was cancelled by the drain before it could fire", async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fired).toBe(false);
  });
});
