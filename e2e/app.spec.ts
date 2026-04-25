import { expect } from "@wdio/globals";
import {
  ensureHomeScreen,
  ensureTestPgConnection,
  openTestPgWorkspace,
} from "./_helpers";

describe("Table View — Smoke Tests", () => {
  it("launches the app window", async () => {
    // The app window should be open and the title should be set
    const title = await browser.getTitle();
    expect(title).toBe("Table View");
  });

  it("boots into the Home screen with the Connections header (sprint 125)", async () => {
    // Sprint 125 — the launch state is now the Home screen, which renders
    // its own header strip with `[data-testid="home-header"]` reading
    // "Connections". The legacy SidebarModeToggle is deliberately gone.
    await ensureHomeScreen();

    const header = await $('[data-testid="home-header"]');
    await header.waitForExist({ timeout: 10000 });
    const text = (((await header.getProperty("textContent")) as string) ?? "")
      .trim()
      .toLowerCase();
    expect(text).toContain("connections");

    // No SidebarModeToggle on Home.
    const modeToggle = await $('[aria-label="Schemas mode"]');
    expect(await modeToggle.isExisting()).toBe(false);
  });

  it("shows 'No connections yet' empty state when the store is empty", async () => {
    // Home renders ConnectionList directly; with an empty store the empty
    // state copy is "No connections yet".
    await ensureHomeScreen();
    const emptyState = await $('//p[normalize-space()="No connections yet"]');
    await emptyState.waitForDisplayed({ timeout: 10000 });
    const text = await emptyState.getText();
    expect(text).toContain("No connections yet");
  });

  it("displays the theme toggle button", async () => {
    await ensureHomeScreen();
    const themeButton = await $('[aria-label*="Theme"]');
    await themeButton.waitForDisplayed({ timeout: 10000 });
    const label = await themeButton.getAttribute("aria-label");
    expect(label).toContain("Theme");
  });

  it("opens the theme picker and applies a mode change", async () => {
    // The footer Theme control is no longer a cycle-on-click toggle — it is a
    // Popover trigger that opens a ThemePicker (Appearance ToggleGroup +
    // featured swatches). Clicking it once just opens the popover; to verify
    // the picker actually re-themes the app we have to interact with one of
    // the items inside.
    await ensureHomeScreen();
    const themeButton = await $('[aria-label*="Theme picker"]');
    await themeButton.waitForDisplayed({ timeout: 10000 });

    const initialLabel = await themeButton.getAttribute("aria-label");

    // Open the picker.
    await themeButton.click();

    // Pick whichever Appearance mode is NOT currently active so the label is
    // guaranteed to change. The default mode is "system"; if for some reason
    // the persisted state already says "system" we toggle to "dark" first.
    const target = initialLabel.includes("(dark)") ? "Light mode" : "Dark mode";
    const targetItem = await $(`[aria-label="${target}"]`);
    await targetItem.waitForDisplayed({ timeout: 5000 });
    await targetItem.click();

    // Dismiss the popover so the trigger button is the focused element again.
    await browser.keys(["Escape"]);

    await browser.waitUntil(
      async () =>
        (await themeButton.getAttribute("aria-label")) !== initialLabel,
      {
        timeout: 5000,
        timeoutMsg: "Theme picker label never updated after mode change",
      },
    );
  });

  it("shows the New Connection button on Home", async () => {
    // Sprint 125 — the New Connection button now lives in the Home header
    // strip. It is reachable as soon as the user is on the Home screen.
    await ensureHomeScreen();

    const newButton = await $('[aria-label="New Connection"]');
    await newButton.waitForDisplayed({ timeout: 10000 });
    expect(await newButton.isDisplayed()).toBe(true);
  });

  it("Workspace renders [← Connections] back button after Open (sprint 125)", async () => {
    // Sentinel for the Workspace screen: the back button. We need a
    // connection to open in the first place.
    await ensureTestPgConnection();
    await openTestPgWorkspace();

    const back = await $('[aria-label="Back to connections"]');
    await back.waitForDisplayed({ timeout: 5000 });
    expect(await back.isDisplayed()).toBe(true);

    // Return to Home so subsequent specs start from the documented baseline.
    await back.click();
    const newBtn = await $('[aria-label="New Connection"]');
    await newBtn.waitForDisplayed({ timeout: 5000 });
  });
});
