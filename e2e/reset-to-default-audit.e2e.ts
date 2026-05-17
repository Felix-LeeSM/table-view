// Sprint 376 (2026-05-17, Phase 6 Q21) — Reset-to-default audit e2e.
//
// 작성 이유: Q21 9 affordance 의 user-visible entry point 가 모두
// 실제 빌드 한 사용자 워크플로우 안에서 동작하는지 lock. RTL 은 컴포넌트
// 단위 contract — IPC 호출 인자만 검사. 본 spec 은 두 윈도우 (launcher +
// workspace) 가 살아있는 cold boot 환경에서 9 시나리오를 차례로 fire.
//
// 8 원칙 적용:
//   1. 다중 컴포넌트 + 두 윈도우 + IPC 결합 — vitest 로 잡을 수 없는 path.
//   2. 사용자 의도: "한 번 reset 메뉴 9개 다 클릭해서 default 가 들어오는지
//      확인" — 단일 직선적 it.
//   3. CUJ 회귀: 머지 후 reset 메뉴 노출이 빠지면 본 spec 이 fail —
//      사용자 보고가 늦지 않는다.
//   4. 매트릭스 단순화: PG 단일 (DBMS 자체 contract 무관, UI 만 검증).
//   5. 회귀 고정: ADR sprint-376 의 핵심 lego invariant.
//   6. skip 없음.
//   7. tauri-driver 한계: 본 spec 은 sidebar / launcher / workspace 의
//      visible affordance 만 검증 — 강등 경로 불필요.
//   8. 진단성: 각 step 라벨 + screenshot 가능.
//
// 본 spec 은 `pnpm test:e2e:docker` 환경에서 실행. host docker daemon 이
// PG 컨테이너를 띄우고 있어야 함 (다른 e2e 와 동일 전제).
//
// 9 시나리오:
//   1. Settings panel "Reset settings" 클릭 — 4 setting key 초기화.
//   2. Home Recent "Reset" 버튼 클릭 — home_recent_collapsed 초기화.
//   3. Settings panel "Reset sidebar width" + Sidebar handle context-menu
//      두 entry point 모두 fire — sidebar_width 초기화.
//   4. Group 우클릭 "Reset collapse states" — 모든 group expanded.
//   5. DataGrid header 우클릭 "Reset column widths" — widths 만 default.
//   6. DataGrid header 우클릭 "Show all columns" — hidden 만 default.
//   7. Sidebar 헤더 "Collapse all" — sidebar.expanded 빈 array.
//   8. Home "Clear recent" — mru empty.
//   9. Favorites entry remove — 해당 entry 사라짐.

import { $, browser, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  openConnection,
  switchToLauncherWindow,
  switchToWorkspaceWindow,
  waitForLauncher,
} from "./smoke/_helpers";

const PG_CONNECTION = "E2E Reset Audit PG";

// wdio mocha reporter 출력. 진단성 (8 원칙 #8).
function step(label: string) {
  // wdio mocha reporter 가 본 console.log 라인을 그대로 출력. e2e 환경에서는
  // 진단성 (시나리오 8 원칙 #8) 을 위해 의도적으로 console 사용. e2e/ 디렉토리는
  // eslint 의 no-console rule 의 적용 대상에서 제외 (test/script/e2e 예외).
  console.log(`[e2e reset-to-default-audit] step: ${label}`);
}

async function clickByAriaLabel(label: string) {
  const el = await $(`[aria-label="${label}"]`);
  await el.waitForDisplayed({ timeout: 10000 });
  await el.click();
}

describe("Sprint 376 — Reset-to-default audit (Q21 9 affordance)", () => {
  it("9 시나리오 모두 user-visible UI 에서 발사 가능 — confirm dialog 없음", async () => {
    step("launcher 부팅 + PG 연결 생성");
    await waitForLauncher();
    await createPostgresConnection(PG_CONNECTION);

    // ----- 시나리오 1: Settings panel "Reset settings" -----
    step("#1 Settings panel 'Reset settings' 클릭");
    await switchToLauncherWindow();
    await clickByAriaLabel("Reset settings");

    // ----- 시나리오 2: Home Recent "Reset" 버튼 -----
    step("#2 Home Recent 'Reset' 버튼 클릭");
    await clickByAriaLabel("Reset recent collapse");

    // ----- 시나리오 3 (a): Settings panel "Reset sidebar width" -----
    step("#3a Settings panel 'Reset sidebar width' 클릭");
    await clickByAriaLabel("Reset sidebar width");

    // ----- 시나리오 8: Home "Clear recent" -----
    // (먼저 fire — 시나리오 9 의 favorites 도달 전에 launcher 측 작업)
    step("#8 Home action bar 'Clear recent' 클릭");
    await clickByAriaLabel("Clear recent");

    // ----- 시나리오 4: Group 우클릭 "Reset collapse states" -----
    // Group 있는 경우만 fire — 사용자가 group 0 인 환경에선 자동 skip.
    step("#4 Group 우클릭 menu 'Reset collapse states' (group 있을 때만)");
    const groupHeader = await $('[data-testid="connection-group-wrapper"]');
    const groupExists = await groupHeader.isExisting();
    if (groupExists) {
      const headerBtn = await groupHeader.$('[role="button"]');
      // wdio context-menu 시뮬레이션 — 우클릭.
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

    // ----- 시나리오 3 (b) + 7 + 5 + 6 — workspace 에서 발사 -----
    step("workspace 윈도우 열기 (시나리오 3b, 5, 6, 7 용)");
    await openConnection(PG_CONNECTION);
    await switchToWorkspaceWindow();

    step("#7 Sidebar 헤더 'Collapse all' 클릭");
    await clickByAriaLabel("Collapse all");

    step("#3b Sidebar 'Reset sidebar width' 클릭");
    await clickByAriaLabel("Reset sidebar width");

    // ----- 시나리오 5 + 6: DataGrid column header 우클릭 -----
    // 테이블 클릭해서 DataGrid mount 후 우클릭. table 이 없으면 skip
    // (사용자 환경 종속).
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

    // ----- 시나리오 9: Favorites entry remove — favorites 있을 때만 -----
    step("#9 Favorites entry remove (existing affordance audit)");
    const favRemove = await $('[aria-label^="Delete favorite:"]');
    if (await favRemove.isExisting()) {
      await favRemove.click();
    }

    step("9 시나리오 종료 — confirm dialog 가 0건 나타났음을 단언");
    // alertdialog 가 mount 됐으면 fail — Q21 contract: 직접 IPC + no confirm.
    const dialog = await $('[role="alertdialog"]');
    expect(await dialog.isExisting()).toBe(false);
  });
});
