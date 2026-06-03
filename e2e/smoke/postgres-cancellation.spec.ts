import { $, browser, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";
import { waitForTabHistoryStatuses } from "./query-history-helpers";

const CONNECTION_NAME = "E2E Postgres Cancellation";

describe("PostgreSQL cancellation smoke", () => {
  it("cancels a long query, shows cancellation, preserves history, and retries cleanly", async () => {
    await step("create Postgres connection and open workspace", async () => {
      await waitForLauncher();
      await createPostgresConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
    });

    await step("run a baseline query result", async () => {
      await openNewQueryTab();
      await typeQuery("SELECT 42 AS before_cancel");
      await runQuery();
      await waitForGridTextAll(
        ["before_cancel", "42"],
        15000,
        "baseline result did not render before cancellation smoke",
      );
    });

    await step("cancel a long-running query from the toolbar", async () => {
      await typeQuery("SELECT pg_sleep(20) AS cancelled_sleep");
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
          timeoutMsg: "cancelled query left a stale result grid visible",
        },
      );
      await waitForTabHistoryStatuses(["cancelled"]);
    });

    await step("retry a fast query after cancellation", async () => {
      await typeQuery("SELECT 7 AS retry_after_cancel");
      await runQuery();
      await waitForGridTextAll(
        ["retry_after_cancel", "7"],
        15000,
        "fast retry result did not render after cancellation",
      );
      await waitForTabHistoryStatuses(["cancelled", "success"]);
    });
  });
});
