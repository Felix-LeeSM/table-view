import { expect } from "@wdio/globals";
import { ensureHomeScreen, ensureTestPgConnection } from "./_helpers";

/**
 * Phase C-2 — ImportExportDialog smoke tests.
 *
 * Covers the user-reported scenario where opening the dialog and clicking
 * "Generate JSON" must NOT freeze the app, and verifies the export payload
 * is well-formed and password-free.
 *
 * Sprint 125 — the Import/Export entry point now lives on the Home screen
 * (paradigm-agnostic connection management). These tests start from Home;
 * a previous spec that left the user inside the Workspace will be returned
 * to Home by `ensureHomeScreen` before the dialog is opened.
 */

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
    // Sprint 125 — return to Home before each test so the
    // [aria-label="Import / Export"] button is reachable. ensureTestPgConnection
    // also lives on Home and is idempotent.
    await ensureHomeScreen();
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
      app: "table-view",
      connections: [
        {
          id: "ignored-on-import",
          name: "E2E Imported PG",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "testuser",
          database: "table_view_test",
          group_id: null,
          color: null,
          connection_timeout: null,
          keep_alive_interval: null,
          environment: null,
          has_password: false,
          // Sprint-65 promoted `paradigm` to a required typed field on
          // ConnectionConfigPublic (no #[serde(default)]); imports without it
          // fail with "missing field `paradigm`". For a postgresql db_type the
          // backend derives the same value, but the wire payload still has to
          // carry it.
          paradigm: "rdb",
        },
      ],
      groups: [],
    });
    // Focus first, then use standard setValue. WebKit inside tauri-driver
    // reliably echoes single setValue calls; a custom DOM setter dance
    // sometimes bypasses React's change tracking.
    await input.click();
    await input.setValue(importJson);

    // Verify the textarea actually holds the payload before clicking Import
    // — this makes CI failures point at the right root cause if the value
    // ever gets truncated.
    const actual = ((await input.getProperty("value")) as string) ?? "";
    expect(actual.length).toBeGreaterThan(0);
    expect(actual).toContain("E2E Imported PG");

    // NOTE: the XPath excludes role="tab" so we don't re-click the already-
    // active "Import" tab (both the tab and the action button share the
    // text "Import"). Previously this silently no-op'd the import.
    const importBtn = await $(
      '//button[not(@role="tab") and normalize-space()="Import"]',
    );
    await importBtn.waitForDisplayed({ timeout: 3000 });
    // Wait until React has processed the input event and enabled the button.
    await browser.waitUntil(async () => await importBtn.isEnabled(), {
      timeout: 3000,
      timeoutMsg: "Import button never became enabled",
    });
    await importBtn.click();

    // The user-visible success signal is that the new connection appears in
    // the sidebar (even if the result panel text changes in the future). If
    // an error alert shows up first, surface its text so the failure is
    // actionable.
    await browser.waitUntil(
      async () => {
        const item = await $('[aria-label^="E2E Imported PG"]');
        if (await item.isExisting()) return true;
        const alert = await $('[role="alert"]');
        if (await alert.isDisplayed()) {
          const msg = (await alert.getText()) || "(empty)";
          throw new Error(`Import failed with alert: ${msg}`);
        }
        return false;
      },
      {
        timeout: 15000,
        timeoutMsg: "Imported connection never appeared in sidebar",
      },
    );

    await browser.keys(["Escape"]);

    const importedItem = await $('[aria-label^="E2E Imported PG"]');
    await importedItem.waitForDisplayed({ timeout: 5000 });
    expect(await importedItem.getAttribute("aria-label")).toContain(
      "E2E Imported PG",
    );
  });
});
