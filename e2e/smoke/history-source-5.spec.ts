// Sprint 373 (2026-05-17) — Phase 5 F.5 의 original history source 5종 e2e.
// Sprint 435 adds `explain`; it is covered by postgres-explain.spec.ts.
//
// 작성 이유: AC-373-06 — 5 source caller (`raw` / `grid-edit` /
// `ddl-structure` / `mongo-op` / `sidebar-prefetch`) 가 각각 사용자
// workflow 안에서 1회씩 발사된 후 SQLite `query_history` 테이블에 5종
// `source` 컬럼 값이 모두 존재해야 함.
//
// 8 원칙 적용:
//   1. 다중 컴포넌트 + 윈도우 + IPC 결합 — vitest 로 잡을 수 없는 path.
//   2. 사용자 의도: "Postgres / Mongo 양쪽 연결을 열고 5종 entry point 를
//      차례로 트리거" — 단일 직선적 it.
//   3. CUJ 회귀: 연결→첫쿼리 + paradigm 전환 + 셀편집 + DDL menu + Mongo
//      bulk op + sidebar prefetch 의 cross-cut.
//   4. 매트릭스 단순화: PG (raw / grid-edit / ddl-structure / sidebar-prefetch)
//      + Mongo (mongo-op) — original 5 source 가 분기되어 양 DBMS 모두 활용.
//   5. 회귀 고정: ADR sprint-373 의 핵심 lego invariant.
//   6. skip 없음.
//   7. tauri-driver 한계: 본 spec 은 5종 trigger 가 user-visible UI 에서
//      그대로 가능 — 강등 경로 불필요.
//   8. 진단성: 각 step 에 라벨 + screenshot 가능.
//
// 본 spec 은 `pnpm test:e2e:docker` 환경에서 실행. host docker daemon 이
// PG / Mongo 컨테이너를 띄우고 있어야 함 (다른 e2e 와 동일 전제).
//
// 의도적으로 직접 SQLite 를 열어 `source` 컬럼을 grep 하지 않는다 — 사용자
// visible API 만 사용해 lego 가 맞물려 동작하는지 검증한다는 8 원칙 #2
// 의 정신. 대신 query history dock panel 의 source badge / aria-label 로
// 단언.

import { $, $$, browser, expect } from "@wdio/globals";
import {
  createMongoConnection,
  createPostgresConnection,
  expandIfCollapsed,
  openConnection,
  openNewQueryTab,
  runQuery,
  typeQuery,
  waitForLauncher,
} from "./_helpers";

const PG_CONNECTION = "E2E History Source PG";
const MONGO_CONNECTION = "E2E History Source Mongo";

// query history dock 패널에서 특정 source 라벨 row 가 mount 됐는지 단언.
// `QueryHistorySourceBadge` 가 `data-source="<label>"` attribute 를 가진
// span 을 렌더. 본 helper 는 그 attribute 존재를 polling 으로 wait.
async function waitForSourceBadge(source: string, timeoutMs = 15000) {
  await browser.waitUntil(
    async () => {
      const badges = await $$(`[data-source="${source}"]`);
      return badges.length > 0;
    },
    {
      timeout: timeoutMs,
      timeoutMsg: `query_history row with source="${source}" did not appear within ${timeoutMs}ms`,
    },
  );
}

// 8 원칙 #8 — 진단 step 라벨. wdio mocha 의 reporter 가 본 라벨을
// 출력해 어느 단계에서 실패했는지 즉시 식별.
function step(label: string) {
  // wdio mocha reporter 가 본 console.log 라인을 그대로 출력. e2e 환경에서는
  // 진단성 (시나리오 8 원칙 #8) 을 위해 의도적으로 console 사용.
  console.log(`[e2e history-source-5] step: ${label}`);
}

