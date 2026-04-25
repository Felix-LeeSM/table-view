import { expect } from "@wdio/globals";
import { openTestPgWorkspace } from "./_helpers";

/**
 * Expand a schema node only if it is not already expanded.
 * Prevents the toggle issue: clicking an already-expanded node collapses it.
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

/**
 * Right-click an element using W3C WebDriver Actions API.
 * Falls back to dispatchEvent if actions API is not supported by tauri-driver.
 */
async function rightClick(el: WebdriverIO.Element) {
  try {
    await browser
      .action("pointer")
      .move({ origin: el, x: 0, y: 0 })
      .down({ button: 2 })
      .up({ button: 2 })
      .perform();
  } catch {
    // Fallback: dispatch a native contextmenu event via execute
    await browser.execute((elem: HTMLElement) => {
      const rect = elem.getBoundingClientRect();
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      });
      elem.dispatchEvent(event);
    }, el);
  }
}

describe("Schema Tree Features", () => {
  // Sprint 125 — schema tree only mounts inside Workspace. Each test calls
  // the idempotent `openTestPgWorkspace` helper so it doesn't matter what
  // screen the previous spec left us on.
  beforeEach(async () => {
    await openTestPgWorkspace();
  });

  it("shows categorized sections when schema is expanded", async () => {
    await ensureSchemaExpanded('[aria-label="public schema"]');

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
    await ensureSchemaExpanded('[aria-label="public schema"]');
    await ensureCategoryExpanded('[aria-label="Tables in public"]');

    // Look for any table item within the schema
    const tableItems = await $$('[aria-label$=" table"]');
    expect(tableItems.length).toBeGreaterThan(0);
  });

  it("highlights a table when selected", async () => {
    await ensureSchemaExpanded('[aria-label="public schema"]');
    await ensureCategoryExpanded('[aria-label="Tables in public"]');

    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await firstTable.click();

    // Selected/active table item is styled with bg-primary/10 + text-primary.
    // Substring matching tolerates Tailwind's slash-modifier class names.
    const classes = await firstTable.getAttribute("class");
    expect(classes).toMatch(/bg-primary|text-primary/);
  });

  // NOTE: tauri-driver does not support right-click via Actions API or dispatchEvent.
  // These context menu tests are skipped until tauri-driver adds right-click support.
  it.skip("shows context menu on table right-click", async () => {
    await ensureSchemaExpanded('[aria-label="public schema"]');
    await ensureCategoryExpanded('[aria-label="Tables in public"]');

    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await firstTable.click();
    await rightClick(firstTable);

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

  it.skip("opens table data tab from context menu", async () => {
    await ensureSchemaExpanded('[aria-label="public schema"]');
    await ensureCategoryExpanded('[aria-label="Tables in public"]');

    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await rightClick(firstTable);

    const dataOption = await $("span=Data");
    await dataOption.waitForDisplayed({ timeout: 3000 });
    await dataOption.click();

    // A tab should open with the table data grid
    const dataGrid = await $(".grid-container");
    await dataGrid.waitForDisplayed({ timeout: 10000 });
    expect(await dataGrid.isDisplayed()).toBe(true);
  });

  it.skip("shows context menu on schema right-click with Refresh option", async () => {
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.waitForDisplayed({ timeout: 5000 });
    await rightClick(publicSchema);

    const refreshOption = await $("span=Refresh");
    await refreshOption.waitForDisplayed({ timeout: 3000 });
    expect(await refreshOption.isDisplayed()).toBe(true);

    // Close menu
    await browser.keys("Escape");
  });

  it("renders search input in Tables category and filters tables", async () => {
    await ensureSchemaExpanded('[aria-label="public schema"]');
    await ensureCategoryExpanded('[aria-label="Tables in public"]');

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
    await ensureSchemaExpanded('[aria-label="public schema"]');
    await ensureCategoryExpanded('[aria-label="Tables in public"]');

    const searchInput = await $('[aria-label="Filter tables in public"]');
    await searchInput.waitForDisplayed({ timeout: 5000 });

    // Type something that won't match any table
    await searchInput.setValue("zzz_nonexistent_table_xyz");

    // Wait for the empty state
    await browser.pause(300);

    const noMatchLabel = await $("//*[contains(text(),'No matching tables')]");
    await noMatchLabel.waitForDisplayed({ timeout: 3000 });
    expect(await noMatchLabel.isDisplayed()).toBe(true);

    // Clear the filter
    const clearButton = await $('[aria-label="Clear table filter in public"]');
    await clearButton.click();
  });
});
