// E2E for the original five history sources (Phase 5 F.5).
// `explain` is covered by postgres-explain.spec.ts.
//
// Reason: AC-373-06 — after each of the five source callers (`raw` /
// `grid-edit` / `ddl-structure` / `mongo-op` / `sidebar-prefetch`) fires
// once inside a user workflow, all five `source` column values must exist
// in the SQLite `query_history` table.
//
// Eight-principle mapping:
//   1. Multiple components + windows + IPC combined — a path vitest cannot
//      cover.
//   2. User intent: "open both Postgres and Mongo connections and trigger
//      the five entry points in turn" — a single straight-line it.
//   3. CUJ regression: cross-cut of connection→first query + paradigm
//      switch + cell edit + DDL menu + Mongo bulk op + sidebar prefetch.
//   4. Matrix simplification: PG (raw / grid-edit / ddl-structure /
//      sidebar-prefetch) + Mongo (mongo-op) — the original five sources
//      branch across both DBMSes.
//   5. Regression pin: the core lego invariant behind AC-373-06.
//   6. No skip.
//   7. tauri-driver limits: all five triggers are directly reachable from
//      user-visible UI — no downgrade path needed.
//   8. Diagnosability: each step has a label + screenshot.
//
// This spec requires the host docker daemon to be running the PG / Mongo
// containers (same precondition as the other e2e specs).
//
// Deliberately does not open SQLite directly to grep the `source` column —
// in the spirit of eight-principle #2, only user-visible APIs verify that
// the lego pieces click together. Asserts via the source badge / SQL text
// in the global query log panel instead.
//
// #2041 — this spec was committed with stale markup because CI had never
// run it. Items aligned with the conventions of the passing specs:
//   * grid wait: `<table>` was retired in favor of CSS Grid, so
//     `waitForGridTextAll` watches `[role="grid"]` instead of `$("table")`
//     (same as `postgres.spec.ts`).
//   * source badge evidence panel: the `QueryLog` opened by
//     `toggle-query-log` never renders badges. Only `GlobalQueryLogPanel` /
//     `QueryHistoryPanel` render them, so this spec switched to
//     `toggle-global-query-log` (same pattern as
//     `waitForStructureHistoryEvidence` in `postgres-structure-ddl.spec.ts`).
//   * `raw` assertion: per AC-196-06-1 `QueryHistorySourceBadge`
//     intentionally renders nothing when `source === "raw"` (early return
//     in `QueryHistorySourceBadge.tsx` + unit test of the same name).
//     `[data-source="raw"]` is therefore structurally unreachable — the raw
//     entry is asserted via the SQL text logged instead of a badge. The
//     AC-373-06 intent that all five sources get recorded is unchanged.

