import { $, browser, expect } from "@wdio/globals";
import {
  clickDomSelector,
  clickDialogAction,
  createOracleConnection,
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

const CONNECTION_NAME = "E2E Oracle";
const ORACLE_SCHEMA = (
  process.env.ORACLE_USER ??
  process.env.E2E_ORACLE_USER ??
  "testuser"
).toUpperCase();

describe("Oracle smoke", () => {
  it("covers connect, catalog browse, SELECT/DML, row edit, and Safe Mode confirmation", async () => {
    const suffix = randomAlphaSuffix();
    const editedName = `Alice Oracle Smoke ${suffix}`;
    const bobName = `Bob Oracle Smoke ${suffix}`;

    await step("create production-tagged Oracle connection", async () => {
      await waitForLauncher();
      await createOracleConnection(CONNECTION_NAME, "production");
      await openConnection(CONNECTION_NAME);
    });

    await step("browse seeded Oracle catalog objects", async () => {
      await expandIfCollapsed(`[aria-label="${ORACLE_SCHEMA} schema"]`, 30000);
      await expandIfCollapsed(`[aria-label="Tables in ${ORACLE_SCHEMA}"]`);

      const usersTable = await $('[aria-label="USERS table"]');
      await usersTable.waitForDisplayed({ timeout: 15000 });

      await expandIfCollapsed(`[aria-label="Views in ${ORACLE_SCHEMA}"]`);
      const activeUsersView = await $(
        '[aria-label="ACTIVE_ORACLE_USERS view"]',
      );
      await activeUsersView.waitForDisplayed({ timeout: 10000 });

      await expandIfCollapsed(`[aria-label="Functions in ${ORACLE_SCHEMA}"]`);
      const catalogPingRoutine = await $(
        '[aria-label="ORACLE_CATALOG_PING function"]',
      );
      await catalogPingRoutine.waitForDisplayed({ timeout: 10000 });

      await clickDomSelector('[aria-label="USERS table"]');
      await waitForGridTextAll(
        ["alice@example.com"],
        30000,
        "seeded Oracle users row did not appear in grid",
      );
    });

    await step("info SELECT runs without confirmation", async () => {
      await runSqlInNewTab(
        "SELECT name AS oracle_name FROM users FETCH FIRST 1 ROWS ONLY",
      );
      const resultGrid = await waitForGridTextAll(
        ["ORACLE_NAME", "Alice"],
        15000,
        "Oracle SELECT result did not appear",
      );
      expect(await resultGrid.isDisplayed()).toBe(true);
      await expectNoVisibleDialogText("Review SQL Changes");
      await expectNoVisibleDialogText("Destructive statement");
    });

    await step("warn UPDATE shows SQL preview and readback", async () => {
      await runSqlInNewTab(
        `UPDATE users SET name = '${bobName}' WHERE email = 'bob@example.com'`,
      );
      await waitForReviewSql(["Review SQL Changes", "UPDATE", bobName]);
      await clickDialogAction("Execute");
      await waitForDialogToClose("Review SQL Changes");

      await runSqlInNewTab(
        "SELECT name AS warn_name FROM users WHERE email = 'bob@example.com'",
      );
      await waitForGridTextAll(
        ["WARN_NAME", bobName],
        15000,
        "Oracle DML readback did not appear in result grid",
      );
    });

    await step("grid edit shows SQL preview before commit", async () => {
      await expandIfCollapsed(`[aria-label="${ORACLE_SCHEMA} schema"]`, 30000);
      await expandIfCollapsed(`[aria-label="Tables in ${ORACLE_SCHEMA}"]`);

      const usersTable = await $('[aria-label="USERS table"]');
      await usersTable.waitForDisplayed({ timeout: 10000 });
      await clickDomSelector('[aria-label="USERS table"]');

      await waitForGridTextAll(
        ["alice@example.com"],
        30000,
        "seeded Oracle users row did not appear in grid",
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
        "Oracle grid edit SQL preview did not appear before commit",
      );
      await executeSqlPreview();

      await runSqlInNewTab(
        "SELECT name AS grid_edit_name FROM users WHERE email = 'alice@example.com'",
      );
      await waitForGridTextAll(
        ["GRID_EDIT_NAME", editedName],
        15000,
        "Oracle grid edit preview commit did not update Alice",
      );
    });

    await step(
      "destructive DELETE requires explicit confirmation",
      async () => {
        await runSqlInNewTab("DELETE FROM users");
        await waitForDialogTextAll(
          ["PRODUCTION DATABASE", "Destructive statement", "DELETE"],
          15000,
          "Oracle destructive confirmation dialog did not appear",
        );
        await clickDialogAction("Confirm");
        await waitForDialogToClose("Destructive statement");
      },
    );
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
  return (alpha + "oracle").slice(0, 6);
}
