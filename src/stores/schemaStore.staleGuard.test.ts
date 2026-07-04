// #1099 — After disconnect, an introspection IPC that was already in flight can
// resolve late and re-pollute the schemaStore cache for a connection that is no
// longer active. Because several fetchers are cache-first, a reconnect then
// short-circuits to that stale list. `clearForConnection` bumps a per-connection
// generation so the shared write guard drops superseded responses.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  useSchemaStore,
  __resetSchemaGenerationsForTests,
} from "./schemaStore";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const CLEAN_STATE = {
  databases: {},
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  postgresExtensions: {},
  sqliteCapabilities: {},
  tableColumnsCache: {},
  tableIndexesCache: {},
  tableConstraintsCache: {},
  triggers: {},
  fileAnalyticsSources: {},
  loading: false,
  error: null,
} as const;

describe("schemaStore stale introspection guard (#1099)", () => {
  beforeEach(() => {
    __resetSchemaGenerationsForTests();
    useSchemaStore.setState({ ...CLEAN_STATE });
  });

  it("drops a postgres-extensions response that resolves after disconnect", async () => {
    const pending =
      deferred<
        {
          name: string;
          schema: string;
          version: string;
          comment: string | null;
        }[]
      >();
    setupTauriMock({
      listPostgresExtensions: vi.fn(() => pending.promise),
    });

    // 1. Introspection is in flight.
    const inflight = useSchemaStore
      .getState()
      .loadPostgresExtensions("conn1", "db1");
    // 2. Disconnect clears the cache and supersedes the in-flight generation.
    useSchemaStore.getState().clearForConnection("conn1");
    // 3. The IPC resolves late.
    pending.resolve([
      { name: "pgcrypto", schema: "public", version: "1.3", comment: null },
    ]);
    await inflight;

    // 4. The just-cleared cache MUST NOT be re-populated by the stale response.
    expect(
      useSchemaStore.getState().postgresExtensions.conn1?.db1,
    ).toBeUndefined();
  });

  it("drops a database-inventory response that resolves after disconnect", async () => {
    const pending = deferred<{ name: string }[]>();
    setupTauriMock({ listDatabases: vi.fn(() => pending.promise) });

    const inflight = useSchemaStore.getState().loadDatabases("conn1");
    useSchemaStore.getState().clearForConnection("conn1");
    pending.resolve([{ name: "app" }]);
    await inflight;

    expect(useSchemaStore.getState().databases.conn1).toBeUndefined();
  });

  it("still writes a response that resolves while the connection is live", async () => {
    const pending =
      deferred<
        {
          name: string;
          schema: string;
          version: string;
          comment: string | null;
        }[]
      >();
    setupTauriMock({
      listPostgresExtensions: vi.fn(() => pending.promise),
    });

    const inflight = useSchemaStore
      .getState()
      .loadPostgresExtensions("conn1", "db1");
    // No disconnect — generation is unchanged.
    pending.resolve([
      { name: "pgcrypto", schema: "public", version: "1.3", comment: null },
    ]);
    await inflight;

    expect(
      useSchemaStore.getState().postgresExtensions.conn1?.db1,
    ).toHaveLength(1);
  });
});
