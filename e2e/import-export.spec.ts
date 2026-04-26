import { expect } from "@wdio/globals";
import { ensureHomeScreen, ensureTestPgConnection } from "./_helpers";

/**
 * Phase C-2 — ImportExportDialog smoke tests.
 *
 * Covers the user-reported scenario where opening the dialog and clicking
 * "Generate encrypted JSON" must NOT freeze the app, and verifies the export
 * payload is the Argon2id+AES-GCM envelope shape with no plaintext password
 * leakage.
 *
 * Sprint 125 — the Import/Export entry point lives on the Home screen
 * (paradigm-agnostic connection management). These tests start from Home;
 * a previous spec that left the user inside the Workspace will be returned
 * to Home by `ensureHomeScreen` before the dialog is opened.
 *
 * Sprint 140 — Generate JSON renamed to "Generate encrypted JSON" and gated
 * behind a master password (min 8). Plain-JSON import still works as a
 * regression-safe fallback, so the import case feeds plain JSON in.
 */

const E2E_MASTER_PASSWORD = "table-view-e2e";

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

    // The Generate encrypted JSON button must be reachable — a stuck UI
    // would never surface this element. It is disabled until the master
    // password reaches min length (S140), which we are not asserting here.
    const generateBtn = await $("button=Generate encrypted JSON");
    await generateBtn.waitForDisplayed({ timeout: 5000 });

    // Closing should also work — proves the modal trap isn't wedged.
    await browser.keys(["Escape"]);
    await generateBtn.waitForDisplayed({ timeout: 5000, reverse: true });
  });

  it("Generate encrypted JSON produces an Argon2id+AES-GCM envelope without leaking plaintext", async () => {
    await openImportExportDialog();

    // Sprint 140: must fill the master password before the button enables.
    // The MasterPasswordField uses React's useId so the id is dynamic
    // (e.g. ":r1:" with colons that break CSS selectors). Reach the input
    // via the label's sibling structure instead.
    const pwInput = await $(
      '//label[normalize-space()="Master password"]/following-sibling::div[1]//input',
    );
    await pwInput.waitForDisplayed({ timeout: 5000 });
    await pwInput.click();
    await pwInput.setValue(E2E_MASTER_PASSWORD);

    const generateBtn = await $("button=Generate encrypted JSON");
    await generateBtn.waitForDisplayed({ timeout: 5000 });
    await browser.waitUntil(async () => await generateBtn.isEnabled(), {
      timeout: 3000,
      timeoutMsg: "Generate encrypted JSON never enabled after password input",
    });
    await generateBtn.click();

    const textarea = await $('[aria-label="Generated export JSON"]');
    await textarea.waitForDisplayed({ timeout: 5000 });

    const value = ((await textarea.getProperty("value")) as string) ?? "";

    // Locked envelope shape from docs/sprints/sprint-134/spec.md (Phase 10
    // decision lock).
    const parsed = JSON.parse(value);
    expect(parsed.v).toBe(1);
    expect(parsed.kdf).toBe("argon2id");
    expect(parsed.alg).toBe("aes-256-gcm");
    expect(parsed.tag_attached).toBe(true);
    expect(typeof parsed.salt).toBe("string");
    expect(typeof parsed.nonce).toBe("string");
    expect(typeof parsed.ciphertext).toBe("string");

    // Critical security checks — neither the per-connection plaintext
    // password ("testpass") nor the master password may appear in the
    // ciphertext envelope. The fixture connection name "Test PG" is now
    // inside the encrypted ciphertext too, so it must NOT appear plain.
    expect(value).not.toContain("testpass");
    expect(value).not.toContain(E2E_MASTER_PASSWORD);
    expect(value).not.toContain("Test PG");

    await browser.keys(["Escape"]);
  });

  it("clearing the master password disables the Generate button", async () => {
    await openImportExportDialog();

    const generateBtn = await $("button=Generate encrypted JSON");
    await generateBtn.waitForDisplayed({ timeout: 5000 });

    // No password yet → disabled.
    expect(await generateBtn.isEnabled()).toBe(false);

    // The MasterPasswordField uses React's useId so the id is dynamic
    // (e.g. ":r1:" with colons that break CSS selectors). Reach the input
    // via the label's sibling structure instead.
    const pwInput = await $(
      '//label[normalize-space()="Master password"]/following-sibling::div[1]//input',
    );
    await pwInput.waitForDisplayed({ timeout: 5000 });
    await pwInput.click();
    await pwInput.setValue("short"); // < 8 chars → still disabled.
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
