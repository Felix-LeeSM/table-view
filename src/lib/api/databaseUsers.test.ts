// Issue #1077 Stage 2 — listDatabaseUsers wrapper contract: forwards the
// connectionId to the `list_database_users` command and returns the wire
// rows verbatim; propagates backend errors (Unsupported for gated engines).

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { listDatabaseUsers, type DatabaseUserRow } from "./databaseUsers";

describe("listDatabaseUsers API wrapper", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes list_database_users with the connection id and returns rows", async () => {
    const rows: DatabaseUserRow[] = [
      {
        name: "alice",
        canLogin: true,
        isSuperuser: false,
        canCreateDb: false,
        canCreateRole: false,
        replication: false,
        connLimit: -1,
        validUntil: null,
        memberOf: ["readonly"],
      },
    ];
    invokeMock.mockResolvedValueOnce(rows);

    const out = await listDatabaseUsers("conn-pg");

    expect(invokeMock).toHaveBeenCalledWith("list_database_users", {
      connectionId: "conn-pg",
    });
    expect(out).toEqual(rows);
  });

  it("propagates backend errors (e.g. Unsupported for gated engines)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Unsupported"));
    await expect(listDatabaseUsers("conn-mysql")).rejects.toThrow(
      /unsupported/i,
    );
  });
});
