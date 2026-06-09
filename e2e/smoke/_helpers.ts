import { $, $$, browser, expect } from "@wdio/globals";

export { editGridCellInRow } from "./grid-edit";

const LAUNCHER_MARKER_SELECTOR = '[aria-label="New Connection"]';
const WORKSPACE_MARKER_SELECTOR = '[aria-label="Back to connections"]';
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

export type DbType =
  | "postgresql"
  | "mongodb"
  | "mysql"
  | "mariadb"
  | "mssql"
  | "oracle"
  | "sqlite"
  | "duckdb"
  | "redis"
  | "elasticsearch"
  | "opensearch";
export type ConnectionEnvironment =
  | "local"
  | "testing"
  | "development"
  | "staging"
  | "production";

const ENVIRONMENT_LABELS: Record<ConnectionEnvironment, string> = {
  local: "Local",
  testing: "Testing",
  development: "Development",
  staging: "Staging",
  production: "Production",
};

export async function step<T>(label: string, action: () => Promise<T>) {
  console.log(`[e2e smoke] step: ${label}`);
  return await action();
}

export async function waitForLauncher() {
  await switchToLauncherWindow();
  await waitForDomSelector(LAUNCHER_MARKER_SELECTOR, 30000);
}

export async function switchToLauncherWindow(timeoutMs = 15000) {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    let handles: string[] = [];
    try {
      handles = await browser.getWindowHandles();
    } catch (e) {
      lastError = e;
    }
    for (const handle of handles) {
      try {
        await browser.switchToWindow(handle);
        if (await isLauncherDocument()) return;
      } catch (e) {
        lastError = e;
      }
    }
    await browser.pause(200);
  }
  throw new Error(
    `launcher window did not appear within ${timeoutMs}ms: ${String(lastError ?? "")}`,
  );
}

export async function switchToWorkspaceWindow(timeoutMs = 30000) {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    let handles: string[] = [];
    try {
      handles = await browser.getWindowHandles();
    } catch (e) {
      lastError = e;
    }
    for (const handle of handles) {
      try {
        await browser.switchToWindow(handle);
        if (await isWorkspaceDocument()) return;
      } catch (e) {
        lastError = e;
      }
    }
    await browser.pause(200);
  }
  throw new Error(
    `workspace window did not appear within ${timeoutMs}ms: ${String(lastError ?? "")}`,
  );
}

export async function openNewConnectionDialog() {
  await waitForLauncher();
  await clickDomSelector('[aria-label="New Connection"]');
  const dialog = await $(DIALOG_SELECTOR);
  await dialog.waitForDisplayed({ timeout: 10000 });
  return dialog;
}

async function isLauncherDocument() {
  return await hasDomSelector(LAUNCHER_MARKER_SELECTOR);
}

async function isWorkspaceDocument() {
  return await hasDomSelector(WORKSPACE_MARKER_SELECTOR);
}

async function hasDomSelector(selector: string) {
  return await browser.execute(
    (sel) => Boolean(document.querySelector(sel)),
    selector,
  );
}

async function waitForDomSelector(selector: string, timeout = 10000) {
  await browser.waitUntil(async () => await hasDomSelector(selector), {
    timeout,
    timeoutMsg: `${selector} did not appear in the DOM`,
  });
}

export async function clickDomSelector(selector: string) {
  await waitForDomSelector(selector);
  await browser.execute((sel) => {
    const element = document.querySelector<HTMLElement>(sel);
    if (!element) throw new Error(`${sel} did not appear in the DOM`);
    element.click();
  }, selector);
}

export async function selectDatabaseType(dbType: DbType) {
  const trigger = await $("#conn-db-type");
  await trigger.waitForDisplayed({ timeout: 5000 });
  const expected = dbTypeLabel(dbType);
  const current = await getDomText("#conn-db-type");
  if (current.includes(expected)) return;

  await trigger.click();
  await clickVisibleOption(expected);
  await browser.waitUntil(
    async () => (await getDomText("#conn-db-type")).includes(expected),
    {
      timeout: 5000,
      timeoutMsg: `Database Type did not switch to ${expected}`,
    },
  );
}

function dbTypeLabel(dbType: DbType): string {
  if (dbType === "postgresql") return "PostgreSQL";
  if (dbType === "mysql") return "MySQL";
  if (dbType === "mariadb") return "MariaDB";
  if (dbType === "mssql") return "Microsoft SQL Server";
  if (dbType === "oracle") return "Oracle";
  if (dbType === "sqlite") return "SQLite";
  if (dbType === "duckdb") return "DuckDB";
  if (dbType === "redis") return "Redis";
  if (dbType === "elasticsearch") return "Elasticsearch";
  if (dbType === "opensearch") return "OpenSearch";
  return "MongoDB";
}

