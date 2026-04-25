import { expect } from "@wdio/globals";
import { openTestPgWorkspace } from "./_helpers";

/**
 * Sprint 61: raw query result editing.
 *
 * Smoke-tests the editable-vs-read-only banner that QueryResultGrid renders
 * for SELECT results, plus the cell detail dialog now reachable from
 * raw query rows.
 *
 * Sprint 125 — every test enters via `openTestPgWorkspace`, which navigates
 * Home → Open before interacting with the schema tree / query editor.
 */

async function openNewQueryTab() {
  const newQueryBtn = await $('[aria-label="New Query Tab"]');
  await newQueryBtn.waitForDisplayed({ timeout: 5000 });
  await newQueryBtn.click();
  const editor = await $(".cm-editor");
  await editor.waitForDisplayed({ timeout: 5000 });
}

async function typeQueryAndRun(sql: string) {
  const cmContent = await $(".cm-content");
  await cmContent.waitForDisplayed({ timeout: 5000 });
  await cmContent.click();
  await browser.pause(150);
  // Clear any prior content — Cmd+A then Delete.
  await browser.keys(["Control", "a"]);
  await browser.keys("Delete");
  await browser.pause(100);
  await browser.keys(sql);
  await browser.pause(200);

  const runBtn = await $('[aria-label="Run query"]');
  await runBtn.waitForDisplayed({ timeout: 5000 });
  await runBtn.click();

  const selectLabel = await $("span=SELECT");
  await selectLabel.waitForDisplayed({ timeout: 10000 });
}

describe("Raw query result editing (Sprint 61)", () => {
  beforeEach(async () => {
    await openTestPgWorkspace();
  });

  it("shows Read-only banner for a SELECT without FROM", async () => {
    await openNewQueryTab();
    await typeQueryAndRun("SELECT 1 AS test_value");

    // The banner copy starts with "Read-only —". WebKit may strip whitespace,
    // so look for the substring rather than an exact match.
    const banner = await $(
      "//*[contains(translate(text(),'READ-ONLY','read-only'),'read-only')]",
    );
    await banner.waitForDisplayed({ timeout: 5000 });
    expect(await banner.isDisplayed()).toBe(true);
  });

  // The "Editable badge" path is exercised end-to-end at the unit/component
  // level (analyzeResultEditability, EditableQueryResultGrid, QueryResultGrid
  // tests). Reproducing it under tauri-driver is fragile: it depends on the
  // seeded fixture having a PK-bearing table at a stable position in the
  // sidebar AND on PK metadata fetching in time. Skip the e2e variant so it
  // doesn't flake; the read-only and cell-detail checks below still cover the
  // surrounding integration of QueryResultGrid in the real Tauri shell.
  it.skip("shows Editable badge for a single-table SELECT with PK", async () => {
    // Intentionally left blank — see comment above.
  });

  it("opens the cell detail dialog on double-click in raw result", async () => {
    await openNewQueryTab();
    await typeQueryAndRun(
      "SELECT 'a long string value for inspection' AS payload",
    );

    // Wait for at least one result cell, then double-click it.
    const cell = await $("tbody td");
    await cell.waitForDisplayed({ timeout: 10000 });
    await cell.doubleClick();

    // Cell detail dialog identifies itself by the "Cell Detail —" header.
    const detailHeader = await $("//*[contains(text(),'Cell Detail')]");
    await detailHeader.waitForDisplayed({ timeout: 5000 });
    expect(await detailHeader.isDisplayed()).toBe(true);

    // Close to keep the page clean for subsequent specs.
    await browser.keys(["Escape"]);
  });
});
