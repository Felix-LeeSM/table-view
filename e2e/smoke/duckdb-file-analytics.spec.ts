import { $, browser, expect } from "@wdio/globals";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createDuckdbConnection,
  openConnection,
  openNewQueryTab,
  runQuery,
  smokeFixtureRoot,
  step,
  switchToLauncherWindow,
  switchToWorkspaceWindow,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";
import { prepareDuckdbFixture } from "./duckdb-fixture";
import { waitForTabHistoryStatuses } from "./query-history-helpers";

const CONNECTION_NAME = "E2E DuckDB File Analytics";
const SALES_CSV_PATH = resolve("e2e/fixtures/duckdb/file-analytics/sales.csv");

type PublicConnection = {
  id: string;
  name: string;
};

type FileAnalyticsSource = {
  id: string;
  alias: string;
  fileName: string;
  kind: string;
  sizeBytes: number;
};

type FileAnalyticsSourceMetadata = {
  source: FileAnalyticsSource;
  columns: Array<{ name: string; dataType: string }>;
  previewSql: string;
};

describe("DuckDB file analytics smoke", () => {
  it("registers a local CSV source, queries the alias, records FILE history, and hides absolute paths", async () => {
    const duckdbPath = resolve(
      smokeFixtureRoot(testDataDir()),
      "duckdb",
      "file_analytics_e2e.duckdb",
    );
    let connection: PublicConnection;
    let source: FileAnalyticsSource;

    await step("verify deterministic CSV source fixture exists", async () => {
      if (!existsSync(SALES_CSV_PATH)) {
        throw new Error(
          `Missing deterministic DuckDB file analytics fixture: ${SALES_CSV_PATH}`,
        );
      }
    });

    await step("prepare deterministic DuckDB fixture file", async () => {
      await prepareDuckdbFixture(duckdbPath);
    });

    await step("create DuckDB file connection and open workspace", async () => {
      await waitForLauncher();
      await createDuckdbConnection(CONNECTION_NAME, duckdbPath);
      await openConnection(CONNECTION_NAME);
    });

    await step("register CSV source through Tauri command", async () => {
      connection = await findConnectionByName(CONNECTION_NAME);
      source = await invokeTauri<FileAnalyticsSource>(
        "duckdb_register_file_analytics_source",
        {
          connectionId: connection.id,
          path: SALES_CSV_PATH,
        },
      );

      expect(source.fileName).toBe("sales.csv");
      expect(source.kind).toBe("csv");
      await assertAbsolutePathNotVisible(SALES_CSV_PATH);
    });

    await step("list registered source metadata through Tauri", async () => {
      const metadata = await invokeTauri<FileAnalyticsSourceMetadata[]>(
        "duckdb_list_file_analytics_source_metadata",
        { connectionId: connection.id },
      );
      const registered = metadata.find(
        (item) => item.source.alias === source.alias,
      );

      expect(registered?.source.fileName).toBe("sales.csv");
      expect(registered?.previewSql).toContain(source.alias);
    });

    await step("reopen workspace so schema tree lists the source", async () => {
      await returnToLauncher();
      await openConnection(CONNECTION_NAME);
      await waitForFileSourceVisible(source.alias, "sales.csv");
      await assertAbsolutePathNotVisible(SALES_CSV_PATH);
    });

    await step(
      "run global editor SELECT against registered alias",
      async () => {
        const sql =
          `SELECT region, SUM(quantity) AS total_quantity FROM "${source.alias}" ` +
          "WHERE region = 'North' GROUP BY region";
        await openNewQueryTab();
        await typeQuery(sql);
        await runQuery();

        const resultGrid = await waitForGridTextAll(
          ["total_quantity", "North", "4"],
          15000,
          "DuckDB file analytics SELECT result did not render",
        );
        expect(await resultGrid.isDisplayed()).toBe(true);
        await waitForWorkspaceTextAll(
          ["SELECT", "1 row"],
          15000,
          "DuckDB file analytics SELECT row-count evidence did not render",
        );
        await waitForTabHistoryStatuses(["success"]);
        await waitForFileAnalyticsHistory("total_quantity", "sales.csv");
        await assertAbsolutePathNotVisible(SALES_CSV_PATH);
      },
    );
  });
});

function testDataDir(): string {
  return (
    process.env.TABLE_VIEW_TEST_DATA_DIR ??
    resolve(tmpdir(), "table-view-smoke", "duckdb-file-analytics")
  );
}

async function findConnectionByName(name: string): Promise<PublicConnection> {
  const connections = await invokeTauri<PublicConnection[]>("list_connections");
  const connection = connections.find((item) => item.name === name);
  if (!connection) {
    throw new Error(`${name} connection was not persisted`);
  }
  return connection;
}

async function returnToLauncher() {
  await switchToWorkspaceWindow();
  const back = await $('[aria-label="Back to connections"]');
  await back.waitForDisplayed({ timeout: 10000 });
  await back.click();
  await switchToLauncherWindow();
}

async function waitForFileSourceVisible(
  alias: string,
  fileName: string,
  timeout = 15000,
) {
  await switchToWorkspaceWindow();
  await browser.waitUntil(
    async () =>
      await browser.execute(
        ({ expectedAlias, expectedFileName }) => {
          return Array.from(
            document.querySelectorAll<HTMLElement>('[aria-label$=" source"]'),
          ).some((row) => {
            const text = row.innerText ?? "";
            return (
              row.getAttribute("aria-label") === `${expectedAlias} source` &&
              text.includes(expectedAlias) &&
              text.includes(expectedFileName)
            );
          });
        },
        { expectedAlias: alias, expectedFileName: fileName },
      ),
    {
      timeout,
      timeoutMsg: `DuckDB file source ${alias} did not appear in schema tree`,
    },
  );
}

async function waitForFileAnalyticsHistory(
  queryFragment: string,
  fileName: string,
  timeout = 15000,
) {
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
    async () =>
      await browser.execute(
        ({ expectedFragment, expectedFileName }) => {
          document
            .querySelector<HTMLElement>('[data-testid="global-log-new-entry"]')
            ?.click();
          const panel = document.querySelector<HTMLElement>(
            '[data-testid="global-query-log-panel"]',
          );
          if (!panel) return false;
          const text = (panel.textContent ?? "").toLowerCase();
          const badge = panel.querySelector<HTMLElement>(
            '[data-source="file-analytics"]',
          );
          return (
            Boolean(badge) &&
            text.includes(expectedFragment.toLowerCase()) &&
            text.includes(expectedFileName.toLowerCase())
          );
        },
        { expectedFragment: queryFragment, expectedFileName: fileName },
      ),
    {
      timeout,
      timeoutMsg: `global query log missing file-analytics evidence for ${queryFragment}`,
    },
  );
}

async function assertAbsolutePathNotVisible(absolutePath: string) {
  await switchToWorkspaceWindow();
  const visibleText = await browser.execute(
    () => document.body.innerText ?? "",
  );
  expect(visibleText).not.toContain(absolutePath);
}

async function invokeTauri<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  await switchToWorkspaceWindow();
  const result = (await browser.executeAsync(
    (cmd, payload, done) => {
      const invoke = (
        window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke?: (
              command: string,
              args?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__?.invoke;
      if (!invoke) {
        done({
          ok: false,
          error: "Tauri invoke bridge is not available in this window.",
        });
        return;
      }
      invoke(cmd, payload)
        .then((data) => done({ ok: true, data }))
        .catch((error) =>
          done({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    },
    command,
    args,
  )) as { ok: true; data: T } | { ok: false; error: string };

  if (result.ok) return result.data;
  throw new Error(result.error);
}
