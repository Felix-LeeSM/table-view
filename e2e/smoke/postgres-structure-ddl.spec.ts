import { $, browser, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  expandIfCollapsed,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  switchToWorkspaceWindow,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";

const CONNECTION_NAME = "E2E Postgres Structure DDL";

describe("PostgreSQL structure DDL smoke", () => {
  it("creates a table and index through the Structure DDL preview flow", async () => {
    const suffix = randomAlphaSuffix();
    const tableName = `structure_ddl_${suffix}`;
    const indexName = `idx_${tableName}_label`;

    await step("create production-tagged Postgres connection", async () => {
      await waitForLauncher();
      await createPostgresConnection(CONNECTION_NAME, "production");
      await openConnection(CONNECTION_NAME);
    });

    await step("open Create Table dialog from public schema", async () => {
      await expandIfCollapsed('[aria-label="public schema"]', 30000);
      await expandIfCollapsed('[aria-label="Tables in public"]');
      await clickAria(`Create table in public`);
      await waitForVisibleText("Create Table", 10000);
    });

    await step("fill table columns and declare one index", async () => {
      await setInputByAria("Table name", tableName);
      await setNthInputByAria("Column name", 0, "id");
      await setNthInputByAria("Column data type", 0, "integer");

      await clickAria("Add column");
      await setNthInputByAria("Column name", 1, "label");
      await setNthInputByAria("Column data type", 1, "text");

      await clickVisibleButtonText("Indexes");
      await clickAria("Add index");
      await setInputByAria("Index name", indexName);
      await clickAria("Index column: label");
    });

    await step("wait for DDL preview and execute", async () => {
      await waitForDdlPreview([
        tableName,
        indexName,
        "CREATE TABLE",
        "CREATE INDEX",
      ]);
      await clickEnabledButtonText("Execute");
      await waitUntilTextGone("Create Table", 20000);
    });

    await step("schema refresh shows the new table", async () => {
      const table = await $(`[aria-label="${tableName} table"]`);
      await table.waitForDisplayed({
        timeout: 20000,
        timeoutMsg: `${tableName} table did not appear after create_table_plan refresh`,
      });
      expect(await table.isDisplayed()).toBe(true);
      await table.click();
    });

    await step("Structure indexes tab shows the new index", async () => {
      await clickAria("Structure");
      await clickVisibleButtonText("Indexes");
      await waitForVisibleText(indexName, 20000);
    });

    await step("query history source badge records ddl-structure", async () => {
      await waitForStructureHistoryEvidence([tableName]);
    });

    await step("pg_indexes query confirms the physical index", async () => {
      await openNewQueryTab();
      await typeQuery(
        `SELECT indexname AS created_index FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${tableName}'`,
      );
      await runQuery();
      await waitForGridTextAll(
        ["created_index", indexName],
        15000,
        "created Postgres index did not appear in pg_indexes",
      );
    });
  });
});

async function waitForStructureHistoryEvidence(fragments: string[]) {
  await switchToWorkspaceWindow();

  const isOpen = await browser.execute(() =>
    Boolean(document.querySelector('[data-testid="global-query-log-panel"]')),
  );
  if (!isOpen) {
    await browser.execute(() => {
      window.dispatchEvent(new CustomEvent("toggle-global-query-log"));
    });
  }

  const panel = await $('[data-testid="global-query-log-panel"]');
  await panel.waitForDisplayed({ timeout: 10000 });

  await browser.waitUntil(
    async () => {
      await browser.execute(() => {
        document
          .querySelector<HTMLElement>('[data-testid="global-log-new-entry"]')
          ?.click();
      });
      return await browser.execute((expectedFragments) => {
        const bodyText = document.body.textContent ?? "";
        const sourceReady = Boolean(
          document.querySelector('[data-source="ddl-structure"]'),
        );
        const sqlReady = expectedFragments.every((fragment) =>
          bodyText.includes(fragment),
        );
        return sourceReady && sqlReady;
      }, fragments);
    },
    {
      timeout: 15000,
      timeoutMsg: `global query log missing ddl-structure source badge or SQL fragments (${fragments.join(
        ", ",
      )})`,
    },
  );
}

function randomAlphaSuffix(): string {
  return Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, "")
    .slice(0, 8);
}

async function setInputByAria(label: string, value: string) {
  await setNthInputByAria(label, 0, value);
}

