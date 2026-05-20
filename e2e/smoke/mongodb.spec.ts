import { $, expect } from "@wdio/globals";
import {
  createMongoConnection,
  editGridCellInRow,
  executeMqlPreview,
  expandIfCollapsed,
  openConnection,
  step,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";

const CONNECTION_NAME = "E2E MongoDB";

describe("MongoDB smoke", () => {
  it("creates a connection, edits seeded collection data, and renders the committed document", async () => {
    const editedName = `Mona Smoke ${Date.now()}`;

    await step("create MongoDB connection and open workspace", async () => {
      await waitForLauncher();
      await createMongoConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);

      const filter = await $('[aria-label="Filter databases and collections"]');
      await filter.waitForDisplayed({ timeout: 30000 });
    });

    await step("open seeded smoke_users collection", async () => {
      await expandIfCollapsed('[aria-label="table_view_test database"]', 30000);

      const collection = await $('[aria-label="smoke_users collection"]');
      await collection.waitForDisplayed({ timeout: 15000 });
      await collection.click();

      await waitForGridTextAll(
        ["mona@example.com"],
        15000,
        "seeded MongoDB document did not appear in document grid",
      );

      expect(await collection.isDisplayed()).toBe(true);
    });

    await step(
      "edit Mona document name and execute the MQL preview",
      async () => {
        await editGridCellInRow(
          "mona@example.com",
          3,
          editedName,
          "Editing name",
        );

        const commit = await $('[aria-label="Commit changes"]');
        await commit.click();
        await executeMqlPreview();
      },
    );

    await step("verify committed MongoDB document value in grid", async () => {
      await waitForGridTextAll(
        ["mona@example.com", editedName],
        15000,
        "committed MongoDB edit did not appear in document grid",
      );
    });
  });
});
