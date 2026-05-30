import { browser, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  typeQuery,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";

const CONNECTION_NAME = "E2E Postgres Extension Completion";
const COMPLETION_LABEL_SELECTOR =
  ".cm-tooltip-autocomplete .cm-completionLabel";

async function visibleCompletionLabels(): Promise<string[]> {
  return await browser.execute((selector) => {
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => element.offsetParent !== null)
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean);
  }, COMPLETION_LABEL_SELECTOR);
}

async function triggerCompletion() {
  await browser.execute(() => {
    const editor = document.querySelector<HTMLElement>(".cm-content");
    if (!editor) throw new Error("CodeMirror editor content did not appear");
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        code: "Space",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

async function waitForCompletionLabel(label: string, timeoutMs = 15000) {
  await browser.waitUntil(
    async () => {
      const labels = await visibleCompletionLabels();
      if (labels.includes(label)) return true;
      await triggerCompletion();
      return false;
    },
    {
      timeout: timeoutMs,
      interval: 250,
      timeoutMsg: `${label} completion did not appear`,
    },
  );
}

async function settledCompletionLabels(waitMs = 1200): Promise<string[]> {
  const deadline = Date.now() + waitMs;
  let labels: string[] = [];
  while (Date.now() < deadline) {
    await triggerCompletion();
    labels = await visibleCompletionLabels();
    await browser.pause(200);
  }
  return labels;
}

describe("PostgreSQL installed-extension completion smoke", () => {
  it("gates curated completion packs with live installed extension inventory", async () => {
    await step("create Postgres connection and open workspace", async () => {
      await waitForLauncher();
      await createPostgresConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
    });

    await step(
      "verify live extension inventory from pg_extension",
      async () => {
        await openNewQueryTab();
        await typeQuery(
          "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'plpgsql', 'uuid-ossp') ORDER BY extname",
        );
        await runQuery();

        const grid = await waitForGridTextAll(
          ["pgcrypto", "plpgsql"],
          15000,
          "installed PostgreSQL extension inventory did not include pgcrypto and plpgsql",
        );
        const text = String((await grid.getProperty("textContent")) ?? "");
        expect(text.toLowerCase()).not.toContain("uuid-ossp");
      },
    );

    await step(
      "surface pgcrypto curated candidates when installed",
      async () => {
        await openNewQueryTab();
        await typeQuery("SELECT GEN_RANDOM");
        await waitForCompletionLabel("GEN_RANDOM_UUID");
      },
    );

    await step("withhold uuid-ossp candidates when not installed", async () => {
      await openNewQueryTab();
      await typeQuery("SELECT UUID_GENERATE");
      const labels = await settledCompletionLabels();
      expect(labels).not.toContain("UUID_GENERATE_V4");
    });

    await step(
      "keep unknown installed extensions detected but unpacked",
      async () => {
        await openNewQueryTab();
        await typeQuery("SELECT PLPGSQL");
        const labels = await settledCompletionLabels();
        expect(
          labels.some((label) => label.toUpperCase().includes("PLPGSQL")),
        ).toBe(false);
      },
    );
  });
});
