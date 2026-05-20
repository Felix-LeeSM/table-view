import { $, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  editGridCellInRow,
  executeSqlPreview,
  expandIfCollapsed,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";

const CONNECTION_NAME = "E2E Postgres";

describe("PostgreSQL smoke", () => {
  it("creates a connection, edits seeded data, and verifies the committed value through a query", async () => {
    const editedName = `Alice Smoke ${Date.now()}`;

    await step("create Postgres connection and open workspace", async () => {
      await waitForLauncher();
      await createPostgresConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
    });

    await step("open seeded users table", async () => {
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

    await step("verify committed value through a query tab", async () => {
      await openNewQueryTab();
      await typeQuery(
        "SELECT name AS edited_name FROM users WHERE email = 'alice@example.com'",
      );
      await runQuery();

      const resultGrid = await waitForGridTextAll(
        ["edited_name", editedName],
        15000,
        "committed Postgres edit did not appear in query result grid",
      );

      expect(await resultGrid.isDisplayed()).toBe(true);
    });
  });
});
