import { expect } from "@wdio/globals";

/**
 * Sprint-124 — three regression guards in one spec:
 *
 *   1. **Paradigm cue parity (sprint 123)** — RDB tabs must NOT carry the
 *      "MongoDB collection tab" / "MongoDB query tab" aria-label. The Leaf
 *      marker is gated entirely on `tab.paradigm === "document"`; this test
 *      catches accidental DOM regressions for relational tabs.
 *
 *   2. **Keyboard cheatsheet (sprint 103)** — Ctrl+/ opens the global
 *      shortcut cheatsheet. Verifies the dialog header + at least one
 *      shortcut group is visible. The `?` variant has an editable-target
 *      guard which is harder to test reliably under tauri-driver, so we
 *      stick to the modifier path.
 *
 *   3. **Multi-statement results (sprint 100)** — Running two SELECTs in
 *      a single execution produces a Radix `TabsList` with
 *      `aria-label="Statement results"` and one trigger per statement.
 *
 * The spec assumes the `Test PG` connection from earlier specs is already
 * configured (or rebuilds it locally). Each test is self-contained.
 */

async function ensureConnectionsMode() {
  const tab = await $('[aria-label="Connections mode"]');
  await tab.waitForDisplayed({ timeout: 10000 });
  const selected = await tab.getAttribute("aria-selected");
  if (selected !== "true") {
    await tab.click();
  }
}

async function ensureConnected() {
  await ensureConnectionsMode();

  const existing = await $('[aria-label^="Test PG"]');
  let exists = false;
  try {
    await existing.waitForExist({ timeout: 5000 });
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    const newBtn = await $('[aria-label="New Connection"]');
    await newBtn.waitForDisplayed({ timeout: 10000 });
    await newBtn.click();

    const dialog = await $('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5000 });

    await (await $("#conn-name")).setValue("Test PG");

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

  const publicSchema = await $('[aria-label="public schema"]');
  let connected = false;
  try {
    await publicSchema.waitForDisplayed({ timeout: 3000 });
    connected = true;
  } catch {
    connected = false;
  }
  if (!connected) {
    const conn = await $('[aria-label^="Test PG"]');
    await conn.waitForDisplayed({ timeout: 5000 });
    await conn.doubleClick();
    await publicSchema.waitForDisplayed({ timeout: 15000 });
  }
}

/**
 * Dispatch a Ctrl-modified key from the document level. Mirrors the helper
 * in `keyboard-shortcuts.spec.ts` — webkit's webdriver `keys()` targets the
 * focused element, but the cheatsheet's listener is attached to `document`.
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

async function ensureSchemaExpanded(selector: string) {
  const schema = await $(selector);
  await schema.waitForDisplayed({ timeout: 15000 });
  const expanded = await schema.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await schema.click();
  }
}

async function ensureCategoryExpanded(selector: string) {
  const cat = await $(selector);
  await cat.waitForDisplayed({ timeout: 5000 });
  const expanded = await cat.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await cat.click();
  }
}

describe("Paradigm cues + global shortcuts (sprint 100/103/123)", () => {
  beforeEach(async () => {
    await ensureConnected();
  });

  it("does not render the MongoDB paradigm marker on RDB tabs (sprint 123)", async () => {
    // Open a table to ensure at least one RDB tab is mounted.
    await ensureSchemaExpanded('[aria-label="public schema"]');
    await ensureCategoryExpanded('[aria-label="Tables in public"]');

    const firstTable = await $('[aria-label$=" table"]');
    await firstTable.waitForDisplayed({ timeout: 5000 });
    await firstTable.click();

    // Scope the negative assertion to the TabBar's tablist so we don't
    // accidentally match unrelated MongoDB-labelled elements elsewhere.
    const tabBarTabs =
      '[role="tablist"][aria-label="Open connections"] [role="tab"]';
    const tabs = await $$(tabBarTabs);
    expect(tabs.length).toBeGreaterThan(0);

    // No tab on a PG connection should ever carry a MongoDB aria-label —
    // the Leaf marker is gated behind `paradigm === "document"`.
    const mongoMarkers = await $$(
      '[role="tablist"][aria-label="Open connections"] [aria-label*="MongoDB"]',
    );
    expect(mongoMarkers.length).toBe(0);
  });

  it("Ctrl+/ opens the keyboard shortcut cheatsheet (sprint 103)", async () => {
    // Make sure no other dialog is open before dispatching the shortcut —
    // the cheatsheet would mount on top, and Escape later might close the
    // wrong one.
    const stray = await $('[role="dialog"]');
    if (await stray.isExisting()) {
      await browser.keys(["Escape"]);
      try {
        await stray.waitForDisplayed({ timeout: 2000, reverse: true });
      } catch {
        // best effort — proceed
      }
    }

    // Some webkit/wry builds race with React's first effect; retry briefly.
    let opened = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await pressCtrl("/");
      try {
        const header = await $("//*[normalize-space()='Keyboard shortcuts']");
        await header.waitForDisplayed({ timeout: 2000 });
        opened = true;
        break;
      } catch {
        // try again
      }
    }
    expect(opened).toBe(true);

    // The dialog renders a search input + at least one group heading.
    // We assert against the search input (stable aria-label) rather than
    // a specific group label so future renames of the groups don't break
    // this guard.
    const search = await $('[aria-label="Search shortcuts"]');
    await search.waitForDisplayed({ timeout: 3000 });
    expect(await search.isDisplayed()).toBe(true);

    // Close so subsequent specs start clean.
    await browser.keys(["Escape"]);
    try {
      await search.waitForDisplayed({ timeout: 3000, reverse: true });
    } catch {
      // best effort
    }
  });

  it("multi-statement SELECT renders a Statement results tablist (sprint 100)", async () => {
    // Open a fresh query tab.
    const newQueryBtn = await $('[aria-label="New Query"]');
    await newQueryBtn.waitForDisplayed({ timeout: 5000 });
    await newQueryBtn.click();

    const editor = await $(".cm-editor");
    await editor.waitForDisplayed({ timeout: 5000 });

    const cmContent = await $(".cm-content");
    await cmContent.waitForDisplayed({ timeout: 5000 });
    await cmContent.click();
    await browser.pause(150);

    // Clear any prior content (defensive — query tabs start empty but the
    // session may have a stale value if a prior test left text behind).
    await browser.keys(["Control", "a"]);
    await browser.keys("Delete");
    await browser.pause(100);

    // Two trivial statements so the row counts/timings are deterministic.
    await browser.keys("SELECT 1 AS a; SELECT 2 AS b;");
    await browser.pause(200);

    const runBtn = await $('[aria-label="Run query"]');
    await runBtn.waitForDisplayed({ timeout: 5000 });
    await runBtn.click();

    // The multi-statement view mounts a Radix `TabsList` whose accessible
    // name is "Statement results" (see QueryResultGrid.tsx:345).
    const statementList = await $(
      '[role="tablist"][aria-label="Statement results"]',
    );
    await statementList.waitForDisplayed({ timeout: 15000 });
    expect(await statementList.isDisplayed()).toBe(true);

    // One trigger per SELECT — assert the count, not the labels, so the
    // test is robust to wording tweaks. Use a top-level scoped selector so
    // we mirror the chaining pattern other specs already exercise.
    const triggers = await $$(
      '[role="tablist"][aria-label="Statement results"] [role="tab"]',
    );
    expect(triggers.length).toBe(2);

    // Each trigger should expose a status (success/error). For a clean
    // `SELECT n` pair both must be success.
    for (const trigger of triggers) {
      const status = await trigger.getAttribute("data-status");
      expect(status).toBe("success");
    }
  });
});
