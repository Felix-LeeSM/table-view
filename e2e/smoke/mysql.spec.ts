import { $, browser, expect } from "@wdio/globals";
import {
  createMysqlConnection,
  editGridCellInRow,
  executeSqlPreview,
  expandIfCollapsed,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  switchToWorkspaceWindow,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

const CONNECTION_NAME = "E2E MySQL";
const MYSQL_DATABASE = process.env.MYSQL_DATABASE ?? "table_view_test";

async function waitForTabHistoryStatuses(statuses: string[]) {
  await switchToWorkspaceWindow();
  await browser.waitUntil(
    async () => {
      await switchToWorkspaceWindow();
      await browser.execute(() => {
        document
          .querySelector<HTMLElement>(
            '[data-testid="query-history-panel-new-entry"]',
          )
          ?.click();
      });
      return await browser.execute((expected) => {
        const actual = Array.from(
          document.querySelectorAll(
            '[data-testid="query-history-panel-rows"] [title]',
          ),
        ).map((el) => el.getAttribute("title"));
        return expected.every((status) => actual.includes(status));
      }, statuses);
    },
    {
      timeout: 10000,
      timeoutMsg: `tab history did not include statuses: ${statuses.join(", ")}`,
    },
  );
}

async function waitForGlobalSourceBadges(sources: string[]) {
  await switchToWorkspaceWindow();
  await browser.execute(() => {
    window.dispatchEvent(new CustomEvent("toggle-global-query-log"));
  });

  const panel = await $('[data-testid="global-query-log-panel"]');
  await panel.waitForDisplayed({ timeout: 10000 });

  await browser.waitUntil(
    async () => {
      await browser.execute(() => {
        document
          .querySelector<HTMLElement>('[data-testid="global-log-new-entry"]')
          ?.click();
      });
      return await browser.execute((expected) => {
        return expected.every((source) =>
          Boolean(document.querySelector(`[data-source="${source}"]`)),
        );
      }, sources);
    },
    {
      timeout: 15000,
      timeoutMsg: `global query log did not include source badges: ${sources.join(", ")}`,
    },
  );
}

async function openSeededUsersTable() {
  await expandIfCollapsed(`[aria-label="Tables in ${MYSQL_DATABASE}"]`, 30000);

  const usersTable = await $('[aria-label="users table"]');
  await usersTable.waitForDisplayed({ timeout: 10000 });
  await usersTable.click();

  await waitForGridTextAll(
    ["alice@example.com"],
    15000,
    "seeded MySQL users row did not appear in grid",
  );
}

describe("MySQL smoke", () => {
  it("covers connect, browse, SELECT, DML batch, row edit, cancellation, and history evidence", async () => {
    const editedName = `Alice MySQL Smoke ${Date.now()}`;

    await step("create MySQL connection and open workspace", async () => {
      await waitForLauncher();
      await createMysqlConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
    });

    await step("browse seeded users table", async () => {
      await openSeededUsersTable();
    });

    await step("edit Alice name cell and execute the SQL preview", async () => {
      await editGridCellInRow(
        "alice@example.com",
        2,
        editedName,
        "Editing name",
      );

      const commit = await $('[aria-label="Commit changes"]');
      await commit.click();
      await executeSqlPreview();
    });

    await step("verify row edit through SELECT result grid", async () => {
      await openNewQueryTab();
      await typeQuery(
        "SELECT name AS edited_name FROM users WHERE email = 'alice@example.com'",
      );
      await runQuery();

      const resultGrid = await waitForGridTextAll(
        ["edited_name", editedName],
        15000,
        "committed MySQL edit did not appear in SELECT result grid",
      );

      expect(await resultGrid.isDisplayed()).toBe(true);
    });

    await step(
      "execute DML batch and verify tabular result envelope",
      async () => {
        await typeQuery(
          [
            "UPDATE products SET price = 29.99 WHERE name = 'Widget'",
            "UPDATE products SET price = 24.99 WHERE name = 'Widget'",
          ].join(";\n"),
        );
        await runQuery();
        await executeSqlPreview();

        await waitForWorkspaceTextAll(
          ["Statement 1 DML", "Statement 2 DML", "row affected"],
          15000,
          "MySQL DML batch did not render per-statement DML result evidence",
        );

        await typeQuery(
          "SELECT name, price FROM products WHERE name = 'Widget'",
        );
        await runQuery();
        await waitForGridTextAll(
          ["name", "price", "Widget", "24.99"],
          15000,
          "MySQL DML batch result was not visible through a follow-up SELECT",
        );
      },
    );

    await step("cancel a long MySQL query and retry cleanly", async () => {
      await typeQuery("SELECT SLEEP(20) AS cancelled_sleep");
      await runQuery();

      const cancel = await $('[aria-label="Cancel query"]');
      await cancel.waitForDisplayed({ timeout: 5000 });
      await cancel.click();

      const cancelledState = await $('[data-testid="query-cancelled-state"]');
      await cancelledState.waitForDisplayed({ timeout: 10000 });
      expect(await cancelledState.getText()).toContain("Query cancelled");

      await browser.waitUntil(
        async () =>
          await browser.execute(
            () => document.querySelector('[role="grid"]') === null,
          ),
        {
          timeout: 5000,
          timeoutMsg: "cancelled MySQL query left a stale result grid visible",
        },
      );
      await waitForTabHistoryStatuses(["cancelled"]);

      await typeQuery("SELECT 7 AS retry_after_mysql_cancel");
      await runQuery();
      await waitForGridTextAll(
        ["retry_after_mysql_cancel", "7"],
        15000,
        "fast MySQL retry result did not render after cancellation",
      );
      await waitForTabHistoryStatuses(["cancelled", "success"]);
    });

    await step("verify query history source labels", async () => {
      await waitForGlobalSourceBadges(["sidebar-prefetch", "grid-edit", "raw"]);
    });
  });
});