async function getDomText(selector: string): Promise<string> {
  return await browser.execute((sel) => {
    return document.querySelector(sel)?.textContent ?? "";
  }, selector);
}

async function clickVisibleOption(label: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((text) => {
        return Array.from(
          document.querySelectorAll<HTMLElement>('[role="option"]'),
        ).some(
          (option) =>
            option.offsetParent !== null && option.textContent?.trim() === text,
        );
      }, label),
    {
      timeout: 5000,
      timeoutMsg: `${label} option did not appear in the open select`,
    },
  );

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

export async function selectConnectionEnvironment(
  environment: ConnectionEnvironment,
) {
  const trigger = await $("#conn-environment");
  await trigger.waitForDisplayed({ timeout: 5000 });
  const expected = ENVIRONMENT_LABELS[environment];
  const current = await getDomText("#conn-environment");
  if (current.includes(expected)) return;

  await trigger.click();
  await clickVisibleOption(expected);
  await browser.waitUntil(
    async () => (await getDomText("#conn-environment")).includes(expected),
    {
      timeout: 5000,
      timeoutMsg: `Environment did not switch to ${expected}`,
    },
  );
}

export async function createPostgresConnection(
  name = "E2E Postgres",
  environment?: ConnectionEnvironment,
) {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("postgresql");

  await setInput("#conn-name", name);
  if (environment) {
    await selectConnectionEnvironment(environment);
  }
  await setInput("#conn-host", process.env.E2E_PG_HOST ?? "localhost");
  await setInput(
    "#conn-port",
    process.env.E2E_PG_PORT ?? process.env.PGPORT ?? "15432",
  );
  await setInput("#conn-user", process.env.PGUSER ?? "testuser");
  await setInput("#conn-password", process.env.PGPASSWORD ?? "testpass");
  await setInput("#conn-database", process.env.PGDATABASE ?? "table_view_test");

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

export async function createMysqlConnection(
  name = "E2E MySQL",
  environment?: ConnectionEnvironment,
) {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("mysql");

  await setInput("#conn-name", name);
  if (environment) {
    await selectConnectionEnvironment(environment);
  }
  await setInput("#conn-host", process.env.E2E_MYSQL_HOST ?? "localhost");
  await setInput(
    "#conn-port",
    process.env.E2E_MYSQL_PORT ?? process.env.MYSQL_PORT ?? "13306",
  );
  await setInput("#conn-user", process.env.MYSQL_USER ?? "testuser");
  await setInput("#conn-password", process.env.MYSQL_PASSWORD ?? "testpass");
  await setInput(
    "#conn-database",
    process.env.MYSQL_DATABASE ?? "table_view_test",
  );

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

export async function createMariaDbConnection(
  name = "E2E MariaDB",
  environment?: ConnectionEnvironment,
) {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("mariadb");

  await setInput("#conn-name", name);
  if (environment) {
    await selectConnectionEnvironment(environment);
  }
  await setInput("#conn-host", process.env.E2E_MARIADB_HOST ?? "localhost");
  await setInput(
    "#conn-port",
    process.env.E2E_MARIADB_PORT ?? process.env.MARIADB_PORT ?? "23306",
  );
  await setInput("#conn-user", process.env.MARIADB_USER ?? "testuser");
  await setInput("#conn-password", process.env.MARIADB_PASSWORD ?? "testpass");
  await setInput(
    "#conn-database",
    process.env.MARIADB_DATABASE ?? "table_view_test",
  );

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

export async function createMssqlConnection(
  name = "E2E MSSQL",
  environment?: ConnectionEnvironment,
) {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("mssql");

  await setInput("#conn-name", name);
  if (environment) {
    await selectConnectionEnvironment(environment);
  }
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
  await setInput(
    "#conn-database",
    process.env.E2E_MSSQL_DATABASE ??
      process.env.MSSQL_DATABASE ??
      "table_view_test",
  );

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

export async function createOracleConnection(
  name = "E2E Oracle",
  environment?: ConnectionEnvironment,
) {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("oracle");

  await setInput("#conn-name", name);
  if (environment) {
    await selectConnectionEnvironment(environment);
  }
  await setInput("#conn-host", process.env.E2E_ORACLE_HOST ?? "localhost");
  await setInput(
    "#conn-port",
    process.env.E2E_ORACLE_PORT ?? process.env.ORACLE_PORT ?? "1521",
  );
  await setInput("#conn-user", process.env.ORACLE_USER ?? "testuser");
  await setInput("#conn-password", process.env.ORACLE_PASSWORD ?? "testpass");
  await setInput(
    "#conn-database",
    process.env.E2E_ORACLE_SERVICE ?? process.env.ORACLE_SERVICE ?? "XEPDB1",
  );

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

export async function createSqliteConnection(
  name: string,
  databasePath: string,
  opts: { readOnly?: boolean } = {},
) {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("sqlite");

  await setInput("#conn-name", name);
  await setInput("#conn-sqlite-path", databasePath);
  if (opts.readOnly === true) {
    const readOnly = await $('input[type="checkbox"]');
    await readOnly.waitForDisplayed({ timeout: 5000 });
    if (!(await readOnly.isSelected())) {
      await readOnly.click();
    }
  }

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

export async function createDuckdbConnection(
  name: string,
  databasePath: string,
  opts: { readOnly?: boolean } = {},
) {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("duckdb");

  await setInput("#conn-name", name);
  await setInput("#conn-sqlite-path", databasePath);
  if (opts.readOnly === true) {
    const readOnly = await $('input[type="checkbox"]');
    await readOnly.waitForDisplayed({ timeout: 5000 });
    if (!(await readOnly.isSelected())) {
      await readOnly.click();
    }
  }

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

export async function createMongoConnection(name = "E2E MongoDB") {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("mongodb");

  await setInput("#conn-name", name);
  await setInput("#conn-host", process.env.E2E_MONGO_HOST ?? "localhost");
  await setInput(
    "#conn-port",
    process.env.E2E_MONGO_PORT ?? process.env.MONGO_PORT ?? "37017",
  );
  await setInput("#conn-user", process.env.MONGO_USER ?? "testuser");
  await setInput("#conn-password", process.env.MONGO_PASSWORD ?? "testpass");
  await setInput(
    "#conn-database",
    process.env.E2E_MONGO_DB ?? "table_view_test",
  );
  await setInput("#conn-auth-source", process.env.E2E_MONGO_AUTH_DB ?? "admin");

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

export async function createRedisConnection(name = "E2E Redis") {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("redis");

  await setInput("#conn-name", name);
  await setInput("#conn-host", process.env.E2E_REDIS_HOST ?? "localhost");
  await setInput(
    "#conn-port",
    process.env.E2E_REDIS_PORT ?? process.env.REDIS_PORT ?? "6379",
  );
  const user = process.env.REDIS_USER ?? "";
  if (user) {
    await setInput("#conn-user", user);
  }
  const password = process.env.REDIS_PASSWORD ?? "";
  if (password) {
    await setInput("#conn-password", password);
  }
  await setInput("#conn-database", process.env.E2E_REDIS_DB ?? "2");

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

export async function createElasticsearchConnection(
  name = "E2E Elasticsearch",
) {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("elasticsearch");

  await setInput("#conn-name", name);
  await setInput(
    "#conn-host",
    process.env.E2E_ELASTICSEARCH_HOST ??
      process.env.ELASTICSEARCH_HOST ??
      "localhost",
  );
  await setInput(
    "#conn-port",
    process.env.E2E_ELASTICSEARCH_PORT ??
      process.env.ELASTICSEARCH_PORT ??
      "19200",
  );
  const user = process.env.ELASTICSEARCH_USER ?? "";
  if (user) {
    await setInput("#conn-user", user);
  }
  const password = process.env.ELASTICSEARCH_PASSWORD ?? "";
  if (password) {
    await setInput("#conn-password", password);
  }

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

export async function createOpenSearchConnection(name = "E2E OpenSearch") {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("opensearch");

  await setInput("#conn-name", name);
  await setInput(
    "#conn-host",
    process.env.E2E_OPENSEARCH_HOST ??
      process.env.OPENSEARCH_HOST ??
      "localhost",
  );
  await setInput(
    "#conn-port",
    process.env.E2E_OPENSEARCH_PORT ?? process.env.OPENSEARCH_PORT ?? "29200",
  );
  const user = process.env.OPENSEARCH_USER ?? "";
  if (user) {
    await setInput("#conn-user", user);
  }
  const password = process.env.OPENSEARCH_PASSWORD ?? "";
  if (password) {
    await setInput("#conn-password", password);
  }

  await saveConnectionDialog(dialog);
  await expectConnectionVisible(name);
}

async function setInput(selector: string, value: string) {
  const input = await $(selector);
  await input.waitForDisplayed({ timeout: 5000 });
  await browser.execute(
    (sel, nextValue) => {
      const element = document.querySelector<HTMLInputElement>(sel);
      if (!element) throw new Error(`${sel} input did not appear`);
      element.focus();

      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("HTMLInputElement value setter missing");

      setter.call(element, nextValue);
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur();
    },
    selector,
    value,
  );
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (sel, expected) =>
          document.querySelector<HTMLInputElement>(sel)?.value === expected,
        selector,
        value,
      ),
    {
      timeout: 5000,
      timeoutMsg: `${selector} did not receive expected value`,
    },
  );
}

async function saveConnectionDialog(dialog: WebdriverIO.Element) {
  await (await $("button=Save")).click();
  try {
    await dialog.waitForDisplayed({ timeout: 10000, reverse: true });
  } catch (e) {
    const alert = await $('[role="alert"]');
    if (await alert.isExisting()) {
      throw new Error(`connection save failed: ${await alert.getText()}`);
    }
    throw e;
  }
}

export async function expectConnectionVisible(name: string) {
  const row = await $(`[aria-label^="${name}"]`);
  await row.waitForDisplayed({ timeout: 10000 });
  expect(await row.getAttribute("aria-label")).toContain(name);
}

export async function openConnection(name: string) {
  await waitForLauncher();
  const row = await $(`[aria-label^="${name}"]`);
  await row.waitForDisplayed({ timeout: 10000 });
  await row.scrollIntoView();
  await browser.execute((el: HTMLElement) => {
    el.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
    );
  }, row);
  await switchToWorkspaceWindow();
  const back = await $(WORKSPACE_MARKER_SELECTOR);
  await back.waitForDisplayed({ timeout: 30000 });
}

export async function openNewQueryTab() {
  await switchToWorkspaceWindow();
  const newQuery = await $('[aria-label="New Query Tab"]');
  await newQuery.waitForDisplayed({ timeout: 10000 });
  await newQuery.click();
  const editor = await $(".cm-editor");
  await editor.waitForDisplayed({ timeout: 10000 });
}

export async function typeQuery(sql: string) {
  await switchToWorkspaceWindow();
  const content = await $(".cm-content");
  await content.waitForDisplayed({ timeout: 5000 });
  await content.click();
  const selectAllModifier = await browser.execute(() =>
    navigator.platform.toLowerCase().includes("mac") ? "Meta" : "Control",
  );
  await browser.keys([selectAllModifier, "a"]);
  await browser.keys("Backspace");
  await browser.waitUntil(
    async () =>
      await browser.execute(
        () => document.querySelector(".cm-content")?.textContent === "",
      ),
    {
      timeout: 5000,
      timeoutMsg: "SQL Query Editor did not clear before typing",
    },
  );
  for (const char of sql) {
    await browser.keys(char === "\n" ? "Enter" : char);
  }
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (expected) =>
          document.querySelector(".cm-content")?.textContent === expected,
        sql,
      ),
    {
      timeout: 5000,
      timeoutMsg: "SQL Query Editor did not receive the exact query text",
    },
  );
}

export async function runQuery() {
  await switchToWorkspaceWindow();
  const run = await $('[aria-label="Run query"]');
  await run.waitForDisplayed({ timeout: 5000 });
  await run.click();
}

export async function waitForGridText(
  snippets: string[],
  timeout: number,
  timeoutMsg: string,
) {
  await switchToWorkspaceWindow();
  const grid = await $('[role="grid"]');
  await grid.waitForDisplayed({ timeout });
  await browser.waitUntil(
    async () => {
      const text = (
        ((await grid.getProperty("textContent")) as string) ?? ""
      ).toLowerCase();
      return snippets.some((snippet) => text.includes(snippet.toLowerCase()));
    },
    {
      timeout,
      timeoutMsg,
    },
  );
  return grid;
}

export async function waitForGridTextAll(
  snippets: string[],
  timeout: number,
  timeoutMsg: string,
) {
  await switchToWorkspaceWindow();
  const grid = await $('[role="grid"]');
  await grid.waitForDisplayed({ timeout });
  await browser.waitUntil(
    async () => {
      const text = (
        ((await grid.getProperty("textContent")) as string) ?? ""
      ).toLowerCase();
      return snippets.every((snippet) => text.includes(snippet.toLowerCase()));
    },
    {
      timeout,
      timeoutMsg,
    },
  );
  return grid;
}

export async function waitForWorkspaceTextAll(
  snippets: string[],
  timeout: number,
  timeoutMsg: string,
) {
  const needles = snippets.map((snippet) => snippet.toLowerCase());
  await browser.waitUntil(
    async () => {
      for (const handle of await browser.getWindowHandles()) {
        await browser.switchToWindow(handle);
        if (!(await isWorkspaceDocument())) continue;
        const text = await browser.execute(
          () => document.body.textContent?.toLowerCase() ?? "",
        );
        if (needles.every((needle) => text.includes(needle))) return true;
      }
      return false;
    },
    { timeout, timeoutMsg },
  );
}

export async function executeSqlPreview() {
  await executePreviewAction("Execute SQL");
}

export async function waitForDialogTextAll(
  snippets: string[],
  timeout = 10000,
  timeoutMsg = "dialog text did not appear",
) {
  await switchToWorkspaceWindow();
  const dialog = await $(DIALOG_SELECTOR);
  await dialog.waitForDisplayed({ timeout });
  await browser.waitUntil(
    async () => {
      const text = (
        ((await dialog.getProperty("textContent")) as string) ?? ""
      ).toLowerCase();
      return snippets.every((snippet) => text.includes(snippet.toLowerCase()));
    },
    {
      timeout,
      timeoutMsg,
    },
  );
  return dialog;
}

export async function expectNoVisibleDialogText(text: string, timeout = 750) {
  await switchToWorkspaceWindow();
  await browser.pause(timeout);
  const visible = await browser.execute(
    (needle, dialogSelector) => {
      return Array.from(document.querySelectorAll<HTMLElement>(dialogSelector))
        .filter((dialog) => {
          const style = window.getComputedStyle(dialog);
          return (
            dialog.getClientRects().length > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        })
        .some((dialog) =>
          (dialog.textContent ?? "")
            .toLowerCase()
            .includes(needle.toLowerCase()),
        );
    },
    text,
    DIALOG_SELECTOR,
  );
  expect(visible).toBe(false);
}

export async function clickDialogAction(ariaLabel: string, timeout = 10000) {
  await switchToWorkspaceWindow();
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (label, dialogSelector) => {
          return findVisibleDialogButton(label) !== null;

          function findVisibleDialogButton(label: string): HTMLElement | null {
            const dialogs = Array.from(
              document.querySelectorAll<HTMLElement>(dialogSelector),
            );
            for (const dialog of dialogs) {
              if (!isVisible(dialog)) continue;
              const button = Array.from(
                dialog.querySelectorAll<HTMLElement>("[aria-label]"),
              ).find(
                (candidate) =>
                  candidate.getAttribute("aria-label") === label &&
                  isVisible(candidate) &&
                  candidate.getAttribute("aria-disabled") !== "true",
              );
              if (button) return button;
            }
            return null;
          }

          function isVisible(element: HTMLElement) {
            const style = window.getComputedStyle(element);
            return (
              element.getClientRects().length > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
            );
          }
        },
        ariaLabel,
        DIALOG_SELECTOR,
      ),
    {
      timeout,
      timeoutMsg: `${ariaLabel} dialog action did not appear`,
    },
  );
  await browser.execute(
    (label, dialogSelector) => {
      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>(dialogSelector),
      );
      for (const dialog of dialogs) {
        if (!isVisible(dialog)) continue;
        const button = Array.from(
          dialog.querySelectorAll<HTMLElement>("[aria-label]"),
        ).find(
          (candidate) =>
            candidate.getAttribute("aria-label") === label &&
            isVisible(candidate),
        );
        if (button) {
          button.click();
          return;
        }
      }
      throw new Error(`${label} dialog action did not appear`);

      function isVisible(element: HTMLElement) {
        const style = window.getComputedStyle(element);
        return (
          element.getClientRects().length > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      }
    },
    ariaLabel,
    DIALOG_SELECTOR,
  );
}

export async function executeMqlPreview() {
  await executePreviewAction("Execute MQL commands");
}

async function executePreviewAction(ariaLabel: string) {
  await switchToWorkspaceWindow();
  const execute = await $(`[aria-label="${ariaLabel}"]`);
  await execute.waitForDisplayed({ timeout: 10000 });
  await browser.execute((label) => {
    const button = Array.from(
      document.querySelectorAll<HTMLElement>("[aria-label]"),
    ).find((candidate) => candidate.getAttribute("aria-label") === label);
    if (!button) throw new Error(`${label} button did not appear`);
    button.click();
  }, ariaLabel);
  await browser.waitUntil(
    async () => {
      const previewActions = await $$(`[aria-label="${ariaLabel}"]`);
      return previewActions.length === 0;
    },
    {
      timeout: 15000,
      timeoutMsg: `${ariaLabel} preview did not close after execution`,
    },
  );
}

export async function expandIfCollapsed(selector: string, timeout = 10000) {
  await switchToWorkspaceWindow();
  const node = await $(selector);
  await node.waitForDisplayed({ timeout });
  if ((await node.getAttribute("aria-expanded")) !== "true") {
    await node.click();
  }
}
