import { $ } from "@wdio/globals";
import {
  createPostgresConnection,
  openConnection,
  switchToWorkspaceWindow,
  waitForLauncher,
  step,
} from "./_helpers";

// Bug regression (2026-07-07): a PostgreSQL connection created with an EMPTY
// `database` field opened a pool but left `activeStatuses[id]` as bare
// `{ type: "connected" }` (no activeDb). The workspace key then derived
// `db=""`, and `useSchemaCache` skipped the whole schema load — the user saw a
// blank schema tree and a blank grid, unrecovered by a webview reload.
//
// `useAutoResolveActiveDb` (mounted in WorkspacePage) heals this reactively:
// it lists the connection's databases and auto-selects the first via
// `switchActiveDb` → `setActiveDb`, which unblocks the `(connId, db)` key so
// the schema tree loads.
//
// User-facing invariant asserted here: after opening a no-default-db PG
// connection, the schema tree actually renders (a `public schema` node
// appears) rather than staying blank. With the bug present this node never
// appears and the wait times out.
//
// NOTE: not runnable without the dockerised PG smoke stack; the seed +
// `tauri-driver` harness are the same as `postgres.spec.ts`.

const CONNECTION_NAME = "E2E Postgres NoDb";

describe("PostgreSQL smoke — no default database (auto-resolve)", () => {
  it("renders the schema tree after connecting with an empty database field", async () => {
    await step(
      "create Postgres connection with no default database and open workspace",
      async () => {
        await waitForLauncher();
        // Empty database field — the connection has no default db, so the
        // backend opens a pool without an active sub-pool selected.
        await createPostgresConnection(CONNECTION_NAME, undefined, {
          database: "",
        });
        await openConnection(CONNECTION_NAME);
      },
    );

    await step(
      "schema tree resolves a default database and renders (not blank)",
      async () => {
        await switchToWorkspaceWindow();
        // The `public schema` node only mounts once `useSchemaCache` runs with
        // a non-empty db — i.e. once auto-resolve selected the first database.
        // A 30s budget covers list_databases + switch_active_db + the schema
        // introspection round-trip (mirrors postgres.spec.ts).
        const publicSchema = await $('[aria-label="public schema"]');
        await publicSchema.waitForDisplayed({ timeout: 30000 });
      },
    );
  });
});
