import { $, browser, expect } from "@wdio/globals";
import {
  createMongoConnection,
  expandIfCollapsed,
  openConnection,
  waitForLauncher,
} from "./_helpers";

const CONNECTION_NAME = "E2E MongoDB";

describe("MongoDB smoke", () => {
  it("creates a connection and opens seeded collection data", async () => {
    await waitForLauncher();
    await createMongoConnection(CONNECTION_NAME);
    await openConnection(CONNECTION_NAME);

    const filter = await $('[aria-label="Filter databases and collections"]');
    await filter.waitForDisplayed({ timeout: 30000 });

    await expandIfCollapsed('[aria-label="table_view_test database"]', 30000);

    const collection = await $('[aria-label="smoke_users collection"]');
    await collection.waitForDisplayed({ timeout: 15000 });
    await collection.click();

    const table = await $("table");
    await table.waitForDisplayed({ timeout: 15000 });

    await browser.waitUntil(
      async () => {
        const text = (
          ((await table.getProperty("textContent")) as string) ?? ""
        )
          .trim()
          .toLowerCase();
        return text.includes("mona") || text.includes("mona@example.com");
      },
      {
        timeout: 15000,
        timeoutMsg: "seeded MongoDB document did not appear in document grid",
      },
    );

    expect(await collection.isDisplayed()).toBe(true);
  });
});
