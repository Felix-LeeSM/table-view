import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AddConstraintRequest,
  CreateIndexRequest,
  CreateTablePlanRequest,
  CreateTriggerRequest,
  DropTriggerRequest,
} from "@/types/schema";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  addConstraint,
  countNullRows,
  createIndex,
  createRdbDatabase,
  createTablePlan,
  createTrigger,
  dropRdbDatabase,
  dropTable,
  dropTrigger,
  renameTable,
} from "./ddl";

describe("DDL Tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("compat table wrappers build request-shaped destructive payloads", async () => {
    invokeMock.mockResolvedValue({ sql: "" });

    await dropTable("conn-1", "users", "public", "app");
    expect(invokeMock).toHaveBeenLastCalledWith("drop_table", {
      request: {
        connectionId: "conn-1",
        schema: "public",
        table: "users",
        cascade: false,
        previewOnly: false,
        expectedDatabase: "app",
      },
    });

    await renameTable("conn-1", "users", "public", "customers", "app");
    expect(invokeMock).toHaveBeenLastCalledWith("rename_table", {
      request: {
        connectionId: "conn-1",
        schema: "public",
        table: "users",
        newName: "customers",
        previewOnly: false,
        expectedDatabase: "app",
      },
    });
  });

  it("threads null expectedDatabase for countNullRows when workspace db is absent", async () => {
    invokeMock.mockResolvedValueOnce(0).mockResolvedValueOnce(3);

    await expect(
      countNullRows("conn-1", "public", "users", "email"),
    ).resolves.toBe(0);
    expect(invokeMock).toHaveBeenLastCalledWith("count_null_rows", {
      connectionId: "conn-1",
      schema: "public",
      table: "users",
      column: "email",
      expectedDatabase: null,
    });

    await expect(
      countNullRows("conn-1", "public", "users", "email", "app"),
    ).resolves.toBe(3);
    expect(invokeMock).toHaveBeenLastCalledWith("count_null_rows", {
      connectionId: "conn-1",
      schema: "public",
      table: "users",
      column: "email",
      expectedDatabase: "app",
    });
  });

  it("preserves unified create-table-plan and trigger request envelopes", async () => {
    const plan: CreateTablePlanRequest = {
      connectionId: "conn-1",
      schema: "public",
      name: "users",
      columns: [
        {
          name: "id",
          data_type: "integer",
          nullable: false,
          default_value: null,
        },
      ],
      indexes: [
        { indexName: "users_id_idx", columns: ["id"], indexType: "btree" },
      ],
      constraints: [
        {
          constraintName: "users_id_pk",
          definition: { type: "primary_key", columns: ["id"] },
        },
      ],
      previewOnly: true,
      expectedDatabase: "app",
    };
    const createTriggerRequest: CreateTriggerRequest = {
      connectionId: "conn-1",
      schema: "public",
      table: "users",
      triggerName: "users_audit",
      timing: "AFTER",
      events: ["INSERT"],
      orientation: "ROW",
      functionSchema: "public",
      functionName: "audit_user",
      previewOnly: true,
      expectedDatabase: "app",
    };
    const dropTriggerRequest: DropTriggerRequest = {
      connectionId: "conn-1",
      schema: "public",
      table: "users",
      triggerName: "users_audit",
      cascade: true,
      previewOnly: false,
      expectedDatabase: "app",
    };
    invokeMock.mockResolvedValue({ sql: "SQL" });

    await createTablePlan(plan);
    await createTrigger(createTriggerRequest);
    await dropTrigger(dropTriggerRequest);

    expect(invokeMock.mock.calls).toEqual([
      ["create_table_plan", { request: plan }],
      ["create_trigger", { request: createTriggerRequest }],
      ["drop_trigger", { request: dropTriggerRequest }],
    ]);
  });

  it("keeps legacy snake_case DDL request bodies intact", async () => {
    const indexRequest: CreateIndexRequest = {
      connection_id: "conn-1",
      schema: "public",
      table: "users",
      index_name: "users_email_idx",
      columns: ["email"],
      index_type: "btree",
      is_unique: true,
      preview_only: true,
      expected_database: "app",
    };
    const constraintRequest: AddConstraintRequest = {
      connection_id: "conn-1",
      schema: "public",
      table: "users",
      constraint_name: "users_email_unique",
      definition: { type: "unique", columns: ["email"] },
      preview_only: true,
      expected_database: "app",
    };
    invokeMock.mockResolvedValue({ sql: "SQL" });

    await createIndex(indexRequest);
    await addConstraint(constraintRequest);

    expect(invokeMock.mock.calls).toEqual([
      ["create_index", { request: indexRequest }],
      ["add_constraint", { request: constraintRequest }],
    ]);
  });

  it("routes database create/drop commands without client-side SQL assembly", async () => {
    invokeMock.mockResolvedValue(undefined);

    await createRdbDatabase("conn-1", "analytics");
    await dropRdbDatabase("conn-1", "analytics");

    expect(invokeMock.mock.calls).toEqual([
      ["create_rdb_database", { connectionId: "conn-1", name: "analytics" }],
      ["drop_rdb_database", { connectionId: "conn-1", name: "analytics" }],
    ]);
  });
});
