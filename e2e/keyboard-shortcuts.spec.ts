import { expect } from "@wdio/globals";

/**
 * Sprint 60: keyboard shortcut wiring smoke tests.
 *
 * Verifies that the Cmd+N (new connection) and Cmd+P (Quick Open) shortcuts
 * actually open their respective UIs end-to-end — both shortcuts only
 * dispatched events before Sprint 60.
 */
describe("Keyboard shortcuts (Sprint 60)", () => {
  /**
   * Press a Ctrl-modified key from the document level via JS injection. WDIO's
   * `keys()` method targets the focused element which can be flaky in Tauri's
   * webview, while a direct `dispatchEvent` reliably reaches the App-level
   * keydown listener.
   */
  async function pressCtrl(key: string) {
    await browser.execute((k: string) => {
      const event = new KeyboardEvent("keydown", {
        key: k,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
    }, key);
  }

  it("Ctrl+N opens the New Connection dialog", async () => {
    // Make sure we start with no dialog open
    const initial = await $$('[role="dialog"]');
    const initialCount = initial.length;

    await pressCtrl("n");

    // After dispatch, ConnectionDialog should mount and become visible.
    const dialog = await $('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5000 });

    const newCount = (await $$('[role="dialog"]')).length;
    expect(newCount).toBeGreaterThan(initialCount);

    // Close it via Escape so subsequent specs start clean
    await browser.keys(["Escape"]);
  });

  it("Ctrl+P opens the Quick Open palette", async () => {
    await pressCtrl("p");

    const dialog = await $('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5000 });

    // The palette is identifiable by its placeholder copy
    const input = await $(
      'input[placeholder*="Search tables, views, functions"]',
    );
    await input.waitForDisplayed({ timeout: 3000 });
    expect(await input.isDisplayed()).toBe(true);

    await browser.keys(["Escape"]);
  });
});
