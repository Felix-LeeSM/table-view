import { $, browser, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  switchToWorkspaceWindow,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";

const CONNECTION_NAME = "E2E Postgres Cancellation";

async function waitForHistoryStatuses(statuses: string[]) {
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
      await waitForHistoryStatuses(["cancelled"]);
    });

    await step("retry a fast query after cancellation", async () => {
      await typeQuery("SELECT 7 AS retry_after_cancel");
      await runQuery();
      await waitForGridTextAll(
        ["retry_after_cancel", "7"],
        15000,
        "fast retry result did not render after cancellation",
      );
      await waitForHistoryStatuses(["cancelled", "success"]);
    });
  });
});