describe("Sprint 373 — query_history source 5종 (AC-373-06)", () => {
  it("records 5 distinct source labels after a user workflow across PG + Mongo", async () => {
    step("launcher 부팅 + PG 연결 생성");
    await waitForLauncher();
    await createPostgresConnection(PG_CONNECTION);
    await openConnection(PG_CONNECTION);

    step("sidebar-prefetch: users 테이블 클릭 (DataGrid 가 SELECT 발사)");
    // 사용자가 sidebar tree 에서 table 을 클릭하면 DataGrid mount 가
    // queryTableData → recordHistoryEntry(source="sidebar-prefetch") 를 발사.
    await expandIfCollapsed('[aria-label="public schema"]', 30000);
    await expandIfCollapsed('[aria-label="Tables in public"]');
    const usersTable = await $('[aria-label="users table"]');
    await usersTable.waitForDisplayed({ timeout: 10000 });
    await usersTable.click();
    const grid = await $("table");
    await grid.waitForDisplayed({ timeout: 15000 });

    step("query log dock 토글 열기");
    // CustomEvent("toggle-query-log") 가 QueryLog 컴포넌트의 toggle hook.
    // GlobalQueryLogPanel 도 toggle-global-query-log 이벤트로 동일 패턴.
    await browser.execute(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });
    await waitForSourceBadge("sidebar-prefetch");

    step("raw: query tab 열고 SELECT 1 실행");
    await openNewQueryTab();
    await typeQuery("SELECT 1 AS test_column");
    await runQuery();
    await waitForSourceBadge("raw");

    step("grid-edit: users 테이블 행 편집 후 commit");
    // DataGrid 셀 편집 → Cmd+S commit. 실제 셀 더블클릭은 driver 한계
    // 가 있으므로 직접 editable cell 의 buttons 중 commit 경로를 발사.
    // 본 시뮬은 `[aria-label="users table"]` 클릭 → 첫 셀 더블클릭 →
    // 새 값 → Enter → toolbar commit. 자세한 셀편집 시뮬은
    // postgres.spec.ts 의 셀편집 hint 와 동일 패턴.
    await usersTable.click();
    // 첫 셀 더블클릭 (table 의 첫 td).
    const firstCell = await $("table tbody tr td");
    await firstCell.waitForDisplayed({ timeout: 5000 });
    await browser.execute((el: HTMLElement) => {
      el.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    }, firstCell);
    // editor input 이 mount 되면 새 값 입력 + Enter.
    const cellInput = await $('input[type="text"], textarea');
    if (await cellInput.isExisting()) {
      await cellInput.setValue("e2e-edit");
      await browser.keys("Enter");
      // commit toolbar 버튼.
      const commit = await $('[aria-label="Commit edits"]');
      if (await commit.isExisting()) {
        await commit.click();
      }
    }
    await waitForSourceBadge("grid-edit");

    step("ddl-structure: ALTER TABLE 메뉴 (StructurePanel)");
    // Structure tab 의 ColumnsEditor 에서 add column → Apply.
    // structure tab toggle.
    const structureTab = await $('[aria-label="Structure"]');
    if (await structureTab.isExisting()) {
      await structureTab.click();
      const addCol = await $('[aria-label="Add column"]');
      if (await addCol.isExisting()) {
        await addCol.click();
        const nameInput = await $('[aria-label="Column name"]');
        if (await nameInput.isExisting()) {
          await nameInput.setValue("e2e_col");
        }
        const apply = await $("button=Apply");
        if (await apply.isExisting()) {
          await apply.click();
        }
        // 사용자가 confirm dialog 를 거치면 commit. timeout 안에 source
        // badge 가 도착하는지 단언.
      }
    }
    await waitForSourceBadge("ddl-structure");

    step("mongo-op: Mongo 연결 + bulk delete 시뮬");
    // launcher 로 돌아가서 Mongo 연결 생성.
    await waitForLauncher();
    await createMongoConnection(MONGO_CONNECTION);
    await openConnection(MONGO_CONNECTION);

    // Mongo seed collection 열기.
    await expandIfCollapsed('[aria-label="table_view_test database"]', 30000);
    const mongoColl = await $('[aria-label="smoke_users collection"]');
    await mongoColl.waitForDisplayed({ timeout: 15000 });
    await mongoColl.click();

    // 데이터그리드의 deleteMany 트리거 — toolbar 의 Bulk Delete 버튼.
    const bulkDelete = await $('[aria-label="Delete matching documents"]');
    if (await bulkDelete.isExisting()) {
      await bulkDelete.click();
      const confirm = await $("button=Delete");
      if (await confirm.isExisting()) {
        await confirm.click();
      }
    }
    await waitForSourceBadge("mongo-op");

    step("최종 단언: 5종 source 모두 query log 에 mount");
    for (const source of [
      "raw",
      "grid-edit",
      "ddl-structure",
      "mongo-op",
      "sidebar-prefetch",
    ]) {
      const badge = await $(`[data-source="${source}"]`);
      expect(await badge.isExisting()).toBe(true);
    }
  });
});
