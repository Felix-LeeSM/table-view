import { $, browser, expect } from "@wdio/globals";
import {
  activateTab,
  clickDomSelector,
  expectConnectionVisible,
  openNewConnectionDialog,
  readFieldValue,
  saveConnectionDialog,
  selectDatabaseType,
  setInput,
  step,
  waitForLauncher,
} from "./_helpers";

// #1815 — the Import / Export dialog had ~20 Rust unit tests behind it
// (src-tauri/src/commands/connection/io.rs) and zero e2e evidence, so the
// 514-line `ImportExportDialog.tsx` wiring could break with the whole unit
// suite still green. This spec drives the real dialog end to end.
//
// Pinned properties, all observable from the DOM:
//   1. Export emits an Argon2id/AES envelope, not plain JSON (ADR 0021) and
//      the payload carries neither the connection password nor the phrase.
//   2. The wrong recovery phrase is refused with the canonical message and
//      imports nothing.
//   3. The displayed phrase imports successfully, the connection survives,
//      and the imported copy arrives with NO stored password — the user has
//      to re-enter it (`io.rs` `password: String::new() // never imported`).
//
// No external database service is needed: `save_connection`
// (src-tauri/src/commands/connection/crud.rs) validates and persists without
// opening an adapter, so a connection pointing at a dead port is enough to
// exercise the password lifecycle. Hence the empty service list in
// e2e/scope-map.mjs and e2e/fixtures/seed-smoke.ts.

const SOURCE_NAME = "E2E Export Source";
const IMPORTED_NAME = `${SOURCE_NAME} (imported)`;
// Distinctive so the absence check below cannot pass on an accidental
// substring. Its absence from the payload is weak evidence on its own — see
// the comment on that assertion.
const SOURCE_PASSWORD = "e2e-export-needle-Zq7v";
// A syntactically valid BIP39 phrase that is not the generated one.
const WRONG_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const PW_SET_BADGE = "pw set";
const INCORRECT_PHRASE_MESSAGE =
  "Incorrect master password — the file could not be decrypted";
const IMPORT_SUCCESS_TEXT = "Imported 1 connection";
const REENTER_PASSWORD_TEXT = "re-enter its password";
// `selectionTree.counterLabel` after the round trip: the original plus one
// imported copy, both preselected.
const CONNECTION_COUNT_AFTER_IMPORT = "2 connections,";

const DIALOG = '[role="dialog"]';
const RECOVERY_PHRASE_OUTPUT = "#export-recovery-phrase";
const EXPORT_JSON_OUTPUT = 'textarea[aria-label="Generated export JSON"]';
const IMPORT_JSON_INPUT = 'textarea[aria-label="Import JSON input"]';
const IMPORT_PHRASE_INPUT = `${DIALOG} input[type="password"]`;
const ACKNOWLEDGE_LABEL = "I have saved the recovery phrase somewhere safe.";

describe("connection export / import round trip", () => {
  it("re-imports an encrypted export without carrying the password across", async () => {
    await step("create a connection that has a stored password", async () => {
      const dialog = await openNewConnectionDialog();
      await selectDatabaseType("postgresql");
      await setInput("#conn-name", SOURCE_NAME);
      await setInput("#conn-host", "127.0.0.1");
      await setInput("#conn-port", "15432");
      await setInput("#conn-user", "e2e-export-user");
      await setInput("#conn-password", SOURCE_PASSWORD);
      await setInput("#conn-database", "table_view_test");
      await saveConnectionDialog(dialog);
      await expectConnectionVisible(SOURCE_NAME);
    });

    await step("the export picker reports the stored password", async () => {
      await openImportExportDialog();
      expect(await selectionTreeRowText(SOURCE_NAME)).toContain(PW_SET_BADGE);
    });

    const phrase = await step("generate the encrypted export", async () => {
      await clickDialogButton("Generate encrypted export");
      await browser.waitUntil(
        async () => (await readFieldValue(RECOVERY_PHRASE_OUTPUT)).length > 0,
        {
          timeout: 30000,
          timeoutMsg: "the export never produced a recovery phrase",
        },
      );
      const generated = (await readFieldValue(RECOVERY_PHRASE_OUTPUT)).trim();
      expect(generated.split(/\s+/)).toHaveLength(12);
      return generated;
    });

    const envelopeJson = await step(
      "reveal the export payload after acknowledging the phrase",
      async () => {
        // The payload textarea stays empty until the acknowledgement box is
        // ticked, so this click is part of the export contract, not setup.
        await tickAcknowledgement();
        await browser.waitUntil(
          async () => (await readFieldValue(EXPORT_JSON_OUTPUT)).length > 0,
          {
            timeout: 10000,
            timeoutMsg:
              "the export payload stayed hidden after acknowledging the phrase",
          },
        );
        return await readFieldValue(EXPORT_JSON_OUTPUT);
      },
    );

    await step("the payload is an envelope, not a plain export", async () => {
      const parsed = JSON.parse(envelopeJson) as Record<string, unknown>;
      // Pins the `EncryptedEnvelope` schema (src-tauri/src/storage/crypto.rs)
      // — the two keys the backend's own envelope detection keys off. A
      // regression to the plain `export_connections` path would already have
      // died at the recovery-phrase wait above, which is why this is a schema
      // guard and not the plain-export guard.
      expect(typeof parsed.kdf).toBe("string");
      expect(typeof parsed.ciphertext).toBe("string");
      expect(Object.keys(parsed)).not.toContain("connections");
      // Cheap tripwires against the payload textarea rendering the wrong
      // thing. Neither proves the ciphertext is sound: `ConnectionConfigPublic`
      // has no password field to begin with, so a degraded AEAD would pass
      // both. The real integrity check is the wrong-phrase rejection below.
      expect(envelopeJson).not.toContain(SOURCE_PASSWORD);
      expect(envelopeJson).not.toContain(phrase);
    });

    await step("the wrong recovery phrase is refused", async () => {
      await activateTab("Import");
      await setInput(IMPORT_JSON_INPUT, envelopeJson);
      await setInput(IMPORT_PHRASE_INPUT, WRONG_PHRASE);
      await clickDialogButton("Import");
      await waitForDialogText(
        INCORRECT_PHRASE_MESSAGE,
        30000,
        "the wrong recovery phrase was not refused",
      );
    });

    await step("the displayed recovery phrase imports", async () => {
      await setInput(IMPORT_PHRASE_INPUT, phrase);
      await clickDialogButton("Import");
      await waitForDialogText(
        IMPORT_SUCCESS_TEXT,
        30000,
        "the correct recovery phrase did not import the connection",
      );
      // Copy check only: `resultFooter` is a static locale string that renders
      // on every successful import, so it would survive a regression that
      // carried the password across. It catches the footer going missing,
      // nothing more — the badge comparison below is what holds the
      // "password is not re-imported" property.
      expect(await dialogText()).toContain(REENTER_PASSWORD_TEXT);
      await clickDialogButton("Done");
    });

    await step(
      "the imported connection survives without its password",
      async () => {
        await expectConnectionVisible(IMPORTED_NAME);
        await openImportExportDialog();
        expect(await selectionTreeRowText(SOURCE_NAME)).toContain(PW_SET_BADGE);
        expect(await selectionTreeRowText(IMPORTED_NAME)).not.toContain(
          PW_SET_BADGE,
        );
        // Exactly one import reached storage. The picker preselects every
        // connection on open, so its own counter (`selectionTree.counterLabel`)
        // is the connection count — a wrong phrase that decrypted anyway would
        // make this read "3 connections".
        expect(await dialogText()).toContain(CONNECTION_COUNT_AFTER_IMPORT);
      },
    );
  });
});

