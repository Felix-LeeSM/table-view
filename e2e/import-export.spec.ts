import { expect } from "@wdio/globals";

/**
 * Phase C-2 — ImportExportDialog smoke tests.
 *
 * Covers the user-reported scenario where opening the dialog and clicking
 * "Generate JSON" must NOT freeze the app, and verifies the export payload
 * is well-formed and password-free.
 *
 * The dialog is reachable from the Sidebar's connections-mode header only.
 */

async function ensureConnectionsMode() {
  const tab = await $('[aria-label="Connections mode"]');
  await tab.waitForDisplayed({ timeout: 10000 });
  const selected = await tab.getAttribute("aria-selected");
  if (selected !== "true") {
    await tab.click();
  }
}

/** Create the standard Test PG connection if it doesn't already exist. */
async function ensureTestPgConnection() {
  await ensureConnectionsMode();
  const existing = await $('[aria-label^="Test PG"]');
  try {
    await existing.waitForExist({ timeout: 5000 });
    return;
  } catch {
    // fall through to create
  }

  const newBtn = await $('[aria-label="New Connection"]');
  await newBtn.waitForDisplayed({ timeout: 10000 });
  await newBtn.click();

  const dialog = await $('[role="dialog"]');
  await dialog.waitForDisplayed({ timeout: 5000 });

  await (await $("#conn-name")).setValue("Test PG");
  const hostInput = await $("#conn-host");
  await hostInput.clearValue();
  await hostInput.setValue("localhost");
  const portInput = await $("#conn-port");
  await portInput.clearValue();
  await portInput.setValue("5432");
  const userInput = await $("#conn-user");
  await userInput.clearValue();
  await userInput.setValue("testuser");
  await (await $("#conn-password")).setValue("testpass");
  const dbInput = await $("#conn-database");
  await dbInput.clearValue();
  await dbInput.setValue("viewtable_test");

  await (await $("button=Save")).click();
  await dialog.waitForDisplayed({ timeout: 5000, reverse: true });
}

async function openImportExportDialog() {
  const btn = await $('[aria-label="Import / Export"]');
  await btn.waitForDisplayed({ timeout: 10000 });
  await btn.click();

  // Find the dialog whose visible header reads "Import / Export Connections"
  // — there could be other dialogs on screen (e.g. a confirm), so scope the
  // wait to one we know is ours.
  const header = await $(
    '//*[normalize-space()="Import / Export Connections"]',
  );
  await header.waitForDisplayed({ timeout: 5000 });
}

async function closeAnyDialogIfOpen() {
  const open = await $('[role="dialog"]');
  if (await open.isExisting()) {
    await browser.keys(["Escape"]);
    try {
      await open.waitForDisplayed({ timeout: 3000, reverse: true });
    } catch {
      // best effort
    }
  }
}

describe("Connection Import/Export", () => {
  beforeEach(async () => {
    await closeAnyDialogIfOpen();
    await ensureTestPgConnection();
  });

  // Always clean up any dialog left open by a failing assertion so the next
  // test / spec doesn't inherit a modal that blocks further interaction.
  afterEach(async () => {
    await closeAnyDialogIfOpen();
  });

  it("opens the dialog without freezing the app", async () => {
    // Pure smoke: just open and make sure UI is still responsive afterwards.
    await openImportExportDialog();

    // The Generate JSON button must be reachable — a stuck UI would never
    // surface this element.
    const generateBtn = await $("button=Generate JSON");
    await generateBtn.waitForDisplayed({ timeout: 5000 });
    expect(await generateBtn.isEnabled()).toBe(true);

    // Closing should also work — proves the modal trap isn't wedged.
    await browser.keys(["Escape"]);
    await generateBtn.waitForDisplayed({ timeout: 5000, reverse: true });
  });

  it("Generate JSON produces a payload without any password fields", async () => {
    await openImportExportDialog();

    const generateBtn = await $("button=Generate JSON");
    await generateBtn.waitForDisplayed({ timeout: 5000 });
    await generateBtn.click();

    const textarea = await $('[aria-label="Generated export JSON"]');
    await textarea.waitForDisplayed({ timeout: 5000 });

    const value = ((await textarea.getProperty("value")) as string) ?? "";
    expect(value).toContain('"schema_version"');
    expect(value).toContain("Test PG");

    // Critical security checks — neither the plaintext password the test set
    // ("testpass") nor any "password" field may appear in the export.
    expect(value).not.toContain("testpass");
    expect(value).not.toContain('"password"');

    // Schema version should match what the backend currently emits (v1).
    const parsed = JSON.parse(value);
    expect(parsed.schema_version).toBe(1);
    expect(Array.isArray(parsed.connections)).toBe(true);

    await browser.keys(["Escape"]);
  });

  it("unchecking a connection excludes it from the generated payload", async () => {
    await openImportExportDialog();

    // Uncheck the "Test PG" row by toggling its checkbox
    const connRow = await $('//label[.//*[text()="Test PG"]]');
    await connRow.waitForDisplayed({ timeout: 5000 });
    const checkbox = await connRow.$("input[type='checkbox']");
    await checkbox.click();

    const generateBtn = await $("button=Generate JSON");
    expect(await generateBtn.isEnabled()).toBe(false);

    await browser.keys(["Escape"]);
  });

  it("imports a connection from pasted JSON and reveals it in the sidebar", async () => {
    await openImportExportDialog();

    // Switch to Import tab
    const importTab = await $(
      '//button[@role="tab" and contains(., "Import")]',
    );
    await importTab.click();

    const input = await $('[aria-label="Import JSON input"]');
    await input.waitForDisplayed({ timeout: 5000 });

    const importJson = JSON.stringify({
      schema_version: 1,
      exported_at_unix_secs: 0,
      app: "view-table",
      connections: [
        {
          id: "ignored-on-import",
          name: "E2E Imported PG",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "testuser",
          database: "viewtable_test",
          group_id: null,
          color: null,
          connection_timeout: null,
          keep_alive_interval: null,
          environment: null,
          has_password: false,
        },
      ],
      groups: [],
    });
    // setValue can drop characters on long payloads in some webdriver
    // implementations; set the value via the DOM directly and dispatch the
    // input event so React sees it.
    await browser.execute(
      (el: HTMLTextAreaElement, v: string) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      input,
      importJson,
    );

    const importBtn = await $('//button[normalize-space()="Import"]');
    await importBtn.waitForDisplayed({ timeout: 3000 });
    // Wait until React has processed the input event and enabled the button.
    await browser.waitUntil(async () => await importBtn.isEnabled(), {
      timeout: 3000,
      timeoutMsg: "Import button never became enabled",
    });
    await importBtn.click();

    // Either the result panel appears or an alert explains why it didn't —
    // surface whichever happens first so test failures are actionable.
    await browser.waitUntil(
      async () => {
        const result = await $(
          '//*[contains(normalize-space(), "Imported 1 connection")]',
        );
        if (await result.isDisplayed()) return true;
        const alert = await $('[role="alert"]');
        if (await alert.isDisplayed()) {
          const msg = (await alert.getText()) || "(empty)";
          throw new Error(`Import failed with alert: ${msg}`);
        }
        return false;
      },
      { timeout: 10000, timeoutMsg: "Import result never appeared" },
    );

    await browser.keys(["Escape"]);

    // The new connection should appear in the sidebar list (we're already in
    // connections mode from the beforeEach helper).
    const importedItem = await $('[aria-label^="E2E Imported PG"]');
    await importedItem.waitForDisplayed({ timeout: 5000 });
    expect(await importedItem.getAttribute("aria-label")).toContain(
      "E2E Imported PG",
    );
  });
});