import { $, browser, expect } from "@wdio/globals";
import {
  createMongoConnection,
  createPostgresConnection,
  editGridCellInRow,
  executeSqlPreview,
  expandIfCollapsed,
  openConnection,
  openNewQueryTab,
  runQuery,
  switchToWorkspaceWindow,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";

const PG_CONNECTION = "E2E History Source PG";
const MONGO_CONNECTION = "E2E History Source Mongo";

// Opens the global query log (leaves it as is if already open).
// Same procedure `postgres-structure-ddl.spec.ts` passes with in CI.
async function openGlobalQueryLog() {
  await switchToWorkspaceWindow();
  const isOpen = await browser.execute(() =>
    Boolean(document.querySelector('[data-testid="global-query-log-panel"]')),
  );
  if (!isOpen) {
    await browser.execute(() => {
      window.dispatchEvent(new CustomEvent("toggle-global-query-log"));
    });
  }
  const panel = await $('[data-testid="global-query-log-panel"]');
  await panel.waitForDisplayed({ timeout: 10000 });
}

// Closes it again once the assertion is done — leaving the panel open can
// overlap subsequent grid / sidebar clicks.
async function closeGlobalQueryLog() {
  const isOpen = await browser.execute(() =>
    Boolean(document.querySelector('[data-testid="global-query-log-panel"]')),
  );
  if (isOpen) {
    await browser.execute(() => {
      window.dispatchEvent(new CustomEvent("toggle-global-query-log"));
    });
  }
}

// React controlled inputs ignore `element.value = x`, so set the value via
// the native setter and dispatch input/change — the same approach as
// `setInput` in `_helpers.ts` and `postgres-structure-ddl.spec.ts`.
async function setAriaInput(ariaLabel: string, value: string) {
  const input = await $(`input[aria-label="${ariaLabel}"]`);
  await input.waitForDisplayed({ timeout: 10000 });
  await browser.execute(
    (label, nextValue) => {
      const element = document.querySelector<HTMLInputElement>(
        `input[aria-label="${label}"]`,
      );
      if (!element) throw new Error(`${label} input did not appear`);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("HTMLInputElement value setter missing");
      element.focus();
      setter.call(element, nextValue);
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur();
    },
    ariaLabel,
    value,
  );
}

// AddColumnDialog's Apply is enabled only when
// `canApply = valid name && non-empty type && preview SQL arrived`. The
// preview fills asynchronously after a debounce, so wait before clicking.
async function waitForAddColumnPreview(fragment: string, timeoutMs = 15000) {
  await browser.waitUntil(
    async () =>
      await browser.execute((needle) => {
        const preview = document.querySelector("#add-column-ddl-preview");
        return (preview?.textContent ?? "").includes(needle);
      }, fragment),
    {
      timeout: timeoutMs,
      timeoutMsg: `add-column DDL preview did not include "${fragment}" within ${timeoutMs}ms`,
    },
  );
}

// Asserts that the badge for a given source mounted in the global query
// log. `QueryHistorySourceBadge` renders a span with
// `data-source="<source>"`. Clicking `global-log-new-entry` flushes the
// pending new entries — the same flush mechanism the passing specs use.
async function waitForSourceBadge(source: string, timeoutMs = 15000) {
  await openGlobalQueryLog();
  await browser.waitUntil(
    async () => {
      await browser.execute(() => {
        document
          .querySelector<HTMLElement>('[data-testid="global-log-new-entry"]')
          ?.click();
      });
      return await browser.execute(
        (target) =>
          Boolean(document.querySelector(`[data-source="${target}"]`)),
        source,
      );
    },
    {
      timeout: timeoutMs,
      timeoutMsg: `query_history row with source="${source}" did not appear within ${timeoutMs}ms`,
    },
  );
  await closeGlobalQueryLog();
}

// `raw` suppresses the badge (AC-196-06-1), so the record is asserted via
// the SQL text logged.
async function waitForRawHistorySql(fragment: string, timeoutMs = 15000) {
  await openGlobalQueryLog();
  await browser.waitUntil(
    async () => {
      await browser.execute(() => {
        document
          .querySelector<HTMLElement>('[data-testid="global-log-new-entry"]')
          ?.click();
      });
      return await browser.execute((needle) => {
        const panel = document.querySelector(
          '[data-testid="global-query-log-panel"]',
        );
        return (panel?.textContent ?? "").includes(needle);
      }, fragment);
    },
    {
      timeout: timeoutMs,
      timeoutMsg: `raw query_history row containing "${fragment}" did not appear within ${timeoutMs}ms`,
    },
  );
  await closeGlobalQueryLog();
}

// Eight-principle #8 — diagnostic step label. The wdio mocha reporter
// prints this label so the failing stage is identified immediately.
function step(label: string) {
  // The wdio mocha reporter prints this console.log line as is. console use
  // is intentional in the e2e environment for diagnosability
  // (eight-principle #8).
  console.log(`[e2e history-source-5] step: ${label}`);
}

describe("Sprint 373 — query_history source 5종 (AC-373-06)", () => {
  it("records 5 distinct source labels after a user workflow across PG + Mongo", async () => {
    step("launcher 부팅 + PG 연결 생성");
    await waitForLauncher();
    await createPostgresConnection(PG_CONNECTION);
    await openConnection(PG_CONNECTION);

    step("sidebar-prefetch: users 테이블 클릭 (DataGrid 가 SELECT 발사)");
    // Clicking a table in the sidebar tree mounts the DataGrid, which fires
    // queryTableData → recordHistoryEntry(source="sidebar-prefetch").
    await expandIfCollapsed('[aria-label="public schema"]', 30000);
    await expandIfCollapsed('[aria-label="Tables in public"]');
    const usersTable = await $('[aria-label="users table"]');
    await usersTable.waitForDisplayed({ timeout: 10000 });
    await usersTable.click();
    await waitForGridTextAll(
      ["alice@example.com"],
      15000,
      "seeded Postgres users row did not appear in grid",
    );

    step("global query log 열고 sidebar-prefetch badge 확인");
    await waitForSourceBadge("sidebar-prefetch");

    step("raw: query tab 열고 SELECT 1 실행");
    await openNewQueryTab();
    await typeQuery("SELECT 1 AS test_column");
    await runQuery();
    // The raw badge is suppressed per AC-196-06-1 — the record is asserted
    // via the SQL text.
    await waitForRawHistorySql("test_column");

    step("grid-edit: users 테이블 행 편집 후 commit");
    // Cell edit → commit → run the SQL preview. Same procedure
    // `postgres.spec.ts` passes with in CI — the shared `editGridCellInRow`
    // finds the row and opens the cell editor. The old body located the cell
    // via `table tbody tr td` and clicked `[aria-label="Commit edits"]`;
    // neither exists in the current markup (grid migration; the actual label
    // is "Commit changes"). A query tab was visited in between, so the
    // sidebar node is re-located (avoids a stale reference).
    const usersTableAgain = await $('[aria-label="users table"]');
    await usersTableAgain.waitForDisplayed({ timeout: 10000 });
    await usersTableAgain.click();
    await waitForGridTextAll(
      ["alice@example.com"],
      15000,
      "users grid did not re-mount before the grid-edit step",
    );
    await editGridCellInRow(
      "alice@example.com",
      2,
      `History Source ${Date.now()}`,
      "Editing name",
    );
    const commit = await $('[aria-label="Commit changes"]');
    await commit.click();
    await executeSqlPreview();
    await waitForSourceBadge("grid-edit");

    step("ddl-structure: Structure 탭 → Add column → Apply");
    // The Structure sub-tab has no aria-label; it is the role=tab button with
    // `id="tab-rdb-structure"`. The old body's `[aria-label="Structure"]`
    // never existed, so the `isExisting()` guard silently skipped the whole
    // block — which hid where it broke when the badge never arrived. The
    // guard is gone and the real selector is used instead.
    const structureTab = await $("#tab-rdb-structure");
    await structureTab.waitForDisplayed({ timeout: 10000 });
    await structureTab.click();

    // Columns is the default sub-tab, so ColumnsEditor mounts right away.
    const addCol = await $('[aria-label="Add column"]');
    await addCol.waitForDisplayed({ timeout: 15000 });
    await addCol.click();

    // A name conflict keeps the preview from appearing, so a fresh name per
    // run.
    await setAriaInput("Column name", `e2e_col_${Date.now()}`);
    await setAriaInput("Column data type", "text");
    await waitForAddColumnPreview("ALTER TABLE");

    const apply = await $('[aria-label="Apply"]');
    await apply.waitForDisplayed({ timeout: 10000 });
    await apply.click();
    await waitForSourceBadge("ddl-structure");

    step("mongo-op: Mongo 연결 + bulk delete 시뮬");
    // Back to the launcher to create the Mongo connection.
    await waitForLauncher();
    await createMongoConnection(MONGO_CONNECTION);
    await openConnection(MONGO_CONNECTION);

    // Open the Mongo seed collection.
    await expandIfCollapsed('[aria-label="table_view_test database"]', 30000);
    const mongoColl = await $('[aria-label="smoke_users collection"]');
    await mongoColl.waitForDisplayed({ timeout: 15000 });
    await mongoColl.click();
    // The bulk ops toolbar attaches after the grid mounts.
    await waitForGridTextAll(
      ["mona@example.com"],
      15000,
      "seeded MongoDB document did not appear in document grid",
    );

    // Triggers the datagrid's deleteMany — the toolbar's Bulk Delete button.
    // The confirm button reads "Delete matching", so the old `button=Delete`
    // never matched (and risked colliding with the connection-delete
    // confirm). This spec receives its seed in its own data dir, so emptying
    // the collection with an unfiltered deleteMany does not leak into other
    // specs — also why it runs last.
    const bulkDelete = await $('[aria-label="Delete matching documents"]');
    await bulkDelete.waitForDisplayed({ timeout: 15000 });
    await bulkDelete.click();
    const confirmDelete = await $('[aria-label="Confirm delete matching"]');
    await confirmDelete.waitForDisplayed({ timeout: 10000 });
    await confirmDelete.click();
    await waitForSourceBadge("mongo-op");

    step("최종 단언: 5종 source 모두 query log 에 기록");
    // The four badge-rendering sources are asserted via the attribute; `raw`
    // is suppressed (AC-196-06-1), so it is asserted via the SQL text left
    // in the log — the AC-373-06 intent that all five get recorded is
    // preserved.
    await openGlobalQueryLog();
    for (const source of [
      "grid-edit",
      "ddl-structure",
      "mongo-op",
      "sidebar-prefetch",
    ]) {
      const badge = await $(`[data-source="${source}"]`);
      expect(await badge.isExisting()).toBe(true);
    }
    // `getText()` returns only visible text — the raw entry can be pushed
    // out of the scroll area by later entries, so read it via textContent.
    const rawLogged = await browser.execute(() => {
      const panel = document.querySelector(
        '[data-testid="global-query-log-panel"]',
      );
      return (panel?.textContent ?? "").includes("test_column");
    });
    expect(rawLogged).toBe(true);
  });
});
