import { expect } from "@wdio/globals";

/**
 * Shared e2e helpers (sprint 125+, multi-window fix sprint 170).
 *
 * Sprint 125 split the app into two top-level screens — Home (paradigm-
 * agnostic connection management) and Workspace (multi-paradigm tabs +
 * sidebar). The launch state is now Home, which means every spec that
 * interacts with a connection has to navigate Home → Open → Workspace
 * before it can touch the schema tree, the tab bar, or any query UI.
 *
 * Phase 12 (sprint 150) made these two separate Tauri windows. tauri-driver
 * only connects to one window at a time, so helpers must explicitly call
 * `browser.switchWindow()` to move the WebDriver context between windows.
 *
 * These helpers centralise that flow. They are intentionally idempotent —
 * each helper detects "already in the right state" and short-circuits, so
 * specs can call them in `beforeEach` without worrying about leftover
 * state from previous tests.
 */

const TEST_PG_NAME = "Test PG";
const WORKSPACE_TITLE = "Table View — Workspace";

/**
 * Switch WebDriver context to the workspace window.
 *
 * Sprint 172 — `browser.switchWindow(matcher)` matches *only* windows
 * already known to wdio at call time. On Linux/Xvfb the workspace window
 * is `visible: false` in `tauri.conf.json` and only joins the
 * `getWindowHandles()` list after the user has triggered `workspace.show()`.
 * `switchWindow` does not poll, so calling it the moment the activation
 * IPC fires races the webview mount and throws "No window found...".
 *
 * Match-by-handle (mirroring `switchToLauncherWindow`) plus a polling loop
 * makes the helper resilient: each iteration re-fetches the handle list,
 * so the workspace handle becomes addressable as soon as Tauri exposes it.
 */
export async function switchToWorkspaceWindow(timeoutMs = 15000) {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const handles = await browser.getWindowHandles();
      for (const handle of handles) {
        await browser.switchToWindow(handle);
        const title = await browser.getTitle();
        if (title === WORKSPACE_TITLE) return;
      }
    } catch (e) {
      lastError = e;
    }
    await browser.pause(200);
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(
    `switchToWorkspaceWindow: workspace window did not appear within ${timeoutMs}ms${detail}`,
  );
}

/** Switch WebDriver context to the launcher window.
 * "Table View" alone matches both windows (workspace title contains it),
 * so we iterate handles and match by exact title. */
export async function switchToLauncherWindow() {
  const handles = await browser.getWindowHandles();
  for (const handle of handles) {
    await browser.switchToWindow(handle);
    const title = await browser.getTitle();
    if (!title.includes("Workspace")) return;
  }
  throw new Error("Launcher window not found");
}

/** True if the WebDriver is currently on the workspace window. */
export async function isWorkspaceMounted(): Promise<boolean> {
  try {
    const title = await browser.getTitle();
    return title.includes("Workspace");
  } catch {
    return false;
  }
}

/**
 * Make sure the Home (launcher) screen is showing. Used by specs that need
 * to look up / create a connection before opening it. No-op when already on
 * the launcher.
 *
 * Sprint 169 — Tauri 2.0 on Linux/Xvfb does NOT create a webview for windows
 * declared `visible: false` in `tauri.conf.json` until they are first shown.
 * That makes `switchWindow("Table View — Workspace")` throw on a fresh boot.
 * We therefore (1) attach to the launcher first, (2) wait long enough for
 * its React tree to mount before probing visibility, and (3) only attempt
 * the workspace-back-button recovery when the launcher really is hidden,
 * inside a try/catch so a missing workspace handle is not fatal.
 */
