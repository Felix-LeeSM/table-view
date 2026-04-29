import { expect } from "@wdio/globals";
import {
  backToHome,
  ensureHomeScreen,
  openTestPgWorkspace,
  switchToLauncherWindow,
  switchToWorkspaceWindow,
} from "./_helpers";

const TEST_MONGO_NAME = "Test Mongo";

/**
 * Create a MongoDB connection from the Home screen if it doesn't already exist.
 */
async function ensureTestMongoConnection() {
  await ensureHomeScreen();

  const existing = await $(`[aria-label^="${TEST_MONGO_NAME}"]`);
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

  // Switch DB type to MongoDB via Radix Select
  const dbTypeTrigger = await $("#conn-db-type");
  await dbTypeTrigger.waitForDisplayed({ timeout: 5000 });
  await dbTypeTrigger.click();

  // Radix renders options in a portal — wait for the listbox to appear
  const mongoOption = await $('div[role="option"][data-value="mongodb"]');
  await mongoOption.waitForDisplayed({ timeout: 5000 });
  await mongoOption.click();

  await (await $("#conn-name")).setValue(TEST_MONGO_NAME);

  const hostInput = await $("#conn-host");
  await hostInput.clearValue();
  await hostInput.setValue(process.env.E2E_MONGO_HOST ?? "mongo");

  const portInput = await $("#conn-port");
  await portInput.clearValue();
  await portInput.setValue("27017");

  const userInput = await $("#conn-user");
  await userInput.clearValue();
  await userInput.setValue("testuser");

  await (await $("#conn-password")).setValue("testpass");

  const dbInput = await $("#conn-database");
  await dbInput.clearValue();
  await dbInput.setValue("admin");

  await (await $("button=Save")).click();
  await dialog.waitForDisplayed({ timeout: 5000, reverse: true });
}

/**
 * Open the Test Mongo connection: ensure it exists, double-click, switch
 * to workspace, wait for the document database tree to load.
 */
async function openTestMongoWorkspace() {
  await ensureTestMongoConnection();

  try {
    await switchToWorkspaceWindow();
    const filterInput = await $(
      '[aria-label="Filter databases and collections"]',
    );
    await filterInput.waitForExist({ timeout: 1000 });
    // Already on workspace with Mongo
  } catch {
    await switchToLauncherWindow();
    const conn = await $(`[aria-label^="${TEST_MONGO_NAME}"]`);
    await conn.waitForDisplayed({ timeout: 5000 });
    await conn.doubleClick();
    await switchToWorkspaceWindow();
  }

  // Wait for the document database tree to render
  const filterInput = await $(
    '[aria-label="Filter databases and collections"]',
  );
  await filterInput.waitForDisplayed({ timeout: 15000 });
}

/**
 * Connection switching E2E — verifies the multi-connection, multi-paradigm
 * flow: PostgreSQL ↔ MongoDB swap via the Home launcher.
 *
 * Covers:
 *   1. Open PG workspace, verify RDB sidebar (schema tree)
 *   2. Back → Open Mongo, verify document sidebar (database tree)
 *   3. Back → Open PG again, verify RDB sidebar restored
 */
describe("Connection switching (PG ↔ Mongo)", function () {
  before(function () {
    if (!process.env.E2E_MONGO_HOST) {
      this.skip();
    }
  });

  it("opens PG and shows the RDB schema tree", async function () {
    await openTestPgWorkspace();

    // RDB sidebar: public schema node
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.waitForDisplayed({ timeout: 15000 });
    expect(await publicSchema.isDisplayed()).toBe(true);

    // Document tree must NOT be present
    const docFilter = await $(
      '[aria-label="Filter databases and collections"]',
    );
    expect(await docFilter.isExisting()).toBe(false);
  });

  it("switches to Mongo and shows the document database tree", async function () {
    // Go back to launcher
    await backToHome();

    // Open Mongo connection
    await openTestMongoWorkspace();

    // Document sidebar: filter input is the sentinel
    const docFilter = await $(
      '[aria-label="Filter databases and collections"]',
    );
    await docFilter.waitForDisplayed({ timeout: 15000 });
    expect(await docFilter.isDisplayed()).toBe(true);

    // RDB sidebar must NOT be present
    const publicSchema = await $('[aria-label="public schema"]');
    expect(await publicSchema.isExisting()).toBe(false);
  });

  it("switches back to PG and shows the RDB schema tree again", async function () {
    // Go back to launcher
    await backToHome();

    // Re-open PG connection
    await openTestPgWorkspace();

    // RDB sidebar restored
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.waitForDisplayed({ timeout: 15000 });
    expect(await publicSchema.isDisplayed()).toBe(true);

    // Clean up
    await backToHome();
  });
});
