import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionDraft, ConnectionGroup } from "@/types/connection";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  connectToDatabase,
  createSqliteDatabaseFile,
  deleteConnection,
  deleteGroup,
  disconnectFromDatabase,
  exportConnections,
  exportConnectionsEncrypted,
  importConnections,
  importConnectionsEncrypted,
  listConnections,
  listGroups,
  moveConnectionToGroup,
  saveConnection,
  saveGroup,
  testConnection,
} from "./connection";

const baseDraft: ConnectionDraft = {
  id: "conn-1",
  name: "Prod",
  dbType: "postgresql",
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "secret",
  database: "app",
  readOnly: false,
  groupId: "grp-1",
  color: "#2255aa",
  connectionTimeout: 15,
  keepAliveInterval: 30,
  environment: "production",
  paradigm: "rdb",
};

describe("connection Tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("normalizes listed connections and preserves backend password presence", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "conn-1",
        name: "Prod",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "app",
        read_only: false,
        group_id: "grp-1",
        color: null,
        connection_timeout: 15,
        keep_alive_interval: 30,
        environment: "production",
        has_password: true,
        paradigm: "rdb",
      },
    ]);

    const connections = await listConnections();

    expect(invokeMock).toHaveBeenCalledWith("list_connections");
    expect(connections).toEqual([
      expect.objectContaining({
        id: "conn-1",
        dbType: "postgresql",
        groupId: "grp-1",
        connectionTimeout: 15,
        keepAliveInterval: 30,
        hasPassword: true,
      }),
    ]);
  });

  it("saves through the nested req envelope and never embeds plaintext in connection", async () => {
    invokeMock.mockResolvedValueOnce({
      ...baseDraft,
      db_type: "postgresql",
      group_id: "grp-1",
      has_password: true,
      connection_timeout: 15,
      keep_alive_interval: 30,
    });

    const saved = await saveConnection(baseDraft, true);

    expect(invokeMock).toHaveBeenCalledWith("save_connection", {
      req: {
        connection: {
          ...baseDraft,
          password: undefined,
          hasPassword: false,
        },
        password: "secret",
        is_new: true,
      },
    });
    const payload = invokeMock.mock.calls[0]?.[1] as {
      req: { connection: Record<string, unknown> };
    };
    expect(payload.req.connection).not.toHaveProperty("password");
    expect(saved).toEqual(
      expect.objectContaining({ id: "conn-1", hasPassword: true }),
    );
  });

  it("tests existing connections with existing_id so the backend can reuse stored password", async () => {
    const draft: ConnectionDraft = { ...baseDraft, password: null };
    invokeMock.mockResolvedValueOnce("Connection successful");

    await expect(testConnection(draft, "conn-1")).resolves.toBe(
      "Connection successful",
    );

    expect(invokeMock).toHaveBeenCalledWith("test_connection", {
      req: {
        config: {
          ...draft,
          password: undefined,
          hasPassword: false,
        },
        password: null,
        existing_id: "conn-1",
      },
    });
  });

  it("forwards lifecycle and group operations through their exact IPC commands", async () => {
    const group: ConnectionGroup = {
      id: "grp-1",
      name: "Production",
      color: "#2255aa",
      collapsed: false,
    };
    invokeMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("/tmp/app.sqlite")
      .mockResolvedValueOnce([group])
      .mockResolvedValueOnce(group)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await connectToDatabase("conn-1");
    await disconnectFromDatabase("conn-1");
    await deleteConnection("conn-1");
    await createSqliteDatabaseFile("/tmp/app.sqlite");
    await expect(listGroups()).resolves.toEqual([group]);
    await expect(saveGroup(group, true)).resolves.toEqual(group);
    await deleteGroup("grp-1");
    await moveConnectionToGroup("conn-1", null);

    expect(invokeMock.mock.calls).toEqual([
      ["connect", { id: "conn-1" }],
      ["disconnect", { id: "conn-1" }],
      ["delete_connection", { id: "conn-1" }],
      ["create_sqlite_database_file", { path: "/tmp/app.sqlite" }],
      ["list_groups"],
      ["save_group", { group, isNew: true }],
      ["delete_group", { id: "grp-1" }],
      ["move_connection_to_group", { connectionId: "conn-1", groupId: null }],
    ]);
  });

  it("forwards import/export payloads, including encrypted master password", async () => {
    invokeMock
      .mockResolvedValueOnce('{"schema_version":1}')
      .mockResolvedValueOnce({ imported: ["Prod"], renamed: [] })
      .mockResolvedValueOnce({ password: "word list", json: "{}" })
      .mockResolvedValueOnce({
        imported: ["Prod"],
        renamed: [],
        created_groups: [],
        skipped_groups: [],
      });

    await exportConnections(["conn-1"]);
    await importConnections('{"schema_version":1}');
    await exportConnectionsEncrypted(["conn-1"]);
    await importConnectionsEncrypted("{}", "word list");

    expect(invokeMock.mock.calls).toEqual([
      ["export_connections", { ids: ["conn-1"] }],
      ["import_connections", { json: '{"schema_version":1}' }],
      ["export_connections_encrypted", { ids: ["conn-1"] }],
      [
        "import_connections_encrypted",
        { payload: "{}", masterPassword: "word list" },
      ],
    ]);
  });
});
