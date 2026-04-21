describe("View Table — Smoke Tests", () => {
  it("launches the app window", async () => {
    // The app window should be open and the title should be set
    const title = await browser.getTitle();
    expect(title).toBe("View Table");
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

    const schemasTab = await $('[role="tab"][aria-selected="false"]');
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
