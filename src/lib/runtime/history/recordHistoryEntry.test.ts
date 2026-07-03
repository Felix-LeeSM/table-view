import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  recordHistoryEntry,
  type RecordHistoryEntryArgs,
} from "./recordHistoryEntry";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";

function acceptsRecordHistoryArgs(args: RecordHistoryEntryArgs): void {
  void args;
}

function assertRecordHistoryEntryArgTypes(): void {
  const common = {
    sql: "SELECT 1",
    executedAt: 1_700_000_000_000,
    duration: 5,
    status: "success",
    connectionId: "conn-1",
    source: "raw",
  } as const;

  acceptsRecordHistoryArgs({
    ...common,
    paradigm: "rdb",
    queryMode: "sql",
  });
  acceptsRecordHistoryArgs({
    ...common,
    paradigm: "document",
    queryMode: "deleteMany",
  });

  // @ts-expect-error document history entries cannot dispatch SQL mode.
  acceptsRecordHistoryArgs({
    ...common,
    paradigm: "document",
    queryMode: "sql",
  });

  // @ts-expect-error RDB history entries cannot dispatch document methods.
  acceptsRecordHistoryArgs({
    ...common,
    paradigm: "rdb",
    queryMode: "deleteMany",
  });
}
void assertRecordHistoryEntryArgTypes;

function countAddHistoryCalls(): number {
  return invokeMock.mock.calls.filter((call) => call[0] === "add_history_entry")
    .length;
}

describe("recordHistoryEntry", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      id: 101,
      executedAt: 1_700_000_000_000,
      sqlRedacted: "?",
    });
    useHistorySettingsStore.setState({
      queryHistoryEnabled: true,
      queryHistoryRetentionDays: 30,
    });
    useQueryHistoryStore.setState({ recentVisible: [] });
  });

  it("maps legacy countDocuments to the backend document count mode", () => {
    recordHistoryEntry({
      sql: "db.users.countDocuments({})",
      executedAt: 1_700_000_000_000,
      duration: 5,
      status: "success",
      connectionId: "conn-mongo",
      paradigm: "document",
      queryMode: "countDocuments",
      database: "appdb",
      collection: "users",
      source: "raw",
    });

    expect(useQueryHistoryStore.getState().recentVisible[0]?.queryMode).toBe(
      "count",
    );
    expect(countAddHistoryCalls()).toBe(1);
  });

  it.each([
    ["kv", "GET user:1", "command"],
    ["search", '{"index":"logs","body":{}}', "dsl"],
  ] as const)(
    "records %s paradigm entries with the %s query mode (issue #1171)",
    (paradigm, sql, expectedMode) => {
      recordHistoryEntry({
        sql,
        executedAt: 1_700_000_000_000,
        duration: 5,
        status: "success",
        connectionId: "conn-1",
        paradigm,
        source: "raw",
      } as RecordHistoryEntryArgs);

      const entry = useQueryHistoryStore.getState().recentVisible[0];
      expect(entry?.paradigm).toBe(paradigm);
      expect(entry?.queryMode).toBe(expectedMode);
      expect(countAddHistoryCalls()).toBe(1);
    },
  );

  it.each([
    ["document", "sql"],
    ["rdb", "deleteMany"],
  ] as const)(
    "skips runtime-invalid %s/%s pairs instead of coercing them",
    (paradigm, queryMode) => {
      recordHistoryEntry({
        sql: "SELECT 1",
        executedAt: 1_700_000_000_000,
        duration: 5,
        status: "success",
        connectionId: "conn-1",
        paradigm,
        queryMode,
        source: "raw",
      } as unknown as RecordHistoryEntryArgs);

      expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(0);
      expect(countAddHistoryCalls()).toBe(0);
    },
  );
});
