// #1219 — 접속 시 전 스키마 eager N+1 로드를 lazy 로 전환. 4개 AC 의
// user-journey 검증:
//   1. 접속 시 스키마 목록만 로드; 테이블은 펼친 스키마만 (seed 첫 스키마 포함).
//   3. 소규모 DB (스키마 수 <= 임계) 는 기존처럼 즉시 전체 로드.
//   4. 재접속 시 persist 된 펼친 스키마는 내용 로드, 접힌 스키마는 안 가져옴.
// mock 은 lib boundary (schema store actions) 만; 렌더는 실제 SchemaTree.
// (AC-2 자동완성 회귀 방지 = expandSchema 의 컬럼 prefetch → useSchemaCache
//  단위 테스트 [AC-1219-3] 에서 lock.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  mockLoadTables,
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

function manySchemas(n: number): Array<{ name: string }> {
  return Array.from({ length: n }, (_, i) => ({ name: `s${i}` }));
}

describe("SchemaTree — lazy schema load (#1219)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  // ── AC1 — 큰 DB: 접속 시 seed 된 첫 스키마 내용만 로드 ────────────────────
  it("large DB: loads only the seeded first schema's tables at mount", async () => {
    setSchemaStoreState({ schemas: { conn1: manySchemas(6) }, tables: {} });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // #1256 seed expands s0 → its content loads; s1..s5 collapsed → no fetch.
    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "s0");
    expect(mockLoadTables).not.toHaveBeenCalledWith("conn1", "db1", "s1");

    // user-facing: seeded schema expanded, the rest collapsed.
    expect(screen.getByLabelText("s0 schema")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("s1 schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // ── AC3 — 소규모 DB: 임계 이하면 기존처럼 전체 즉시 로드 ──────────────────
  it("small DB: eager-loads every schema's tables at mount (<= threshold)", async () => {
    setSchemaStoreState({ schemas: { conn1: manySchemas(3) }, tables: {} });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "s0");
    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "s1");
    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "s2");
  });

  // ── AC4 — 재접속: persist 된 펼친 스키마만 내용 로드, 접힌 건 안 가져옴 ────
  it("reconnect: persisted expanded schema loads its tables; collapsed ones stay unfetched", async () => {
    setSchemaStoreState({ schemas: { conn1: manySchemas(6) }, tables: {} });
    // 이전 세션에서 사용자가 s3 만 펼쳐둔 상태 (나머지 접힘).
    useWorkspaceStore.getState().setExpanded("conn1", "db1", ["s3"]);

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "s3");
    expect(mockLoadTables).not.toHaveBeenCalledWith("conn1", "db1", "s0");

    expect(screen.getByLabelText("s3 schema")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("s0 schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // ── AC1 — 큰 DB 에서 수동 펼침 = 로드 1회 (reconcile ↔ click 중복 방지) ──
  it("large DB: manually expanding a collapsed schema fetches its tables exactly once", async () => {
    setSchemaStoreState({ schemas: { conn1: manySchemas(6) }, tables: {} });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("s1 schema"));
    });

    const s1Calls = mockLoadTables.mock.calls.filter(
      ([, , schema]) => schema === "s1",
    );
    expect(s1Calls).toHaveLength(1);
  });
});
