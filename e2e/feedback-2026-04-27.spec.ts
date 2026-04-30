import { expect } from "@wdio/globals";
import { openTestPgWorkspace } from "./_helpers";

/**
 * 2026-04-27 user feedback bucket — 12 real-usage UX gaps.
 *
 * Sprint 170 triage (docs/sprints/sprint-170/triage.md):
 *   - DELETE 4: #3 MySQL autocomplete (DBMS 미지원), #8 preview tab 3종
 *     (SchemaTree.preview.test.tsx + tabStore.test.ts 권위), #9 dirty
 *     indicator (TabBar.test.tsx AC-S134-06 권위).
 *   - MOVE 5: #3 PG/Mongo autocomplete, #4 form 3종, #5 plaintext NOT
 *     offered, #7 sprint copy / schema 위치 한 곳, #11 Functions layout
 *     (sprint-171 에서 component test 신규 작성).
 *   - REVIVE 4: #1 Home picker (RISK-025 resolved, sprint-172 에서
 *     `app.spec.ts` 흡수), #2 connection swap, #5 encrypted round-trip,
 *     #10 row count, #12 Mongo db 지속 (sprint-172).
 *   - LIVE 1: #6 Disconnect button (그대로 유지).
 *
 * Sprint 170 작업 후 이 파일에 남는 것은:
 *   - #6 (LIVE) — 변경 없음
 *   - 사용자 피드백 ID 보존을 위한 placeholder describe 만 (REVIVE/MOVE 전환
 *     시점에 흡수처에 인용).
 */

describe("Phase 11 feedback (2026-04-27)", () => {
  describe("#1 Home picker should be smaller than Workspace", () => {
    // Sprint 170 — RISK-025 가 sprint 155 에 resolved. tauri.conf.json 에
    // launcher 720x560 fixed / workspace 1280x800 resizable 로 분리됨.
    // 본문 작성은 sprint-172 에서 `app.spec.ts` 에 흡수 (REVIVE).
    it.skip(
      "Home renders in a smaller viewport than Workspace [REVIVE-sprint-172]",
    );
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

    // Sprint 170 — MySQL autocomplete 시나리오 제거 (DBMS 미지원, Phase 17~20
    // 도입 예정). 재도입 시 신규 spec 으로 들어옴 (P6 만료 조건 충족 — 만료
    // 사유: DBMS 자체가 부재).
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

  // Sprint 170 — #8 (PG preview tab parity, 3 it) 와 #9 (dirty indicator)
  // 는 component / store 레이어가 권위:
  //   - #8: SchemaTree.preview.test.tsx (AC-S136-01/02/03) + tabStore.test.ts
  //   - #9: TabBar.test.tsx AC-01/03/04 (sprint 97) + AC-S134-06 (sprint 134,
  //     active 와 dirty 분리 정확히 검증)
  // P1 (피라미드 분리) 적용 — e2e 변형 제거.

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
