// Reset-to-default audit e2e (Q21).
//
// Status (#2474, 2026-09-05): no runner executes this file — it is not a
// regression pin. wdio only picks up `e2e/smoke/**/*.spec.ts`
// (wdio.smoke.conf.ts `specs`) and vitest excludes `e2e/**`
// (vite.config.ts `exclude`). tauri-driver does not support macOS, so the
// smoke suite cannot even run on a dev machine (macOS) — the only place
// this suite runs in CI is Linux (xvfb + WebKitGTK), and even there this
// file sits outside the glob, so it does not run on a PR where e2e-smoke
// runs.
//
// Kept because: the 9-scenario list below is a scenario inventory that
// gathers the user-visible entry points of the Q21 reset affordances and
// their movement history (#2440 / #2433) in one place, and doubles as a
// manual verification checklist.
// docs/contributor-guide/smoke-matrix/h7-ops-security-reliability.md also
// classifies this file as "invoked by nothing ... scenario inventory". The
// regression guards that actually execute are RTL's —
// `*reset-affordance*.test.tsx` of HomePage · ConnectionGroup · HeaderRow ·
// Sidebar · FavoritesPanel, plus Sidebar.collapse-toggle.test.tsx and
// RecentConnections.test.tsx.
//
// The selectors in the body date from 2026-05-17 and are confirmed to have
// drifted — the "Collapse all" that scenario 7 waits for is the
// object-named `Collapse all {{objectPlural}}`
// (src/lib/i18n/locales/layout.ts `sidebar.collapseAll`). Option 1 for
// folding this into the smoke suite: move to `e2e/smoke/` + rename to
// `.spec.ts` + register in e2e/scope-map.mjs and e2e/fixtures/seed-smoke.ts.
//
// Eight-principle mapping:
//   1. Multiple components + two windows + IPC combined — a path vitest
//      cannot cover.
//   2. User intent: "click all nine reset menus once and confirm defaults
//      land" — a single straight-line it.
//   3. If the reset menu exposure regresses after merge, this spec does not
//      fail — no runner executes it (see the Status section above).
//   4. Matrix simplification: PG only (no DBMS-specific contract; UI only).
//   5. (formerly "regression pin") an inventory recording the lego
//      invariant, not an executing pin.
//   6. No skip.
//   7. tauri-driver limits: this spec verifies only visible affordances of
//      sidebar / launcher / workspace — no downgrade path needed.
//   8. Diagnosability: per-step labels + screenshots possible.
//
// This spec requires the host docker daemon to be running the PG container
// (same precondition as the other e2e specs).
//
// 9 scenarios (updated: the two settings panel entries removed):
//   1. (removed) Settings panel "Reset settings" — the user's direct
//      request unmounted the settings panel UI itself. IPC `reset_setting`
//      is kept. Currently e2e step 0 — satisfies audit-checklist item #1,
//      which asked for e2e scenario 1 to be updated in the follow-up.
//   2. (removed by #2440) Home Recent "Reset" button — Recent became a view
//      of the group rail and the collapsible footer is gone.
//   3. (partially removed) Sidebar handle context-menu only — the settings
//      panel entry (#3a) was removed. Only the sidebar handle (#3b) fires
//      and resets `sidebar_width`.
//   4. Group right-click "Reset collapse states" — every group expanded.
//   5. DataGrid header right-click "Reset column widths" — widths to
//      default only.
//   6. DataGrid header right-click "Show all columns" — hidden ones to
//      default only.
//   7. Sidebar header "Collapse all" — sidebar.expanded becomes an empty
//      array.
//   8. (moved by #2433) "Clear all" at the end of the Recent rail — goes
//      through a confirm dialog, leaving mru empty. It used to be the
//      Eraser in the Home action bar. A destructive action aimed at the
//      list, it moved to the end of the list and gained a confirm because
//      it cannot be undone. That is also why the scenario order below
//      changed — when the list is empty the button itself does not render,
//      so it fires after the workspace has been opened once.
//   9. Favorites entry remove — the entry disappears.
//
// #2433 caution: the "zero confirm dialogs" assertion below excludes
// scenario 8. The other eight still go through direct IPC.

import { $, browser, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  openConnection,
  switchToLauncherWindow,
  switchToWorkspaceWindow,
  waitForLauncher,
} from "./smoke/_helpers";

const PG_CONNECTION = "E2E Reset Audit PG";

// Printed by the wdio mocha reporter. Diagnosability (eight-principle #8).
function step(label: string) {
  // The wdio mocha reporter prints this console.log line as is. console use
  // is intentional in the e2e environment for diagnosability
  // (eight-principle #8). The e2e/ directory is exempt from eslint's
  // no-console rule (test/script/e2e exception).
  console.log(`[e2e reset-to-default-audit] step: ${label}`);
}

async function clickByAriaLabel(label: string) {
  const el = await $(`[aria-label="${label}"]`);
  await el.waitForDisplayed({ timeout: 10000 });
  await el.click();
}

