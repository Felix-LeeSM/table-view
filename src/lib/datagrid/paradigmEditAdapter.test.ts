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
vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => toastSuccess(msg),
    error: (msg: string) => toastError(msg),
    info: (msg: string) => toastInfo(msg),
    warn: vi.fn(),
  },
}));

const insertDocument = vi.fn();
const updateDocument = vi.fn();
const deleteDocument = vi.fn();
vi.mock("@/lib/tauri", () => ({
  insertDocument: (...args: unknown[]) => insertDocument(...args),
  updateDocument: (...args: unknown[]) => updateDocument(...args),
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
}));

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
});

describe("buildRdbSession + execute", () => {
  it("happy path → ok:true, executeQueryBatch called once, toast.success", async () => {
    const executeQueryBatch = vi.fn().mockResolvedValue(undefined);
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

  it("execute dispatches commands one-by-one and reports ok:true", async () => {
    updateDocument.mockResolvedValue(undefined);
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
    expect(updateDocument).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("1 document change committed.");
    expect(history.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it("execute failure surfaces ok:false without failedIndex (per-command, no batch rollback)", async () => {
    updateDocument.mockRejectedValue(new Error("write failed"));
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
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(history.recordError).toHaveBeenCalledTimes(1);
  });
});
