import { $, browser } from "@wdio/globals";
import {
  createRedisConnection,
  openConnection,
  step,
  switchToWorkspaceWindow,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

// KV UX redesign (2026-07-07, task #E): key inspection + mutation moved out of
// the left KvSidebar into a right-hand KvKeyDetailPanel tab (mirrors the search
// paradigm). This smoke pins the new cross-window journey — sidebar scan/select
// → detail tab opens in the main area with the key's structure → mutation edits
// through the panel. e2e (not component) because it needs the sidebar, the
// workspace window, the tab store, and the mutation IPC all live (P1).

const CONNECTION_NAME = "E2E Redis Detail";
const KEY = "tv:string";
const INITIAL_VALUE = "hello";
// aria-label from `kvKeyDetail.sectionAria` = "{{key}} key detail".
const DETAIL_PANEL_SELECTOR = `[aria-label="${KEY} key detail"]`;

describe("Redis key detail panel smoke", () => {
  it("opens a right-hand detail tab on key select and mutates from the panel", async () => {
    const editedValue = `smoke-detail-${Date.now()}`;

    await step("create Redis connection and open workspace", async () => {
      await waitForLauncher();
      await createRedisConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
      // #1113: Safe Mode default `warn` pauses KvSidebar auto-scan; assert the
      // paused gate, then run the manual bounded scan.
      await waitForWorkspaceTextAll(
        ["Keys", "Safe Mode paused automatic key scan"],
        30000,
        "Redis key browser did not surface the Safe Mode scan-paused gate",
      );
      await triggerKvKeyScan();
      await waitForWorkspaceTextAll(
        [KEY],
        15000,
        "Redis key browser did not render seeded keys after manual scan",
      );
    });

    await step(
      "sidebar shows no inline editor before a key is selected",
      async () => {
        // The redesign removed the inline value/mutation surface from the
        // sidebar — the "Mutation" section must not exist until a key is opened
        // in the detail tab.
        await assertWorkspaceTextAbsent(
          "Mutation",
          "Sidebar still renders an inline Mutation editor before selection",
        );
        await assertPanelAbsent(
          DETAIL_PANEL_SELECTOR,
          "Detail panel rendered before any key was selected",
        );
      },
    );

    await step(
      "selecting a key opens the detail tab with its structure",
      async () => {
        await clickRedisKey(KEY);
        await switchToWorkspaceWindow();
        const panel = await $(DETAIL_PANEL_SELECTOR);
        await panel.waitForDisplayed({ timeout: 15000 });
        // name / type / value + the panel-hosted mutation surface. TTL text is
        // a live countdown (seed sets ttlSeconds: 3600) so it is not asserted.
        await waitForWorkspaceTextAll(
          [KEY, "string", INITIAL_VALUE, "Mutation"],
          15000,
          "Detail panel did not render the selected key's structure",
        );
      },
    );

    await step("mutate the value from the detail panel", async () => {
      await setField("String value", editedValue);
      await clickButton("Preview string set");
      await waitForWorkspaceTextAll(
        [`Preview: SET ${KEY}`],
        10000,
        "Detail-panel string set preview did not appear",
      );
      await clickButton("Confirm String set");
      await waitForWorkspaceTextAll(
        [editedValue],
        15000,
        "Detail-panel string set did not refresh the value",
      );
    });
  });
});

async function triggerKvKeyScan() {
  const scanButton = await $("button=Scan 100 keys");
  await scanButton.waitForEnabled({ timeout: 15000 });
  await scanButton.click();
}

async function clickRedisKey(key: string) {
  await switchToWorkspaceWindow();
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (label) =>
          Array.from(
            document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
          ).some(
            (item) =>
              item.offsetParent !== null &&
              (item.textContent ?? "").includes(label),
          ),
        key,
      ),
    { timeout: 15000, timeoutMsg: `${key} Redis key did not appear` },
  );
  await browser.execute((label) => {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    ).find(
      (candidate) =>
        candidate.offsetParent !== null &&
        (candidate.textContent ?? "").includes(label),
    );
    if (!item) throw new Error(`${label} Redis key did not appear`);
    item.click();
  }, key);
}

async function setField(label: string, value: string) {
  const field = await $(`[aria-label="${label}"]`);
  await field.waitForDisplayed({ timeout: 10000 });
  await field.clearValue();
  await field.setValue(value);
}

async function clickButton(label: string) {
  const button = await $(`button=${label}`);
  await button.waitForDisplayed({ timeout: 10000 });
  await button.click();
}

async function assertWorkspaceTextAbsent(text: string, message: string) {
  await switchToWorkspaceWindow();
  const present = await browser.execute(
    (needle) =>
      (document.body.textContent ?? "").toLowerCase().includes(needle),
    text.toLowerCase(),
  );
  if (present) throw new Error(message);
}

async function assertPanelAbsent(selector: string, message: string) {
  await switchToWorkspaceWindow();
  const panel = await $(selector);
  if (await panel.isExisting()) throw new Error(message);
}
