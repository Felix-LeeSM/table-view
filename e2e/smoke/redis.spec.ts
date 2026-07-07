import { $, browser } from "@wdio/globals";
import {
  createRedisConnection,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  switchToWorkspaceWindow,
  waitForGridTextAll,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

const CONNECTION_NAME = "E2E Redis";
const INITIAL_VALUE = "hello";
// KV UX redesign (2026-07-07, #E): value inspection + mutation moved out of the
// left KvSidebar into a right-hand KvKeyDetailPanel tab. aria-label comes from
// `kvKeyDetail.sectionAria` = "{{key}} key detail".
const DETAIL_PANEL_SELECTOR = '[aria-label="tv:string key detail"]';

describe("Redis smoke", () => {
  it("connects, scans keys, opens the detail tab, runs commands, and gates TTL/delete mutations", async () => {
    await step("create Redis connection and open workspace", async () => {
      await waitForLauncher();
      await createRedisConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
      // #1113: Safe Mode default is now `warn`, which pauses KvSidebar
      // auto-scan (`autoScanAllowed = safeMode === "off"`). Assert the
      // paused gate, then run the manual "Scan 100 keys" a warn-default
      // user performs to load the bounded key page.
      await waitForWorkspaceTextAll(
        ["Keys", "Safe Mode paused automatic key scan"],
        30000,
        "Redis key browser did not surface the Safe Mode scan-paused gate",
      );
      await triggerKvKeyScan();
      await waitForWorkspaceTextAll(
        ["tv:string"],
        15000,
        "Redis key browser did not render seeded keys after manual scan",
      );
    });

    await step(
      "filtered scan then open the key in the detail tab",
      async () => {
        await setField("Redis key pattern", "tv:string");
        await browser.keys("Enter");
        await waitForWorkspaceTextAll(
          ["1 key", "tv:string"],
          15000,
          "Redis filtered key scan did not render tv:string",
        );
        // Selecting a key now opens the right-hand KvKeyDetailPanel tab (the
        // sidebar no longer renders an inline value/mutation surface).
        await clickRedisKey("tv:string");
        await switchToWorkspaceWindow();
        await (
          await $(DETAIL_PANEL_SELECTOR)
        ).waitForDisplayed({ timeout: 15000 });
        await waitForWorkspaceTextAll(
          ["tv:string", INITIAL_VALUE, "string", "Mutation"],
          15000,
          "KvKeyDetailPanel did not render the seeded string value",
        );
      },
    );

    await step("run a bounded Redis command in the query tab", async () => {
      await openNewQueryTab();
      await setCodeMirrorText("GET tv:string");
      await runQuery();
      await waitForGridTextAll(
        [INITIAL_VALUE],
        15000,
        "Redis GET command did not render the seeded string value",
      );
    });

    // String-overwrite coverage moved to redis-key-detail-panel.spec.ts (the
    // dedicated new-UX spec) to avoid duplication. TTL + delete stay here
    // because that spec does not cover them.
    await step("guard and apply a TTL update from the detail tab", async () => {
      // Re-open the detail tab: the query tab above is now the active editor,
      // so re-select the key to bring the panel back into the main area.
      await clickRedisKey("tv:string");
      await switchToWorkspaceWindow();
      await (
        await $(DETAIL_PANEL_SELECTOR)
      ).waitForDisplayed({ timeout: 15000 });
      await setField("Expire seconds", "120");
      await clickButton("Preview expire");
      await waitForWorkspaceTextAll(
        ["Preview: expire tv:string after 120s."],
        10000,
        "Redis expire preview did not appear",
      );
      await clickButton("Confirm Expire");
      await setCodeMirrorText("TTL tv:string");
      await runQuery();
      await waitForRedisTtlCommandResult(30000);
    });

    await step("require exact key confirmation before delete", async () => {
      // TTL step ran a query, so re-select the key to restore the detail tab.
      await clickRedisKey("tv:string");
      await switchToWorkspaceWindow();
      await (
        await $(DETAIL_PANEL_SELECTOR)
      ).waitForDisplayed({ timeout: 15000 });

      await setField("Delete confirm key", "wrong");
      await clickButton("Preview delete");
      await waitForWorkspaceTextAll(
        ["Type the exact key before previewing delete."],
        10000,
        "Redis delete exact-key guard did not appear",
      );

      await setField("Delete confirm key", "tv:string");
      await clickButton("Preview delete");
      await waitForWorkspaceTextAll(
        ["Preview: delete tv:string."],
        10000,
        "Redis delete preview did not appear",
      );
      await clickButton("Confirm Delete");
      // The panel reloads its own value after a mutation → "(missing)". The
      // sidebar list is NOT auto-rescanned in the new UX (separate columns),
      // so assert the panel first, then run a manual re-scan to confirm the
      // key is gone from the sidebar.
      await waitForWorkspaceTextAll(
        ["missing"],
        15000,
        "KvKeyDetailPanel did not reflect the deleted key as missing",
      );
      await triggerKvKeyScan();
      await waitForWorkspaceTextAll(
        ["0 keys", "No keys match pattern tv:string."],
        15000,
        "Manual re-scan did not show the deleted key removed from the sidebar",
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
  await browser.waitUntil(
    async () =>
      await browser.execute((label) => {
        return Array.from(
          document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
        ).some(
          (item) =>
            item.offsetParent !== null &&
            (item.textContent ?? "").includes(label),
        );
      }, key),
    {
      timeout: 15000,
      timeoutMsg: `${key} Redis key did not appear`,
    },
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

async function setCodeMirrorText(text: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((nextText) => {
        type CodeMirrorView = {
          state: { doc: { length: number; toString(): string } };
          focus(): void;
          dispatch(update: {
            changes: { from: number; to: number; insert: string };
          }): void;
        };
        type CodeMirrorContent = HTMLElement & {
          cmTile?: { root?: { view?: CodeMirrorView } };
        };

        const content = Array.from(
          document.querySelectorAll<CodeMirrorContent>(".cm-content"),
        ).find((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
        const view = content?.cmTile?.root?.view;
        if (!view) return false;
        const current = view.state.doc.toString();
        view.focus();
        if (current !== nextText) {
          view.dispatch({
            changes: { from: 0, to: current.length, insert: nextText },
          });
        }
        return view.state.doc.toString() === nextText;
      }, text),
    {
      timeout: 5000,
      timeoutMsg: "Redis command editor did not accept direct input",
    },
  );
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

async function waitForRedisTtlCommandResult(timeout: number) {
  await browser.waitUntil(
    async () => {
      for (const handle of await browser.getWindowHandles()) {
        try {
          await browser.switchToWindow(handle);
          const hasTtlResult = await browser.execute(() => {
            if (!document.querySelector('[aria-label="Back to connections"]')) {
              return false;
            }
            const grid = document.querySelector('[role="grid"]');
            if (!grid) return false;
            return Array.from(
              grid.querySelectorAll<HTMLElement>('[role="row"]'),
            ).some((row) => {
              const cells = Array.from(
                row.querySelectorAll<HTMLElement>('[role="gridcell"]'),
              ).map((cell) => (cell.textContent ?? "").trim());
              return (
                cells.includes("tv:string") &&
                cells.includes("expires") &&
                cells.some((cell) => /^(1[01][0-9]|120)$/.test(cell))
              );
            });
          });
          if (hasTtlResult) return true;
        } catch {
          // Closed Tauri windows can leave stale handles during smoke cleanup.
        }
      }
      return false;
    },
    {
      timeout,
      timeoutMsg: "Redis expire mutation did not return TTL command evidence",
    },
  );
}
