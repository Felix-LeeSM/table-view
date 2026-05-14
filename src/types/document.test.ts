// Sprint 308 (2026-05-14) — DocumentRow wire shape round-trip.
//
// 작성 이유: A1 mongosh 파서가 `db.coll.findOne()` 을 dispatch 했을 때
// Rust 측 `DocumentRow { columns, row, raw }` 가 frontend 의 DataGrid /
// Quick Look 으로 도달하는 직렬화 경로를 명시적으로 단언한다. 컨트랙트가
// 변경되면 즉시 회귀.

import { describe, it, expect } from "vitest";
import { type DocumentRow, isDocumentSentinel } from "./document";

describe("DocumentRow wire shape (Sprint 308)", () => {
  it("parses a typical findOne wire payload", () => {
    const wire = JSON.stringify({
      columns: [
        { name: "_id", data_type: "ObjectId", category: "unknown" },
        { name: "name", data_type: "String", category: "unknown" },
      ],
      row: [{ $oid: "507f1f77bcf86cd799439011" }, "alice"],
      raw: { _id: { $oid: "507f1f77bcf86cd799439011" }, name: "alice" },
    });
    const parsed = JSON.parse(wire) as DocumentRow;
    expect(parsed.columns).toHaveLength(2);
    expect(parsed.columns[0]?.name).toBe("_id");
    expect(parsed.row).toHaveLength(2);
    expect(parsed.raw["name"]).toBe("alice");
  });

  it("preserves composite-cell sentinel strings end-to-end", () => {
    // The backend flatten_cell helper emits the sentinel for nested
    // documents/arrays — the type wrapper must not strip them.
    const row: DocumentRow = {
      columns: [
        { name: "_id", data_type: "ObjectId", category: "unknown" },
        { name: "profile", data_type: "Document", category: "unknown" },
        { name: "tags", data_type: "Array", category: "unknown" },
      ],
      row: [{ $oid: "507f1f77bcf86cd799439011" }, "{...}", "[3 items]"],
      raw: {},
    };
    expect(isDocumentSentinel(row.row[1])).toBe(true);
    expect(isDocumentSentinel(row.row[2])).toBe(true);
  });
});
