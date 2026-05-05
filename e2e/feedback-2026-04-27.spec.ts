import { expect } from "@wdio/globals";
import { openTestPgWorkspace } from "./_helpers";

/**
 * 2026-04-27 user feedback bucket — Sprint 206 후 #6 Disconnect button
 * (LIVE) 만 남음. 다른 시나리오는 권위 component test 또는 outline
 * archive (docs/sprints/sprint-206/archived-placeholders.md) 로 이전.
 *
 * 제거 이력:
 *   - Sprint 170: #3 #4 #7 #8 #9 #11 e2e 제거. 권위 component test 가
 *     정확히 회귀 보호 (P1 피라미드 분리).
 *   - Sprint 206: #1 #2 #5 #10 #12 placeholder describe 제거. outline
 *     은 archive 로 이전. 후속 sprint 가 본문 작성 시 archive 입력값.
 *
 * 권위 component test 인용:
 *   - #3 PG/Mongo autocomplete: SqlQueryEditor.test.tsx (AC-S139-02) +
 *     MongoQueryEditor.test.tsx (AC-S139-01b cross-contamination guard)
 *   - #4 DBMS form (MySQL/SQLite/MongoDB defaults): ConnectionDialog.test.tsx
 *     (AC-S138-01/03/04)
 *   - #5 plaintext NOT offered: ImportExportDialog.ac149.test.tsx (AC-149-5)
 *   - #7 no sprint copy / schema 위치 한 곳:
 *     src/__tests__/no-stale-sprint-tooltip.test.ts (AC-141-2) +
 *     WorkspaceToolbar.test.tsx (AC-S135-01)
 *   - #8 PG preview tab parity: SchemaTree.preview.test.tsx
 *     (AC-S136-01/02/03) + tabStore.test.ts
 *   - #9 dirty indicator: TabBar.test.tsx AC-01/03/04 (sprint 97) +
 *     AC-S134-06 (sprint 134)
 *   - #11 Functions sidebar layout: SchemaTree.dbms-shape.test.tsx (AC-145-3)
 */

describe("Phase 11 feedback (2026-04-27)", () => {
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
});
