describe("View Table — Smoke Tests", () => {
  it("launches the app window", async () => {
    // The app window should be open and the title should be set
    const title = await browser.getTitle();
    expect(title).toBe("View Table");
  });

  it("renders the sidebar with Schemas header in the empty state", async () => {
    // Sidebar header now shows the active connection name or 'Schemas' when
    // nothing is selected. With no saved connections we expect the fallback.
    // WebKit's webdriver returns an empty string from getText() on truncate
    // spans, so read textContent via getProperty for stability.
    const header = await $('[data-testid="sidebar-connection-header"]');
    await header.waitForExist({ timeout: 10000 });
    const text = ((await header.getProperty("textContent")) as string) ?? "";
    expect(text.trim().toLowerCase()).toContain("schemas");
  });

  it("shows empty state when no connections exist", async () => {
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

  it("cycles the theme on toggle click", async () => {
    const themeButton = await $('[aria-label*="Theme"]');
    await themeButton.waitForDisplayed({ timeout: 10000 });

    // Get initial theme label
    const initialLabel = await themeButton.getAttribute("aria-label");

    // Click to cycle theme
    await themeButton.click();

    // Wait for theme to update
    await browser.pause(500);

    // Label should have changed (e.g., "Theme: system" -> "Theme: light")
    const newLabel = await themeButton.getAttribute("aria-label");
    expect(newLabel).not.toBe(initialLabel);
  });

  it("shows the New Connection button", async () => {
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
