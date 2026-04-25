describe("Table View — Smoke Tests", () => {
  it("launches the app window", async () => {
    // The app window should be open and the title should be set
    const title = await browser.getTitle();
    expect(title).toBe("Table View");
  });

  it("renders the sidebar header with the current mode label", async () => {
    // The sidebar starts in "connections" mode by default, so the header
    // strip should read "Connections". After clicking the Schemas tab it
    // should read "Schemas" (when no connection is selected).
    // WebKit's webdriver returns an empty string from getText() on truncate
    // spans, so read textContent via getProperty for stability.
    const header = await $('[data-testid="sidebar-connection-header"]');
    await header.waitForExist({ timeout: 10000 });

    let text = ((await header.getProperty("textContent")) as string) ?? "";
    expect(text.trim().toLowerCase()).toContain("connections");

    // Sprint-124 fixup: the sidebar mode picker is a Radix ToggleGroup
    // (items render with role="radio", not role="tab"). Query by the stable
    // `aria-label="Schemas mode"` attribute instead.
    const schemasTab = await $('[aria-label="Schemas mode"]');
    await schemasTab.waitForDisplayed({ timeout: 5000 });
    await schemasTab.click();

    // Re-read the same node — its text should now read "Schemas".
    await browser.waitUntil(
      async () =>
        (((await header.getProperty("textContent")) as string) ?? "")
          .trim()
          .toLowerCase()
          .includes("schemas"),
      { timeout: 5000 },
    );
    text = ((await header.getProperty("textContent")) as string) ?? "";
    expect(text.trim().toLowerCase()).toContain("schemas");
  });

  it("shows 'No connections yet' empty state when the store is empty", async () => {
    // The default connections mode renders ConnectionList, which now shows
    // its own empty state. (The schema-panel empty state is only reached
    // after switching to Schemas mode without any connection selected.)
    const emptyState = await $('//p[normalize-space()="No connections yet"]');
    await emptyState.waitForDisplayed({ timeout: 10000 });
    const text = await emptyState.getText();
    expect(text).toContain("No connections yet");
  });

  it("displays the theme toggle button", async () => {
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

  it("shows the New Connection button", async () => {
    // The New Connection button is scoped to connections mode; previous test
    // leaves the sidebar in schemas mode, so switch back first.
    const connectionsTab = await $('[aria-label="Connections mode"]');
    await connectionsTab.waitForDisplayed({ timeout: 5000 });
    await connectionsTab.click();

    const newButton = await $('[aria-label="New Connection"]');
    await newButton.waitForDisplayed({ timeout: 10000 });
    expect(await newButton.isDisplayed()).toBe(true);
  });

  it("sidebar has a resize handle", async () => {
    // The resize handle is an absolute-positioned div at the right edge
    const sidebar = await $(".border-r");
    await sidebar.waitForDisplayed({ timeout: 10000 });
    expect(await sidebar.isDisplayed()).toBe(true);
  });
});
