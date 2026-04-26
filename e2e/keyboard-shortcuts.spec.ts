import { expect } from "@wdio/globals";

import {
  backToHome,
  ensureHomeScreen,
  isWorkspaceMounted,
  openTestPgWorkspace,
} from "./_helpers";

/**
 * Press a Ctrl-modified key from the document level via JS injection. WDIO's
 * `keys()` method targets the focused element which can be flaky in Tauri's
 * webview, while a direct `dispatchEvent` reliably reaches the App-level
 * keydown listener. Hoisted out of the Sprint 60 describe so the Sprint 133
 * scenarios below can reuse it.
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

/**
 * Sprint 60: keyboard shortcut wiring smoke tests.
 *
 * Verifies that the Cmd+N (new connection) and Cmd+P (Quick Open) shortcuts
 * actually open their respective UIs end-to-end — both shortcuts only
 * dispatched events before Sprint 60.
 */
describe("Keyboard shortcuts (Sprint 60)", () => {
  /** Wait until the App + Sidebar listeners are mounted before dispatching. */
  async function ensureAppReady() {
    const newBtn = await $('[aria-label="New Connection"]');
    await newBtn.waitForDisplayed({ timeout: 10000 });
  }

  /**
   * Dispatch the shortcut and wait for the modal. Some webkit/wry builds
   * race with React's first effect, so retry the dispatch a few times.
   */
  async function pressUntilDialog(key: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      await pressCtrl(key);
      try {
        const dialog = await $('[role="dialog"]');
        await dialog.waitForDisplayed({ timeout: 2000 });
        return;
      } catch {
        // try again
      }
    }
    throw new Error(`Dialog never appeared after Ctrl+${key}`);
  }

  it("Ctrl+N opens the New Connection dialog", async () => {
    await ensureAppReady();
    const initialCount = (await $$('[role="dialog"]')).length;

    await pressUntilDialog("n");

    const newCount = (await $$('[role="dialog"]')).length;
    expect(newCount).toBeGreaterThan(initialCount);

    // Close it via Escape so subsequent specs start clean
    await browser.keys(["Escape"]);
  });

  it("Ctrl+P opens the Quick Open palette", async () => {
    await ensureAppReady();
    await pressUntilDialog("p");

    // The palette is identifiable by its placeholder copy
    const input = await $(
      'input[placeholder*="Search tables, views, functions"]',
    );
    await input.waitForDisplayed({ timeout: 3000 });
    expect(await input.isDisplayed()).toBe(true);

    await browser.keys(["Escape"]);
  });
});

/**
 * Sprint 133: new keyboard shortcuts wired in `App.tsx`.
 *
 *   - Cmd+, toggles between Home and Workspace.
 *   - Cmd+1..9 switches the active workspace tab.
 *   - Cmd+K opens the `<ConnectionSwitcher>` popover (workspace-only).
 *
 * The Cmd+, scenario is the only one that runs without a PG fixture (it
 * exercises Home → Workspace and back). The Cmd+K scenario depends on
 * Workspace being mounted, which in turn requires a successful PG
 * connection — gated on `PGHOST` so it runs in CI but skips locally
 * without a docker fixture.
 */
describe("Keyboard shortcuts (Sprint 133)", function () {
  it("Cmd+, toggles Home → Workspace and back", async function () {
    if (!process.env.PGHOST && !process.env.E2E_PG_HOST) {
      this.skip();
    }

    // Start on Home with the canonical Test PG connection seeded.
    await openTestPgWorkspace();
    expect(await isWorkspaceMounted()).toBe(true);

    // Cmd+, in Workspace → Home.
    await pressCtrl(",");
    const newBtn = await $('[aria-label="New Connection"]');
    await newBtn.waitForDisplayed({ timeout: 5000 });
    expect(await isWorkspaceMounted()).toBe(false);

    // Cmd+, on Home → Workspace.
    await pressCtrl(",");
    const back = await $('[aria-label="Back to connections"]');
    await back.waitForDisplayed({ timeout: 5000 });
    expect(await isWorkspaceMounted()).toBe(true);

    // Restore: leave the suite on Home so subsequent specs aren't
    // forced to start in Workspace.
    await backToHome();
  });

  it("Cmd+K opens the connection switcher popover", async function () {
    if (!process.env.PGHOST && !process.env.E2E_PG_HOST) {
      this.skip();
    }

    await openTestPgWorkspace();

    // ConnectionSwitcher is a Radix Select. Cmd+K dispatches the global
    // `open-connection-switcher` event which the controlled component
    // mirrors into its `open` state — the surfaced item carries the
    // contract-stable `aria-label="Connection: <name>"` (S125 AC-05),
    // which is more robust than relying on Radix's internal role.
    await pressCtrl("k");
    const item = await $('[aria-label="Connection: Test PG"]');
    await item.waitForDisplayed({ timeout: 5000 });
    expect(await item.isDisplayed()).toBe(true);

    // Close via Escape so the next spec starts clean.
    await browser.keys(["Escape"]);
    await backToHome();
    await ensureHomeScreen();
  });
});
