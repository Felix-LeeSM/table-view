import { expect } from "@wdio/globals";
import { openTestPgWorkspace, ensureHomeScreen } from "./_helpers";

/**
 * 2026-04-27 user feedback bucket — 12 real-usage UX gaps surfaced after
 * the Phase 10 sprint chain. Each `it` encodes the *desired* behaviour as
 * a concrete contract between the next sprint chain and this spec; bodies
 * are deferred (`this.skip()`) until each gap is wired up so the suite
 * stays green.
 *
 * The skip pattern mirrors `e2e/db-switcher.spec.ts` so the suite reports
 * pending work as skipped rather than silently passing.
 *
 * Sprint 149 post-chain: Phase 11 closing pass wires the P0 gaps —
 * #6 (Disconnect button) and #8 (PG preview tab parity) — to live
 * assertions. Remaining items stay `this.skip()` per the same pattern.
 *
 * Item #1 (Home picker window size) intentionally has no concrete
 * assertions yet — the design (Tauri window resize vs CSS layout vs
 * separate launcher window) is still under discussion with the user
 * (ADR 0011 / RISK-025 — phase 12 deferral).
 */

describe("Phase 11 feedback (2026-04-27)", () => {
  describe("#1 Home picker should be smaller than Workspace", () => {
    it("Home renders in a smaller viewport than Workspace [DESIGN-PENDING]", async function () {
      // Pending design discussion — three candidate approaches:
      //   A) Tauri WebviewWindow.setSize() on screen transition
      //   B) CSS-only: Home content max-width inside same window
      //   C) Two windows: small launcher + main workspace
      // Outline once design lands:
      //   1. ensureHomeScreen()
      //   2. const home = await browser.execute(() => ({
      //        w: window.innerWidth, h: window.innerHeight,
      //      }));
      //   3. openTestPgWorkspace()
      //   4. const ws = await browser.execute(() => ({...}));
      //   5. expect(home.w).toBeLessThan(ws.w);
      this.skip();
      expect(true).toBe(true);
    });
  });

  describe("#2 Switching connection from Home propagates to Workspace", () => {
    it("double-clicking a different connection swaps the workspace target", async function () {
      // Outline:
      //   1. openTestPgWorkspace() — workspace shows "Test PG"
      //   2. backToHome()
      //   3. create / pick a second connection ("Test PG Alt")
      //   4. dispatch dblclick on the alt row
      //   5. wait for Workspace re-mount
      //   6. assert sidebar header / topbar reflects "Test PG Alt", not
      //      "Test PG"
      this.skip();
      expect(true).toBe(true);
    });
  });

  describe("#3 Query autocomplete is paradigm- and DBMS-aware", () => {
    it("MongoDB query editor offers Mongo (not SQL) completions", async function () {
      if (!process.env.E2E_MONGO_HOST) this.skip();
      // Outline:
      //   1. open mongo connection → workspace
      //   2. open query tab
      //   3. type "db." into .cm-editor
      //   4. completion popup contains "find" / "aggregate"
      //   5. completion popup does NOT contain "SELECT"
      this.skip();
      expect(true).toBe(true);
    });

    it("PostgreSQL query editor offers SQL keyword completions", async function () {
      // Outline:
      //   1. openTestPgWorkspace()
      //   2. open query tab
      //   3. type "SEL"
      //   4. completion popup contains "SELECT"
      this.skip();
      expect(true).toBe(true);
    });

    it("MySQL query editor flavour differs from PostgreSQL flavour", async function () {
      if (!process.env.E2E_MYSQL_HOST) this.skip();
      // Outline:
      //   - PG offers RETURNING; MySQL offers LIMIT N,M form
      //   - assert one DBMS-only keyword is present and the other absent
      this.skip();
      expect(true).toBe(true);
    });
  });

  describe("#4 New Connection form is DBMS-specific", () => {
    it("MySQL default user is 'root' (not 'postgres')", async function () {
      // Outline:
      //   1. ensureHomeScreen() → click [aria-label="New Connection"]
      //   2. switch DBMS dropdown → MySQL
      //   3. read #conn-user value → expect "root"
      this.skip();
      expect(true).toBe(true);
    });

    it("SQLite form hides host/port and exposes a file picker", async function () {
      // Outline:
      //   1. open New Connection → SQLite
      //   2. expect #conn-host / #conn-port not displayed
      //   3. expect [aria-label="Database file"] (or similar) displayed
      this.skip();
      expect(true).toBe(true);
    });

    it("MongoDB default user is empty (atlas-style) rather than 'postgres'", async function () {
      // Outline:
      //   1. open New Connection → MongoDB
      //   2. read #conn-user → expect "" (or "admin"), never "postgres"
      this.skip();
      expect(true).toBe(true);
    });
  });

  describe("#5 Export/Import covers password + flexible selection", () => {
    it("encrypted export round-trip preserves the per-connection password", async function () {
      // Outline:
      //   1. ensureTestPgConnection (with password "testpass")
      //   2. open Import/Export → enter master pw → Generate encrypted JSON
      //   3. capture envelope text
      //   4. delete original connection
      //   5. switch to Import tab → paste envelope → enter same master pw
      //   6. import succeeds; new connection has has_password=true
      //   7. double-click → workspace connects without re-prompting password
      this.skip();
      expect(true).toBe(true);
    });

    it("exporting a single selected connection produces a 1-item payload", async function () {
      // Outline:
      //   1. ensureTestPgConnection + create a second connection
      //   2. open Import/Export → uncheck all → check only one
      //   3. Generate encrypted JSON
      //   4. assert envelope ciphertext length scales with 1 connection
      //      (reasonable upper bound — exact length depends on Argon2id
      //      output)
      this.skip();
      expect(true).toBe(true);
    });

    it("exporting a group exports exactly that group's connections", async function () {
      // Outline:
      //   1. seed: 2 connections in group "G1", 1 connection ungrouped
      //   2. open Import/Export → tick group G1 header → 2 children auto
      //      check, ungrouped stays unchecked
      //   3. Generate encrypted JSON → counter reads "2 connections,
      //      1 group selected"
      this.skip();
      expect(true).toBe(true);
    });

    it("plaintext export is NOT offered as a UI option", async function () {
      // Outline:
      //   1. open Import/Export
      //   2. expect no button matching /^Export plain/i or
      //      /^Generate JSON$/ (only "Generate encrypted JSON" remains)
      this.skip();
      expect(true).toBe(true);
    });
  });

  describe("#6 Workspace toolbar exposes Disconnect", () => {
    it("Disconnect button is reachable from the active connection toolbar", async () => {
      await openTestPgWorkspace();

      const btn = await $('[aria-label="Disconnect"]');
      await btn.waitForDisplayed({ timeout: 5000 });
      expect(await btn.isDisplayed()).toBe(true);

      // Tooltip / title carries the connection name so a sighted user
      // can verify which pool the click will tear down before committing.
      const title = await btn.getAttribute("title");
      expect(title).toBe("Disconnect from Test PG");

      // Sprint 134 contract: button is enabled when the focused
      // connection is in `connected` state. `disabled` attribute reflects
      // that state via the underlying button element.
      const disabled = await btn.getAttribute("disabled");
      expect(disabled).toBeFalsy();
    });
  });

  describe("#7 Disabled controls show meaningful tooltips (no sprint copy)", () => {
    it("no tooltip text mentions a sprint number", async function () {
      // Outline:
      //   1. openTestPgWorkspace()
      //   2. find every disabled button: $$('button[disabled]')
      //   3. for each: hover, read [role="tooltip"] text
      //   4. expect text not to match /sprint\s*\d+/i
      this.skip();
      expect(true).toBe(true);
    });

    it("schema selection lives in exactly one place (topbar XOR sidebar)", async function () {
      // Outline:
      //   1. openTestPgWorkspace()
      //   2. count [aria-label*="Schema"] toggles — sidebar tree node
      //      counts as the sidebar surface; a topbar dropdown counts as
      //      the topbar surface
      //   3. expect exactly one surface is present
      this.skip();
      expect(true).toBe(true);
    });
  });

  describe("#8 PostgreSQL single-click parity with MongoDB preview tabs", () => {
    /** Expand the public schema's Tables category so the table rows are
     * mounted and clickable. The tree may already be expanded from a
     * sibling test; aria-expanded acts as the idempotency gate. */
    async function ensureTablesCategoryOpen() {
      const schema = await $('[aria-label="public schema"]');
      await schema.waitForDisplayed({ timeout: 15000 });
      if ((await schema.getAttribute("aria-expanded")) !== "true") {
        await schema.click();
      }
      const cat = await $('[aria-label="Tables in public"]');
      await cat.waitForDisplayed({ timeout: 5000 });
      if ((await cat.getAttribute("aria-expanded")) !== "true") {
        await cat.click();
      }
    }

    /** Close every open tab so this describe block starts from a clean
     * tab strip. `[role="tablist"][aria-label="Open connections"]` scopes
     * away from MainArea's Records/Structure sub-tabs. */
    async function closeAllTabs() {
      const tabBarTabs =
        '[role="tablist"][aria-label="Open connections"] [role="tab"]';
      let remaining = await $$(tabBarTabs);
      while (remaining.length > 0) {
        const closeBtn = await remaining[0]!.$('[aria-label^="Close"]');
        await closeBtn.waitForExist({ timeout: 5000 });
        await browser.execute((el: HTMLElement) => el.click(), closeBtn);
        await browser.pause(150);
        remaining = await $$(tabBarTabs);
      }
    }

    beforeEach(async () => {
      await openTestPgWorkspace();
      await closeAllTabs();
      await ensureTablesCategoryOpen();
    });

    it("single-click on a PG table opens a preview tab", async () => {
      const firstTable = await $('[aria-label$=" table"]');
      await firstTable.waitForDisplayed({ timeout: 5000 });
      await firstTable.click();

      const previewTab = await $(
        '[role="tablist"][aria-label="Open connections"] [role="tab"][data-preview="true"]',
      );
      await previewTab.waitForDisplayed({ timeout: 5000 });
      expect(await previewTab.getAttribute("data-preview")).toBe("true");
    });

    it("single-clicking a second table replaces the preview tab", async () => {
      const tableRows = await $$('[aria-label$=" table"]');
      // Need at least two tables in the test fixture for the swap test.
      // The seed schema includes table_view_test + others — guard against
      // smaller fixtures so the spec isn't silently meaningless.
      if (tableRows.length < 2) {
        throw new Error(
          `expected ≥2 tables in public schema, found ${tableRows.length}`,
        );
      }

      await tableRows[0]!.click();
      await browser.pause(200);

      const tabBarTabs =
        '[role="tablist"][aria-label="Open connections"] [role="tab"]';
      const countAfterFirst = (await $$(tabBarTabs)).length;
      expect(countAfterFirst).toBe(1);

      await tableRows[1]!.click();
      await browser.pause(300);

      const countAfterSecond = (await $$(tabBarTabs)).length;
      // Sprint 136 contract: a second single-click on a different table
      // replaces (not appends) the preview tab. Total tab count holds.
      expect(countAfterSecond).toBe(1);

      const finalTab = await $(`${tabBarTabs}[data-preview="true"]`);
      await finalTab.waitForDisplayed({ timeout: 5000 });
      expect(await finalTab.getAttribute("data-preview")).toBe("true");
    });

    it("double-clicking pins the preview tab as permanent", async () => {
      const tableRows = await $$('[aria-label$=" table"]');
      if (tableRows.length < 2) {
        throw new Error(
          `expected ≥2 tables in public schema, found ${tableRows.length}`,
        );
      }

      await tableRows[0]!.doubleClick();
      await browser.pause(300);

      const tabBarTabs =
        '[role="tablist"][aria-label="Open connections"] [role="tab"]';
      const firstTab = await $(tabBarTabs);
      await firstTab.waitForDisplayed({ timeout: 5000 });
      // Permanent tab — no [data-preview] attribute (TabBar emits
      // `undefined` rather than "false", which webdriver returns as null).
      expect(await firstTab.getAttribute("data-preview")).toBeNull();

      await tableRows[1]!.click();
      await browser.pause(300);

      const tabsAfter = await $$(tabBarTabs);
      // Sprint 136 contract: a preview tab coexists with the pinned
      // permanent tab — totals 2.
      expect(tabsAfter.length).toBe(2);

      // The new tab is the preview; the original stays permanent.
      let previewCount = 0;
      let permanentCount = 0;
      for (const t of tabsAfter) {
        const attr = await t.getAttribute("data-preview");
        if (attr === "true") previewCount += 1;
        else permanentCount += 1;
      }
      expect(previewCount).toBe(1);
      expect(permanentCount).toBe(1);
    });

    afterEach(async () => {
      // Leave the suite on Home so cross-spec ordering stays predictable.
      await closeAllTabs();
      await ensureHomeScreen();
    });
  });

  describe("#9 Dirty indicator follows the dirty tab, not the focused tab", () => {
    it("typing in tab A then focusing tab B leaves the dot on A only", async function () {
      // Outline:
      //   1. openTestPgWorkspace()
      //   2. open two query tabs (A, B)
      //   3. focus A → type into .cm-editor
      //   4. click tab B header
      //   5. assert tab A has [data-dirty="true"]; B does not
      this.skip();
      expect(true).toBe(true);
    });
  });

  describe("#10 PG sidebar table count is the row count (or correctly labelled)", () => {
    it("the number next to a table reflects its row count", async function () {
      // Outline:
      //   1. openTestPgWorkspace()
      //   2. seed table_view_test with N rows via raw query (or rely on
      //      a known fixture row count)
      //   3. refresh sidebar
      //   4. read [aria-label$="row count"] for that table → matches N
      // Alternative if the number is intentionally not row count:
      //   - assert its title/aria-label clearly names what it represents
      this.skip();
      expect(true).toBe(true);
    });
  });

  describe("#11 Sidebar Functions node does not break layout", () => {
    it("clicking Functions keeps the sidebar within its container width", async function () {
      // Outline:
      //   1. openTestPgWorkspace()
      //   2. const before = await sidebar.getSize("width");
      //   3. click [aria-label="Functions"] tree node
      //   4. wait for children to render
      //   5. const after = await sidebar.getSize("width");
      //   6. expect(after).toBe(before);
      this.skip();
      expect(true).toBe(true);
    });
  });

  describe("#12 MongoDB switch database persists across re-open", () => {
    it("after switching to 'admin' the trigger label remains 'admin'", async function () {
      if (!process.env.E2E_MONGO_HOST) this.skip();
      // Outline:
      //   1. open mongo workspace
      //   2. click DB switcher trigger
      //   3. select "admin"
      //   4. close popover
      //   5. re-open switcher → trigger label says "admin", not the
      //      original default DB
      this.skip();
      expect(true).toBe(true);
    });
  });
});
