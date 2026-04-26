import { expect } from "@wdio/globals";

/**
 * Sprint 133 — DB switcher (PG sub-pool LRU + Mongo in-connection switch)
 * smoke test scaffolding.
 *
 * The full-body coverage targets the workspace toolbar's DB-switcher
 * dropdown introduced in S130 / S131:
 *   1. From Home, double-click a connected PG connection (S134 removed
 *      the ConnectionSwitcher / Cmd+K popover; entry is now via Home).
 *   2. In the workspace, click the DB switcher trigger and verify the
 *      popover lists at least one database row.
 *   3. Select a different DB and verify the trigger label updates.
 *
 * Both the PG and Mongo descriptors are gated behind the
 * `E2E_PG_HOST` / `E2E_MONGO_HOST` env vars so this spec stays compile-
 * clean and runtime-safe in CI environments without a database fixture.
 * The actual interaction body is intentionally deferred — the sprint
 * scope is the spec scaffold; full body work is tracked separately.
 *
 * Skip pattern mirrors `e2e/paradigm-and-shortcuts.spec.ts`'s `before(()
 * => this.skip())` idiom so the suite reports as skipped rather than
 * silently passing in fixture-less envs.
 */

describe("DB switcher (Sprint 133)", function () {
  before(function () {
    // Honour both `E2E_PG_HOST` (e2e-specific) and `PGHOST` (the
    // canonical libpq variable that the CI workflow already exports for
    // the postgres service). Falling back to `PGHOST` keeps this spec in
    // sync with `.github/workflows/ci.yml` so the suite executes in CI
    // without an extra workflow env tweak.
    if (!process.env.E2E_PG_HOST && !process.env.PGHOST) {
      this.skip();
    }
  });

  it("opens the switcher and lists databases for a PG connection", async function () {
    // Body deferred — the contract scaffolds the spec but defers full
    // interaction to a follow-up sprint with proper fixture wiring. The
    // spec must still compile and runtime-skip cleanly.
    this.skip();
    // Outline (kept here so the next sprint can fill it in):
    //   1. await pressCtrl("k");
    //   2. await selectConnection("Test PG");
    //   3. await openDbSwitcherPopover();
    //   4. await assertDatabaseRowsVisible();
    //   5. await selectDatabase("admin");
    //   6. await expectTriggerLabel("admin");
    expect(true).toBe(true);
  });

  it("opens the switcher and lists databases for a Mongo connection", async function () {
    // Mongo fixture is optional — skip when E2E_MONGO_HOST is unset.
    if (!process.env.E2E_MONGO_HOST) {
      this.skip();
    }
    this.skip();
    expect(true).toBe(true);
  });
});
