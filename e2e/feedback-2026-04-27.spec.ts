import { expect } from "@wdio/globals";
import { openTestPgWorkspace } from "./_helpers";

/**
 * 2026-04-27 user feedback bucket — 12 real-usage UX gaps.
 *
 * Sprint 170 triage (docs/sprints/sprint-170/triage.md):
 *   - DELETE 4 (e2e 제거, 권위 component test 이미 존재).
 *   - MOVE 5 (sprint-171 재검증 결과 모두 이미 권위 component test 존재 →
 *     DELETE 로 강등, sprint-171 에서 e2e 제거).
 *   - REVIVE 4: #1 Home picker, #2 connection swap, #5 encrypted round-trip,
 *     #10 row count, #12 Mongo db 지속 (sprint-172).
 *   - LIVE 1: #6 Disconnect button (그대로 유지).
 *
 * Sprint 171 후 이 파일에 남는 것은 #6 (LIVE) + REVIVE placeholder describe
 * 만이다. 권위 component test 인용:
 *   - #3 PG/Mongo autocomplete: SqlQueryEditor.test.tsx (AC-S139-02) +
 *     MongoQueryEditor.test.tsx (AC-S139-01b cross-contamination guard)
 *   - #4 DBMS form (MySQL/SQLite/MongoDB defaults): ConnectionDialog.test.tsx
 *     (AC-S138-01/03/04)
 *   - #5 plaintext NOT offered: ImportExportDialog.ac149.test.tsx (AC-149-5)
 *   - #7 no sprint copy / schema 위치 한 곳:
 *     src/__tests__/no-stale-sprint-tooltip.test.ts (AC-141-2) +
 *     WorkspaceToolbar.test.tsx (AC-S135-01)
 *   - #11 Functions sidebar layout: SchemaTree.dbms-shape.test.tsx (AC-145-3)
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

  // Sprint 171 — #3 (PG/Mongo autocomplete) e2e 제거. 권위:
  //   - SqlQueryEditor.test.tsx AC-S139-02 (PG/MySQL/SQLite dialect keyword
  //     highlighting)
  //   - MongoQueryEditor.test.tsx AC-S139-01b (completion source includes
  //     MQL operators) + cross-contamination guard (NEVER includes
  //     SELECT/FROM/WHERE)
  // P1 (피라미드) 적용 — 분기 자체가 컴포넌트 단위에서 구조적으로 검증됨.

  // Sprint 171 — #4 (DBMS-specific form) e2e 제거. 권위:
  //   - ConnectionDialog.test.tsx AC-S138-01/03 (MySQL: port=3306, user=root)
  //   - ConnectionDialog.test.tsx AC-S138-04 (SQLite: file path field 만,
  //     host/port/user/password absent)
  //   - ConnectionDialog.test.tsx AC-S138-01 Mongo (port=27017,
  //     user defaults to empty NOT "postgres")

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

    // Sprint 171 — plaintext NOT offered e2e 제거. 권위:
    //   ImportExportDialog.ac149.test.tsx AC-149-5 가 정확히 검증 — dialog
    //   exposes only "Generate encrypted JSON", no plaintext button anywhere.
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

  // Sprint 171 — #7 e2e 제거. 권위:
  //   - no sprint copy: src/__tests__/no-stale-sprint-tooltip.test.ts
  //     (AC-141-2) 가 src/ 전체를 4 regex 로 스캔 — 정적 가드가 e2e 보다
  //     강함.
  //   - schema selection 한 곳: WorkspaceToolbar.test.tsx AC-S135-01 이
  //     legacy SchemaSwitcher chip 부재를 검증. Sidebar tree 가 유일한
  //     선택 surface.

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

  // Sprint 171 — #11 Functions sidebar layout e2e 제거. 권위:
  //   SchemaTree.dbms-shape.test.tsx AC-145-3 가 세 가지 구조 불변성으로
  //   ≤1px width delta 를 보장 — (1) data-category-overflow="capped",
  //   (2) 모든 함수 행의 w-full, (3) args span 의 truncate. jsdom 에서
  //   실제 width 측정은 불가하지만 구조적 검증이 더 견고하다.

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
