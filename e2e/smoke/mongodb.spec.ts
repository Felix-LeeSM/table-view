import { $, browser, expect } from "@wdio/globals";
import {
  createMongoConnection,
  editGridCellInRow,
  executeMqlPreview,
  expandIfCollapsed,
  expectNoVisibleDialogText,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  waitForDialogTextAll,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";

const CONNECTION_NAME = "E2E MongoDB";
const DATABASE_NAME = "table_view_test";
const SMOKE_COLLECTION = "smoke_users";
const MONA_EMAIL = "mona@example.com";

function monaReadQuery() {
  return `db.${SMOKE_COLLECTION}.find({email:"${MONA_EMAIL}"}, {name:1,email:1,_id:0}).sort({name:1}).limit(1)`;
}

async function typeMongoQuery(query: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((nextQuery) => {
        type CodeMirrorView = {
          state: { doc: { toString(): string } };
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

        const currentQuery = view.state.doc.toString();
        view.focus();
        if (currentQuery !== nextQuery) {
          view.dispatch({
            changes: { from: 0, to: currentQuery.length, insert: nextQuery },
          });
        }
        return view.state.doc.toString() === nextQuery;
      }, query),
    {
      timeout: 5000,
      timeoutMsg: "MongoDB Query Editor did not accept direct input",
    },
  );
}

async function selectMongoQueryDatabase(database: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute(() => {
        return Array.from(
          document.querySelectorAll<HTMLElement>("button[aria-label]"),
        ).some((button) => {
          const label = button.getAttribute("aria-label") ?? "";
          return (
            button.offsetParent !== null &&
            (label.startsWith("No database bound") ||
              label.startsWith("Current database:"))
          );
        });
      }),
    {
      timeout: 10000,
      timeoutMsg: "Mongo query database selector did not appear",
    },
  );
  await browser.execute(() => {
    const trigger = Array.from(
      document.querySelectorAll<HTMLElement>("button[aria-label]"),
    ).find((button) => {
      const label = button.getAttribute("aria-label") ?? "";
      return (
        button.offsetParent !== null &&
        (label.startsWith("No database bound") ||
          label.startsWith("Current database:"))
      );
    });
    if (!trigger) throw new Error("Mongo query database selector not found");
    trigger.click();
  });
  await clickVisibleOption(database);
  await browser.waitUntil(
    async () =>
      await browser.execute((expected) => {
        return Array.from(
          document.querySelectorAll<HTMLElement>("button[aria-label]"),
        ).some((button) => {
          const label = button.getAttribute("aria-label") ?? "";
          return (
            button.offsetParent !== null &&
            label.startsWith(`Current database: ${expected}.`)
          );
        });
      }, database),
    {
      timeout: 10000,
      timeoutMsg: `Mongo query database did not switch to ${database}`,
    },
  );
}

async function clickVisibleOption(label: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((text) => {
        return Array.from(
          document.querySelectorAll<HTMLElement>('[role="option"]'),
        ).some(
          (option) =>
            option.offsetParent !== null && option.textContent?.trim() === text,
        );
      }, label),
    {
      timeout: 10000,
      timeoutMsg: `${label} option did not appear`,
    },
  );
  await browser.execute((text) => {
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find(
      (candidate) =>
        candidate.offsetParent !== null &&
        candidate.textContent?.trim() === text,
    );
    if (!option) throw new Error(`${text} option did not appear`);
    option.click();
  }, label);
}

describe("MongoDB smoke", () => {
  it("creates a connection, edits seeded collection data, and renders the committed document", async () => {
    const editedName = `Mona Smoke ${Date.now()}`;

    await step("create MongoDB connection and open workspace", async () => {
      await waitForLauncher();
      await createMongoConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);

      const filter = await $('[aria-label="Filter databases and collections"]');
      await filter.waitForDisplayed({ timeout: 30000 });
    });

    await step("open seeded smoke_users collection", async () => {
      await expandIfCollapsed(
        `[aria-label="${DATABASE_NAME} database"]`,
        30000,
      );

      const collection = await $(
        `[aria-label="${SMOKE_COLLECTION} collection"]`,
      );
      await collection.waitForDisplayed({ timeout: 15000 });
      await collection.click();

      await waitForGridTextAll(
        [MONA_EMAIL],
        15000,
        "seeded MongoDB document did not appear in document grid",
      );

      expect(await collection.isDisplayed()).toBe(true);
    });

    await step(
      "edit Mona document name and execute the MQL preview",
      async () => {
        await editGridCellInRow(MONA_EMAIL, 3, editedName, "Editing name");

        const commit = await $('[aria-label="Commit changes"]');
        await commit.click();
        await executeMqlPreview();
      },
    );

    await step("verify committed MongoDB document value in grid", async () => {
      await waitForGridTextAll(
        [MONA_EMAIL, editedName],
        15000,
        "committed MongoDB edit did not appear in document grid",
      );
    });

    await step(
      "verify query editor find projection and cursor chain",
      async () => {
        await openNewQueryTab();
        await selectMongoQueryDatabase(DATABASE_NAME);
        await typeMongoQuery(monaReadQuery());
        await runQuery();
        await waitForGridTextAll(
          [MONA_EMAIL, editedName],
          15000,
          "MongoDB query editor find/projection/cursor chain did not return the edited document",
        );
      },
    );

    await step(
      "confirm destructive runCommand is gated before mutation",
      async () => {
        await typeMongoQuery(
          `db.runCommand({delete:"${SMOKE_COLLECTION}", deletes:[{q:{email:"${MONA_EMAIL}"}, limit:0}]})`,
        );
        await runQuery();
        await waitForDialogTextAll(
          ["runCommand", "delete", SMOKE_COLLECTION],
          15000,
          "MongoDB destructive runCommand confirmation did not appear",
        );

        const cancel = await $('[data-testid="confirm-destructive-cancel"]');
        await cancel.waitForDisplayed({ timeout: 10000 });
        await cancel.click();
        await expectNoVisibleDialogText("runCommand", 1000);
      },
    );

    await step(
      "verify destructive confirmation cancel left data intact",
      async () => {
        await typeMongoQuery(monaReadQuery());
        await runQuery();
        await waitForGridTextAll(
          [MONA_EMAIL, editedName],
          15000,
          "MongoDB destructive runCommand cancel mutated the seeded document",
        );
      },
    );
  });
});
