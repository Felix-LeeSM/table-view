import { $, browser, expect } from "@wdio/globals";

const WORKSPACE_TITLE = "Table View — Workspace";

export type DbType = "postgresql" | "mongodb";

export async function waitForLauncher() {
  await switchToLauncherWindow();
  await waitForDomSelector('[aria-label="New Connection"]', 30000);
}

export async function switchToLauncherWindow(timeoutMs = 15000) {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const handles = await browser.getWindowHandles();
      for (const handle of handles) {
        await browser.switchToWindow(handle);
        const title = await browser.getTitle();
        if (title === "Table View") return;
      }
    } catch (e) {
      lastError = e;
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
    try {
      const handles = await browser.getWindowHandles();
      for (const handle of handles) {
        await browser.switchToWindow(handle);
        const title = await browser.getTitle();
        if (title === WORKSPACE_TITLE) return;
      }
    } catch (e) {
      lastError = e;
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
  const dialog = await $('[role="dialog"]');
  await dialog.waitForDisplayed({ timeout: 10000 });
  return dialog;
}

async function waitForDomSelector(selector: string, timeout = 10000) {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (sel) => Boolean(document.querySelector(sel)),
        selector,
      ),
    {
      timeout,
      timeoutMsg: `${selector} did not appear in the DOM`,
    },
  );
}

async function clickDomSelector(selector: string) {
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
  return dbType === "postgresql" ? "PostgreSQL" : "MongoDB";
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

export async function createPostgresConnection(name = "E2E Postgres") {
  const dialog = await openNewConnectionDialog();
  await selectDatabaseType("postgresql");

  await setInput("#conn-name", name);
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

async function setInput(selector: string, value: string) {
  const input = await $(selector);
  await input.waitForDisplayed({ timeout: 5000 });
  await input.clearValue();
  await input.setValue(value);
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
  const back = await $('[aria-label="Back to connections"]');
  await back.waitForDisplayed({ timeout: 30000 });
}

export async function openNewQueryTab() {
  const newQuery = await $('[aria-label="New Query Tab"]');
  await newQuery.waitForDisplayed({ timeout: 10000 });
  await newQuery.click();
  const editor = await $(".cm-editor");
  await editor.waitForDisplayed({ timeout: 10000 });
}

export async function typeQuery(sql: string) {
  const content = await $(".cm-content");
  await content.waitForDisplayed({ timeout: 5000 });
  await content.click();
  await browser.keys(sql);
}

export async function runQuery() {
  const run = await $('[aria-label="Run query"]');
  await run.waitForDisplayed({ timeout: 5000 });
  await run.click();
}

export async function waitForGridText(
  snippets: string[],
  timeout: number,
  timeoutMsg: string,
) {
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

export async function expandIfCollapsed(selector: string, timeout = 10000) {
  const node = await $(selector);
  await node.waitForDisplayed({ timeout });
  if ((await node.getAttribute("aria-expanded")) !== "true") {
    await node.click();
  }
}
