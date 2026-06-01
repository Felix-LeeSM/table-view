import { $, browser, expect } from "@wdio/globals";
import {
  editGridCellInRow,
  executeSqlPreview,
  expandIfCollapsed,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  switchToWorkspaceWindow,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

interface MysqlFamilySmokeOptions {
  dbLabel: "MySQL" | "MariaDB";
  connectionName: string;
  database: string;
  retryAlias: string;
  createConnection: (name: string) => Promise<void>;
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

async function waitForGlobalHistoryEvidence({
  sourceBadges,
  rawFragments,
}: {
  sourceBadges: string[];
  rawFragments: string[];
}) {
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
      return await browser.execute(
        ({ expectedBadges, expectedFragments }) => {
          const bodyText = document.body.textContent ?? "";
          const badgesReady = expectedBadges.every((source) =>
            Boolean(document.querySelector(`[data-source="${source}"]`)),
          );
          const rawEntriesReady = expectedFragments.every((fragment) =>
            bodyText.includes(fragment),
          );
          return badgesReady && rawEntriesReady;
        },
        { expectedBadges: sourceBadges, expectedFragments: rawFragments },
      );
    },
    {
      timeout: 15000,
      timeoutMsg: `global query log missing source badges (${sourceBadges.join(
        ", ",
      )}) or raw entries (${rawFragments.join(", ")})`,
    },
  );
}

async function openSeededUsersTable(database: string, dbLabel: string) {
  await expandIfCollapsed(`[aria-label="Tables in ${database}"]`, 30000);

  const usersTable = await $('[aria-label="users table"]');
  await usersTable.waitForDisplayed({ timeout: 10000 });
  await usersTable.click();

  await waitForGridTextAll(
    ["alice@example.com"],
    15000,
    `seeded ${dbLabel} users row did not appear in grid`,
  );
}

async function clickVisibleTab(label: string) {
  await switchToWorkspaceWindow();
  await browser.waitUntil(
    async () =>
      await browser.execute((expectedLabel) => {
        const tab = Array.from(
          document.querySelectorAll<HTMLElement>('[role="tab"]'),
        ).find(
          (candidate) =>
            candidate.offsetParent !== null &&
            candidate.textContent?.trim() === expectedLabel,
        );
        if (!tab) return false;
        tab.click();
        return true;
      }, label),
    {
      timeout: 10000,
      timeoutMsg: `${label} tab did not appear in the workspace`,
    },
  );
}

async function browseMariaDbCatalogMetadata(database: string) {
  await expandIfCollapsed(`[aria-label="Tables in ${database}"]`, 30000);

  const probeTable = await $('[aria-label="catalog_metadata_probe table"]');
  await probeTable.waitForDisplayed({ timeout: 10000 });

  const viewsCategory = await $(`[aria-label="Views in ${database}"]`);
  await viewsCategory.waitForDisplayed({ timeout: 10000 });
  await viewsCategory.click();
  const activeUsersView = await $('[aria-label="active_mariadb_users view"]');
  await activeUsersView.waitForDisplayed({ timeout: 10000 });

  const functionsCategory = await $(`[aria-label="Functions in ${database}"]`);
  await functionsCategory.waitForDisplayed({ timeout: 10000 });
  await functionsCategory.click();
  const taxRateFunction = await $('[aria-label="mariadb_tax_rate function"]');
  await taxRateFunction.waitForDisplayed({ timeout: 10000 });

  const proceduresCategory = await $(
    `[aria-label="Procedures in ${database}"]`,
  );
  await proceduresCategory.waitForDisplayed({ timeout: 10000 });
  await proceduresCategory.click();
  const catalogPingProcedure = await $(
    '[aria-label="mariadb_catalog_ping function"]',
  );
  await catalogPingProcedure.waitForDisplayed({ timeout: 10000 });

  await probeTable.click();
  await waitForGridTextAll(
    ["mariadb-catalog-probe", "12.34"],
    15000,
    "MariaDB catalog metadata probe row did not appear in grid",
  );

  await clickVisibleTab("Structure");
  await waitForWorkspaceTextAll(
    ["amount", "decimal", "user_id"],
    15000,
    "MariaDB catalog probe columns did not appear in Structure view",
  );

  await clickVisibleTab("Indexes");
  await waitForWorkspaceTextAll(
    [
      "uq_mariadb_catalog_probe_code",
      "ix_mariadb_catalog_probe_user",
      "code",
      "user_id",
    ],
    15000,
    "MariaDB catalog probe indexes did not appear in Structure view",
  );

  await clickVisibleTab("Constraints");
  await waitForWorkspaceTextAll(
    ["fk_mariadb_catalog_probe_user", "FOREIGN KEY", "users(id)"],
    15000,
    "MariaDB catalog probe FK constraint did not appear in Structure view",
  );
}

