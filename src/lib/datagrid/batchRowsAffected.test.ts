import { describe, it, expect } from "vitest";
import type { QueryResult } from "@/types/query";
import { detectBatchRowsAffectedMismatch } from "./batchRowsAffected";

// #1441 P3-3 — the grid commit / raw-edit batch emits one single-row statement
// per staged change, so a committed batch should report exactly one affected
// row per DML result. This cross-check surfaces a 0-row / partial write that
// slips past the backend single-row guard (#1432).

function dml(rows_affected: number): QueryResult {
  return {
    columns: [],
    rows: [],
    totalCount: 0,
    executionTimeMs: 1,
    queryType: { dml: { rows_affected } },
  };
}

const select: QueryResult = {
  columns: [],
  rows: [],
  totalCount: 0,
  executionTimeMs: 1,
  queryType: "select",
};

describe("detectBatchRowsAffectedMismatch", () => {
  it("returns null when every DML statement affected exactly one row", () => {
    expect(
      detectBatchRowsAffectedMismatch([dml(1), dml(1), dml(1)]),
    ).toBeNull();
  });

  it("flags a 0-row statement (target vanished / no match)", () => {
    expect(detectBatchRowsAffectedMismatch([dml(1), dml(0)])).toEqual({
      affected: 1,
      expected: 2,
    });
  });

  it("flags a multi-row statement (not uniquely identified)", () => {
    expect(detectBatchRowsAffectedMismatch([dml(4)])).toEqual({
      affected: 4,
      expected: 1,
    });
  });

  it("ignores non-DML results when counting", () => {
    // A stray SELECT contributes to neither side, so 1 DML @ 1 row = no mismatch.
    expect(detectBatchRowsAffectedMismatch([select, dml(1)])).toBeNull();
  });

  it("returns null for an empty batch or a loosely-typed / undefined result", () => {
    expect(detectBatchRowsAffectedMismatch([])).toBeNull();
    expect(detectBatchRowsAffectedMismatch(undefined)).toBeNull();
    expect(detectBatchRowsAffectedMismatch("nope")).toBeNull();
  });
});