async function setNthInputByAria(label: string, index: number, value: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (ariaLabel, nth) =>
          document.querySelectorAll<HTMLInputElement>(
            `input[aria-label="${ariaLabel}"]`,
          ).length > nth,
        label,
        index,
      ),
    {
      timeout: 10000,
      timeoutMsg: `${label} input #${index} did not appear`,
    },
  );
  await browser.execute(
    (ariaLabel, nth, nextValue) => {
      const input = document.querySelectorAll<HTMLInputElement>(
        `input[aria-label="${ariaLabel}"]`,
      )[nth];
      if (!input) throw new Error(`${ariaLabel} input #${nth} did not appear`);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("HTMLInputElement value setter missing");
      input.focus();
      setter.call(input, nextValue);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
    },
    label,
    index,
    value,
  );
}

async function clickAria(label: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((ariaLabel) => {
        const isVisible = (element: HTMLElement) => {
          const style = window.getComputedStyle(element);
          return (
            element.getClientRects().length > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        };
        return Array.from(
          document.querySelectorAll<HTMLElement>(`[aria-label="${ariaLabel}"]`),
        ).some(isVisible);
      }, label),
    {
      timeout: 10000,
      timeoutMsg: `${label} control did not appear`,
    },
  );
  await browser.execute((ariaLabel) => {
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return (
        element.getClientRects().length > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const target = Array.from(
      document.querySelectorAll<HTMLElement>(`[aria-label="${ariaLabel}"]`),
    ).find(isVisible);
    if (!target) throw new Error(`${ariaLabel} control did not appear`);
    target.click();
  }, label);
}

async function clickVisibleButtonText(text: string) {
  await browser.waitUntil(
    async () => (await findVisibleButtonText(text)) !== null,
    {
      timeout: 10000,
      timeoutMsg: `${text} button did not appear`,
    },
  );
  await browser.execute((needle) => {
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return (
        element.getClientRects().length > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const button = Array.from(
      document.querySelectorAll<HTMLElement>("button"),
    ).find(
      (candidate) =>
        isVisible(candidate) && candidate.textContent?.trim() === needle,
    );
    if (!button) throw new Error(`${needle} button did not appear`);
    button.click();
  }, text);
}

async function clickEnabledButtonText(text: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((needle) => {
        const isVisible = (element: HTMLElement) => {
          const style = window.getComputedStyle(element);
          return (
            element.getClientRects().length > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        };
        return Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).some(
          (candidate) =>
            isVisible(candidate) &&
            candidate.textContent?.trim() === needle &&
            !candidate.disabled,
        );
      }, text),
    {
      timeout: 15000,
      timeoutMsg: `${text} enabled button did not appear`,
    },
  );
  await browser.execute((needle) => {
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return (
        element.getClientRects().length > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (candidate) =>
        isVisible(candidate) &&
        candidate.textContent?.trim() === needle &&
        !candidate.disabled,
    );
    if (!button) throw new Error(`${needle} enabled button did not appear`);
    button.click();
  }, text);
}

async function waitForDdlPreview(snippets: string[]) {
  await browser.waitUntil(
    async () =>
      await browser.execute((needles) => {
        const text =
          document.querySelector<HTMLElement>("#create-table-ddl-preview")
            ?.textContent ?? "";
        return needles.every((needle) =>
          text.toLowerCase().includes(needle.toLowerCase()),
        );
      }, snippets),
    {
      timeout: 15000,
      timeoutMsg: `DDL preview did not include ${snippets.join(", ")}`,
    },
  );
}

async function waitForVisibleText(text: string, timeout: number) {
  await browser.waitUntil(
    async () =>
      await browser.execute((needle) => {
        const isVisible = (element: HTMLElement) => {
          const style = window.getComputedStyle(element);
          return (
            element.getClientRects().length > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        };
        return Array.from(
          document.querySelectorAll<HTMLElement>("body *"),
        ).some(
          (candidate) =>
            isVisible(candidate) &&
            (candidate.textContent ?? "").includes(needle),
        );
      }, text),
    { timeout, timeoutMsg: `${text} did not become visible` },
  );
}

async function waitUntilTextGone(text: string, timeout: number) {
  await browser.waitUntil(
    async () =>
      await browser.execute((needle) => {
        const isVisible = (element: HTMLElement) => {
          const style = window.getComputedStyle(element);
          return (
            element.getClientRects().length > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        };
        return !Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"]'),
        ).some(
          (candidate) =>
            isVisible(candidate) &&
            (candidate.textContent ?? "").includes(needle),
        );
      }, text),
    { timeout, timeoutMsg: `${text} dialog did not close` },
  );
}

async function findVisibleButtonText(text: string): Promise<string | null> {
  return await browser.execute((needle) => {
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return (
        element.getClientRects().length > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const found = Array.from(
      document.querySelectorAll<HTMLElement>("button"),
    ).find(
      (candidate) =>
        isVisible(candidate) && candidate.textContent?.trim() === needle,
    );
    return found?.textContent ?? null;
  }, text);
}
