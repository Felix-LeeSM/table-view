import { $, $$, browser, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  expandIfCollapsed,
  openConnection,
  openNewQueryTab,
  runQuery,
  typeQuery,
  waitForLauncher,
} from "./_helpers";

const CONNECTION_NAME = "E2E Postgres";

describe("PostgreSQL smoke", () => {
  it("creates a connection, opens seeded data, and executes a query", async () => {
    await waitForLauncher();
    await createPostgresConnection(CONNECTION_NAME);
    await openConnection(CONNECTION_NAME);

    await expandIfCollapsed('[aria-label="public schema"]', 30000);
    await expandIfCollapsed('[aria-label="Tables in public"]');

    const usersTable = await $('[aria-label="users table"]');
    await usersTable.waitForDisplayed({ timeout: 10000 });
    await usersTable.click();

    const table = await $("table");
    await table.waitForDisplayed({ timeout: 15000 });
    await browser.waitUntil(
      async () => {
        const body = (
          ((await table.getProperty("textContent")) as string) ?? ""
        )
          .trim()
          .toLowerCase();
        return body.includes("alice") || body.includes("alice@example.com");
      },
      {
        timeout: 15000,
        timeoutMsg: "seeded Postgres users row did not appear in grid",
      },
    );

    await openNewQueryTab();
    await typeQuery("SELECT 1 AS test_column");
    await runQuery();

    const header = await $("th*=test_column");
    await header.waitForDisplayed({ timeout: 15000 });

    await browser.waitUntil(
      async () => {
        const cells = await $$("td");
        for (const cell of cells) {
          const text = (
            ((await cell.getProperty("textContent")) as string) ?? ""
          ).trim();
          if (text === "1") return true;
        }
        return false;
      },
      {
        timeout: 15000,
        timeoutMsg: "SELECT 1 result did not appear in result grid",
      },
    );

    expect(await header.isDisplayed()).toBe(true);
  });
});
