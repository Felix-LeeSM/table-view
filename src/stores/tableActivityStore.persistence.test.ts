import { describe, it, expect, beforeEach, vi } from "vitest";

// #1218 persist round-trip + #1091 hydrate-crash guard.
//
// #1091 lesson: the moment a persisted store hydrates a non-empty list, any
// field the mapper forgot to backfill crashed at the top level. Here the risk
// fields are the nullable `schema` (stored '' by the backend) and the nullable
// `lastUsed` / `pinnedAt`. hydrate MUST normalize them without throwing, and a
// full entry must survive entry -> persist payload -> SQLite row shape ->
// hydrate unchanged.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  useTableActivityStore,
  __resetTableActivityStoreForTests,
  selectPinnedTables,
  selectRecentTables,
  type PersistTableActivityPayload,
} from "./tableActivityStore";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  __resetTableActivityStoreForTests();
});

describe("tableActivityStore persistence round-trip", () => {
  it("hydrates rows from list_table_activity without crashing on nullable fields", async () => {
    const rows: PersistTableActivityPayload[] = [
      // schemaless flat row: schema null, pinned-only (lastUsed null).
      {
        connectionId: "sl1",
        db: "main.db",
        schema: null,
        table: "todos",
        lastUsed: null,
        pinnedAt: 100,
      },
      // with-schema recent row.
      {
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: "users",
        lastUsed: 200,
        pinnedAt: null,
      },
    ];
    invokeMock.mockResolvedValueOnce(rows);

    await useTableActivityStore.getState().loadPersistedTableActivity();

    const entries = useTableActivityStore.getState().entries;
    expect(entries).toHaveLength(2);

    const pinned = selectPinnedTables(entries, "sl1", "main.db");
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.schema).toBeNull();
    expect(pinned[0]!.lastUsed).toBeNull();

    const recent = selectRecentTables(entries, "pg1", "app");
    expect(recent[0]!.table).toBe("users");
    expect(recent[0]!.pinnedAt).toBeNull();
  });

  it("survives a mutate -> persist payload -> hydrate round-trip byte-for-byte", async () => {
    const store = useTableActivityStore.getState();
    store.recordTableUsed({
      connectionId: "pg1",
      db: "app",
      schema: "public",
      table: "users",
    });
    store.togglePin({
      connectionId: "pg1",
      db: "app",
      schema: "public",
      table: "users",
    });
    await Promise.resolve();

    const persistCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "persist_table_activity",
    );
    const lastPayload = persistCalls[persistCalls.length - 1]![1] as {
      entries: PersistTableActivityPayload[];
    };
    expect(lastPayload.entries).toHaveLength(1);
    const row = lastPayload.entries[0]!;
    expect(row.schema).toBe("public");
    expect(typeof row.lastUsed).toBe("number");
    expect(typeof row.pinnedAt).toBe("number");

    // Feed the exact persisted payload back through hydrate.
    __resetTableActivityStoreForTests();
    invokeMock.mockResolvedValueOnce(lastPayload.entries);
    await useTableActivityStore.getState().loadPersistedTableActivity();

    const hydrated = useTableActivityStore.getState().entries;
    expect(hydrated).toEqual([
      {
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: "users",
        lastUsed: row.lastUsed,
        pinnedAt: row.pinnedAt,
      },
    ]);
  });

  it("hydrate tolerates a rejected IPC (keeps default empty state)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    await useTableActivityStore.getState().loadPersistedTableActivity();
    expect(useTableActivityStore.getState().entries).toEqual([]);
  });
});
