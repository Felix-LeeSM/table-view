import { $, browser } from "@wdio/globals";
import {
  clickDialogAction,
  createPostgresConnection,
  editGridCellInRow,
  executeSqlPreview,
  expectNoVisibleDialogText,
  expandIfCollapsed,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  typeQuery,
  waitForDialogTextAll,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";

const CONNECTION_NAME = "E2E Postgres Safe Mode";

describe("PostgreSQL Safe Mode smoke", () => {
  it("covers info, warn, destructive, DDL, and grid-edit confirmation paths", async () => {
    const suffix = Date.now();
    const ddlColumn = `safe_mode_note_${suffix}`;
    const bobName = `Bob Safe Mode ${suffix}`;
    const aliceName = `Alice Safe Mode ${suffix}`;

    await step("create production-tagged Postgres connection", async () => {
      await waitForLauncher();
      await createPostgresConnection(CONNECTION_NAME, "production");
      await openConnection(CONNECTION_NAME);
    });

    await step("info SELECT runs without confirmation", async () => {
      await runSqlInNewTab("SELECT 1 AS safe_mode_info");
      await waitForGridTextAll(
        ["safe_mode_info", "1"],
        15000,
        "info SELECT result did not appear",
      );
      await expectNoVisibleDialogText("Review SQL Changes");
      await expectNoVisibleDialogText("Destructive statement");
    });

    await step("warn UPDATE shows SQL preview before execution", async () => {
      await runSqlInNewTab(
        `UPDATE users SET name = '${bobName}' WHERE email = 'bob@example.com'`,
      );
      await waitForReviewSql(["Review SQL Changes", "UPDATE users", bobName]);
      await clickDialogAction("Execute");
      await waitForDialogToClose("Review SQL Changes");

      await runSqlInNewTab(
        "SELECT name AS warn_name FROM users WHERE email = 'bob@example.com'",
      );
      await waitForGridTextAll(
        ["warn_name", bobName],
        15000,
        "warn UPDATE result did not commit",
      );
    });

    await step("destructive DROP requires explicit confirmation", async () => {
      await runSqlInNewTab(`DROP TABLE IF EXISTS __safe_mode_smoke_${suffix}`);
      await waitForDialogTextAll(
        ["PRODUCTION DATABASE", "Destructive statement", "DROP TABLE"],
        15000,
        "destructive confirmation dialog did not appear",
      );
      await clickDialogAction("Confirm");
      await waitForDialogToClose("Destructive statement");
    });

    await step("DDL ADD COLUMN shows preview before execution", async () => {
      await runSqlInNewTab(`ALTER TABLE users ADD COLUMN ${ddlColumn} TEXT`);
      await waitForReviewSql(["Review SQL Changes", "ALTER TABLE", ddlColumn]);
      await clickDialogAction("Execute");
      await waitForDialogToClose("Review SQL Changes");

      await runSqlInNewTab(`SELECT ${ddlColumn} FROM users LIMIT 1`);
      await waitForGridTextAll(
        [ddlColumn],
        15000,
        "DDL ADD COLUMN result did not appear in query result grid",
      );
    });

    await step("grid edit shows SQL preview before commit", async () => {
      await expandIfCollapsed('[aria-label="public schema"]', 30000);
      await expandIfCollapsed('[aria-label="Tables in public"]');

      const usersTable = await $('[aria-label="users table"]');
      await usersTable.waitForDisplayed({ timeout: 10000 });
      await usersTable.click();

      await waitForGridTextAll(
        ["alice@example.com"],
        15000,
        "seeded Postgres users row did not appear in grid",
      );
      await editGridCellInRow(
        "alice@example.com",
        2,
        aliceName,
        "Editing name",
      );

      const commit = await $('[aria-label="Commit changes"]');
      await commit.click();
      await waitForReviewSql(["Review SQL Changes", "UPDATE", aliceName]);
      await executeSqlPreview();

      await runSqlInNewTab(
        "SELECT name AS grid_edit_name FROM users WHERE email = 'alice@example.com'",
      );
      await waitForGridTextAll(
        ["grid_edit_name", aliceName],
        15000,
        "grid edit preview commit did not update Alice",
      );
    });
  });
});

async function runSqlInNewTab(sql: string) {
  await openNewQueryTab();
  await typeQuery(sql);
  await runQuery();
}

async function waitForReviewSql(snippets: string[]) {
  await waitForDialogTextAll(
    snippets,
    15000,
    `${snippets.join(", ")} did not appear in SQL preview dialog`,
  );
}

async function waitForDialogToClose(text: string) {
  await browser.waitUntil(
    async () =>
      !(await browser.execute((needle) => {
        return Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"]'),
        )
          .filter((dialog) => {
            const style = window.getComputedStyle(dialog);
            return (
              dialog.getClientRects().length > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
            );
          })
          .some((dialog) =>
            (dialog.textContent ?? "")
              .toLowerCase()
              .includes(needle.toLowerCase()),
          );
      }, text)),
    {
      timeout: 15000,
      timeoutMsg: `${text} dialog did not close`,
    },
  );
}
