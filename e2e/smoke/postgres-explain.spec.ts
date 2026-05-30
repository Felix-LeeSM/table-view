import { $, $$, browser, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  openConnection,
  openNewQueryTab,
  step,
  switchToWorkspaceWindow,
  typeQuery,
  waitForLauncher,
} from "./_helpers";

const CONNECTION_NAME = "E2E Postgres Explain";

async function waitForExplainSourceBadge(timeoutMs = 15000) {
  await browser.waitUntil(
    async () => {
      const badges = await $$('[data-source="explain"]');
      return badges.length > 0;
    },
    {
      timeout: timeoutMs,
      timeoutMsg: `query history source="explain" did not appear within ${timeoutMs}ms`,
    },
  );
}

describe("PostgreSQL Explain smoke", () => {
  it("renders a plan from the query editor and records an explain history source", async () => {
    await step("create Postgres connection and open workspace", async () => {
      await waitForLauncher();
      await createPostgresConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
    });

    await step("open query tab and request an Explain plan", async () => {
      await openNewQueryTab();
      await typeQuery(
        "SELECT name FROM users WHERE email = 'alice@example.com'",
      );

      const explain = await $('[aria-label="Explain query"]');
      await explain.waitForDisplayed({ timeout: 10000 });
      await explain.click();
    });

    await step(
      "verify plan rendering stays in plan-inspection mode",
      async () => {
        const plan = await $('[data-testid="explain-plan"]');
        await plan.waitForDisplayed({ timeout: 15000 });
        await browser.waitUntil(
          async () => {
            const text = String((await plan.getProperty("textContent")) ?? "");
            const lower = text.toLowerCase();
            return (
              lower.includes("plan summary") &&
              lower.includes("scan") &&
              !lower.includes("execution time")
            );
          },
          {
            timeout: 15000,
            timeoutMsg:
              "Explain plan did not render a scan summary without execution timing",
          },
        );
        expect(await plan.isDisplayed()).toBe(true);
      },
    );

    await step("open query log and verify explain source label", async () => {
      await switchToWorkspaceWindow();
      await browser.execute(() => {
        window.dispatchEvent(new CustomEvent("toggle-query-log"));
      });

      await waitForExplainSourceBadge();

      const badge = await $('[data-source="explain"]');
      expect(await badge.getText()).toBe("PLAN");
    });
  });
});
