import { $, browser } from "@wdio/globals";
import {
  expectConnectionVisible,
  openConnection,
  openNewConnectionDialog,
  openNewQueryTab,
  runQuery,
  step,
  switchToWorkspaceWindow,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

const CONNECTION_NAME = "E2E Valkey";
const INITIAL_VALUE = "hello-valkey";

describe("Valkey smoke", () => {
  it("connects, scans keys, previews values, and runs bounded commands", async () => {
    await step("create Valkey connection and open workspace", async () => {
      await waitForLauncher();
      await createValkeyConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
      await waitForWorkspaceTextAll(
        ["Keys", "vk:string"],
        30000,
        "Valkey key browser did not render seeded keys",
      );
    });

    await step("scan and preview a seeded string key", async () => {
      await setField("Valkey key pattern", "vk:*");
      await browser.keys("Enter");
      await waitForWorkspaceTextAll(
        ["3 keys", "vk:string", "vk:hash", "vk:events"],
        15000,
        "Valkey filtered key scan did not render seeded keys",
      );
      await clickKvKey("vk:string");
      await waitForWorkspaceTextAll(
        ["vk:string", INITIAL_VALUE, "string"],
        15000,
        "Valkey value preview did not render seeded string value",
      );
    });

    await step(
      "run bounded Valkey read commands in the query tab",
      async () => {
        await openNewQueryTab();
        await setCodeMirrorText("GET vk:string");
        await runQuery();
        await waitForValkeyGridTextAll(
          [INITIAL_VALUE],
          15000,
          "Valkey GET command did not render the seeded string value",
        );

        await setCodeMirrorText("HGETALL vk:hash");
        await runQuery();
        await waitForValkeyGridTextAll(
          ["name", "Ada", "role", "engineer"],
          15000,
          "Valkey HGETALL command did not render hash projection",
        );

        await setCodeMirrorText("XRANGE vk:events - + COUNT 10");
        await runQuery();
        await waitForValkeyGridTextAll(
          ["1-0", "login", "ada"],
          15000,
          "Valkey XRANGE command did not render stream projection",
        );
      },
    );

    await step("run bounded Valkey write and TTL commands", async () => {
      await setCodeMirrorText("SET vk:cmd written EX 120");
      await runQuery();
      await waitForWorkspaceTextAll(
        ["1 row affected"],
        15000,
        "Valkey SET command did not render DML summary",
      );
      await setCodeMirrorText("GET vk:cmd");
      await runQuery();
      await waitForValkeyGridTextAll(
        ["vk:cmd", "written"],
        15000,
        "Valkey SET command did not persist the written value",
      );

      await setCodeMirrorText("EXPIRE vk:cmd 60");
      await runQuery();
      await waitForWorkspaceTextAll(
        ["1 row affected"],
        15000,
        "Valkey EXPIRE command did not render DML summary",
      );
      await setCodeMirrorText("TTL vk:cmd");
      await runQuery();
      await waitForValkeyGridTextAll(
        ["vk:cmd", "expires"],
        15000,
        "Valkey TTL command did not confirm expire state",
      );
    });

    await step(
      "keep destructive commands behind exact-key confirmation",
      async () => {
        await setCodeMirrorText("DEL vk:cmd");
        await runQuery();
        await waitForWorkspaceTextAll(
          ["Confirmation key must exactly match the target key"],
          15000,
          "Valkey DEL command did not surface exact-key confirmation guard",
        );

        await setCodeMirrorText("FLUSHDB");
        await runQuery();
        await waitForWorkspaceTextAll(
          ["outside the bounded runtime slice"],
          15000,
          "Valkey unsupported command did not surface bounded-slice guard",
        );
      },
    );
  });
});

async function clickKvKey(key: string) {
  await switchToWorkspaceWindow();
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
      timeoutMsg: `${key} Valkey key did not appear`,
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
    if (!item) throw new Error(`${label} Valkey key did not appear`);
    item.click();
  }, key);
}

async function waitForValkeyGridTextAll(
  snippets: string[],
  timeout: number,
  timeoutMsg: string,
) {
  const needles = snippets.map((snippet) => snippet.toLowerCase());
  await browser.waitUntil(
    async () => {
      for (const handle of await browser.getWindowHandles()) {
        try {
          await browser.switchToWindow(handle);
          const hasExpectedGridText = await browser.execute((expected) => {
            if (!document.querySelector('[aria-label="Back to connections"]')) {
              return false;
            }
            const grid = document.querySelector('[role="grid"]');
            if (!grid) return false;
            const text = (grid.textContent ?? "").toLowerCase();
            return expected.every((needle) => text.includes(needle));
          }, needles);
          if (hasExpectedGridText) return true;
        } catch {
          // Closed Tauri windows can leave stale handles during smoke cleanup.
        }
      }
      return false;
    },
    { timeout, timeoutMsg },
  );
}

async function setCodeMirrorText(text: string) {
  await switchToWorkspaceWindow();
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
      timeoutMsg: "Valkey command editor did not accept direct input",
    },
  );
}

async function setField(label: string, value: string) {
  await switchToWorkspaceWindow();
  const field = await $(`[aria-label="${label}"]`);
  await field.waitForDisplayed({ timeout: 10000 });
  await field.clearValue();
  await field.setValue(value);
}

async function createValkeyConnection(name: string) {
  const dialog = await openNewConnectionDialog();
  await selectValkeyDatabaseType();

  await setInput("#conn-name", name);
  await setInput("#conn-host", process.env.E2E_VALKEY_HOST ?? "localhost");
  await setInput(
    "#conn-port",
    process.env.E2E_VALKEY_PORT ?? process.env.VALKEY_PORT ?? "16379",
  );
  const user = process.env.VALKEY_USER ?? "";
  if (user) {
    await setInput("#conn-user", user);
  }
  const password = process.env.VALKEY_PASSWORD ?? "";
  if (password) {
    await setInput("#conn-password", password);
  }
  await setInput("#conn-database", process.env.E2E_VALKEY_DB ?? "2");

  await (await $("button=Save")).click();
  await dialog.waitForDisplayed({ timeout: 10000, reverse: true });
  await expectConnectionVisible(name);
}

async function selectValkeyDatabaseType() {
  const trigger = await $("#conn-db-type");
  await trigger.waitForDisplayed({ timeout: 5000 });
  if ((await trigger.getText()).includes("Valkey")) return;

  await trigger.click();
  await browser.waitUntil(
    async () =>
      await browser.execute(() => {
        return Array.from(
          document.querySelectorAll<HTMLElement>('[role="option"]'),
        ).some(
          (option) =>
            option.offsetParent !== null &&
            option.textContent?.trim() === "Valkey",
        );
      }),
    {
      timeout: 5000,
      timeoutMsg: "Valkey option did not appear in the open select",
    },
  );
  await browser.execute(() => {
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find(
      (candidate) =>
        candidate.offsetParent !== null &&
        candidate.textContent?.trim() === "Valkey",
    );
    if (!option) throw new Error("Valkey option did not appear");
    option.click();
  });
}

async function setInput(selector: string, value: string) {
  const input = await $(selector);
  await input.waitForDisplayed({ timeout: 5000 });
  await input.clearValue();
  await input.setValue(value);
}
