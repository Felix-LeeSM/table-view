import { describe, it, expect, beforeEach, vi } from "vitest";

// #1218 persist round-trip + #1091 hydrate-crash guard.
//
// #1091 lesson: the moment a persisted store hydrates a non-empty list, any
// field the mapper forgot to backfill crashed at the top level. Here the risk
// fields are the nullable `schema` (stored '' by the backend) and the nullable
// `lastUsed` / `pinnedAt`. hydrate MUST normalize them without throwing, and a
// full entry must survive entry -> persist payload -> SQLite row shape ->
// hydrate unchanged.
//
// Mock the typed wrapper (not raw core) so the assertion survives the eager
// store import in `test-setup.ts`.

vi.mock("@lib/tauri/tableActivity", () => ({
  persistTableActivity: vi.fn().mockResolvedValue(undefined),
  listTableActivity: vi.fn().mockResolvedValue([]),
}));

import {
  persistTableActivity,
  listTableActivity,
} from "@lib/tauri/tableActivity";
import {
  useTableActivityStore,
  __resetTableActivityStoreForTests,
  selectPinnedTables,
  selectRecentTables,
  type PersistTableActivityPayload,
} from "./tableActivityStore";

const persistMock = vi.mocked(persistTableActivity);
const listMock = vi.mocked(listTableActivity);

beforeEach(() => {
  persistMock.mockReset();
  persistMock.mockResolvedValue(undefined);
  listMock.mockReset();
  listMock.mockResolvedValue([]);
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
    listMock.mockResolvedValueOnce(rows);

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

    expect(persistMock).toHaveBeenCalled();
    const lastPayload = persistMock.mock.calls[
      persistMock.mock.calls.length - 1
    ]![0] as PersistTableActivityPayload[];
    expect(lastPayload).toHaveLength(1);
    const row = lastPayload[0]!;
    expect(row.schema).toBe("public");
    expect(typeof row.lastUsed).toBe("number");
    expect(typeof row.pinnedAt).toBe("number");

    // Feed the exact persisted payload back through hydrate.
    __resetTableActivityStoreForTests();
    listMock.mockResolvedValueOnce(lastPayload);
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
    listMock.mockRejectedValueOnce(new Error("boom"));
    await useTableActivityStore.getState().loadPersistedTableActivity();
    expect(useTableActivityStore.getState().entries).toEqual([]);
  });
});
