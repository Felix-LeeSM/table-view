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
// 본 spec 은 host docker daemon 이 PG / Mongo 컨테이너를 띄우고 있어야
// 함 (다른 e2e 와 동일 전제).
//
// 의도적으로 직접 SQLite 를 열어 `source` 컬럼을 grep 하지 않는다 — 사용자
// visible API 만 사용해 lego 가 맞물려 동작하는지 검증한다는 8 원칙 #2
// 의 정신. 대신 global query log 패널의 source badge / SQL 텍스트로 단언.
//
// #2041 — 본 spec 은 CI 에서 한 번도 실행된 적이 없어 마크업이 밀린 채로
// 커밋돼 있었다. 통과하는 24개 spec 의 관행으로 맞춘 항목:
//   * grid 대기: Sprint 258 이 `<table>` 을 폐기하고 CSS Grid 로 옮겼으므로
//     `$("table")` 대신 `[role="grid"]` 를 보는 `waitForGridTextAll`
//     (`postgres.spec.ts` 와 동일).
//   * source badge 증거 패널: `toggle-query-log` 가 여는 `QueryLog` 는
//     badge 를 아예 렌더하지 않는다. badge 를 렌더하는 것은
//     `GlobalQueryLogPanel` / `QueryHistoryPanel` 둘뿐이므로
//     `toggle-global-query-log` 로 바꿨다 (`postgres-structure-ddl.spec.ts`
//     의 `waitForStructureHistoryEvidence` 와 동일 패턴).
//   * `raw` 단언: `QueryHistorySourceBadge` 는 AC-196-06-1 로
//     `source === "raw"` 일 때 의도적으로 아무것도 렌더하지 않는다
//     (`QueryHistorySourceBadge.tsx` 의 early return + 동명 unit test).
//     따라서 `[data-source="raw"]` 는 구조상 도달 불가 — raw entry 는
//     badge 대신 로그에 찍힌 SQL 텍스트로 단언한다. 5종이 모두 기록된다는
//     AC-373-06 의 단언 의도는 그대로다.

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

// global query log 를 연다 (이미 열려 있으면 그대로 둔다).
// `postgres-structure-ddl.spec.ts` 가 CI 에서 통과시키는 것과 동일한 절차.
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

// 단언이 끝나면 다시 닫는다 — 패널이 열린 채로 두면 뒤따르는 grid /
// sidebar 클릭과 겹칠 수 있다.
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

// React controlled input 은 `element.value = x` 를 무시하므로 native setter
// 로 값을 넣고 input/change 를 발사한다 — `_helpers.ts` 의 `setInput` 및
// `postgres-structure-ddl.spec.ts` 가 쓰는 것과 같은 방식.
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

// AddColumnDialog 의 Apply 는 `canApply = 이름 유효 && 타입 비어있지 않음 &&
// preview SQL 도착` 이라야 enable 된다. preview 는 debounce 후 비동기로
// 채워지므로 기다렸다 눌러야 한다.
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

// global query log 에서 특정 source 의 badge 가 mount 됐는지 단언.
// `QueryHistorySourceBadge` 가 `data-source="<source>"` 를 가진 span 을
// 렌더한다. `global-log-new-entry` 클릭은 대기 중인 신규 entry 를 밀어
// 넣는 트리거로, 통과하는 spec 들이 쓰는 것과 같은 flush 방식.
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

// `raw` 는 badge 가 억제되므로 (AC-196-06-1) 로그에 찍힌 SQL 텍스트로
// 기록 사실을 단언한다.
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
    // raw badge 는 AC-196-06-1 로 억제 — SQL 텍스트로 기록을 단언한다.
    await waitForRawHistorySql("test_column");

    step("grid-edit: users 테이블 행 편집 후 commit");
    // 셀 편집 → commit → SQL preview 실행. `postgres.spec.ts` 가 CI 에서
    // 통과시키는 것과 동일한 절차 — 공용 `editGridCellInRow` 가 행을 찾아
    // 셀 editor 를 연다. 예전 본문은 `table tbody tr td` 로 셀을 찾고
    // `[aria-label="Commit edits"]` 를 눌렀는데 둘 다 현재 마크업에 없다
    // (Sprint 258 grid 전환 / 실제 라벨은 "Commit changes").
    // query tab 을 거쳤으므로 sidebar 노드를 다시 잡는다 (stale 참조 방지).
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
    // Structure sub-tab 은 aria-label 이 없고 `id="tab-rdb-structure"` 인
    // role=tab 버튼이다. 예전 본문의 `[aria-label="Structure"]` 는 존재한
    // 적이 없어 `isExisting()` 가드에 걸려 블록 전체가 조용히 skip 됐다 —
    // 그래서 badge 가 안 와도 어디서 끊겼는지 안 보였다. 가드를 걷어내고
    // 실제 selector 로 바꾼다.
    const structureTab = await $("#tab-rdb-structure");
    await structureTab.waitForDisplayed({ timeout: 10000 });
    await structureTab.click();

    // Columns sub-tab 이 기본값이라 ColumnsEditor 가 바로 mount 된다.
    const addCol = await $('[aria-label="Add column"]');
    await addCol.waitForDisplayed({ timeout: 15000 });
    await addCol.click();

    // 이름 충돌이 있으면 preview 가 뜨지 않으므로 매 실행마다 새 이름.
    await setAriaInput("Column name", `e2e_col_${Date.now()}`);
    await setAriaInput("Column data type", "text");
    await waitForAddColumnPreview("ALTER TABLE");

    const apply = await $('[aria-label="Apply"]');
    await apply.waitForDisplayed({ timeout: 10000 });
    await apply.click();
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
    // bulk ops toolbar 는 grid 가 mount 된 뒤에 붙는다.
    await waitForGridTextAll(
      ["mona@example.com"],
      15000,
      "seeded MongoDB document did not appear in document grid",
    );

    // 데이터그리드의 deleteMany 트리거 — toolbar 의 Bulk Delete 버튼.
    // 확인 버튼의 텍스트는 "Delete matching" 이라 예전 `button=Delete` 는
    // 맞지 않았다 (게다가 연결 삭제 확인 버튼과 붙을 위험도 있다).
    // 본 spec 은 seed 를 자기 data dir 에 따로 받으므로 filter 없는
    // deleteMany 로 collection 을 비워도 다른 spec 에 새지 않는다. 마지막
    // 단계인 이유이기도 하다.
    const bulkDelete = await $('[aria-label="Delete matching documents"]');
    await bulkDelete.waitForDisplayed({ timeout: 15000 });
    await bulkDelete.click();
    const confirmDelete = await $('[aria-label="Confirm delete matching"]');
    await confirmDelete.waitForDisplayed({ timeout: 10000 });
    await confirmDelete.click();
    await waitForSourceBadge("mongo-op");

    step("최종 단언: 5종 source 모두 query log 에 기록");
    // badge 를 렌더하는 4종은 attribute 로, `raw` 는 억제되므로 (AC-196-06-1)
    // 로그에 남은 SQL 텍스트로 단언한다 — AC-373-06 의 "5종이 모두 기록된다"
    // 는 그대로 유지된다.
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
    // `getText()` 는 보이는 텍스트만 준다 — raw entry 는 뒤에 쌓인 항목들에
    // 밀려 스크롤 밖일 수 있으므로 textContent 로 본다.
    const rawLogged = await browser.execute(() => {
      const panel = document.querySelector(
        '[data-testid="global-query-log-panel"]',
      );
      return (panel?.textContent ?? "").includes("test_column");
    });
    expect(rawLogged).toBe(true);
  });
});
