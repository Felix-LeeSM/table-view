import { expect } from "@wdio/globals";

describe("Schema Tree Features", () => {
  // Prerequisite: connection.spec.ts must run first to create and connect
  // This spec assumes a connected PostgreSQL with the "public" schema loaded.

  it("shows categorized sections when schema is expanded", async () => {
    // Ensure we're connected — expand the public schema
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.waitForDisplayed({ timeout: 15000 });
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
    // The Tables category should be expanded by default
    // Look for any table item within the schema
    const tableItems = await $$('[aria-label$=" table"]');
    // There should be at least system tables visible
    expect(tableItems.length).toBeGreaterThan(0);
  });

  it("highlights a table when selected", async () => {
    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await firstTable.click();

    // After clicking, the table should be selected (highlighted)
    // Selection applies accent color classes
    const parentRow = await firstTable.parentElement();
    const classes = await parentRow.getAttribute("class");
    expect(classes).toContain("accent");
  });

  it("shows context menu on table right-click", async () => {
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
    await publicSchema.waitForDisplayed({ timeout: 10000 });
    await publicSchema.contextClick();

    const refreshOption = await $("span=Refresh");
    await refreshOption.waitForDisplayed({ timeout: 3000 });
    expect(await refreshOption.isDisplayed()).toBe(true);

    // Close menu
    await browser.keys("Escape");
  });
});
