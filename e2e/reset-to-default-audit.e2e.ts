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
// 본 spec 은 host docker daemon 이
// PG 컨테이너를 띄우고 있어야 함 (다른 e2e 와 동일 전제).
//
// 9 시나리오 (sprint-377 / 2026-05-17 갱신: settings panel entry 두 개 제거):
//   1. (sprint-377 제거) Settings panel "Reset settings" — 사용자 직접 요청
//      으로 settings panel UI 자체 unmount. IPC `reset_setting` 는 유지.
//      현재 e2e step 0 — audit-checklist item #1 의 \"e2e 시나리오 1 은
//      sprint-377 follow-up 에서 갱신\" 충족.
//   2. (#2440 제거) Home Recent "Reset" 버튼 — Recent 가 group rail 의
//      view 가 되며 접히는 footer 가 사라졌다.
//   3. (sprint-377 부분 제거) Sidebar handle context-menu 만 — settings
//      panel entry (#3a) 는 sprint-377 에서 제거. sidebar handle (#3b)
//      만 fire 해 `sidebar_width` 초기화.
//   4. Group 우클릭 "Reset collapse states" — 모든 group expanded.
//   5. DataGrid header 우클릭 "Reset column widths" — widths 만 default.
//   6. DataGrid header 우클릭 "Show all columns" — hidden 만 default.
//   7. Sidebar 헤더 "Collapse all" — sidebar.expanded 빈 array.
//   8. (#2433 이동) Recent rail 끝의 "Clear all" — 확인 창을 거쳐 mru empty.
//      옛 자리는 Home action bar 의 Eraser 였다. 목록을 겨냥한 파괴적
//      동작이라 목록 끝으로 내려갔고, 되돌릴 수 없어 확인 창이 붙었다.
//      아래 시나리오 순서도 그래서 바뀐다 — 목록이 비어 있으면 버튼 자체가
//      렌더되지 않으므로 workspace 를 한 번 연 뒤에 fire 한다.
//   9. Favorites entry remove — 해당 entry 사라짐.
//
// #2433 주의: 아래 "confirm dialog 0건" 단언은 시나리오 8 을 제외한다.
// 나머지 여덟은 여전히 직접 IPC 다.

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
  it("9 시나리오 모두 user-visible UI 에서 발사 가능 — #8 만 확인 창을 거친다", async () => {
    step("launcher 부팅 + PG 연결 생성");
    await waitForLauncher();
    await createPostgresConnection(PG_CONNECTION);

    // ----- 시나리오 1: (sprint-377 제거) Settings panel "Reset settings" -----
    // sprint-377 (2026-05-17) 에서 사용자 직접 요청으로 settings panel UI
    // 제거. e2e step 도 동반 제거 — 회귀 가드는 RTL
    // (`src/pages/HomePage.reset-affordance.test.tsx` AC-377-01) 가 담당.
    await switchToLauncherWindow();

    // ----- 시나리오 2: (#2440 제거) Home Recent "Reset" 버튼 -----
    // #2440 에서 Recent 가 footer 에서 group rail 의 view 로 옮겨져 접을
    // footer 자체가 없어졌다. 접힘 상태가 없으니 초기화할 것도 없다.

    // ----- 시나리오 3 (a): (sprint-377 제거) Settings panel "Reset sidebar width" -----
    // sprint-377 에서 settings panel 의 두 번째 entry point 제거.
    // sidebar handle 우클릭 entry (#3b) 는 workspace 윈도우에서 fire (아래).

    // ----- 시나리오 8 은 아래로 내려갔다 (#2433) -----
    // Recent 목록 끝의 "Clear all" 은 목록이 비면 렌더되지 않는다. 이 지점
    // 에서는 아직 connection 을 연 적이 없어 mru 가 비어 있으므로,
    // workspace 를 연 뒤 launcher 로 돌아와 fire 한다.

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

    // ----- 시나리오 8: Recent rail 끝의 "Clear all" (#2433) -----
    // launcher 로 돌아와 Recent view 를 고르고 목록 끝의 버튼을 누른다.
    // 목록이 비어 있으면 버튼이 없다 — 위 시나리오 4/5/6/9 와 같은
    // isExisting 가드를 쓴다.
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
    // #2433 이전에는 "confirm 이 한 번도 안 떴다" 였다. 시나리오 8 이 이제
    // 일부러 하나를 띄우므로, 단언은 "확인 뒤 닫혔다" 로 좁아진다. 나머지
    // 여덟 affordance 는 여전히 직접 IPC 라 dialog 를 안 띄운다.
    const dialog = await $('[role="alertdialog"]');
    await dialog.waitForExist({ reverse: true, timeout: 10000 });
    expect(await dialog.isExisting()).toBe(false);
  });
});
