// 작성 2026-05-17 (Phase 5 sprint-371) — `addHistoryEntry` / `listHistory` /
// `getHistoryDetail` / `clearHistory` wrapper 의 wire shape 검증.
//
// 본 테스트의 invariant 는 backend cargo integration test 와 동일 wire
// shape (lego): backend 의 `tests/history_*.rs` 가 받는 request payload 와
// 본 파일의 mocked `invoke("...", { req: {...} })` args 가 byte-equivalent
// 여야 한다. 한 쪽이 변경되면 다른 쪽도 같이 깨져 회귀를 즉시 잡는다.
//
// Vitest only — backend logic (SQL redact, drift, VACUUM 등) 는 Rust 통합
// 테스트 책임. 본 파일은 (a) invoke 호출 args 의 정확성, (b) 응답 shape
// 의 deserialize, (c) backend 에러의 reject propagation 만 잠근다.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  addHistoryEntry,
  clearHistory,
  getHistoryDetail,
  listHistory,
  type AddHistoryEntryRequest,
  type ListHistoryRequest,
} from "./history";

describe("history wrappers (Phase 5 sprint-371)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // -------------------------------------------------------------------------
  // addHistoryEntry
  // -------------------------------------------------------------------------

  it("addHistoryEntry forwards camelCase req payload to add_history_entry", async () => {
    const req: AddHistoryEntryRequest = {
      connectionId: "c-1",
      tabId: "tab-1",
      paradigm: "rdb",
      queryMode: "sql",
      database: "appdb",
      source: "raw",
      sql: "SELECT * FROM users WHERE email = 'a@b.com'",
      status: "success",
      rowsAffected: 42,
      durationMs: 17,
      executedAt: 1_700_000_000_000,
    };
    invokeMock.mockResolvedValueOnce({
      id: 7,
      executedAt: 1_700_000_000_000,
      sqlRedacted: "SELECT * FROM users WHERE email = ?",
    });

    const resp = await addHistoryEntry(req);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("add_history_entry", { req });
    expect(resp.id).toBe(7);
    expect(resp.sqlRedacted).toBe("SELECT * FROM users WHERE email = ?");
  });

  it("addHistoryEntry supports document paradigm with mongosh queryMode", async () => {
    invokeMock.mockResolvedValueOnce({
      id: 11,
      executedAt: 1_700_000_001_000,
      sqlRedacted: "db.orders.find({status: ?})",
    });
    const req: AddHistoryEntryRequest = {
      connectionId: "c-mongo",
      paradigm: "document",
      queryMode: "find",
      database: "shop",
      collection: "orders",
      source: "raw",
      sql: "db.orders.find({status: 'paid'})",
      status: "success",
      durationMs: 8,
      executedAt: 1_700_000_001_000,
    };
    const resp = await addHistoryEntry(req);
    expect(invokeMock).toHaveBeenCalledWith("add_history_entry", { req });
    expect(resp.sqlRedacted).toContain("?");
  });

  it("addHistoryEntry propagates backend rejection (e.g. discriminated union violation)", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("Validation error: invalid paradigm/queryMode pair"),
    );
    // Cast through a structural type to bypass the TS guard for the wire-level
    // negative test (frontend code that bypasses the TS gate gets the backend
    // reject as a runtime safety net).
    const bad = {
      connectionId: "c-1",
      paradigm: "rdb",
      queryMode: "find",
      source: "raw",
      sql: "db.users.find({})",
      status: "success",
      durationMs: 5,
      executedAt: 1_700_000_002_000,
    } as unknown as AddHistoryEntryRequest;
    await expect(addHistoryEntry(bad)).rejects.toThrow(/Validation error/);
  });

  // -------------------------------------------------------------------------
  // listHistory
  // -------------------------------------------------------------------------

  it("listHistory forwards filter + limit and parses the response shape", async () => {
    const req: ListHistoryRequest = {
      connectionId: "c-1",
      filter: { paradigm: "rdb", queryMode: "sql" },
      cursor: 100,
      limit: 50,
    };
    invokeMock.mockResolvedValueOnce({
      rows: [
        {
          id: 99,
          connectionId: "c-1",
          paradigm: "rdb",
          queryMode: "sql",
          source: "raw",
          sqlRedacted: "SELECT ?",
          status: "success",
          durationMs: 5,
          executedAt: 1_700_000_003_000,
        },
      ],
      nextCursor: 99,
    });

    const resp = await listHistory(req);

    expect(invokeMock).toHaveBeenCalledWith("list_history", { req });
    expect(resp.rows).toHaveLength(1);
    const firstRow = resp.rows[0];
    expect(firstRow).toBeDefined();
    if (!firstRow) throw new Error("unreachable — toHaveLength asserted");
    expect(firstRow).not.toHaveProperty("sql");
    expect(firstRow.sqlRedacted).toBe("SELECT ?");
    expect(resp.nextCursor).toBe(99);
  });

  it("listHistory passes an empty payload (no filter / no pagination)", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [] });
    const resp = await listHistory({});
    expect(invokeMock).toHaveBeenCalledWith("list_history", { req: {} });
    expect(resp.rows).toEqual([]);
    expect(resp.nextCursor).toBeUndefined();
  });

  it("listHistory propagates backend Validation when tabId is set without connectionId", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("Validation error: list_history: tabId requires connectionId"),
    );
    await expect(listHistory({ tabId: "tab-1" })).rejects.toThrow(
      /tabId requires connectionId/,
    );
  });

  // -------------------------------------------------------------------------
  // getHistoryDetail
  // -------------------------------------------------------------------------

  it("getHistoryDetail returns source with the SQL detail response", async () => {
    invokeMock.mockResolvedValueOnce({
      id: 42,
      source: "raw",
      sql: "SELECT * FROM users WHERE email = 'leak@example.com'",
      sqlRedacted: "SELECT * FROM users WHERE email = ?",
    });
    const resp = await getHistoryDetail({ id: 42 });
    expect(invokeMock).toHaveBeenCalledWith("get_history_detail", {
      req: { id: 42 },
    });
    expect(Object.keys(resp).sort()).toEqual([
      "id",
      "source",
      "sql",
      "sqlRedacted",
    ]);
    expect(resp.source).toBe("raw");
    expect(resp.sql).toContain("leak@example.com");
  });

  it("getHistoryDetail propagates NotFound for unknown id", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("Not found: history entry 999 not found"),
    );
    await expect(getHistoryDetail({ id: 999 })).rejects.toThrow(
      /history entry 999/,
    );
  });

  // -------------------------------------------------------------------------
  // clearHistory
  // -------------------------------------------------------------------------

  it("clearHistory invokes clear_history with no payload and returns deletedCount", async () => {
    invokeMock.mockResolvedValueOnce({ deletedCount: 7 });
    const resp = await clearHistory();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("clear_history");
    expect(resp.deletedCount).toBe(7);
  });
});
