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
  step,
  switchToLauncherWindow,
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
      dataDir,
      "fixtures",
      "sqlite",
      "table_view_e2e.sqlite",
    );
    const stateDbPath = resolve(dataDir, "state.db");
    const editedName = `Alice SQLite Smoke ${Date.now()}`;
    const smokeProductName = `SQLite Smoke Product ${Date.now()}`;

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

  const sql = readFileSync(resolve("e2e/fixtures/seed.sqlite.sql"), "utf-8");
  const db = new Database(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

async function returnToLauncher() {
  const back = await $('[aria-label="Back to connections"]');
  await back.waitForDisplayed({ timeout: 10000 });
  await back.click();
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