export async function ensureHomeScreen() {
  await switchToLauncherWindow();

  const launcherMain = await $('[data-testid="launcher-page"]');

  let launcherReady = false;
  try {
    await launcherMain.waitForDisplayed({ timeout: 10000 });
    launcherReady = true;
  } catch {
    launcherReady = false;
  }

  if (!launcherReady) {
    // Launcher webview is hidden — workspace must be foregrounded. The
    // workspace handle only exists after the user has activated a
    // connection in the current session, so wrap the whole recovery in
    // a try/catch.
    try {
      // Short timeout: if the workspace genuinely doesn't exist (fresh
      // boot path), we want to fall through to the New Connection probe
      // quickly rather than stall the recovery for 15s.
      await switchToWorkspaceWindow(3000);
      const back = await $('[aria-label="Back to connections"]');
      await back.waitForDisplayed({ timeout: 5000 });
      await back.click();
      await switchToLauncherWindow();
      await launcherMain.waitForDisplayed({ timeout: 10000 });
    } catch {
      // Fall through — the New Connection wait below will surface a
      // more actionable failure than a stale switchWindow rejection.
    }
  }

  const newBtn = await $('[aria-label="New Connection"]');
  await newBtn.waitForDisplayed({ timeout: 10000 });
}

/** Create the canonical Test PG connection from the Home screen if it
 * doesn't already exist. Leaves the user on the Home screen. */
export async function ensureTestPgConnection() {
  await ensureHomeScreen();

  const existing = await $(`[aria-label^="${TEST_PG_NAME}"]`);
  try {
    await existing.waitForExist({ timeout: 5000 });
    return;
  } catch {
    // fall through to create
  }

  const newBtn = await $('[aria-label="New Connection"]');
  await newBtn.waitForDisplayed({ timeout: 10000 });
  await newBtn.click();

  const dialog = await $('[role="dialog"]');
  await dialog.waitForDisplayed({ timeout: 5000 });

  await (await $("#conn-name")).setValue(TEST_PG_NAME);

  const hostInput = await $("#conn-host");
  await hostInput.clearValue();
  await hostInput.setValue("localhost");

  const portInput = await $("#conn-port");
  await portInput.clearValue();
  await portInput.setValue("5432");

  const userInput = await $("#conn-user");
  await userInput.clearValue();
  await userInput.setValue("testuser");

  await (await $("#conn-password")).setValue("testpass");

  const dbInput = await $("#conn-database");
  await dbInput.clearValue();
  await dbInput.setValue("table_view_test");

  await (await $("button=Save")).click();
  await dialog.waitForDisplayed({ timeout: 5000, reverse: true });
}

/**
 * Open the Test PG connection: ensure it exists, double-click it from
 * the launcher, switch to the workspace window, and wait for the public
 * schema to appear. After this returns the test can interact with the
 * schema tree / tab bar exactly as before sprint 125.
 */
export async function openTestPgWorkspace() {
  await ensureTestPgConnection();

  // ensureTestPgConnection guarantees we are on launcher with the React
  // tree mounted. We must double-click to *create* the workspace webview
  // — on Linux the workspace handle does not exist until then. Detect
  // "already on workspace" via launcher visibility: if launcher is no
  // longer displayed, a previous spec activated the connection and the
  // workspace handle exists.
  const launcherMain = await $('[data-testid="launcher-page"]');
  const launcherActive = await launcherMain.isDisplayed().catch(() => false);

  if (!launcherActive) {
    await switchToWorkspaceWindow();
  } else {
    const conn = await $(`[aria-label^="${TEST_PG_NAME}"]`);
    await conn.waitForDisplayed({ timeout: 5000 });
    await conn.doubleClick();
    await switchToWorkspaceWindow();
  }

  // The Workspace's [← Connections] back button is the unambiguous
  // Workspace marker.
  const back = await $('[aria-label="Back to connections"]');
  await back.waitForDisplayed({ timeout: 15000 });

  // Wait for the schema tree to render — Workspace's Sidebar mounts the
  // SchemaPanel which lazily loads the public schema once connected.
  const publicSchema = await $('[aria-label="public schema"]');
  await publicSchema.waitForDisplayed({ timeout: 15000 });
}

/**
 * Send the user back to the Home (launcher) screen. No-op when already
 * there. Mirrors `ensureHomeScreen`'s probe-launcher-first pattern (sprint 169).
 */
export async function backToHome() {
  await ensureHomeScreen();
}

/** Sanity guard so callers don't accidentally treat the helpers as
 * "did something" booleans. The `expect` import keeps wdio happy. */
export const __ensureHelpersLoaded = () => expect;
