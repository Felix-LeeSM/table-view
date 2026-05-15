// Sprint 326 (2026-05-15) — Slice I.1: MqlCommand[] → BulkWriteOp[]
// 매핑 helper.
//
// 작성 이유: commit path 가 단일 bulkWrite 호출로 묶이려면 generator
// 가 만든 `MqlCommand` 형식을 wire `BulkWriteOp` 로 정확히 변환해야
// 한다. _id filter / $set update / insertOne document 의 3 카드를
// 가드.

import { describe, it, expect } from "vitest";
import { mqlCommandsToBulkOps } from "./mqlToBulk";
import type { MqlCommand } from "./mqlGenerator";

const DB = "app";
const COLL = "users";

describe("mqlCommandsToBulkOps (Sprint 326 I.1)", () => {
  it("maps insertOne command to { op: insertOne, document }", () => {
    const cmds: MqlCommand[] = [
      {
        kind: "insertOne",
        database: DB,
        collection: COLL,
        document: { name: "Marie" },
      },
    ];
    expect(mqlCommandsToBulkOps(cmds)).toEqual([
      { op: "insertOne", document: { name: "Marie" } },
    ]);
  });

  it("maps updateOne command to { op: updateOne, filter: { _id }, update: { $set: patch } }", () => {
    const cmds: MqlCommand[] = [
      {
        kind: "updateOne",
        database: DB,
        collection: COLL,
        documentId: { ObjectId: "507f1f77bcf86cd799439011" },
        patch: { name: "Ada L." },
      },
    ];
    expect(mqlCommandsToBulkOps(cmds)).toEqual([
      {
        op: "updateOne",
        filter: { _id: { ObjectId: "507f1f77bcf86cd799439011" } },
        update: { $set: { name: "Ada L." } },
      },
    ]);
  });

  it("maps deleteOne command to { op: deleteOne, filter: { _id } }", () => {
    const cmds: MqlCommand[] = [
      {
        kind: "deleteOne",
        database: DB,
        collection: COLL,
        documentId: { ObjectId: "507f1f77bcf86cd799439022" },
      },
    ];
    expect(mqlCommandsToBulkOps(cmds)).toEqual([
      {
        op: "deleteOne",
        filter: { _id: { ObjectId: "507f1f77bcf86cd799439022" } },
      },
    ]);
  });

  it("preserves insert→update→delete order", () => {
    const cmds: MqlCommand[] = [
      {
        kind: "insertOne",
        database: DB,
        collection: COLL,
        document: { name: "Marie" },
      },
      {
        kind: "updateOne",
        database: DB,
        collection: COLL,
        documentId: { ObjectId: "507f1f77bcf86cd799439011" },
        patch: { name: "Ada L." },
      },
      {
        kind: "deleteOne",
        database: DB,
        collection: COLL,
        documentId: { ObjectId: "507f1f77bcf86cd799439022" },
      },
    ];
    const ops = mqlCommandsToBulkOps(cmds);
    expect(ops.map((o) => o.op)).toEqual([
      "insertOne",
      "updateOne",
      "deleteOne",
    ]);
  });

  it("empty input returns empty array", () => {
    expect(mqlCommandsToBulkOps([])).toEqual([]);
  });
});
