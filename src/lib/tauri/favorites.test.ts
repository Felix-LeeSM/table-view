import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { listFavorites, persistFavorites } from "./favorites";

const invokeMock = vi.mocked(invoke);

describe("favorites Tauri wrapper", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("persists favorite rows with the existing IPC payload shape", async () => {
    const favorites = [
      {
        id: "fav-1",
        name: "Recent query",
        sql: "SELECT 1",
        connectionId: null,
        sortOrder: 0,
        createdAt: 100,
        updatedAt: 100,
      },
    ];

    await persistFavorites(favorites);

    expect(invokeMock).toHaveBeenCalledWith("persist_favorites", {
      favorites,
    });
  });

  it("loads favorite rows from the existing IPC command", async () => {
    const rows = [
      {
        id: "fav-1",
        name: "Saved",
        sql: "SELECT 1",
        connectionId: "conn-1",
        createdAt: 100,
        updatedAt: 200,
      },
    ];
    invokeMock.mockResolvedValueOnce(rows);

    await expect(listFavorites()).resolves.toBe(rows);
    expect(invokeMock).toHaveBeenCalledWith("list_favorites");
  });
});
