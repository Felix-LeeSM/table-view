import { $, browser, expect } from "@wdio/globals";
import {
  createMssqlConnection,
  openConnection,
  step,
  waitForLauncher,
} from "./_helpers";

// Regression pin (E2E P5): the backend schema-list query
// (`src-tauri/src/db/mssql/catalog/queries.rs::USER_SCHEMAS_SQL`) used to
// exclude only `sys` and `INFORMATION_SCHEMA`. SQL Server auto-creates one
// schema per fixed database role (`db_datareader`, `db_owner`, …) plus `guest`
// in EVERY database, so those leaked into the `with-schema` sidebar next to the
// real `dbo` schema. The fix adds them to the exclusion list; `dbo` and any
// user schema must still show.
const CONNECTION_NAME = "E2E MSSQL Schema Filter";

// Schemas SQL Server ships in every database that must never reach the sidebar.
const HIDDEN_SCHEMAS = [
  "guest",
  "db_accessadmin",
  "db_backupoperator",
  "db_datareader",
  "db_datawriter",
  "db_ddladmin",
  "db_denydatareader",
  "db_denydatawriter",
  "db_owner",
  "db_securityadmin",
];

describe("MSSQL schema filter smoke", () => {
  it("shows dbo but hides fixed database-role and guest schemas", async () => {
    await step("connect to the seeded MSSQL database", async () => {
      await waitForLauncher();
      await createMssqlConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
    });

    await step("user schema dbo renders in the tree", async () => {
      // with-schema tree: schema rows carry `aria-label="{name} schema"`.
      const dbo = await $('[aria-label="dbo schema"]');
      await dbo.waitForDisplayed({ timeout: 30000 });
    });

    await step(
      "fixed database-role and guest schemas are excluded",
      async () => {
        // dbo present above guarantees the schema list has loaded, so a
        // missing role/guest row is a real exclusion, not a race.
        const leaked = await findRenderedSchemas(HIDDEN_SCHEMAS);
        expect(leaked).toEqual([]);
      },
    );
  });
});

/** Names from `candidates` that have a rendered `"{name} schema"` tree row. */
async function findRenderedSchemas(candidates: string[]): Promise<string[]> {
  return browser.execute(
    (names: string[]) =>
      names.filter((name) =>
        document.querySelector(`[aria-label="${name} schema"]`),
      ),
    candidates,
  );
}
