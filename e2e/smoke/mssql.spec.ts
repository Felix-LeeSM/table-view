import { $, browser, expect } from "@wdio/globals";
import {
  clickDialogAction,
  createMssqlConnection,
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
  waitForWorkspaceTextAll,
} from "./_helpers";

const CONNECTION_NAME = "E2E MSSQL";

describe("MSSQL smoke", () => {
  it("covers connect, catalog browse, SELECT/DML, row edit, and Safe Mode confirmation", async () => {
    const suffix = randomAlphaSuffix();
    const editedName = `Alice MSSQL Smoke ${suffix}`;
    const bobName = `Bob MSSQL Smoke ${suffix}`;
    const productName = `MSSQL Smoke Product ${suffix}`;

    await step("create production-tagged MSSQL connection", async () => {
      await waitForLauncher();
      await createMssqlConnection(CONNECTION_NAME, "production");
      await openConnection(CONNECTION_NAME);
    });

    await step("browse seeded dbo catalog objects", async () => {
      await expandIfCollapsed('[aria-label="dbo schema"]', 30000);
      await expandIfCollapsed('[aria-label="Tables in dbo"]');

      const usersTable = await $('[aria-label="users table"]');
      await usersTable.waitForDisplayed({ timeout: 15000 });

      await expandIfCollapsed('[aria-label="Views in dbo"]');
      const activeUsersView = await $('[aria-label="active_mssql_users view"]');
      await activeUsersView.waitForDisplayed({ timeout: 10000 });

      await expandIfCollapsed('[aria-label="Procedures in dbo"]');
      const catalogPingProcedure = await $(
        '[aria-label="mssql_catalog_ping function"]',
      );
      await catalogPingProcedure.waitForDisplayed({ timeout: 10000 });

      await usersTable.click();
      await waitForGridTextAll(
        ["alice@example.com"],
        15000,
        "seeded MSSQL users row did not appear in grid",
      );
    });

    await step("info SELECT runs without confirmation", async () => {
      await runSqlInNewTab("SELECT TOP 1 name AS mssql_name FROM dbo.users");
      const resultGrid = await waitForGridTextAll(
        ["mssql_name", "Alice"],
        15000,
        "MSSQL SELECT result did not appear",
      );
      expect(await resultGrid.isDisplayed()).toBe(true);
      await expectNoVisibleDialogText("Review SQL Changes");
      await expectNoVisibleDialogText("Destructive statement");
    });

    await step("warn UPDATE shows SQL preview before execution", async () => {
      await runSqlInNewTab(
        `UPDATE dbo.users SET name = N'${bobName}' WHERE email = N'bob@example.com'`,
      );
      await waitForReviewSql(["Review SQL Changes", "UPDATE", bobName]);
      await clickDialogAction("Execute");
      await waitForDialogToClose("Review SQL Changes");

      await runSqlInNewTab(
        "SELECT name AS warn_name FROM dbo.users WHERE email = N'bob@example.com'",
      );
      await waitForGridTextAll(
        ["warn_name", bobName],
        15000,
        "MSSQL warn UPDATE result did not commit",
      );
    });

    await step(
      "info INSERT renders statement evidence and readback",
      async () => {
        await runSqlInNewTab(
          `INSERT INTO dbo.products (name, price) VALUES (N'${productName}', 42.50)`,
        );
        await waitForWorkspaceTextAll(
          ["DML", "1 row affected"],
          15000,
          "MSSQL DML result evidence did not render",
        );
        await expectNoVisibleDialogText("Review SQL Changes");

        await runSqlInNewTab(
          `SELECT name, price FROM dbo.products WHERE name = N'${productName}'`,
        );
        await waitForGridTextAll(
          [productName, "42.5"],
          15000,
          "MSSQL DML readback did not appear in result grid",
        );
      },
    );

    await step("destructive DROP requires explicit confirmation", async () => {
      await runSqlInNewTab(`DROP TABLE IF EXISTS dbo.__mssql_smoke_${suffix}`);
      await waitForDialogTextAll(
        ["PRODUCTION DATABASE", "Destructive statement", "DROP TABLE"],
        15000,
        "MSSQL destructive confirmation dialog did not appear",
      );
      await clickDialogAction("Confirm");
      await waitForDialogToClose("Destructive statement");
    });

    await step("grid edit shows SQL preview before commit", async () => {
      await expandIfCollapsed('[aria-label="dbo schema"]', 30000);
      await expandIfCollapsed('[aria-label="Tables in dbo"]');

      const usersTable = await $('[aria-label="users table"]');
      await usersTable.waitForDisplayed({ timeout: 10000 });
      await usersTable.click();

      await waitForGridTextAll(
        ["alice@example.com"],
        15000,
        "seeded MSSQL users row did not appear in grid",
      );
      await editGridCellInRow(
        "alice@example.com",
        2,
        editedName,
        "Editing name",
      );

      const commit = await $('[aria-label="Commit changes"]');
      await commit.click();
      await waitForDialogTextAll(
        ["SQL Preview", "UPDATE", editedName],
        15000,
        "MSSQL grid edit SQL preview did not appear before commit",
      );
      await executeSqlPreview();

      await runSqlInNewTab(
        "SELECT name AS grid_edit_name FROM dbo.users WHERE email = N'alice@example.com'",
      );
      await waitForGridTextAll(
        ["grid_edit_name", editedName],
        15000,
        "MSSQL grid edit preview commit did not update Alice",
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
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"], [role="alertdialog"]',
          ),
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

function randomAlphaSuffix() {
  const alpha = Math.random()
    .toString(36)
    .replace(/[^a-z]/g, "");
  return (alpha + "mssql").slice(0, 6);
}
