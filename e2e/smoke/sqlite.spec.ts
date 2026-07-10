import { $, browser, expect } from "@wdio/globals";
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createSqliteConnection,
  editGridCellInRow,
  executeSqlPreview,
  openConnection,
  openNewConnectionDialog,
  openNewQueryTab,
  runQuery,
  selectDatabaseType,
  smokeFixtureRoot,
  step,
  switchToLauncherWindow,
  switchToWorkspaceWindow,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

const WRITABLE_CONNECTION = "E2E SQLite";
const READ_ONLY_CONNECTION = "E2E SQLite Read Only";

describe("SQLite file workflow smoke", () => {
  it("covers file create/open, browse, read query, DML, row edit, and guardrail rejection", async () => {
    const dataDir = testDataDir();
    const sqlitePath = resolve(
      smokeFixtureRoot(dataDir),
      "sqlite",
      "table_view_e2e.sqlite",
    );
    const stateDbPath = resolve(dataDir, "state.db");
    const editedName = `Alice SQLite Smoke ${Date.now()}`;
    const smokeProductName = `SQLite Smoke Product ${Date.now()}`;
    const createdTableName = `structured_sqlite_${Date.now()}`;
    const readOnlyTableName = `readonly_sqlite_${Date.now()}`;

    await step("prepare deterministic SQLite fixture file", async () => {
      prepareSqliteFixture(sqlitePath);
    });

    await step("create SQLite file connection and open workspace", async () => {
      await waitForLauncher();
      await createSqliteConnection(WRITABLE_CONNECTION, sqlitePath);
      await openConnection(WRITABLE_CONNECTION);
    });

    await step("browse seeded users table", async () => {
      const usersTable = await $('[aria-label="users table"]');
      await usersTable.waitForDisplayed({ timeout: 15000 });
      await usersTable.click();

      await waitForGridTextAll(
        ["alice@example.com"],
        15000,
        "seeded SQLite users row did not appear in grid",
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

    await step("verify row edit through SELECT result grid", async () => {
      await openNewQueryTab();
      await typeQuery(
        "SELECT name AS edited_name FROM users WHERE email = 'alice@example.com'",
      );
      await runQuery();

      const resultGrid = await waitForGridTextAll(
        ["edited_name", editedName],
        15000,
        "committed SQLite edit did not appear in SELECT result grid",
      );
      expect(await resultGrid.isDisplayed()).toBe(true);
    });

    await step("execute writable DML batch and verify rows", async () => {
      await typeQuery(
        [
          `INSERT INTO products (name, price) VALUES ('${smokeProductName} A', 29.99)`,
          `INSERT INTO products (name, price) VALUES ('${smokeProductName} B', 24.99)`,
        ].join("; "),
      );
      await runQuery();

      await waitForWorkspaceTextAll(
        ["Statement 1 DML", "Statement 2 DML", "row affected"],
        15000,
        "SQLite DML batch did not render per-statement result evidence",
      );

      await typeQuery(
        `SELECT name, price FROM products WHERE name IN ('${smokeProductName} A', '${smokeProductName} B') ORDER BY name`,
      );
      await runQuery();
      await waitForGridTextAll(
        [
          "name",
          "price",
          `${smokeProductName} A`,
          `${smokeProductName} B`,
          "29.99",
          "24.99",
        ],
        15000,
        "SQLite DML batch result was not visible through a follow-up SELECT",
      );
    });

    await step("create table through SQLite structured DDL", async () => {
      await clickAria("Create table in main");
      await waitForVisibleText("Create Table", 10000);

      await setInputByAria("Table name", createdTableName);
      await setNthInputByAria("Column name", 0, "id");
      await setNthInputByAria("Column data type", 0, "INTEGER");
      await clickAria("Add column");
      await setNthInputByAria("Column name", 1, "label");
      await setNthInputByAria("Column data type", 1, "TEXT");

      await waitForDdlPreview([createdTableName, "CREATE TABLE"]);
      await clickEnabledButtonText("Execute");
      await waitUntilTextGone("Create Table", 20000);

      const createdTable = await $(`[aria-label="${createdTableName} table"]`);
      await createdTable.waitForDisplayed({
        timeout: 20000,
        timeoutMsg: `${createdTableName} table did not appear after SQLite create_table_plan refresh`,
      });
      expect(await createdTable.isDisplayed()).toBe(true);
    });

    await step("read-only connection rejects writes", async () => {
      await returnToLauncher();
      await createSqliteConnection(READ_ONLY_CONNECTION, sqlitePath, {
        readOnly: true,
      });
      await openConnection(READ_ONLY_CONNECTION);
      await openNewQueryTab();
      await typeQuery(
        "INSERT INTO products (name, price) VALUES ('read only rejected', 1.23)",
      );
      await runQuery();

      await waitForWorkspaceTextAll(
        ["read-only SQLite connection"],
        15000,
        "SQLite read-only write rejection did not render",
      );
    });

    await step(
      "read-only connection rejects structured table creation",
      async () => {
        await clickAria("Create table in main");
        await waitForVisibleText("Create Table", 10000);

        await setInputByAria("Table name", readOnlyTableName);
        await setNthInputByAria("Column name", 0, "name");
        await setNthInputByAria("Column data type", 0, "TEXT");
        await waitForDdlPreview([readOnlyTableName, "CREATE TABLE"]);
        await clickEnabledButtonText("Execute");

        await waitForWorkspaceTextAll(
          ["read-only SQLite connection"],
          15000,
          "SQLite read-only structured create-table rejection did not render",
        );
        await clickEnabledButtonText("Cancel");
        await waitUntilTextGone("Create Table", 10000);
      },
    );

    await step("internal app-state SQLite path is rejected", async () => {
      await returnToLauncher();
      const dialog = await openNewConnectionDialog();
      await selectDatabaseType("sqlite");
      await setInput("#conn-name", "E2E SQLite App State Rejected");
      await setInput("#conn-sqlite-path", stateDbPath);
      await (await $("button=Test Connection")).click();
      await waitForElementTextAll(
        dialog,
        ["internal app SQLite state"],
        15000,
        "internal app SQLite state rejection did not appear",
      );
      await (await $("button=Cancel")).click();
      await dialog.waitForDisplayed({ timeout: 10000, reverse: true });
    });
  });
});

function testDataDir(): string {
  return (
    process.env.TABLE_VIEW_TEST_DATA_DIR ??
    resolve(tmpdir(), "table-view-smoke", "sqlite")
  );
}

function prepareSqliteFixture(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });

  const sql = readFileSync(
    resolve("e2e/fixtures/sqlite/query/seed.sql"),
    "utf-8",
  );
  const db = new Database(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

async function returnToLauncher() {
  await switchToWorkspaceWindow();
  const back = await $('[aria-label="Back to connections"]');
  await back.waitForDisplayed({ timeout: 10000 });
  try {
    await back.click();
  } catch (error) {
    if (!String(error).toLowerCase().includes("no such window")) {
      throw error;
    }
  }
  await switchToLauncherWindow();
}

async function waitForElementTextAll(
  element: WebdriverIO.Element,
  snippets: string[],
  timeout: number,
  timeoutMsg: string,
) {
  await browser.waitUntil(
    async () => {
      const text = (await element.getText()).toLowerCase();
      return snippets.every((snippet) => text.includes(snippet.toLowerCase()));
    },
    { timeout, timeoutMsg },
  );
}

async function setInput(selector: string, value: string) {
  const input = await $(selector);
  await input.waitForDisplayed({ timeout: 5000 });
  await input.clearValue();
  await input.setValue(value);
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
