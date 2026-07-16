// 2026-05-14 — ParadigmEditAdapter 단위 테스트. RDB / Document
// adapter 가 각자 paradigm 의 preview 생성 + 위험 분석 + execute
// closure 를 캡슐화하는지 확인. hook (useDataGridPreviewCommit) 의
// 통합 테스트와 분리해서 adapter 자체의 표면만 verify.
//
// 시나리오 묶음:
//   - rdbEditAdapter:
//     1. preparePreview happy path → session.items 에 risk:"safe"
//     2. preparePreview destructive 분석 → items 에 risk:"destructive"
//     3. preparePreview coerceError → coerceErrors map 채워짐
//     4. preparePreview 비어 있음 → session: null
//     5. execute happy → ok:true, executeQueryBatch 단일 호출
//     6. execute failure + "statement K of N failed" → failedIndex / failedKey 추출
//   - documentEditAdapter:
//     1. preparePreview happy path → kind:"document", mqlPreview 첨부
//     2. preparePreview 빈 commands → session: null
//     3. execute → 명령 N개 순차 dispatch
//     4. execute failure → ok:false (failedIndex 미정)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { TableData } from "@/types/schema";
import type { SafeModeGate } from "@/hooks/useSafeModeGate";
import {
  buildRdbSession,
  classifyRdbRisk,
  documentEditAdapter,
  rdbEditAdapter,
} from "./paradigmEditAdapter";

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
const toastWarning = vi.fn();
vi.mock("@/lib/runtime/toast", () => ({
  toast: {
    success: (msg: string) => toastSuccess(msg),
    error: (msg: string) => toastError(msg),
    info: (msg: string) => toastInfo(msg),
    warning: (msg: string) => toastWarning(msg),
    warn: vi.fn(),
  },
}));

const insertDocument = vi.fn();
const updateDocument = vi.fn();
const deleteDocument = vi.fn();
// Sprint 326 — Slice I.1: commit path 가 bulkWriteDocuments 로 통합.
// 기존 insert/update/deleteDocument mock 은 호출되지 않지만 type-mock
// 호환을 위해 유지.
const bulkWriteDocuments = vi.fn();
beforeEach(() => {
  setupTauriMock({
    insertDocument: (...args: unknown[]) => insertDocument(...args),
    updateDocument: (...args: unknown[]) => updateDocument(...args),
    deleteDocument: (...args: unknown[]) => deleteDocument(...args),
    bulkWriteDocuments: (...args: unknown[]) => bulkWriteDocuments(...args),
  });
});

