import { $, browser, expect } from "@wdio/globals";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createDuckdbConnection,
  openConnection,
  smokeFixtureRoot,
  step,
  waitForGridTextAll,
  waitForLauncher,
} from "./_helpers";
import { prepareDuckdbFixture } from "./duckdb-fixture";

// Regression pin (E2E P5): the backend `list_namespaces` query
// (`src-tauri/src/db/duckdb/connection.rs::LIST_NAMESPACES_SQL`) used to filter
// only the `information_schema`/`pg_catalog` *schemas*. But DuckDB's
// `information_schema.schemata` spans every attached catalog, and the internal
// `system` and `temp` catalogs each own their own `main` schema. So `main` came
// back three times (user db + system + temp). The frontend does not dedupe the
// `list_namespaces` payload (`useSchemaCache` filters system names out of the
// *count* only — they still render), and DuckDB paints a `flat` tree with no
// schema headers, so the two empty internal `main` duplicates rendered as extra
// "No tables" placeholders next to the real `core` tables.
//
// This fixture leaves the user's `main` schema empty and puts the only real
// table in `core`, so the flat tree renders exactly ONE "No tables" placeholder
// after the fix — and rendered THREE before it (the `main` triplicate).
const CONNECTION_NAME = "E2E DuckDB Schema Filter";
const SEED = "e2e/fixtures/duckdb/schema-filter/seed.sql";

describe("DuckDB schema filter smoke", () => {
  it("hides internal system/temp catalogs so empty `main` renders once, not thrice", async () => {
    const duckdbPath = resolve(
      smokeFixtureRoot(testDataDir()),
      "duckdb",
      "table_view_schema_filter.duckdb",
    );

    await step(
      "prepare deterministic DuckDB fixture (core table + empty main)",
      async () => {
        await prepareDuckdbFixture(duckdbPath, SEED);
      },
    );

    await step("connect to the DuckDB file and open workspace", async () => {
      await waitForLauncher();
      await createDuckdbConnection(CONNECTION_NAME, duckdbPath);
      await openConnection(CONNECTION_NAME);
    });

    await step("real user schema (core) still renders its table", async () => {
      // Flat tree: no schema header, tables listed directly. `core.users`
      // proves the fix does not over-filter user schemas.
      const usersTable = await $('[aria-label="users table"]');
      await usersTable.waitForDisplayed({ timeout: 15000 });
      await usersTable.click();
      await waitForGridTextAll(
        ["alice@example.com"],
        15000,
        "seeded DuckDB core.users row did not appear in grid",
      );
    });

    await step(
      "internal catalogs do not leak duplicate empty `main` placeholders",
      async () => {
        // The flat tree emits one "No tables" (schema:emptyTables) status row
        // per empty namespace. Only the user's own empty `main` should remain —
        // before the fix, system/temp `main` duplicates produced three.
        const noTablesCount = await countNoTablesPlaceholders();
        expect(noTablesCount).toBe(1);
      },
    );
  });
});

function testDataDir(): string {
  return (
    process.env.TABLE_VIEW_TEST_DATA_DIR ??
    resolve(tmpdir(), "table-view-smoke", "duckdb")
  );
}

async function countNoTablesPlaceholders(): Promise<number> {
  return browser.execute(
    () =>
      Array.from(document.querySelectorAll('[role="status"]')).filter(
        (el) => (el.textContent ?? "").trim() === "No tables",
      ).length,
  );
}
