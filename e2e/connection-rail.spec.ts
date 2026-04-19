import { expect } from "@wdio/globals";

/**
 * Sprint 60: ConnectionRail visual separation smoke tests.
 *
 * The sidebar was restructured into (a) a left vertical rail of connection
 * icons and (b) a right schema panel that only shows the currently-selected
 * connection's schema tree. This spec verifies the wiring at the surface
 * level.
 */
describe("ConnectionRail (Sprint 60)", () => {
  /**
   * Open the New Connection dialog by clicking the rail's + button, fill the
   * standard PG test credentials, and save. Returns when the dialog has closed
   * and the new rail icon is visible.
   */
  async function createTestConnection(name: string) {
    const newBtn = await $('[aria-label="New Connection"]');
    await newBtn.waitForDisplayed({ timeout: 10000 });
    await newBtn.click();

    const dialog = await $('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5000 });

    const nameInput = await $("#conn-name");
    await nameInput.setValue(name);

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

    const railIcon = await $(`[aria-label^="${name}"]`);
    await railIcon.waitForDisplayed({ timeout: 5000 });
    return railIcon;
  }

  it("rail toolbar exists with proper role", async () => {
    const toolbar = await $('[role="toolbar"][aria-label="Connections"]');
    await toolbar.waitForDisplayed({ timeout: 10000 });
    expect(await toolbar.isDisplayed()).toBe(true);
  });

  it("rail shows New Connection button (+)", async () => {
    const newBtn = await $('[aria-label="New Connection"]');
    await newBtn.waitForDisplayed({ timeout: 10000 });
    expect(await newBtn.isDisplayed()).toBe(true);
  });

  it("clicking a rail icon selects it (aria-pressed transitions to true)", async () => {
    const icon = await createTestConnection("Rail Pick");

    // Initial click — selection should flip to pressed
    await icon.click();
    await browser.waitUntil(
      async () => (await icon.getAttribute("aria-pressed")) === "true",
      { timeout: 3000, timeoutMsg: "Rail icon was never marked aria-pressed" },
    );
    expect(await icon.getAttribute("aria-pressed")).toBe("true");
  });

  it("double-clicking the rail icon connects and shows the schema tree", async () => {
    const icon = await $('[aria-label^="Rail Pick"]');
    await icon.waitForDisplayed({ timeout: 5000 });
    await icon.doubleClick();

    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.waitForDisplayed({ timeout: 15000 });
    expect(await publicSchema.isDisplayed()).toBe(true);
  });

  it("sidebar header strip reflects the selected connection name", async () => {
    // After the previous test the connection is still selected. The header
    // strip should display the connection's name (uppercased by CSS).
    const header = await $('//span[contains(text(), "Rail Pick")]');
    await header.waitForDisplayed({ timeout: 5000 });
    expect(await header.isDisplayed()).toBe(true);
  });
});