describe("Sprint 376 — Reset-to-default audit (Q21 9 affordance)", () => {
  it("9 시나리오 모두 user-visible UI 에서 발사 가능 — #8 만 확인 창을 거친다", async () => {
    step("launcher 부팅 + PG 연결 생성");
    await waitForLauncher();
    await createPostgresConnection(PG_CONNECTION);

    // ----- Scenario 1: (removed) Settings panel "Reset settings" -----
    // The settings panel UI was removed at the user's direct request. The
    // e2e step was removed with it — the regression guard is RTL's
    // (`src/pages/HomePage.reset-affordance.test.tsx` AC-377-01).
    await switchToLauncherWindow();

    // ----- Scenario 2: (removed by #2440) Home Recent "Reset" button -----
    // #2440 moved Recent from the footer to a view of the group rail, so the
    // collapsible footer itself is gone. No collapsed state, nothing to
    // reset.

    // ----- Scenario 3 (a): (removed) Settings panel "Reset sidebar width" -----
    // The settings panel's second entry point was removed.
    // The sidebar handle right-click entry (#3b) fires in the workspace
    // window (below).

    // ----- Scenario 8 moved below (#2433) -----
    // The "Clear all" at the end of the Recent list does not render when the
    // list is empty. No connection has been opened at this point, so mru is
    // empty — it fires after the workspace is opened and we return to the
    // launcher.

    // ----- Scenario 4: Group right-click "Reset collapse states" -----
    // Fires only when a group exists — auto-skips in a zero-group
    // environment.
    step("#4 Group 우클릭 menu 'Reset collapse states' (group 있을 때만)");
    const groupHeader = await $('[data-testid="connection-group-wrapper"]');
    const groupExists = await groupHeader.isExisting();
    if (groupExists) {
      const headerBtn = await groupHeader.$('[role="button"]');
      // Simulates a wdio context menu — right click.
      await browser.execute((el: HTMLElement) => {
        el.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      }, headerBtn);
      const resetItem = await $('[role="menuitem"]*=Reset collapse states');
      const resetItemExists = await resetItem.isExisting();
      if (resetItemExists) {
        await resetItem.click();
      }
    }

    // ----- Scenarios 3 (b) + 7 + 5 + 6 — fired in the workspace -----
    step("workspace 윈도우 열기 (시나리오 3b, 5, 6, 7 용)");
    await openConnection(PG_CONNECTION);
    await switchToWorkspaceWindow();

    step("#7 Sidebar 헤더 'Collapse all' 클릭");
    await clickByAriaLabel("Collapse all");

    step("#3b Sidebar 'Reset sidebar width' 클릭");
    await clickByAriaLabel("Reset sidebar width");

    // ----- Scenarios 5 + 6: DataGrid column header right-click -----
    // Click the table to mount the DataGrid, then right-click. Skips when no
    // table exists (depends on the user's environment).
    step("#5/#6 DataGrid column header 우클릭 — 컬럼이 있을 때만");
    const colHeader = await $('[role="columnheader"]');
    const hasGrid = await colHeader.isExisting();
    if (hasGrid) {
      await browser.execute((el: HTMLElement) => {
        el.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      }, colHeader);
      const widthItem = await $('[role="menuitem"]*=Reset column widths');
      if (await widthItem.isExisting()) await widthItem.click();
      // re-open menu for "Show all columns"
      await browser.execute((el: HTMLElement) => {
        el.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      }, colHeader);
      const showAll = await $('[role="menuitem"]*=Show all columns');
      if (await showAll.isExisting()) await showAll.click();
    }

    // ----- Scenario 9: Favorites entry remove — only when favorites exist -----
    step("#9 Favorites entry remove (existing affordance audit)");
    const favRemove = await $('[aria-label^="Delete favorite:"]');
    if (await favRemove.isExisting()) {
      await favRemove.click();
    }

    // ----- Scenario 8: "Clear all" at the end of the Recent rail (#2433) -----
    // Return to the launcher, pick the Recent view, and press the button at
    // the end of the list. No button when the list is empty — uses the same
    // isExisting guard as scenarios 4/5/6/9 above.
    step("#8 Recent rail 끝 'Clear all' + 확인 창 (recent 항목이 있을 때만)");
    await switchToLauncherWindow();
    const railRecent = await $('[data-testid="rail-recent"]');
    await railRecent.waitForDisplayed({ timeout: 10000 });
    await railRecent.click();
    const clearAll = await $('[data-testid="recent-clear-all"]');
    if (await clearAll.isExisting()) {
      await clearAll.click();
      const clearConfirm = await $('[data-testid="recent-clear-confirm"]');
      await clearConfirm.waitForDisplayed({ timeout: 10000 });
      await clearConfirm.click();
    }

    step("종료 — 열린 채로 남은 confirm dialog 가 없음을 단언");
    // Before #2433 this was "no confirm ever appeared". Scenario 8 now raises
    // one on purpose, so the assertion narrows to "closed after confirming".
    // The other eight affordances still go through direct IPC and raise no
    // dialog.
    const dialog = await $('[role="alertdialog"]');
    await dialog.waitForExist({ reverse: true, timeout: 10000 });
    expect(await dialog.isExisting()).toBe(false);
  });
});
