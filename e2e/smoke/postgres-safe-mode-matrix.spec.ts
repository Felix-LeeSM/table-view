import { expect } from "@wdio/globals";
import {
  clickDialogAction,
  createPostgresConnection,
  expectNoVisibleDialogText,
  openConnection,
  openNewQueryTab,
  readSafeMode,
  runQuery,
  setSafeMode,
  step,
  typeQuery,
  waitForDialogTextAll,
  waitForLauncher,
} from "./_helpers";

/**
 * Issue #1124 — Safe Mode mode-dial matrix e2e.
 *
 * The pre-existing safe-mode specs (`postgres-safe-mode.spec.ts`,
 * `mssql.spec.ts`, `oracle.spec.ts`, `mongodb.spec.ts`) only ever exercise
 * the SAME cell: `production + destructive → confirm`. The mode dial's own
 * effect — how strict / warn / off change gating across environments — was
 * verified by 0 e2e. This spec drives the toolbar `SafeModeToggle` through
 * the dial and asserts the toggle → store → gate → dialog integration path.
 *
 * Behavior classes (from `decideSafeModeAction`, `src/lib/safeMode.ts`) —
 * destructive (`severity === "danger"`) statement only, since read / safe
 * writes are never gated:
 *
 *   | env       | mode         | result                                    |
 *   |-----------|--------------|-------------------------------------------|
 *   | non-prod  | warn / off   | allow (no dialog)                         |  ← class A
 *   | non-prod  | strict       | confirm (non-prod "strict" copy)          |  ← class B
 *   | prod      | strict / warn| confirm (bare reason)                     |  ← class C
 *   | prod      | off          | confirm (prod-auto "forces Safe Mode")    |  ← class D
 *
 * Collapse rationale (per #1124 "cover distinct behavior classes, not the
 * full cartesian product"):
 *   - non-prod {warn, off} collapse to class A — both `allow`, dialog-less
 *     and indistinguishable at the UI. We assert the default (warn) cell;
 *     off/non-prod is the identical code path.
 *   - prod {strict, warn} collapse to class C — already covered verbatim by
 *     `postgres-safe-mode.spec.ts` (prod + warn default). Not re-asserted
 *     here; this spec adds the UNCOVERED dial cells (B and D) plus the
 *     default-profile check.
 *   - class D (prod + off) is the "off can't bypass production" prod-auto
 *     net — distinct copy, so asserted explicitly.
 *
 * Single representative DBMS (Postgres) per #1124 ("대표 DBMS 1개로 충분").
 * mysql / duckdb DBMS-specific destructive-confirm smoke (#1124 checkbox 3)
 * is the already-covered class C on new engines and is left as a follow-up.
 *
 * Safe Mode is a global, backend-persisted setting shared across the e2e
 * session; the final step resets it to the `warn` default so sibling specs
 * (which rely on the default) are not contaminated.
 */
const NONPROD_CONNECTION = "E2E Postgres Safe Mode Matrix (dev)";
const PROD_CONNECTION = "E2E Postgres Safe Mode Matrix (prod)";

describe("PostgreSQL Safe Mode mode-dial matrix", () => {
  it("gates destructive statements per mode x environment", async () => {
    const suffix = randomAlphaSuffix();
    const dropTarget = `__sm_matrix_${suffix}`;
    const dropSql = `DROP TABLE IF EXISTS ${dropTarget}`;

    await step("create development-tagged Postgres connection", async () => {
      await waitForLauncher();
      await createPostgresConnection(NONPROD_CONNECTION, "development");
      await openConnection(NONPROD_CONNECTION);
    });

    await step("fresh profile defaults to warn (not off)", async () => {
      // #1113 shipped the default as `warn`; this pins the default-profile
      // dial state so a regression to `off` (which would silently unguard
      // production destructive statements) is caught by e2e.
      expect(await readSafeMode()).toBe("warn");
    });

    await step(
      "class A — non-prod + warn (default): destructive allowed, no dialog",
      async () => {
        await runSqlInNewTab(dropSql);
        await expectNoVisibleDialogText("Destructive statement");
        await expectNoVisibleDialogText("PRODUCTION DATABASE");
      },
    );

    await step(
      "class B — non-prod + strict: destructive confirm with non-prod copy",
      async () => {
        await setSafeMode("strict");
        await runSqlInNewTab(dropSql);
        await waitForDialogTextAll(
          ["Destructive statement", "Safe Mode (strict)", "DROP TABLE"],
          15000,
          "non-production strict confirmation dialog did not appear",
        );
        // Non-prod strict must NOT render the production header.
        await expectNoVisibleDialogText("PRODUCTION DATABASE");
        await clickDialogAction("Confirm");
        await expectNoVisibleDialogText("Destructive statement", 2000);
      },
    );

    await step("create production-tagged Postgres connection", async () => {
      await waitForLauncher();
      await createPostgresConnection(PROD_CONNECTION, "production");
      await openConnection(PROD_CONNECTION);
    });

    await step(
      "class D — prod + off: destructive still confirms (prod-auto)",
      async () => {
        // The toolbar "off" toggle is a no-op on production connections;
        // the prod-auto copy points at the environment tag, distinguishing
        // this from the class C bare-reason prod confirm.
        await setSafeMode("off");
        await runSqlInNewTab(dropSql);
        await waitForDialogTextAll(
          [
            "PRODUCTION DATABASE",
            "production environment forces Safe Mode",
            "DROP TABLE",
          ],
          15000,
          "production off prod-auto confirmation dialog did not appear",
        );
        await clickDialogAction("Confirm");
        await expectNoVisibleDialogText("PRODUCTION DATABASE", 2000);
      },
    );

    await step("reset Safe Mode to the warn default", async () => {
      await setSafeMode("warn");
      expect(await readSafeMode()).toBe("warn");
    });
  });
});

async function runSqlInNewTab(sql: string) {
  await openNewQueryTab();
  await typeQuery(sql);
  await runQuery();
}

function randomAlphaSuffix() {
  const alpha = Math.random()
    .toString(36)
    .replace(/[^a-z]/g, "");
  return (alpha + "safe").slice(0, 6);
}
