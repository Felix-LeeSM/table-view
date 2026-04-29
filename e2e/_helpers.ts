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

/** Switch WebDriver context to the workspace window. */
export async function switchToWorkspaceWindow() {
  await browser.switchWindow(WORKSPACE_TITLE);
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
 */
export async function ensureHomeScreen() {
  // Try switching to workspace — if it exists, click Back first.
  try {
    await switchToWorkspaceWindow();
    const back = await $('[aria-label="Back to connections"]');
    await back.waitForDisplayed({ timeout: 5000 });
    await back.click();
  } catch {
    // Workspace window not reachable — already on launcher or no workspace.
  }
  await switchToLauncherWindow();
  const newBtn = await $('[aria-label="New Connection"]');
  await newBtn.waitForDisplayed({ timeout: 5000 });
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

  // Short-circuit: if already on the workspace, just verify it's responsive.
  try {
    await switchToWorkspaceWindow();
    const back = await $('[aria-label="Back to connections"]');
    await back.waitForExist({ timeout: 1000 });
    // Already on workspace — skip navigation.
  } catch {
    // Not on workspace — open from launcher.
    await switchToLauncherWindow();
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
 * there.
 */
export async function backToHome() {
  try {
    await switchToWorkspaceWindow();
    const back = await $('[aria-label="Back to connections"]');
    await back.waitForDisplayed({ timeout: 5000 });
    await back.click();
  } catch {
    // Not on workspace — already on launcher.
  }
  await switchToLauncherWindow();
  const newBtn = await $('[aria-label="New Connection"]');
  await newBtn.waitForDisplayed({ timeout: 5000 });
}

/** Sanity guard so callers don't accidentally treat the helpers as
 * "did something" booleans. The `expect` import keeps wdio happy. */
export const __ensureHelpersLoaded = () => expect;