async function openImportExportDialog() {
  await waitForLauncher();
  await clickDomSelector('[aria-label="Import / Export"]');
  const dialog = await $(DIALOG);
  await dialog.waitForDisplayed({ timeout: 10000 });
}

/** Text content of the open dialog, for presence / absence assertions. */
async function dialogText(): Promise<string> {
  return await browser.execute(
    (sel) => document.querySelector(sel)?.textContent ?? "",
    DIALOG,
  );
}

async function waitForDialogText(
  needle: string,
  timeout: number,
  timeoutMsg: string,
) {
  await browser.waitUntil(async () => (await dialogText()).includes(needle), {
    timeout,
    timeoutMsg,
  });
}

/**
 * Click a dialog button by its exact label. `[role="tab"]` is excluded so
 * "Import" hits the submit button and not the tab that carries the same word,
 * and the disabled check keeps the click off a button still showing
 * "Importing…". The finder is declared inside each `browser.execute` payload
 * because only the serialised function body reaches the page.
 */
async function clickDialogButton(label: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (sel, text) => {
          return find() !== null;

          function find(): HTMLButtonElement | null {
            return (
              Array.from(
                document.querySelectorAll<HTMLButtonElement>(`${sel} button`),
              ).find(
                (button) =>
                  button.getAttribute("role") !== "tab" &&
                  (button.textContent ?? "").trim() === text &&
                  !button.disabled &&
                  button.offsetParent !== null,
              ) ?? null
            );
          }
        },
        DIALOG,
        label,
      ),
    { timeout: 30000, timeoutMsg: `${label} button did not become clickable` },
  );
  await browser.execute(
    (sel, text) => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`${sel} button`),
      ).find(
        (candidate) =>
          candidate.getAttribute("role") !== "tab" &&
          (candidate.textContent ?? "").trim() === text &&
          !candidate.disabled &&
          candidate.offsetParent !== null,
      );
      if (!button) throw new Error(`${text} button did not appear`);
      button.click();
    },
    DIALOG,
    label,
  );
}

async function tickAcknowledgement() {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (sel, text) =>
          Array.from(
            document.querySelectorAll<HTMLElement>(`${sel} label`),
          ).some(
            (label) =>
              (label.textContent ?? "").includes(text) &&
              label.querySelector('input[type="checkbox"]') !== null,
          ),
        DIALOG,
        ACKNOWLEDGE_LABEL,
      ),
    {
      timeout: 10000,
      timeoutMsg: "the recovery-phrase acknowledgement box did not appear",
    },
  );
  await browser.execute(
    (sel, text) => {
      const label = Array.from(
        document.querySelectorAll<HTMLElement>(`${sel} label`),
      ).find(
        (candidate) =>
          (candidate.textContent ?? "").includes(text) &&
          candidate.querySelector('input[type="checkbox"]') !== null,
      );
      const box = label?.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      if (!box) throw new Error("acknowledgement checkbox did not appear");
      if (!box.checked) box.click();
    },
    DIALOG,
    ACKNOWLEDGE_LABEL,
  );
}

/** Full text of a connection's row in the export selection tree. */
async function selectionTreeRowText(name: string): Promise<string> {
  let text = "";
  await browser.waitUntil(
    async () => {
      const found = await browser.execute(
        (sel, connName) => {
          const box = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              `${sel} input[type="checkbox"]`,
            ),
          ).find((el) => el.getAttribute("aria-label") === connName);
          return box?.closest("label")?.textContent ?? null;
        },
        DIALOG,
        name,
      );
      if (found === null) return false;
      text = found;
      return true;
    },
    {
      timeout: 10000,
      timeoutMsg: `${name} did not appear in the export selection tree`,
    },
  );
  return text;
}
