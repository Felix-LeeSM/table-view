// 2026-05-15 — MqlCommand[] → BulkWriteOp[] mapping helper.
//
// Reason: for the commit path to batch into a single bulkWrite call, the
// `MqlCommand` shape the generator builds must convert exactly into the wire
// `BulkWriteOp`. Guards three cases: the _id filter, the $set update, and
// the insertOne document.

import { describe, expect, it } from "vitest";
import type { MqlCommand } from "./mqlGenerator";
import { mqlCommandsToBulkOps } from "./mqlToBulk";

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

  // 2026-05-15 — `cmd.patch` now carries the full update operator
  // (`{ $set, $unset }`) instead of the raw $set body, so a single row can
  // mix overwrite + structural delete. mqlToBulk just forwards the operator
  // object unchanged. Reason: the tree-panel delete had to bundle $unset
  // into the same row's patch.
  it("maps updateOne command — patch already wraps $set/$unset operators", () => {
    const cmds: MqlCommand[] = [
      {
        kind: "updateOne",
        database: DB,
        collection: COLL,
        documentId: { objectId: "507f1f77bcf86cd799439011" },
        patch: { $set: { name: "Ada L." } },
      },
    ];
    expect(mqlCommandsToBulkOps(cmds)).toEqual([
      {
        op: "updateOne",
        filter: { _id: { $oid: "507f1f77bcf86cd799439011" } },
        update: { $set: { name: "Ada L." } },
      },
    ]);
  });

  it("maps updateOne with combined $set + $unset patch", () => {
    const cmds: MqlCommand[] = [
      {
        kind: "updateOne",
        database: DB,
        collection: COLL,
        documentId: { objectId: "507f1f77bcf86cd799439011" },
        patch: { $set: { name: "Ada L." }, $unset: { legacyField: "" } },
      },
    ];
    expect(mqlCommandsToBulkOps(cmds)).toEqual([
      {
        op: "updateOne",
        filter: { _id: { $oid: "507f1f77bcf86cd799439011" } },
        update: { $set: { name: "Ada L." }, $unset: { legacyField: "" } },
      },
    ]);
  });

  it("maps deleteOne command to { op: deleteOne, filter: { _id } }", () => {
    const cmds: MqlCommand[] = [
      {
        kind: "deleteOne",
        database: DB,
        collection: COLL,
        documentId: { objectId: "507f1f77bcf86cd799439022" },
      },
    ];
    expect(mqlCommandsToBulkOps(cmds)).toEqual([
      {
        op: "deleteOne",
        filter: { _id: { $oid: "507f1f77bcf86cd799439022" } },
      },
    ]);
  });

  it("maps string, number, and raw document ids without coercion", () => {
    const cmds: MqlCommand[] = [
      {
        kind: "updateOne",
        database: DB,
        collection: COLL,
        documentId: { string: "user:ada" },
        patch: { $set: { name: "Ada" } },
      },
      {
        kind: "deleteOne",
        database: DB,
        collection: COLL,
        documentId: { number: 42 },
      },
      {
        kind: "deleteOne",
        database: DB,
        collection: COLL,
        documentId: { raw: { tenant: "app", key: "grace" } },
      },
    ];
    expect(mqlCommandsToBulkOps(cmds)).toEqual([
      {
        op: "updateOne",
        filter: { _id: "user:ada" },
        update: { $set: { name: "Ada" } },
      },
      {
        op: "deleteOne",
        filter: { _id: 42 },
      },
      {
        op: "deleteOne",
        filter: { _id: { tenant: "app", key: "grace" } },
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
        documentId: { objectId: "507f1f77bcf86cd799439011" },
        patch: { $set: { name: "Ada L." } },
      },
      {
        kind: "deleteOne",
        database: DB,
        collection: COLL,
        documentId: { objectId: "507f1f77bcf86cd799439022" },
      },
    ];
    const ops = mqlCommandsToBulkOps(cmds);
    expect(ops.map((o) => o.op)).toEqual([
      "insertOne",
      "updateOne",
      "deleteOne",
    ]);
  });

  it("preserves mixed command order and update operator payloads", () => {
    const cmds: MqlCommand[] = [
      {
        kind: "deleteOne",
        database: DB,
        collection: COLL,
        documentId: { objectId: "507f1f77bcf86cd799439022" },
      },
      {
        kind: "updateOne",
        database: DB,
        collection: COLL,
        documentId: { objectId: "507f1f77bcf86cd799439011" },
        patch: { $set: { status: "archived" }, $unset: { stale: "" } },
      },
      {
        kind: "insertOne",
        database: DB,
        collection: COLL,
        document: { name: "Marie" },
      },
    ];
    expect(mqlCommandsToBulkOps(cmds)).toEqual([
      {
        op: "deleteOne",
        filter: { _id: { $oid: "507f1f77bcf86cd799439022" } },
      },
      {
        op: "updateOne",
        filter: { _id: { $oid: "507f1f77bcf86cd799439011" } },
        update: { $set: { status: "archived" }, $unset: { stale: "" } },
      },
      { op: "insertOne", document: { name: "Marie" } },
    ]);
  });

  it("empty input returns empty array", () => {
    expect(mqlCommandsToBulkOps([])).toEqual([]);
  });
});
