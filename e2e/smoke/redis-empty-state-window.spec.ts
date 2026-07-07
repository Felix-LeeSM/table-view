import { $, browser, expect } from "@wdio/globals";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createDuckdbConnection,
  createRedisConnection,
  openConnection,
  setActiveWorkspaceConnection,
  step,
  switchToLauncherWindow,
  switchToWorkspaceWindow,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";
import { prepareDuckdbFixture } from "./duckdb-fixture";

// #D — EmptyState must target the connection this workspace window is pinned
// to (its Tauri window label), NOT a global MRU/first-connected pick. The
// pre-fix `EmptyState` picked `mruConnection ?? firstConnected` across ALL
// connections, so a Redis(KV) window that also had a connected DuckDB(rdb)
// connection mislabeled its empty state "SQL against <DuckDB>" and opened its
// "New Query" tab in the DuckDB workspace slot — invisible to the Redis
// window ("New Query does nothing").
//
// Repro without touching MRU: DuckDB is created FIRST, so it is the
// first-connected connection. Opening a connection never marks it MRU on its
// own (App.tsx only calls `markConnectionUsed` once a tab exists), so the
// pre-fix target resolves to `firstConnected` = DuckDB even though the window
// under test is Redis. Requires docker Redis (:6379); DuckDB is embedded.
const DUCK_CONNECTION = "E2E DuckDB EmptyState";
const REDIS_CONNECTION = "E2E Redis EmptyState";

describe("Empty state targets the pinned window connection (#D)", () => {
  it("Redis window shows the KV lead and routes New Query to itself while DuckDB is the first-connected connection", async () => {
    const duckdbPath = resolve(
      tmpdir(),
      "table-view-smoke",
      "empty-state",
      "duck.duckdb",
    );

    await step("prepare embedded DuckDB fixture file", async () => {
      await prepareDuckdbFixture(duckdbPath);
    });

    await step(
      "open DuckDB first (first-connected), then open Redis in its own window",
      async () => {
        await waitForLauncher();
        await createDuckdbConnection(DUCK_CONNECTION, duckdbPath);
        await openConnection(DUCK_CONNECTION);

        await switchToLauncherWindow();
        await createRedisConnection(REDIS_CONNECTION);
        await openConnection(REDIS_CONNECTION);
      },
    );

    await step(
      "Redis window empty-state renders the KV lead, not the SQL/DuckDB lead",
      async () => {
        setActiveWorkspaceConnection(REDIS_CONNECTION);
        await switchToWorkspaceWindow();

        // Pre-fix RED: the target was DuckDB (first-connected), so the Redis
        // window showed "…start writing SQL against E2E DuckDB EmptyState".
        await waitForWorkspaceTextAll(
          ["start writing Redis commands against", REDIS_CONNECTION],
          20000,
          "Redis window empty-state did not render the KV command lead for its own connection",
        );
        // The wrong-paradigm SQL lead and the other connection's name must not
        // leak into this window.
        await expectAbsentInWorkspace("start writing SQL against");
        await expectAbsentInWorkspace(DUCK_CONNECTION);
      },
    );

    await step(
      "New Query CTA opens a query tab in THIS Redis window",
      async () => {
        // EmptyState's CTA carries no aria-label; match it by its visible
        // "New Query" text (the TabBar's aria-labelled "New Query Tab" button
        // is not mounted while the empty state is showing).
        const cta = await $("button=New Query");
        await cta.waitForDisplayed({ timeout: 10000 });
        await cta.click();

        // Pre-fix RED: the tab was created in the DuckDB workspace slot, so no
        // editor mounted in the Redis window and the CTA appeared to no-op.
        const editor = await $(".cm-editor");
        await editor.waitForDisplayed({ timeout: 10000 });
      },
    );
  });
});

async function expectAbsentInWorkspace(text: string) {
  const present = await browser.execute(
    (needle) => (document.body.textContent ?? "").includes(needle),
    text,
  );
  expect(present).toBe(false);
}
