import { $, browser, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  executeSqlPreview,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  switchToWorkspaceWindow,
  typeQuery,
  waitForDialogTextAll,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";

// Issue #1299 — multi-table (JOIN) result editing is a cross-component + IPC
// journey the unit / component tests cannot cover end to end: the sql-parser
// AST → multiTableResolver attribution → schemaStore PK lookup → per-table
// UPDATE routing → Rust `execute_query_batch` single-row transaction → commit
// re-run must all be alive. Same-named `id` columns (u.id + o.id) also exercise
// the #1296 Postgres column-order transport that keeps duplicate names distinct.
//
// The seed (`e2e/fixtures/postgresql/query/seed.sql`) gives Alice an order and
// leaves Bob order-less, so a LEFT JOIN yields one matched row (Alice) and one
// unmatched row (Bob, orders side NULL) — the exact shapes decisions #2/#3 pin.

const CONNECTION_NAME = "E2E Postgres Multi-Table Edit";
const JOIN_SQL =
  "SELECT u.id, u.name, o.id, o.total FROM users u LEFT JOIN orders o ON o.user_id = u.id ORDER BY u.id";

/** Read a raw editable-grid cell's `aria-readonly` for the row matching a
 *  text needle at the given 1-based aria-colindex. */
async function cellAriaReadonly(
  rowNeedle: string,
  ariaColIndex: number,
): Promise<string | null> {
  await switchToWorkspaceWindow();
  return browser.execute(
    (needle, colIndex) => {
      const row = Array.from(document.querySelectorAll('[role="row"]')).find(
        (candidate) =>
          ((candidate as HTMLElement).textContent ?? "").includes(needle),
      );
      const cell = row?.querySelector<HTMLElement>(
        `[role="gridcell"][aria-colindex="${colIndex}"]`,
      );
      return cell?.getAttribute("aria-readonly") ?? null;
    },
    rowNeedle,
    ariaColIndex,
  );
}

/** Dispatch a native double-click on the grid cell in the row matching a text
 *  needle at the given 1-based aria-colindex (React listens at the root). */
async function doubleClickCell(rowNeedle: string, ariaColIndex: number) {
  await switchToWorkspaceWindow();
  await browser.execute(
    (needle, colIndex) => {
      const row = Array.from(document.querySelectorAll('[role="row"]')).find(
        (candidate) =>
          ((candidate as HTMLElement).textContent ?? "").includes(needle),
      );
      const cell = row?.querySelector<HTMLElement>(
        `[role="gridcell"][aria-colindex="${colIndex}"]`,
      );
      if (!cell) return;
      const rect = cell.getBoundingClientRect();
      const init: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      };
      cell.dispatchEvent(new MouseEvent("dblclick", init));
    },
    rowNeedle,
    ariaColIndex,
  );
  await browser.pause(150);
}

/** Set the value of the currently-open cell editor input (by aria-label). */
async function setEditorValue(editorLabel: string, value: string) {
  await browser.execute(
    (label, next) => {
      const input = Array.from(
        document.querySelectorAll<HTMLInputElement>("input[aria-label]"),
      ).find((candidate) => candidate.getAttribute("aria-label") === label);
      if (!input) throw new Error(`${label} input did not appear`);
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, next);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          code: "Enter",
        }),
      );
    },
    editorLabel,
    value,
  );
}

describe("PostgreSQL multi-table (JOIN) result editing smoke", () => {
  it("edits a per-table cell from a JOIN result and locks LEFT JOIN NULL rows", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const aliceName = `Alice Join ${suffix}`;

    await step("open a non-production Postgres connection", async () => {
      await waitForLauncher();
      await createPostgresConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
    });

    await step("run the LEFT JOIN and confirm it is editable", async () => {
      await openNewQueryTab();
      await typeQuery(JOIN_SQL);
      await runQuery();
      await waitForGridTextAll(
        ["Alice", "Bob", "99.99"],
        15000,
        "JOIN result did not render",
      );
      // The multi-table gate opened per-column editing.
      const badge = await $("*=Editable —");
      await badge.waitForDisplayed({ timeout: 10000 });
    });

    await step(
      "LEFT JOIN unmatched (Bob) orders cells are locked",
      async () => {
        // Column 4 is o.total; Bob has no order so his row's orders columns are
        // read-only (decision #3). Editing must not open an editor.
        expect(await cellAriaReadonly("Bob", 4)).toBe("true");
        await doubleClickCell("Bob", 4);
        const editor = await browser.execute(() =>
          Array.from(document.querySelectorAll("input[aria-label]")).some(
            (el) => (el.getAttribute("aria-label") ?? "").startsWith("Editing"),
          ),
        );
        expect(editor).toBe(false);
      },
    );

    await step(
      "edit Alice's users.name cell and commit per-table",
      async () => {
        // Column 2 is u.name on the matched Alice row.
        await doubleClickCell("Alice", 2);
        await setEditorValue("Editing name", aliceName);

        const commit = await $('[aria-label="Commit pending changes"]');
        await commit.waitForDisplayed({ timeout: 10000 });
        await commit.click();

        // The preview targets the users table specifically (per-table routing).
        await waitForDialogTextAll(
          ["UPDATE", "users", aliceName],
          15000,
          "multi-table edit SQL preview did not target the users table",
        );
        await executeSqlPreview();
      },
    );

    await step("commit re-runs the query and shows the new name", async () => {
      await waitForGridTextAll(
        [aliceName],
        15000,
        "JOIN edit did not commit / re-run",
      );
    });

    const newTotal = "88.88";
    await step(
      "edit the orders side (same-named id columns) and round-trip",
      async () => {
        // Column 4 is o.total on the matched (Alice) row. Alice is the only
        // matched order row, so her new name pins the needle after the re-run.
        await doubleClickCell(aliceName, 4);
        await setEditorValue("Editing total", newTotal);

        const commit = await $('[aria-label="Commit pending changes"]');
        await commit.waitForDisplayed({ timeout: 10000 });
        await commit.click();

        // Routing must target orders, not users, despite the duplicate `id`
        // columns (#1296 transport keeps them distinct, positional PK WHERE).
        await waitForDialogTextAll(
          ["UPDATE", "orders", newTotal],
          15000,
          "orders-side edit SQL preview did not target the orders table",
        );
        await executeSqlPreview();

        await waitForGridTextAll(
          [newTotal],
          15000,
          "orders-side edit did not commit / re-run",
        );
      },
    );
  });
});
