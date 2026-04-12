import { expect } from "@wdio/globals";

describe("Schema Tree Features", () => {
  // Self-contained: reuse or create connection and connect before each test
  beforeEach(async () => {
    // Wait for sidebar to be ready, then check if connection already exists
    const existingConn = await $('[aria-label^="Test PG"]');
    let exists = false;
    try {
      await existingConn.waitForExist({ timeout: 5000 });
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      // Create connection via dialog
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

    // Check if already connected (public schema visible)
    const publicSchemaCheck = await $('[aria-label="public schema"]');
    let alreadyConnected = false;
    try {
      await publicSchemaCheck.waitForDisplayed({ timeout: 3000 });
      alreadyConnected = true;
    } catch {
      alreadyConnected = false;
    }

    if (!alreadyConnected) {
      // Ensure connected: double-click to connect
      const connItem = await $('[aria-label^="Test PG"]');
      await connItem.waitForDisplayed({ timeout: 5000 });
      await connItem.doubleClick();

      // Wait for public schema to appear
      const publicSchema = await $('[aria-label="public schema"]');
      await publicSchema.waitForDisplayed({ timeout: 15000 });
    }
  });

  it("shows categorized sections when schema is expanded", async () => {
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.click();

    // Schema should show category headers
    const tablesCategory = await $('[aria-label="Tables in public"]');
    await tablesCategory.waitForDisplayed({ timeout: 5000 });
    expect(await tablesCategory.isDisplayed()).toBe(true);

    const viewsCategory = await $('[aria-label="Views in public"]');
    await viewsCategory.waitForDisplayed({ timeout: 5000 });
    expect(await viewsCategory.isDisplayed()).toBe(true);

    const functionsCategory = await $('[aria-label="Functions in public"]');
    await functionsCategory.waitForDisplayed({ timeout: 5000 });
    expect(await functionsCategory.isDisplayed()).toBe(true);
  });

  it("displays tables under the Tables category", async () => {
    // Expand schema
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.click();

    const tablesCategory = await $('[aria-label="Tables in public"]');
    await tablesCategory.waitForDisplayed({ timeout: 5000 });
    await tablesCategory.click();

    // Look for any table item within the schema
    const tableItems = await $$('[aria-label$=" table"]');
    expect(tableItems.length).toBeGreaterThan(0);
  });

  it("highlights a table when selected", async () => {
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.click();

    const tablesCategory = await $('[aria-label="Tables in public"]');
    await tablesCategory.waitForDisplayed({ timeout: 5000 });
    await tablesCategory.click();

    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await firstTable.click();

    // After clicking, the table should be selected (highlighted)
    const parentRow = await firstTable.parentElement();
    const classes = await parentRow.getAttribute("class");
    expect(classes).toContain("accent");
  });

  it("shows context menu on table right-click", async () => {
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.click();

    const tablesCategory = await $('[aria-label="Tables in public"]');
    await tablesCategory.waitForDisplayed({ timeout: 5000 });
    await tablesCategory.click();

    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await firstTable.click();
    await firstTable.contextClick();

    // Context menu should appear with expected options
    const structureOption = await $("span=Structure");
    await structureOption.waitForDisplayed({ timeout: 3000 });
    expect(await structureOption.isDisplayed()).toBe(true);

    const dataOption = await $("span=Data");
    expect(await dataOption.isDisplayed()).toBe(true);

    const dropOption = await $("span=Drop Table");
    expect(await dropOption.isDisplayed()).toBe(true);

    const renameOption = await $("span=Rename Table");
    expect(await renameOption.isDisplayed()).toBe(true);

    // Close menu by pressing Escape
    await browser.keys("Escape");
  });

  it("opens table data tab from context menu", async () => {
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.click();

    const tablesCategory = await $('[aria-label="Tables in public"]');
    await tablesCategory.waitForDisplayed({ timeout: 5000 });
    await tablesCategory.click();

    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await firstTable.contextClick();

    const dataOption = await $("span=Data");
    await dataOption.waitForDisplayed({ timeout: 3000 });
    await dataOption.click();

    // A tab should open with the table data grid
    const dataGrid = await $(".grid-container");
    await dataGrid.waitForDisplayed({ timeout: 10000 });
    expect(await dataGrid.isDisplayed()).toBe(true);
  });

  it("shows context menu on schema right-click with Refresh option", async () => {
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.contextClick();

    const refreshOption = await $("span=Refresh");
    await refreshOption.waitForDisplayed({ timeout: 3000 });
    expect(await refreshOption.isDisplayed()).toBe(true);

    // Close menu
    await browser.keys("Escape");
  });

  it("renders search input in Tables category and filters tables", async () => {
    // Expand the public schema
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.click();

    // Tables category should be expanded by default
    const tablesCategory = await $('[aria-label="Tables in public"]');
    await tablesCategory.waitForDisplayed({ timeout: 5000 });
    await tablesCategory.click();

    // Search input should be visible when there are tables
    const searchInput = await $('[aria-label="Filter tables in public"]');
    await searchInput.waitForDisplayed({ timeout: 5000 });
    expect(await searchInput.isDisplayed()).toBe(true);

    // Get initial table count
    const tablesBeforeFilter = await $$('[aria-label$=" table"]');
    expect(tablesBeforeFilter.length).toBeGreaterThan(0);

    // Type a filter
    await searchInput.setValue("user");

    // Wait for filtering to apply
    await browser.pause(300);

    // Some tables should be filtered out
    const tablesAfterFilter = await $$('[aria-label$=" table"]');
    expect(tablesAfterFilter.length).toBeLessThan(tablesBeforeFilter.length);

    // Clear the filter using the X button
    const clearButton = await $('[aria-label="Clear table filter in public"]');
    await clearButton.waitForDisplayed({ timeout: 3000 });
    await clearButton.click();

    // Wait for clearing
    await browser.pause(300);

    // All tables should be visible again
    const tablesAfterClear = await $$('[aria-label$=" table"]');
    expect(tablesAfterClear.length).toBe(tablesBeforeFilter.length);
  });

  it("shows No matching tables when filter matches nothing", async () => {
    // Expand the public schema
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.click();

    // Tables category should be expanded by default
    const tablesCategory = await $('[aria-label="Tables in public"]');
    await tablesCategory.waitForDisplayed({ timeout: 5000 });
    await tablesCategory.click();

    const searchInput = await $('[aria-label="Filter tables in public"]');
    await searchInput.waitForDisplayed({ timeout: 5000 });

    // Type something that won't match any table
    await searchInput.setValue("zzz_nonexistent_table_xyz");

    // Wait for the empty state
    await browser.pause(300);

    const noMatchLabel = await $("span=No matching tables");
    await noMatchLabel.waitForDisplayed({ timeout: 3000 });
    expect(await noMatchLabel.isDisplayed()).toBe(true);

    // Clear the filter
    const clearButton = await $('[aria-label="Clear table filter in public"]');
    await clearButton.click();
  });
});
