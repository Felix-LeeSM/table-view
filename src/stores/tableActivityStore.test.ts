import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// #1218 — table pin + recent store. Mirrors mruStore/favoritesStore contract:
// synchronous in-memory mutate + fire-and-forget IPC persist through the typed
// `@lib/tauri/tableActivity` wrapper (never a direct `@tauri-apps/api/core`
// import), boot hydrate via `list_table_activity`.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  useTableActivityStore,
  __resetTableActivityStoreForTests,
  selectRecentTables,
  selectPinnedTables,
  selectTableActivitySignals,
  tableActivityKey,
  RECENT_CAP,
  type TableRef,
} from "./tableActivityStore";

const invokeMock = vi.mocked(invoke);

const PG = (table: string): TableRef => ({
  connectionId: "pg1",
  db: "app",
  schema: "public",
  table,
});

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  __resetTableActivityStoreForTests();
});

describe("tableActivityStore", () => {
  it("keeps IPC behind the typed wrapper (no direct core import)", () => {
    const src = readFileSync(
      resolve(__dirname, "tableActivityStore.ts"),
      "utf-8",
    );
    expect(src).not.toContain("@tauri-apps/api/core");
  });

  it("starts empty", () => {
    expect(useTableActivityStore.getState().entries).toEqual([]);
  });

  it("recordTableUsed adds a recent entry and persists via IPC", async () => {
    useTableActivityStore.getState().recordTableUsed(PG("users"));

    const { entries } = useTableActivityStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.table).toBe("users");
    expect(typeof entries[0]!.lastUsed).toBe("number");
    expect(entries[0]!.pinnedAt).toBeNull();

    await Promise.resolve();
    const calls = invokeMock.mock.calls.filter(
      (c) => c[0] === "persist_table_activity",
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const payload = calls[0]![1] as {
      entries: Array<{ table: string; schema: string | null }>;
    };
    expect(payload.entries[0]!.table).toBe("users");
    expect(payload.entries[0]!.schema).toBe("public");
  });

  it("recordTableUsed dedupes by key and refreshes lastUsed (most-recent first)", () => {
    const store = useTableActivityStore.getState();
    store.recordTableUsed(PG("users"));
    store.recordTableUsed(PG("orders"));
    store.recordTableUsed(PG("users"));

    const recent = selectRecentTables(
      useTableActivityStore.getState().entries,
      "pg1",
      "app",
    );
    expect(recent.map((e) => e.table)).toEqual(["users", "orders"]);
  });

  it("caps recent per (connectionId, db) at RECENT_CAP, evicting the oldest", () => {
    const store = useTableActivityStore.getState();
    for (let i = 0; i < RECENT_CAP + 3; i++) {
      store.recordTableUsed(PG(`t${i}`));
    }
    const recent = selectRecentTables(
      useTableActivityStore.getState().entries,
      "pg1",
      "app",
    );
    expect(recent).toHaveLength(RECENT_CAP);
    // t0..t2 evicted (oldest), newest first.
    expect(recent[0]!.table).toBe(`t${RECENT_CAP + 2}`);
    expect(recent.some((e) => e.table === "t0")).toBe(false);
  });

  it("pinned entries survive recent eviction", () => {
    const store = useTableActivityStore.getState();
    store.recordTableUsed(PG("keepme"));
    store.togglePin(PG("keepme"));
    for (let i = 0; i < RECENT_CAP + 5; i++) {
      store.recordTableUsed(PG(`t${i}`));
    }
    expect(store.isPinned(PG("keepme"))).toBe(true);
    const pinned = selectPinnedTables(
      useTableActivityStore.getState().entries,
      "pg1",
      "app",
    );
    expect(pinned.map((e) => e.table)).toContain("keepme");
  });

  it("togglePin adds then removes a pin; unpinning a never-opened table drops it", () => {
    const store = useTableActivityStore.getState();
    store.togglePin(PG("solo")); // pin a table never opened
    expect(store.isPinned(PG("solo"))).toBe(true);
    expect(
      selectPinnedTables(
        useTableActivityStore.getState().entries,
        "pg1",
        "app",
      ),
    ).toHaveLength(1);

    store.togglePin(PG("solo")); // unpin — no lastUsed, so the row is dropped
    expect(store.isPinned(PG("solo"))).toBe(false);
    expect(useTableActivityStore.getState().entries).toHaveLength(0);
  });

  it("unpinning a table that was also opened keeps it as a recent entry", () => {
    const store = useTableActivityStore.getState();
    store.recordTableUsed(PG("orders"));
    store.togglePin(PG("orders"));
    store.togglePin(PG("orders")); // unpin
    expect(store.isPinned(PG("orders"))).toBe(false);
    const recent = selectRecentTables(
      useTableActivityStore.getState().entries,
      "pg1",
      "app",
    );
    expect(recent.map((e) => e.table)).toContain("orders");
  });

  it("selectors scope by (connectionId, db)", () => {
    const store = useTableActivityStore.getState();
    store.recordTableUsed({
      connectionId: "pg1",
      db: "app",
      schema: "public",
      table: "a",
    });
    store.recordTableUsed({
      connectionId: "pg1",
      db: "other",
      schema: "public",
      table: "b",
    });
    store.recordTableUsed({
      connectionId: "pg2",
      db: "app",
      schema: "public",
      table: "c",
    });
    const recent = selectRecentTables(
      useTableActivityStore.getState().entries,
      "pg1",
      "app",
    );
    expect(recent.map((e) => e.table)).toEqual(["a"]);
  });

  it("selectTableActivitySignals exposes a flat pin/recent signal for Quick Open", () => {
    const store = useTableActivityStore.getState();
    store.recordTableUsed(PG("users"));
    store.togglePin(PG("users"));
    store.recordTableUsed(PG("orders"));

    const signals = selectTableActivitySignals(
      useTableActivityStore.getState().entries,
    );
    const users = signals.find((s) => s.table === "users");
    const orders = signals.find((s) => s.table === "orders");
    expect(users?.pinned).toBe(true);
    expect(orders?.pinned).toBe(false);
    expect(typeof users?.lastUsed).toBe("number");
  });

  it("supports a nullable schema segment in the key (schemaless paradigm)", () => {
    const flat: TableRef = {
      connectionId: "sl1",
      db: "main.db",
      schema: null,
      table: "todos",
    };
    expect(tableActivityKey(flat)).toBe("sl1 main.db  todos");
    useTableActivityStore.getState().recordTableUsed(flat);
    const recent = selectRecentTables(
      useTableActivityStore.getState().entries,
      "sl1",
      "main.db",
    );
    expect(recent).toHaveLength(1);
    expect(recent[0]!.schema).toBeNull();
  });
});
