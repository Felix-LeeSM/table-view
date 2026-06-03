import { browser } from "@wdio/globals";
import { switchToWorkspaceWindow } from "./_helpers";

export async function expandTabHistoryPanel(timeout = 10000) {
  await switchToWorkspaceWindow();
  await waitForDomSelector('[data-testid="query-history-panel"]', timeout);
  await browser.execute(() => {
    const toggle = document.querySelector<HTMLElement>(
      '[aria-label="Expand tab history"], [aria-label="Collapse tab history"]',
    );
    if (!toggle) throw new Error("tab history toggle did not appear");
    if (toggle.getAttribute("aria-expanded") !== "true") {
      toggle.click();
    }
  });
  await waitForDomSelector('[data-testid="query-history-panel-body"]', timeout);
}

export async function waitForTabHistoryStatuses(
  statuses: string[],
  timeout = 10000,
) {
  await switchToWorkspaceWindow();
  await browser.waitUntil(
    async () => {
      await expandTabHistoryPanel(timeout);
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
      timeout,
      timeoutMsg: `tab history did not include statuses: ${statuses.join(", ")}`,
    },
  );
}

async function waitForDomSelector(selector: string, timeout = 10000) {
  await browser.waitUntil(
    async () =>
      await browser.execute((targetSelector) => {
        return Boolean(document.querySelector(targetSelector));
      }, selector),
    {
      timeout,
      timeoutMsg: `${selector} did not appear within ${timeout}ms`,
    },
  );
}
