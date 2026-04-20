import { expect } from "@wdio/globals";

describe("Database Connection Flow", () => {
  it("creates a PostgreSQL connection via the dialog", async () => {
    // 1. Open the New Connection dialog
    const newBtn = await $('[aria-label="New Connection"]');
    await newBtn.waitForDisplayed({ timeout: 10000 });
    await newBtn.click();

    // 2. Wait for dialog
    const dialog = await $('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5000 });

    // 3. Fill connection form using element IDs
    const nameInput = await $("#conn-name");
    await nameInput.setValue("Test PG");

    const hostInput = await $("#conn-host");
    // Clear existing default and set
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

    // 4. Save
    const saveBtn = await $("button=Save");
    await saveBtn.click();

    // 5. Verify dialog closed
    await dialog.waitForDisplayed({ timeout: 5000, reverse: true });

    // 6. Verify connection appears in sidebar
    const connItem = await $('[aria-label^="Test PG"]');
    await connItem.waitForDisplayed({ timeout: 5000 });
    expect(await connItem.getAttribute("aria-label")).toContain("Test PG");
  });

  it("connects to PostgreSQL and shows schemas", async () => {
    // Double-click on the connection item to connect
    const connItem = await $('[aria-label^="Test PG"]');
    await connItem.waitForDisplayed({ timeout: 5000 });
    await connItem.doubleClick();

    // Wait for connection to establish and schemas to load.
    // The "public" schema should appear with an aria-label.
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.waitForDisplayed({ timeout: 15000 });
    expect(await publicSchema.isDisplayed()).toBe(true);
  });

  it("opens a query tab from the sidebar header New Query button", async () => {
    // After the previous test connected and auto-switched to schemas mode,
    // the sidebar header renders a "New Query Tab" button. Click it.
    const newQueryBtn = await $('[aria-label="New Query Tab"]');
    await newQueryBtn.waitForDisplayed({ timeout: 5000 });
    await newQueryBtn.click();

    // The query editor should appear (CodeMirror .cm-editor)
    const editor = await $(".cm-editor");
    await editor.waitForDisplayed({ timeout: 5000 });
    expect(await editor.isDisplayed()).toBe(true);
  });
});
