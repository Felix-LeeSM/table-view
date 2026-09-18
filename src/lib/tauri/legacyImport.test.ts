// `importLegacyLocalStorage` wrapper unit tests. Verifies only the backend
// IPC call contract (command name, payload shape, error propagation) —
// actual SQLite writes are the Rust integration tests' responsibility.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { importLegacyLocalStorage, type LegacyPayload } from "./legacyImport";

describe("importLegacyLocalStorage (Phase 1 sprint-355)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the import_legacy_localstorage command with camelCase payload", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    const payload: LegacyPayload = {
      favorites: [
        {
          id: "fav-1",
          name: "users",
          sql: "SELECT * FROM users",
          connectionId: "conn-1",
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      ],
      mru: [{ connectionId: "conn-1", lastUsed: 1_700_000_000_000 }],
    };

    await importLegacyLocalStorage(payload);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("import_legacy_localstorage", {
      payload,
    });
  });

  it("forwards an empty payload (no favorites / no mru) — backend handles pending → done transition", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await importLegacyLocalStorage({});
    expect(invokeMock).toHaveBeenCalledWith("import_legacy_localstorage", {
      payload: {},
    });
  });

  it("propagates backend rejection (e.g. LegacyImportInProgress on retry race)", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("Legacy import in progress — write blocked"),
    );
    await expect(importLegacyLocalStorage({})).rejects.toThrow(
      /Legacy import in progress/,
    );
  });

  it("supports null connectionId (global favorite)", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const payload: LegacyPayload = {
      favorites: [
        {
          id: "fav-2",
          name: "logs",
          sql: "SELECT * FROM logs",
          connectionId: null,
          createdAt: 1_700_000_001_000,
          updatedAt: 1_700_000_001_000,
        },
      ],
    };
    await importLegacyLocalStorage(payload);
    expect(invokeMock).toHaveBeenCalledWith("import_legacy_localstorage", {
      payload,
    });
  });
});
