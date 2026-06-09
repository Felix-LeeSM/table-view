import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  getFunctionSource,
  getTableColumns,
  getTableConstraints,
  getTableIndexes,
  getTriggerSource,
  getViewColumns,
  getViewDefinition,
  listDatabases,
  listFunctions,
  listPostgresExtensions,
  listPostgresTypes,
  listSchemaColumns,
  listSchemas,
  listTables,
  listTriggers,
  listViews,
} from "./schema";

interface SchemaCase {
  command: string;
  run: (expectedDatabase?: string) => Promise<unknown>;
  payload: (expectedDatabase: string | null) => Record<string, unknown>;
}

const cases: SchemaCase[] = [
  {
    command: "list_schemas",
    run: (expected) => listSchemas("conn-1", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      expectedDatabase,
    }),
  },
  {
    command: "list_tables",
    run: (expected) => listTables("conn-1", "public", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      schema: "public",
      expectedDatabase,
    }),
  },
  {
    command: "get_table_columns",
    run: (expected) => getTableColumns("conn-1", "users", "public", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      table: "users",
      schema: "public",
      expectedDatabase,
    }),
  },
  {
    command: "list_schema_columns",
    run: (expected) => listSchemaColumns("conn-1", "public", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      schema: "public",
      expectedDatabase,
    }),
  },
  {
    command: "get_table_indexes",
    run: (expected) => getTableIndexes("conn-1", "users", "public", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      table: "users",
      schema: "public",
      expectedDatabase,
    }),
  },
  {
    command: "get_table_constraints",
    run: (expected) =>
      getTableConstraints("conn-1", "users", "public", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      table: "users",
      schema: "public",
      expectedDatabase,
    }),
  },
  {
    command: "list_views",
    run: (expected) => listViews("conn-1", "public", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      schema: "public",
      expectedDatabase,
    }),
  },
  {
    command: "list_functions",
    run: (expected) => listFunctions("conn-1", "public", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      schema: "public",
      expectedDatabase,
    }),
  },
  {
    command: "get_view_definition",
    run: (expected) =>
      getViewDefinition("conn-1", "public", "v_users", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      schema: "public",
      viewName: "v_users",
      expectedDatabase,
    }),
  },
  {
    command: "get_view_columns",
    run: (expected) => getViewColumns("conn-1", "public", "v_users", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      schema: "public",
      viewName: "v_users",
      expectedDatabase,
    }),
  },
  {
    command: "get_function_source",
    run: (expected) =>
      getFunctionSource("conn-1", "public", "refresh_users", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      schema: "public",
      functionName: "refresh_users",
      expectedDatabase,
    }),
  },
  {
    command: "list_triggers",
    run: (expected) => listTriggers("conn-1", "public", "users", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      schema: "public",
      table: "users",
      expectedDatabase,
    }),
  },
  {
    command: "get_trigger_source",
    run: (expected) =>
      getTriggerSource("conn-1", "public", "users", "users_audit", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      schema: "public",
      table: "users",
      triggerName: "users_audit",
      expectedDatabase,
    }),
  },
  {
    command: "list_postgres_types",
    run: (expected) => listPostgresTypes("conn-1", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      expectedDatabase,
    }),
  },
  {
    command: "list_postgres_extensions",
    run: (expected) => listPostgresExtensions("conn-1", expected),
    payload: (expectedDatabase) => ({
      connectionId: "conn-1",
      expectedDatabase,
    }),
  },
];

describe("schema Tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("lists databases through the paradigm-neutral command", async () => {
    invokeMock.mockResolvedValueOnce([{ name: "app" }]);

    await expect(listDatabases("conn-1")).resolves.toEqual([{ name: "app" }]);

    expect(invokeMock).toHaveBeenCalledWith("list_databases", {
      connectionId: "conn-1",
    });
  });

  it.each(cases)(
    "threads null expectedDatabase for $command when workspace db is absent",
    async ({ command, run, payload }) => {
      invokeMock.mockResolvedValueOnce([]);

      await run();

      expect(invokeMock).toHaveBeenCalledWith(command, payload(null));
    },
  );

  it.each(cases)(
    "threads expectedDatabase for $command when workspace db is present",
    async ({ command, run, payload }) => {
      invokeMock.mockResolvedValueOnce([]);

      await run("app");

      expect(invokeMock).toHaveBeenCalledWith(command, payload("app"));
    },
  );
});
