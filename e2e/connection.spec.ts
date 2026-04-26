import { expect } from "@wdio/globals";
import { ensureHomeScreen } from "./_helpers";

describe("Database Connection Flow", () => {
  it("creates a PostgreSQL connection via the dialog (from Home, sprint 125)", async () => {
    // Sprint 125 — connection management now lives on the Home screen. The
    // New Connection button is rendered in the Home header strip; the
    // dialog flow itself is unchanged.
    await ensureHomeScreen();

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
    await dbInput.setValue("table_view_test");

    // 4. Save
    const saveBtn = await $("button=Save");
    await saveBtn.click();

    // 5. Verify dialog closed. If the dialog stays open, surface any
    // backend error message so CI failures point at the actual cause
    // instead of "still displayed after 5000ms".
    try {
      await dialog.waitForDisplayed({ timeout: 5000, reverse: true });
    } catch (timeoutErr) {
      const alert = await $('[role="alert"]');
      if (await alert.isExisting()) {
        const msg = await alert.getText();
        throw new Error(
          `Save failed — dialog stayed open with alert: "${msg}". Original: ${(timeoutErr as Error).message}`,
        );
      }
      throw timeoutErr;
    }

    // 6. Verify connection appears in the Home screen's ConnectionList
    const connItem = await $('[aria-label^="Test PG"]');
    await connItem.waitForDisplayed({ timeout: 5000 });
    expect(await connItem.getAttribute("aria-label")).toContain("Test PG");
  });

  it("connects to PostgreSQL and shows schemas (Home → Workspace swap)", async () => {
    // Sprint 125 — double-click on the Home connection list item connects
    // and swaps the app shell to the Workspace screen. The schema tree is
    // rendered by Workspace's Sidebar.
    await ensureHomeScreen();

    const connItem = await $('[aria-label^="Test PG"]');
    await connItem.waitForDisplayed({ timeout: 5000 });
    // The connection row is `draggable="true"` and wrapped in a Radix
    // ContextMenuTrigger; webdriverio's native doubleClick() is unreliable
    // against this combination on the Linux tauri-driver runner ("element
    // did not become interactable"). Scroll into view, then dispatch a real
    // dblclick MouseEvent — React's synthetic event system listens via
    // bubbling delegation, so onDoubleClick still fires.
    await connItem.scrollIntoView();
    await browser.execute((el: HTMLElement) => {
      el.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    }, connItem);

    // Workspace has mounted — the back button is the Workspace sentinel.
    const back = await $('[aria-label="Back to connections"]');
    await back.waitForDisplayed({ timeout: 15000 });

    // Wait for connection to establish and schemas to load.
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.waitForDisplayed({ timeout: 15000 });
    expect(await publicSchema.isDisplayed()).toBe(true);
  });

  it("opens a query tab from the sidebar header New Query button", async () => {
    // After the previous test connected and swapped to Workspace, the
    // Workspace Sidebar header renders a "New Query Tab" button. Click it.
    const newQueryBtn = await $('[aria-label="New Query Tab"]');
    await newQueryBtn.waitForDisplayed({ timeout: 5000 });
    await newQueryBtn.click();

    // The query editor should appear (CodeMirror .cm-editor)
    const editor = await $(".cm-editor");
    await editor.waitForDisplayed({ timeout: 5000 });
    expect(await editor.isDisplayed()).toBe(true);
  });
});