export function defineMysqlFamilySmoke({
  dbLabel,
  connectionName,
  database,
  retryAlias,
  createConnection,
}: MysqlFamilySmokeOptions) {
  describe(`${dbLabel} smoke`, () => {
    it("covers connect, browse, SELECT, DML batch, row edit, cancellation, and history evidence", async () => {
      const editedName = `Alice ${dbLabel} Smoke ${Date.now()}`;
      const smokeProductName = `${dbLabel} Smoke Product ${Date.now()}`;

      await step(
        `create ${dbLabel} connection and open workspace`,
        async () => {
          await waitForLauncher();
          await createConnection(connectionName);
          await openConnection(connectionName);
        },
      );

      if (dbLabel === "MariaDB") {
        await step(
          "browse MariaDB catalog metadata categories and table structure",
          async () => {
            await browseMariaDbCatalogMetadata(database);
          },
        );
      }

      await step("browse seeded users table", async () => {
        await openSeededUsersTable(database, dbLabel);
      });

      await step(
        "edit Alice name cell and execute the SQL preview",
        async () => {
          await editGridCellInRow(
            "alice@example.com",
            2,
            editedName,
            "Editing name",
          );

          const commit = await $('[aria-label="Commit changes"]');
          await commit.click();
          await executeSqlPreview();
        },
      );

      await step("verify row edit through SELECT result grid", async () => {
        await openNewQueryTab();
        await typeQuery(
          "SELECT name AS edited_name FROM users WHERE email = 'alice@example.com'",
        );
        await runQuery();

        const resultGrid = await waitForGridTextAll(
          ["edited_name", editedName],
          15000,
          `committed ${dbLabel} edit did not appear in SELECT result grid`,
        );

        expect(await resultGrid.isDisplayed()).toBe(true);
      });

      await step(
        "execute DML batch and verify tabular result envelope",
        async () => {
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
            `${dbLabel} DML batch did not render per-statement DML result evidence`,
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
            `${dbLabel} DML batch result was not visible through a follow-up SELECT`,
          );
        },
      );

      await step(
        `cancel a long ${dbLabel} query and retry cleanly`,
        async () => {
          await typeQuery("SELECT SLEEP(20) AS cancelled_sleep");
          await runQuery();

          const cancel = await $('[aria-label="Cancel query"]');
          await cancel.waitForDisplayed({ timeout: 5000 });
          await cancel.click();

          const cancelledState = await $(
            '[data-testid="query-cancelled-state"]',
          );
          await cancelledState.waitForDisplayed({ timeout: 10000 });
          expect(await cancelledState.getText()).toContain("Query cancelled");

          await browser.waitUntil(
            async () =>
              await browser.execute(
                () => document.querySelector('[role="grid"]') === null,
              ),
            {
              timeout: 5000,
              timeoutMsg: `cancelled ${dbLabel} query left a stale result grid visible`,
            },
          );
          await waitForTabHistoryStatuses(["cancelled"]);

          await typeQuery(`SELECT 7 AS ${retryAlias}`);
          await runQuery();
          await waitForGridTextAll(
            [retryAlias, "7"],
            15000,
            `fast ${dbLabel} retry result did not render after cancellation`,
          );
          await waitForTabHistoryStatuses(["cancelled", "success"]);
        },
      );

      await step("verify query history source labels", async () => {
        await waitForGlobalHistoryEvidence({
          sourceBadges: ["sidebar-prefetch", "grid-edit"],
          rawFragments: [`SELECT 7 AS ${retryAlias}`],
        });
      });
    });
  });
}
