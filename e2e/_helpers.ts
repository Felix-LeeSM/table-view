import { expect } from "@wdio/globals";

/**
 * Shared e2e helpers (sprint 125+).
 *
 * Sprint 125 split the app into two top-level screens — Home (paradigm-
 * agnostic connection management) and Workspace (multi-paradigm tabs +
 * sidebar). The launch state is now Home, which means every spec that
 * interacts with a connection has to navigate Home → Open → Workspace
 * before it can touch the schema tree, the tab bar, or any query UI.
 *
 * These helpers centralise that flow. They are intentionally idempotent —
 * each helper detects "already in the right state" and short-circuits, so
 * specs can call them in `beforeEach` without worrying about leftover
 * state from previous tests.
 *
 * Naming follows the `ensure*` pattern already established in
 * `import-export.spec.ts` (`ensureConnectionsMode`,
 * `ensureTestPgConnection`).
 */

const TEST_PG_NAME = "Test PG";

/** True if the Workspace screen is currently mounted. We use the back
 * button as the sentinel because it is the unambiguous Workspace-only
 * marker (Home does not render any element with this aria-label). */
export async function isWorkspaceMounted(): Promise<boolean> {
  const back = await $('[aria-label="Back to connections"]');
  try {
    await back.waitForExist({ timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Make sure the Home screen is showing. Used by specs that need to look
 * up / create a connection before opening it. No-op when already on Home.
 */
export async function ensureHomeScreen() {
  if (!(await isWorkspaceMounted())) return;
  const back = await $('[aria-label="Back to connections"]');
  await back.waitForDisplayed({ timeout: 5000 });
  await back.click();
  // Home is the absence of the back button + presence of the New Connection
  // button (Home renders one in the header strip).
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
 * Home, wait for Workspace to mount, and wait for the public schema to
 * appear. After this returns the test can interact with the schema tree
 * / tab bar exactly as before sprint 125.
 */
export async function openTestPgWorkspace() {
  await ensureTestPgConnection();

  if (!(await isWorkspaceMounted())) {
    const conn = await $(`[aria-label^="${TEST_PG_NAME}"]`);
    await conn.waitForDisplayed({ timeout: 5000 });
    await conn.doubleClick();
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
 * Send the user back to the Home screen. No-op when already there.
 */
export async function backToHome() {
  if (!(await isWorkspaceMounted())) return;
  const back = await $('[aria-label="Back to connections"]');
  await back.waitForDisplayed({ timeout: 5000 });
  await back.click();
  const newBtn = await $('[aria-label="New Connection"]');
  await newBtn.waitForDisplayed({ timeout: 5000 });
}

/** Sanity guard so callers don't accidentally treat the helpers as
 * "did something" booleans. The `expect` import keeps wdio happy. */
export const __ensureHelpersLoaded = () => expect;
