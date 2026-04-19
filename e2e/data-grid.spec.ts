import { expect } from "@wdio/globals";

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
  // Ensure connection exists and is connected
  beforeEach(async () => {
    const existingConn = await $('[aria-label^="Test PG"]');
    let exists = false;
    try {
      await existingConn.waitForExist({ timeout: 5000 });
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      const newBtn = await $('[aria-label="New Connection"]');
      await newBtn.waitForDisplayed({ timeout: 10000 });
      await newBtn.click();

      const dialog = await $('[role="dialog"]');
      await dialog.waitForDisplayed({ timeout: 5000 });

      const nameInput = await $("#conn-name");
      await nameInput.setValue("Test PG");

      const hostInput = await $("#conn-host");
      await hostInput.clearValue();
      await hostInput.setValue("localhost");

      const portInput = await $("#conn-port");
      await portInput.clearValue();
      await portInput.setValue("5432");

      const userInput = await $("#conn-user");
      await userInput.clearValue();
      await userInput.setValue("testuser");

      const passwordInput = await $("#conn-password");
      await passwordInput.setValue("testpass");

      const dbInput = await $("#conn-database");
      await dbInput.clearValue();
      await dbInput.setValue("viewtable_test");

      const saveBtn = await $("button=Save");
      await saveBtn.click();

      await dialog.waitForDisplayed({ timeout: 5000, reverse: true });
    }

    const publicSchemaCheck = await $('[aria-label="public schema"]');
    let alreadyConnected = false;
    try {
      await publicSchemaCheck.waitForDisplayed({ timeout: 3000 });
      alreadyConnected = true;
    } catch {
      alreadyConnected = false;
    }

    if (!alreadyConnected) {
      const connItem = await $('[aria-label^="Test PG"]');
      await connItem.waitForDisplayed({ timeout: 5000 });
      await connItem.doubleClick();

      const publicSchema = await $('[aria-label="public schema"]');
      await publicSchema.waitForDisplayed({ timeout: 15000 });
    }
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
    const newQueryBtn = await $('[aria-label="New Query"]');
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
    const newQueryBtn = await $('[aria-label="New Query"]');
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

    // Wait for tab to appear
    const tab = await $('[role="tab"]');
    await tab.waitForDisplayed({ timeout: 5000 });

    // Get tab count before closing
    const tabsBefore = await $$('[role="tab"]');
    const countBefore = tabsBefore.length;

    // Close the tab
    const closeBtn = await tab.$('[aria-label^="Close"]');
    await closeBtn.waitForDisplayed({ timeout: 5000 });
    await closeBtn.click();

    // Wait for tab to be removed
    await browser.pause(500);

    const tabsAfter = await $$('[role="tab"]');
    expect(tabsAfter.length).toBe(countBefore - 1);
  });
});
