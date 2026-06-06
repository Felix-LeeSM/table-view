import { $, browser, expect } from "@wdio/globals";
import {
  editGridCellInRow,
  executeSqlPreview,
  expandIfCollapsed,
  expectConnectionVisible,
  openConnection,
  openNewConnectionDialog,
  openNewQueryTab,
  runQuery,
  step,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

const CONNECTION_NAME = "E2E MSSQL";
const DATABASE = process.env.MSSQL_DATABASE ?? "table_view_test";
const COMPLETION_LABEL_SELECTOR =
  ".cm-tooltip-autocomplete .cm-completionLabel";

describe("MSSQL smoke", () => {
  it("covers full support: connect, catalog, query, row edit, bounded DDL/admin, and completion evidence", async () => {
    const suffix = randomAlphaSuffix();
    const editedName = `Alice MSSQL Smoke ${suffix}`;
    const productA = `MSSQL Smoke Product ${suffix} A`;
    const productB = `MSSQL Smoke Product ${suffix} B`;
    const adminTable = `mssql_smoke_admin_${suffix}`;

    await step("create MSSQL connection and open workspace", async () => {
      await waitForLauncher();
      await createMssqlConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
    });

    await step(
      "browse MSSQL catalog metadata and seeded users table",
      async () => {
        await expandFirst([
          `[aria-label="${DATABASE} database"]`,
          `[aria-label="${DATABASE} schema"]`,
          '[aria-label="dbo schema"]',
        ]);
        await expandFirst([
          '[aria-label="Tables in dbo"]',
          `[aria-label="Tables in ${DATABASE}"]`,
        ]);
        const usersTable = await $('[aria-label="users table"]');
        await usersTable.waitForDisplayed({ timeout: 15000 });
        await usersTable.click();
        await waitForGridTextAll(
          ["alice@example.com"],
          15000,
          "seeded MSSQL users row did not appear in grid",
        );
        await waitForWorkspaceTextAll(
          ["users", "orders", "products"],
          15000,
          "MSSQL catalog did not expose seeded table names",
        );
      },
    );

    await step("edit Alice name cell and execute SQL preview", async () => {
      await editGridCellInRow(
        "alice@example.com",
        2,
        editedName,
        "Editing name",
      );
      await (await $('[aria-label="Commit changes"]')).click();
      await executeSqlPreview();
    });

    await step("verify row edit through SELECT result grid", async () => {
      await runSqlInNewTab(
        "SELECT name AS edited_name FROM users WHERE email = 'alice@example.com'",
      );
      const resultGrid = await waitForGridTextAll(
        ["edited_name", editedName],
        15000,
        "committed MSSQL edit did not appear in SELECT result grid",
      );
      expect(await resultGrid.isDisplayed()).toBe(true);
    });

    await step("execute DML batch and verify result envelope", async () => {
      await runSqlInNewTab(
        [
          `INSERT INTO products (name, price) VALUES ('${productA}', 29.99)`,
          `INSERT INTO products (name, price) VALUES ('${productB}', 24.99)`,
        ].join("; "),
      );
      await waitForWorkspaceTextAll(
        ["Statement 1 DML", "Statement 2 DML", "row affected"],
        15000,
        "MSSQL DML batch did not render per-statement DML evidence",
      );

      await runSqlInNewTab(
        `SELECT name, price FROM products WHERE name IN ('${productA}', '${productB}') ORDER BY name`,
      );
      await waitForGridTextAll(
        ["name", "price", productA, productB, "29.99", "24.99"],
        15000,
        "MSSQL DML batch result was not visible through SELECT",
      );
    });

    await step(
      "execute bounded DDL/admin and verify catalog/result",
      async () => {
        await runSqlInNewTab(
          `CREATE TABLE dbo.${adminTable} (id INT NOT NULL PRIMARY KEY, note NVARCHAR(64) NULL)`,
        );
        await waitForWorkspaceTextAll(
          ["DDL", adminTable],
          15000,
          "MSSQL CREATE TABLE DDL did not render completion evidence",
        );

        await runSqlInNewTab(
          `INSERT INTO dbo.${adminTable} (id, note) VALUES (1, 'bounded admin')`,
        );
        await runSqlInNewTab(`SELECT note FROM dbo.${adminTable} WHERE id = 1`);
        await waitForGridTextAll(
          ["bounded admin"],
          15000,
          "MSSQL bounded DDL/admin table was not queryable",
        );

        await runSqlInNewTab(`DROP TABLE dbo.${adminTable}`);
        await waitForWorkspaceTextAll(
          ["DDL", adminTable],
          15000,
          "MSSQL DROP TABLE DDL did not render completion evidence",
        );
      },
    );

    await step("surface MSSQL vocabulary and catalog completion", async () => {
      await openNewQueryTab();
      await typeQuery("SELECT * FROM us");
      await waitForCompletionLabel("users");
      await typeQuery("SEL");
      await waitForCompletionLabel("SELECT");
    });
  });
});

async function createMssqlConnection(name: string) {
  const dialog = await openNewConnectionDialog();
  await selectDbType("Microsoft SQL Server");
  await setInput("#conn-name", name);
  await setInput("#conn-host", process.env.E2E_MSSQL_HOST ?? "localhost");
  await setInput(
    "#conn-port",
    process.env.E2E_MSSQL_PORT ?? process.env.MSSQL_PORT ?? "14333",
  );
  await setInput("#conn-user", process.env.MSSQL_USER ?? "sa");
  await setInput(
    "#conn-password",
    process.env.MSSQL_PASSWORD ?? "Testpass123!",
  );
  await setInput("#conn-database", DATABASE);
  await (await $("button=Save")).click();
  await dialog.waitForDisplayed({ timeout: 10000, reverse: true });
  await expectConnectionVisible(name);
}

async function runSqlInNewTab(sql: string) {
  await openNewQueryTab();
  await typeQuery(sql);
  await runQuery();
}

async function selectDbType(label: string) {
  const trigger = await $("#conn-db-type");
  await trigger.waitForDisplayed({ timeout: 5000 });
  if ((await trigger.getText()).includes(label)) return;
  await trigger.click();
  await browser.execute((text) => {
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find(
      (candidate) =>
        candidate.offsetParent !== null &&
        candidate.textContent?.trim() === text,
    );
    if (!option) throw new Error(`${text} option did not appear`);
    option.click();
  }, label);
}

async function setInput(selector: string, value: string) {
  const input = await $(selector);
  await input.waitForDisplayed({ timeout: 5000 });
  await input.clearValue();
  await input.setValue(value);
}

async function expandFirst(selectors: string[]) {
  let lastError: unknown = null;
  for (const selector of selectors) {
    try {
      await expandIfCollapsed(selector, 5000);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function waitForCompletionLabel(label: string, timeoutMs = 15000) {
  await browser.waitUntil(
    async () => {
      await triggerCompletion();
      const labels = await visibleCompletionLabels();
      return labels.some(
        (candidate) => candidate.toLowerCase() === label.toLowerCase(),
      );
    },
    {
      timeout: timeoutMs,
      interval: 250,
      timeoutMsg: `${label} completion did not appear`,
    },
  );
}

async function visibleCompletionLabels(): Promise<string[]> {
  return await browser.execute((selector) => {
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => element.offsetParent !== null)
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean);
  }, COMPLETION_LABEL_SELECTOR);
}

async function triggerCompletion() {
  await browser.execute(() => {
    const editor = document.querySelector<HTMLElement>(".cm-content");
    if (!editor) throw new Error("CodeMirror editor content did not appear");
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        code: "Space",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function randomAlphaSuffix() {
  const alpha = Math.random()
    .toString(36)
    .replace(/[^a-z]/g, "");
  return (alpha + "smoke").slice(0, 8);
}
