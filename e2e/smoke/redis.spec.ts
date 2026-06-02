import { $, browser } from "@wdio/globals";
import {
  createRedisConnection,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  waitForGridTextAll,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

const CONNECTION_NAME = "E2E Redis";
const INITIAL_VALUE = "hello";

describe("Redis smoke", () => {
  it("connects, scans keys, previews values, runs commands, and gates mutations", async () => {
    const editedValue = `smoke-${Date.now()}`;

    await step("create Redis connection and open workspace", async () => {
      await waitForLauncher();
      await createRedisConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
      await waitForWorkspaceTextAll(
        ["Keys", "tv:string"],
        30000,
        "Redis key browser did not render seeded keys",
      );
    });

    await step("scan and preview a seeded string key", async () => {
      await setField("Redis key pattern", "tv:string");
      await browser.keys("Enter");
      await waitForWorkspaceTextAll(
        ["1 key", "tv:string"],
        15000,
        "Redis filtered key scan did not render tv:string",
      );
      await clickRedisKey("tv:string");
      await waitForWorkspaceTextAll(
        ["tv:string", INITIAL_VALUE, "string", "Mutation"],
        15000,
        "Redis value preview did not render seeded string value",
      );
    });

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

    await step("guard and apply a string overwrite", async () => {
      await clickRedisKey("tv:string");
      await setField("String value", editedValue);
      await clickButton("Preview string set");
      await waitForWorkspaceTextAll(
        ["Preview: SET tv:string"],
        10000,
        "Redis string set preview did not appear",
      );
      await clickButton("Confirm String set");
      await waitForWorkspaceTextAll(
        [editedValue],
        15000,
        "Redis string set did not refresh the preview",
      );
    });

    await step("guard and apply a TTL update", async () => {
      await setField("Expire seconds", "120");
      await clickButton("Preview expire");
      await waitForWorkspaceTextAll(
        ["Preview: expire tv:string after 120s."],
        10000,
        "Redis expire preview did not appear",
      );
      await clickButton("Confirm Expire");
      await waitForRedisTtlSeconds(15000);
    });

    await step("require exact key confirmation before delete", async () => {
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
      await waitForWorkspaceTextAll(
        ["No keys found."],
        15000,
        "Redis delete mutation did not refresh key scan",
      );
    });
  });
});

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

async function waitForRedisTtlSeconds(timeout: number) {
  await browser.waitUntil(
    async () =>
      await browser.execute(() => {
        const text = document.body.textContent ?? "";
        return /\b(1[01][0-9]|120)s\b/.test(text);
      }),
    {
      timeout,
      timeoutMsg: "Redis expire mutation did not refresh TTL metadata",
    },
  );
}
