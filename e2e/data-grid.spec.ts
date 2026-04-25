import { expect } from "@wdio/globals";
import { openTestPgWorkspace } from "./_helpers";

/**
 * Expand a schema node only if it is not already expanded.
 */
async function ensureSchemaExpanded(selector: string) {
  const schema = await $(selector);
  await schema.waitForDisplayed({ timeout: 15000 });
  const expanded = await schema.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await schema.click();
  }
}

/**
 * Expand a category node only if it is not already expanded.
 */
async function ensureCategoryExpanded(selector: string) {
  const cat = await $(selector);
  await cat.waitForDisplayed({ timeout: 5000 });
  const expanded = await cat.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await cat.click();
  }
}

describe("Data Grid & Query Execution", () => {
  // Sprint 125 — every spec must navigate Home → Open before interacting
  // with the schema tree / tab bar. `openTestPgWorkspace` is idempotent
  // (no-op when already on Workspace with Test PG) so the cross-spec ordering
  // doesn't flake.
  beforeEach(async () => {
    await openTestPgWorkspace();
  });

  it("shows data grid with real values when table is clicked", async () => {
    await ensureSchemaExpanded('[aria-label="public schema"]');
    await ensureCategoryExpanded('[aria-label="Tables in public"]');

    // Click the first table
    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await firstTable.click();

    // Wait for data grid to load — look for the table element
    const table = await $("table");
    await table.waitForDisplayed({ timeout: 10000 });

    // Verify table headers are rendered
    const headers = await $$("th");
    expect(headers.length).toBeGreaterThan(0);

    // Verify cells contain real data (not all NULL)
    // Get all cell elements
    const cells = await $$("td");
    expect(cells.length).toBeGreaterThan(0);

    // At least one cell should NOT contain "NULL".
    // WebKit's webdriver returns "" from getText() on truncate-styled cells,
    // so read textContent via getProperty for stability.
    let hasNonNullValue = false;
    for (const cell of cells) {
      const raw = ((await cell.getProperty("textContent")) as string) ?? "";
      const text = raw.trim();
      if (text && text !== "NULL" && text !== "No data") {
        hasNonNullValue = true;
        break;
      }
    }
    expect(hasNonNullValue).toBe(true);
  });

  it("shows connection name in schema tree header", async () => {
    // The sidebar header strip shows the active connection name. WebKit's
    // webdriver returns "" from getText() on truncate spans, so read
    // textContent via getProperty for stability.
    const header = await $('[data-testid="sidebar-connection-header"]');
    await header.waitForExist({ timeout: 5000 });
    const text = (
      ((await header.getProperty("textContent")) as string) ?? ""
    ).trim();
    expect(text).toBe("Test PG");
    // Should NOT look like a UUID
    expect(text).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("tab color dot has connection name title", async () => {
    await ensureSchemaExpanded('[aria-label="public schema"]');
    await ensureCategoryExpanded('[aria-label="Tables in public"]');

    // Click a table to create a tab
    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await firstTable.click();

    // Wait for tab to appear
    const tab = await $('[role="tab"]');
    await tab.waitForDisplayed({ timeout: 5000 });

    // Verify the color dot has a title with connection name
    const colorDot = await $('[aria-label="Connection color"]');
    await colorDot.waitForDisplayed({ timeout: 5000 });
    const title = await colorDot.getAttribute("title");
    expect(title).toBe("Test PG");
  });

  it("shows Format button in query tab toolbar", async () => {
    // Open a new query tab
    const newQueryBtn = await $('[aria-label="New Query Tab"]');
    await newQueryBtn.waitForDisplayed({ timeout: 5000 });
    await newQueryBtn.click();

    // Wait for query editor
    const editor = await $(".cm-editor");
    await editor.waitForDisplayed({ timeout: 5000 });

    // Verify the Format button exists
    const formatBtn = await $('[aria-label="Format SQL"]');
    await formatBtn.waitForDisplayed({ timeout: 5000 });
    expect(await formatBtn.isDisplayed()).toBe(true);

    // Format button should be disabled when SQL is empty
    expect(await formatBtn.getAttribute("disabled")).toBe("true");
  });

  it("executes a SELECT query and shows real values", async () => {
    // Open a new query tab
    const newQueryBtn = await $('[aria-label="New Query Tab"]');
    await newQueryBtn.waitForDisplayed({ timeout: 5000 });
    await newQueryBtn.click();

    const editor = await $(".cm-editor");
    await editor.waitForDisplayed({ timeout: 5000 });

    // Type a SQL query into CodeMirror by clicking the content area and typing
    const cmContent = await $(".cm-content");
    await cmContent.waitForDisplayed({ timeout: 5000 });
    await cmContent.click();
    await browser.pause(200);
    await browser.keys("SELECT 1 AS test_column");

    // Wait for the text to appear in the editor
    await browser.pause(500);

    // Click the Run button
    const runBtn = await $('[aria-label="Run query"]');
    await runBtn.waitForDisplayed({ timeout: 5000 });
    await runBtn.click();

    // Wait for result to appear — look for the status bar showing "SELECT"
    const selectLabel = await $("span=SELECT");
    await selectLabel.waitForDisplayed({ timeout: 10000 });

    // Verify result grid shows "1" as cell value (not NULL)
    // The result should show "test_column" header and "1" value
    const testColHeader = await $("th*=test_column");
    expect(await testColHeader.isDisplayed()).toBe(true);

    // Wait for result table cells
    const cells = await $$("td");
    expect(cells.length).toBeGreaterThan(0);

    // The cell should contain "1", not "NULL". Use textContent to bypass
    // WebKit's getText() returning empty strings for truncate-styled cells.
    const firstCell = cells[0]!;
    const cellText = (
      ((await firstCell.getProperty("textContent")) as string) ?? ""
    ).trim();
    expect(cellText).toBe("1");
  });

  it("closes a tab via close button", async () => {
    await ensureSchemaExpanded('[aria-label="public schema"]');
    await ensureCategoryExpanded('[aria-label="Tables in public"]');

    // Click a table to create a tab
    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await firstTable.click();

    // Scope all tab queries to the TabBar list — MainArea also renders
    // role="tab" elements (Records/Structure sub-tabs) which would otherwise
    // inflate the count and confuse the diff after closing.
    const tabBarTabs =
      '[role="tablist"][aria-label="Open connections"] [role="tab"]';

    const tab = await $(tabBarTabs);
    await tab.waitForDisplayed({ timeout: 5000 });

    const countBefore = (await $$(tabBarTabs)).length;

    // The close button uses `opacity-0 group-hover:opacity-100` which
    // webdriver treats as not displayed; trigger the click via JS to bypass
    // the visibility gate. The React onClick handler is what we care about.
    const closeBtn = await tab.$('[aria-label^="Close"]');
    await closeBtn.waitForExist({ timeout: 5000 });
    await browser.execute((el: HTMLElement) => el.click(), closeBtn);

    // Wait for tab to be removed
    await browser.pause(500);

    const tabsAfter = await $$(tabBarTabs);
    expect(tabsAfter.length).toBe(countBefore - 1);
  });
});
