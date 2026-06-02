import { $, browser, expect } from "@wdio/globals";
import duckdb, {
  type Connection as NativeDuckdbConnection,
  type Database as NativeDuckdbDatabase,
} from "duckdb";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createDuckdbConnection,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  switchToLauncherWindow,
  switchToWorkspaceWindow,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

const WRITABLE_CONNECTION = "E2E DuckDB";
const READ_ONLY_CONNECTION = "E2E DuckDB Read Only";

describe("DuckDB file workflow smoke", () => {
  it("covers .duckdb open, catalog browse, SELECT result/history, and read-only write rejection", async () => {
    const dataDir = testDataDir();
    const duckdbPath = resolve(
      dataDir,
      "fixtures",
      "duckdb",
      "table_view_e2e.duckdb",
    );

    await step("prepare deterministic DuckDB fixture file", async () => {
      await prepareDuckdbFixture(duckdbPath);
    });

    await step("create DuckDB file connection and open workspace", async () => {
      await waitForLauncher();
      await createDuckdbConnection(WRITABLE_CONNECTION, duckdbPath);
      await openConnection(WRITABLE_CONNECTION);
    });

    await step("browse seeded users table", async () => {
      const usersTable = await $('[aria-label="users table"]');
      await usersTable.waitForDisplayed({ timeout: 15000 });
      await usersTable.click();

      await waitForGridTextAll(
        ["alice@example.com"],
        15000,
        "seeded DuckDB users row did not appear in grid",
      );
    });

    await step(
      "run raw SELECT and verify tabular result envelope",
      async () => {
        await openNewQueryTab();
        await typeQuery(
          "SELECT email AS duckdb_email FROM core.users WHERE name = 'Alice'",
        );
        await runQuery();

        const resultGrid = await waitForGridTextAll(
          ["duckdb_email", "alice@example.com"],
          15000,
          "DuckDB SELECT result did not render through the tabular grid",
        );
        expect(await resultGrid.isDisplayed()).toBe(true);
        await waitForWorkspaceTextAll(
          ["SELECT", "1 row"],
          15000,
          "DuckDB SELECT result envelope did not render row-count evidence",
        );
      },
    );

    await step("verify query history records the DuckDB SELECT", async () => {
      await waitForTabHistoryStatuses(["success"]);
      await waitForGlobalHistoryEvidence(["SELECT email AS duckdb_email"]);
    });

    await step("read-only connection rejects writes", async () => {
      await returnToLauncher();
      await createDuckdbConnection(READ_ONLY_CONNECTION, duckdbPath, {
        readOnly: true,
      });
      await openConnection(READ_ONLY_CONNECTION);
      await openNewQueryTab();
      await typeQuery(
        "INSERT INTO core.products (id, name, price) VALUES (99, 'read only rejected', 1.23)",
      );
      await runQuery();

      await waitForWorkspaceTextAll(
        ["read-only"],
        15000,
        "DuckDB read-only write rejection did not render",
      );
    });
  });
});

function testDataDir(): string {
  return (
    process.env.TABLE_VIEW_TEST_DATA_DIR ??
    resolve(tmpdir(), "table-view-smoke", "duckdb")
  );
}

async function prepareDuckdbFixture(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  rmSync(`${path}.wal`, { force: true });

  const sql = readFileSync(resolve("e2e/fixtures/seed.duckdb.sql"), "utf-8");
  const database = new duckdb.Database(path);
  const connection = database.connect();

  try {
    for (const statement of splitSqlStatements(sql)) {
      await runDuckdb(connection, statement);
    }
  } finally {
    await closeDuckdb(connection, database);
  }
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function runDuckdb(
  connection: NativeDuckdbConnection,
  sql: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    connection.run(sql, (err) => {
      if (err) reject(new Error(err.message ?? String(err)));
      else resolve();
    });
  });
}

async function closeDuckdb(
  connection: NativeDuckdbConnection,
  database: NativeDuckdbDatabase,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    connection.close((err) => {
      if (err) reject(new Error(err.message ?? String(err)));
      else resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    database.close((err) => {
      if (err) reject(new Error(err.message ?? String(err)));
      else resolve();
    });
  });
}

async function waitForTabHistoryStatuses(statuses: string[]) {
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

async function waitForGlobalHistoryEvidence(rawFragments: string[]) {
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
        return expectedFragments.every((fragment) =>
          bodyText.includes(fragment),
        );
      }, rawFragments);
    },
    {
      timeout: 15000,
      timeoutMsg: `global query log missing raw entries: ${rawFragments.join(
        ", ",
      )}`,
    },
  );
}

async function returnToLauncher() {
  const back = await $('[aria-label="Back to connections"]');
  await back.waitForDisplayed({ timeout: 10000 });
  await back.click();
  await switchToLauncherWindow();
}