function makeRdbData(): TableData {
  return {
    columns: [
      {
        name: "id",
        data_type: "integer",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "name",
        data_type: "text",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ],
    rows: [[1, "alice"]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query: "SELECT * FROM users",
  };
}

function gateAllowAll(): SafeModeGate {
  return { decide: () => ({ action: "allow" }) };
}
function gateBlockDestructive(): SafeModeGate {
  return {
    decide: (analysis) =>
      analysis.severity === "danger"
        ? { action: "block", reason: analysis.reasons[0] ?? "blocked" }
        : { action: "allow" },
  };
}
function gateConfirmDestructive(): SafeModeGate {
  return {
    decide: (analysis) =>
      analysis.severity === "danger"
        ? { action: "confirm", reason: analysis.reasons[0] ?? "confirm" }
        : { action: "allow" },
  };
}

const history = {
  recordSuccess: vi.fn(),
  recordError: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classifyRdbRisk", () => {
  it("allow decision → risk: safe with no reason", () => {
    const result = classifyRdbRisk("SELECT 1", gateAllowAll());
    expect(result).toEqual({ risk: "safe" });
  });

  it("block decision on destructive → risk: destructive with reason", () => {
    const result = classifyRdbRisk("DELETE FROM users", gateBlockDestructive());
    expect(result.risk).toBe("destructive");
    expect(result.reason).toMatch(/DELETE/);
  });

  it("confirm decision on destructive → risk: warn with reason", () => {
    const result = classifyRdbRisk(
      "DROP TABLE users",
      gateConfirmDestructive(),
    );
    expect(result.risk).toBe("warn");
    expect(result.reason).toMatch(/DROP/);
  });

  it("Oracle unsupported PL/SQL stays destructive even when generic gate allows", () => {
    const result = classifyRdbRisk(
      "CREATE OR REPLACE PACKAGE app_pkg AS END app_pkg",
      gateAllowAll(),
      "oracle",
    );
    expect(result.risk).toBe("destructive");
    expect(result.reason).toMatch(/Oracle PL\/SQL package\/routine DDL/);
  });
});

describe("buildRdbSession + execute", () => {
  it("happy path → ok:true, executeQueryBatch called once, toast.success", async () => {
    const executeQueryBatch = vi.fn().mockResolvedValue(undefined);
    const session = buildRdbSession(
      ["UPDATE users SET name='bob' WHERE id=1"],
      ["0-1"],
      {
        connectionId: "conn-1",
        expectedDatabase: "db1",
        safeModeGate: gateAllowAll(),
        executeQueryBatch,
        history,
      },
    );
    expect(session.kind).toBe("rdb");
    expect(session.items).toHaveLength(1);
    expect(session.items[0]!.risk).toBe("safe");
    expect(session.items[0]!.key).toBe("0-1");

    const result = await session.execute();
    expect(result.ok).toBe(true);
    expect(executeQueryBatch).toHaveBeenCalledTimes(1);
    expect(executeQueryBatch).toHaveBeenCalledWith(
      "conn-1",
      ["UPDATE users SET name='bob' WHERE id=1"],
      expect.stringMatching(/^edit-/),
      "db1",
      // Issue #1112 — datagrid commit forwards the Safe Mode confirmation proof.
      true,
    );
    expect(toastSuccess).toHaveBeenCalledWith("1 change committed.");
    expect(history.recordSuccess).toHaveBeenCalledTimes(1);
    expect(history.recordError).not.toHaveBeenCalled();
  });

  it("execute failure with 'statement K of N failed' → failedIndex parsed, failedKey routed", async () => {
    const executeQueryBatch = vi
      .fn()
      .mockRejectedValue(new Error("statement 2 of 3 failed: syntax error"));
    const session = buildRdbSession(
      ["UPDATE a SET x=1", "UPDATE b SET y=2", "UPDATE c SET z=3"],
      ["0-0", "1-0", "2-0"],
      {
        connectionId: "conn-1",
        safeModeGate: gateAllowAll(),
        executeQueryBatch,
        history,
      },
    );
    const result = await session.execute();
    expect(result.ok).toBe(false);
    expect(result.failedIndex).toBe(1); // 0-based: "statement 2" → index 1
    expect(result.failedKey).toBe("1-0");
    expect(result.errorMessage).toMatch(/all changes rolled back/);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(history.recordError).toHaveBeenCalledTimes(1);
  });

  it("execute failure without index match → failedIndex defaults to 0", async () => {
    const executeQueryBatch = vi
      .fn()
      .mockRejectedValue(new Error("connection lost"));
    const session = buildRdbSession(["UPDATE a SET x=1"], ["0-0"], {
      connectionId: "conn-1",
      safeModeGate: gateAllowAll(),
      executeQueryBatch,
      history,
    });
    const result = await session.execute();
    expect(result.ok).toBe(false);
    expect(result.failedIndex).toBe(0);
    expect(result.failedKey).toBe("0-0");
  });

  it("forwards Oracle dialect risk to raw RDB preview sessions", () => {
    const executeQueryBatch = vi.fn();
    const session = buildRdbSession(
      ["CREATE OR REPLACE PACKAGE app_pkg AS END app_pkg"],
      [undefined],
      {
        connectionId: "conn-1",
        safeModeGate: gateAllowAll(),
        executeQueryBatch,
        history,
        dialect: "oracle",
      },
    );
    expect(session.items[0]).toMatchObject({
      risk: "destructive",
      reason: expect.stringMatching(/Oracle PL\/SQL package\/routine DDL/),
    });
  });

  it("rows_affected mismatch (0-row) → toast.warning instead of success (#1441 P3-3)", async () => {
    const executeQueryBatch = vi.fn().mockResolvedValue([
      {
        columns: [],
        rows: [],
        totalCount: 0,
        executionTimeMs: 1,
        // Backend committed but reported 0 rows for a one-row intent — the
        // single-row guard did not fire on this (hypothetical) path.
        queryType: { dml: { rows_affected: 0 } },
      },
    ]);
    const session = buildRdbSession(
      ["UPDATE users SET name='bob' WHERE id=1"],
      ["0-1"],
      {
        connectionId: "conn-1",
        safeModeGate: gateAllowAll(),
        executeQueryBatch,
        history,
      },
    );
    const result = await session.execute();
    expect(result.ok).toBe(true);
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining("0 row"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("rdbEditAdapter.preparePreview", () => {
  it("emits a session when pendingEdits produce valid SQL", () => {
    const adapter = rdbEditAdapter({
      connectionId: "conn-1",
      safeModeGate: gateAllowAll(),
      executeQueryBatch: vi.fn(),
      history,
    });
    const { session, coerceErrors } = adapter.preparePreview({
      data: makeRdbData(),
      schema: "public",
      table: "users",
      page: 1,
      pendingEdits: new Map([["0-1", "bob"]]),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(),
    });
    expect(session).not.toBeNull();
    expect(session!.kind).toBe("rdb");
    expect(session!.items[0]!.text).toMatch(/UPDATE/);
    expect(session!.items[0]!.text).toMatch(/bob/);
    expect(coerceErrors.size).toBe(0);
  });

  it("returns session: null + populated coerceErrors when pending edits fail validation", () => {
    const adapter = rdbEditAdapter({
      connectionId: "conn-1",
      safeModeGate: gateAllowAll(),
      executeQueryBatch: vi.fn(),
      history,
    });
    const { session, coerceErrors } = adapter.preparePreview({
      data: makeRdbData(),
      schema: "public",
      table: "users",
      // id 컬럼 (integer) 에 "not-a-number" — coerce 실패
      pendingEdits: new Map([["0-0", "not-a-number"]]),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(),
      page: 1,
    });
    expect(session).toBeNull();
    expect(coerceErrors.size).toBe(1);
    expect(coerceErrors.get("0-0")).toMatch(/integer/);
  });

  it("returns session: null when there are no edits", () => {
    const adapter = rdbEditAdapter({
      connectionId: "conn-1",
      safeModeGate: gateAllowAll(),
      executeQueryBatch: vi.fn(),
      history,
    });
    const { session, coerceErrors } = adapter.preparePreview({
      data: makeRdbData(),
      schema: "public",
      table: "users",
      page: 1,
      pendingEdits: new Map(),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(),
    });
    expect(session).toBeNull();
    expect(coerceErrors.size).toBe(0);
  });

  it("Safe Mode block on destructive → items[i].risk: destructive", () => {
    const adapter = rdbEditAdapter({
      connectionId: "conn-1",
      safeModeGate: gateBlockDestructive(),
      executeQueryBatch: vi.fn(),
      history,
    });
    const { session } = adapter.preparePreview({
      data: makeRdbData(),
      schema: "public",
      table: "users",
      page: 1,
      pendingEdits: new Map(),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(["row-1-0"]),
    });
    expect(session).not.toBeNull();
    // DELETE WHERE pk = "warn" 으로 분류되는데, 우리 gate 는 danger 만 block.
    // bounded DELETE WHERE 는 severity:"warn" 이고 gate 가 allow → safe.
    expect(session!.items[0]!.risk).toBe("safe");
  });

  it("Postgres ARRAY element edit → whole-reassign warning toast (#1441 P3-2)", () => {
    const data = makeRdbData();
    data.columns.push({
      name: "tags",
      data_type: "text[]",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    });
    data.rows = [[1, "alice", ["a", "b"]]];
    const adapter = rdbEditAdapter({
      connectionId: "conn-1",
      safeModeGate: gateAllowAll(),
      executeQueryBatch: vi.fn(),
      history,
      dialect: "postgresql",
    });
    const { session } = adapter.preparePreview({
      data,
      schema: "public",
      table: "users",
      page: 1,
      // Nested edit on the ARRAY column's element [0].
      pendingEdits: new Map([["0-2:[0]", "z"]]),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(),
    });
    // The statement is still emitted as a whole-array reassign...
    expect(session!.items[0]!.text).toMatch(
      /tags = ARRAY\['z', 'b'\]::text\[\]/,
    );
    // ...and the clobber risk is surfaced to the user once.
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringMatching(/whole array/),
    );
  });
});

describe("documentEditAdapter.preparePreview + execute", () => {
  const docData: TableData = {
    columns: [
      {
        name: "_id",
        data_type: "objectId",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "name",
        data_type: "string",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ],
    rows: [["507f1f77bcf86cd799439011", "alice"]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query: "db.users.find()",
  };

  it("emits a session with kind:document + mqlPreview attached", () => {
    const adapter = documentEditAdapter({
      connectionId: "conn-mongo",
      history,
    });
    const { session, coerceErrors } = adapter.preparePreview({
      data: docData,
      schema: "mydb",
      table: "users",
      page: 1,
      pendingEdits: new Map([["0-1", "bob"]]),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(),
    });
    expect(session).not.toBeNull();
    expect(coerceErrors.size).toBe(0);
    if (session && session.kind === "document") {
      expect(session.mqlPreview.commands).toHaveLength(1);
      expect(session.mqlPreview.commands[0]!.kind).toBe("updateOne");
      expect(session.items).toHaveLength(1);
      // Document grid 의 Safe Mode 는 현재 항상 "safe" (Phase 28+ 에서 확장).
      expect(session.items[0]!.risk).toBe("safe");
    } else {
      throw new Error("session must be a document preview");
    }
  });

  it("returns session: null when no commands emerged", () => {
    const adapter = documentEditAdapter({
      connectionId: "conn-mongo",
      history,
    });
    const { session } = adapter.preparePreview({
      data: docData,
      schema: "mydb",
      table: "users",
      page: 1,
      pendingEdits: new Map(),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(),
    });
    expect(session).toBeNull();
  });

  it("execute dispatches the batch via bulkWriteDocuments and reports ok:true", async () => {
    bulkWriteDocuments.mockResolvedValue({
      inserted_count: 0,
      matched_count: 1,
      modified_count: 1,
      deleted_count: 0,
      upserted_ids: [],
    });
    const adapter = documentEditAdapter({
      connectionId: "conn-mongo",
      history,
    });
    const { session } = adapter.preparePreview({
      data: docData,
      schema: "mydb",
      table: "users",
      page: 1,
      pendingEdits: new Map([["0-1", "bob"]]),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(),
    });
    const result = await session!.execute();
    expect(result.ok).toBe(true);
    // Single bulkWrite IPC for the whole batch (Sprint 326 I.1).
    expect(bulkWriteDocuments).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("1 document change committed.");
    expect(history.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it("execute failure surfaces partial-commit copy without rollback wording", async () => {
    bulkWriteDocuments.mockRejectedValue(new Error("write failed"));
    const adapter = documentEditAdapter({
      connectionId: "conn-mongo",
      history,
    });
    const { session } = adapter.preparePreview({
      data: docData,
      schema: "mydb",
      table: "users",
      page: 1,
      pendingEdits: new Map([["0-1", "bob"]]),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(),
    });
    const result = await session!.execute();
    expect(result.ok).toBe(false);
    expect(result.failedIndex).toBeUndefined();
    expect(result.errorMessage).toMatch(/write failed/);
    expect(result.errorMessage).toMatch(/ordered but not transactional/);
    expect(result.errorMessage).toMatch(
      /earlier document writes may already be committed/,
    );
    expect(result.errorMessage).toMatch(
      /pending edits stay available for retry/,
    );
    expect(result.errorMessage).not.toMatch(/rolled back/i);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(result.errorMessage);
    expect(toastError.mock.calls[0]![0]).not.toMatch(/rolled back/i);
    expect(history.recordError).toHaveBeenCalledTimes(1);
  });

  it("execute failure parses backend bulk_write op index for the failed MQL line", async () => {
    bulkWriteDocuments.mockRejectedValue(
      new Error("bulk_write op 1 delete_one failed: duplicate key"),
    );
    const adapter = documentEditAdapter({
      connectionId: "conn-mongo",
      history,
    });
    const { session } = adapter.preparePreview({
      data: {
        ...docData,
        rows: [
          ["507f1f77bcf86cd799439011", "alice"],
          ["507f1f77bcf86cd799439022", "grace"],
        ],
        total_count: 2,
      },
      schema: "mydb",
      table: "users",
      page: 1,
      pendingEdits: new Map([["0-1", "bob"]]),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(["row-1-1"]),
    });
    const result = await session!.execute();
    expect(result.ok).toBe(false);
    expect(result.failedIndex).toBe(1);
    // Issue #1440 — ops before the failed index were applied by the backend;
    // their pending-state origins must surface so the facade can prune them,
    // and the user copy must say the applied ops left the pending list.
    expect(result.appliedPending).toEqual({
      editKeys: ["0-1"],
      deleteKeys: [],
      newRows: [],
    });
    expect(result.errorMessage).toMatch(/bulk_write op 1 delete_one failed/);
    expect(result.errorMessage).toMatch(/first 1 of 2 operations/);
    expect(result.errorMessage).toMatch(/removed from pending/);
    expect(result.errorMessage).not.toMatch(/rolled back/i);
    expect(history.recordError).toHaveBeenCalledTimes(1);
  });

  it("reports applied inserts by row reference across repeated partial failures (#1483 review B1)", async () => {
    // Reason: PR #1483 review B1 — `newRowIndexes` were preview-time
    // positions, but the facade prunes against the CURRENT pendingNewRows
    // array, which shifts after the first prune. The adapter must hand back
    // the row references themselves so the prune is position-independent.
    // (2026-07-10)
    const rowA = ["507f1f77bcf86cd799439031", "adam"];
    const rowB = ["507f1f77bcf86cd799439032", "bella"];
    const rowC = ["507f1f77bcf86cd799439033", "cara"];
    bulkWriteDocuments.mockRejectedValueOnce(
      new Error("bulk_write op 1 insert_one failed: duplicate key"),
    );
    bulkWriteDocuments.mockRejectedValueOnce(
      new Error("bulk_write op 1 insert_one failed: duplicate key"),
    );
    const adapter = documentEditAdapter({
      connectionId: "conn-mongo",
      history,
    });
    const { session } = adapter.preparePreview({
      data: docData,
      schema: "mydb",
      table: "users",
      page: 1,
      pendingEdits: new Map(),
      pendingNewRows: [rowA, rowB, rowC],
      pendingDeletedRowKeys: new Set(),
    });
    // Round 1: op 0 (rowA) applied, op 1 failed.
    const first = await session!.execute();
    expect(first.ok).toBe(false);
    expect(first.failedIndex).toBe(1);
    expect(first.appliedPending!.newRows).toHaveLength(1);
    expect(first.appliedPending!.newRows[0]).toBe(rowA);

    // Round 2: retry resumes at [rowB, rowC]; relative op 1 fails, so rowB
    // applied. The report must identify rowB itself.
    const second = await session!.execute();
    expect(second.ok).toBe(false);
    expect(second.failedIndex).toBe(2);
    expect(second.appliedPending!.newRows).toHaveLength(1);
    expect(second.appliedPending!.newRows[0]).toBe(rowB);
  });

  it("out-of-range bulk_write op index prunes nothing (#1483 review F1)", async () => {
    // Reason: PR #1483 review F1 — a garbled/stale op index past the
    // dispatched slice must not claim the whole remainder was applied;
    // treat it like an unparseable error (keep-all fallback), never prune.
    // (2026-07-10)
    bulkWriteDocuments.mockRejectedValueOnce(
      new Error("bulk_write op 7 insert_one failed: ???"),
    );
    const adapter = documentEditAdapter({
      connectionId: "conn-mongo",
      history,
    });
    const { session } = adapter.preparePreview({
      data: docData,
      schema: "mydb",
      table: "users",
      page: 1,
      pendingEdits: new Map(),
      pendingNewRows: [
        ["507f1f77bcf86cd799439031", "adam"],
        ["507f1f77bcf86cd799439032", "bella"],
      ],
      pendingDeletedRowKeys: new Set(),
    });
    const result = await session!.execute();
    expect(result.ok).toBe(false);
    expect(result.failedIndex).toBeUndefined();
    expect(result.appliedPending).toBeUndefined();
  });

  it("retry after a partial failure resumes from the failed op — applied ops are not re-sent (#1440)", async () => {
    // Reason: issue #1440 — the SAME session's execute() must not re-dispatch
    // ops the backend already applied. A second execute (in-modal retry)
    // resumes at the failed op, so a duplicate insert/update can't happen.
    // (2026-07-10)
    bulkWriteDocuments.mockRejectedValueOnce(
      new Error("bulk_write op 1 delete_one failed: write timeout"),
    );
    bulkWriteDocuments.mockResolvedValueOnce({
      inserted_count: 0,
      matched_count: 0,
      modified_count: 0,
      deleted_count: 1,
      upserted_ids: [],
    });
    const adapter = documentEditAdapter({
      connectionId: "conn-mongo",
      history,
    });
    const { session } = adapter.preparePreview({
      data: {
        ...docData,
        rows: [
          ["507f1f77bcf86cd799439011", "alice"],
          ["507f1f77bcf86cd799439022", "grace"],
        ],
        total_count: 2,
      },
      schema: "mydb",
      table: "users",
      page: 1,
      pendingEdits: new Map([["0-1", "bob"]]),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(["row-1-1"]),
    });
    const first = await session!.execute();
    expect(first.ok).toBe(false);
    expect(first.failedIndex).toBe(1);

    const second = await session!.execute();
    expect(second.ok).toBe(true);
    expect(bulkWriteDocuments).toHaveBeenCalledTimes(2);
    const retryOps = bulkWriteDocuments.mock.calls[1]![3] as Array<{
      op: string;
    }>;
    expect(retryOps).toHaveLength(1);
    expect(retryOps[0]!.op).toBe("deleteOne");
    expect(toastSuccess).toHaveBeenCalledWith("1 document change committed.");
  });
});
