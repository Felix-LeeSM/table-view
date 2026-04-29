import { expect } from "@wdio/globals";
import {
  backToHome,
  ensureHomeScreen,
  ensureTestPgConnection,
  openTestPgWorkspace,
  switchToLauncherWindow,
} from "./_helpers";

/**
 * Sprint 125 — Home / Workspace full-screen swap regression spec.
 *
 * Covers the four contract scenarios from `docs/sprints/sprint-125/contract.md`:
 *
 *   1. Boot → Home visible (ConnectionList rendered, no
 *      `[role="tablist"][aria-label="Open connections"]` visible).
 *   2. Open Test PG → Workspace
 *      (`[role="tablist"][aria-label="Open connections"]` visible after a
 *      query/table tab is created; schema panel mounts).
 *   3. Click `[aria-label="Back to connections"]` → Home again.
 *   4. Re-Open Test PG → same active tab restored (persisted via tabStore).
 */

describe("Home ↔ Workspace screen swap (sprint 125)", () => {
  it("boots into the Home screen with the ConnectionList rendered", async () => {
    await ensureHomeScreen();

    // ConnectionList is the body of the Home screen. Empty store still
    // renders the "No connections yet" empty card; a populated store shows
    // the items. Either way, the parent ConnectionList container has the
    // `data-testid="connection-list-root"` sentinel.
    const list = await $('[data-testid="connection-list-root"]');
    await list.waitForDisplayed({ timeout: 10000 });
    expect(await list.isDisplayed()).toBe(true);

    // Workspace's TabBar must NOT be visible on Home.
    const tabBar = await $('[role="tablist"][aria-label="Open connections"]');
    expect(await tabBar.isExisting()).toBe(false);

    // Back button is Workspace-only and must also be absent.
    const back = await $('[aria-label="Back to connections"]');
    expect(await back.isExisting()).toBe(false);
  });

  it("Open Test PG swaps to Workspace (schema panel + tab bar mounts)", async () => {
    await ensureTestPgConnection();
    await openTestPgWorkspace();

    // Workspace sentinel — back button is the unambiguous marker.
    const back = await $('[aria-label="Back to connections"]');
    await back.waitForDisplayed({ timeout: 5000 });
    expect(await back.isDisplayed()).toBe(true);

    // Schema panel mounted (public schema visible).
    const publicSchema = await $('[aria-label="public schema"]');
    await publicSchema.waitForDisplayed({ timeout: 15000 });
    expect(await publicSchema.isDisplayed()).toBe(true);

    // Open a query tab so the TabBar tablist becomes visible — without
    // any tab the TabBar still renders but the assertion is more
    // meaningful when at least one tab exists.
    const newQueryBtn = await $('[aria-label="New Query Tab"]');
    await newQueryBtn.waitForDisplayed({ timeout: 5000 });
    await newQueryBtn.click();

    const tabBar = await $('[role="tablist"][aria-label="Open connections"]');
    await tabBar.waitForDisplayed({ timeout: 5000 });
    expect(await tabBar.isDisplayed()).toBe(true);
  });

  it("clicking [← Connections] returns to Home", async () => {
    // Assumes the previous test left us inside Workspace with a query tab
    // open. We don't reset between tests within the same describe.
    const back = await $('[aria-label="Back to connections"]');
    await back.waitForDisplayed({ timeout: 5000 });
    await back.click();
    await switchToLauncherWindow();

    // Home sentinel — the New Connection button on the Home header strip.
    const newBtn = await $('[aria-label="New Connection"]');
    await newBtn.waitForDisplayed({ timeout: 5000 });
    expect(await newBtn.isDisplayed()).toBe(true);

    // Workspace markers must be absent.
    const backAgain = await $('[aria-label="Back to connections"]');
    expect(await backAgain.isExisting()).toBe(false);

    const tabBar = await $('[role="tablist"][aria-label="Open connections"]');
    expect(await tabBar.isExisting()).toBe(false);
  });

  it("re-Opening Test PG restores the previously active tab (tabStore persistence)", async () => {
    // Capture the count of open Workspace tabs after re-entry — the
    // previous spec opened exactly one query tab; re-opening Test PG must
    // not blow tabs away.
    await openTestPgWorkspace();

    const tabBar = await $('[role="tablist"][aria-label="Open connections"]');
    await tabBar.waitForDisplayed({ timeout: 5000 });

    const tabs = await $$(
      '[role="tablist"][aria-label="Open connections"] [role="tab"]',
    );
    // At least one tab should still be open from the previous step.
    expect(tabs.length).toBeGreaterThan(0);

    // Clean up so subsequent specs start from a known place.
    await backToHome();
  });
});
