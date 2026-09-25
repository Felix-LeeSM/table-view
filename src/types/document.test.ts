// 2026-05-14 — DocumentRow wire shape.
//
// Reason: when the A1 mongosh parser dispatches `db.coll.findOne()`, the
// Rust-side `DocumentRow { columns, row, raw }` reaches the frontend DataGrid
// / Quick Look. These cases pin the frontend's reading of that shape (the
// composite-cell sentinels), so a contract change fails at once.

import { describe, expect, it } from "vitest";
import { type DocumentRow, isDocumentSentinel } from "./document";

describe("DocumentRow wire shape (Sprint 308)", () => {
  // Reason: P4 error branches — isDocumentSentinel's false paths (non-string /
  // non-sentinel string / malformed "[N items]" shape) and the "[0 items]"
  // boundary were unverified. Replaces a tautology that only checked a
  // JSON.parse round-trip (2026-07-17).
  it("classifies non-sentinels as false and accepts the [0 items] boundary", () => {
    expect(isDocumentSentinel(42)).toBe(false);
    expect(isDocumentSentinel("plain")).toBe(false);
    expect(isDocumentSentinel("[abc items]")).toBe(false);
    expect(isDocumentSentinel("")).toBe(false);
    expect(isDocumentSentinel("[0 items]")).toBe(true);
  });

  it("preserves composite-cell sentinel strings end-to-end", () => {
    // The backend flatten_cell helper emits the sentinel for nested
    // documents/arrays — the type wrapper must not strip them.
    const row: DocumentRow = {
      columns: [
        { name: "_id", dataType: "ObjectId", category: "unknown" },
        { name: "profile", dataType: "Document", category: "unknown" },
        { name: "tags", dataType: "Array", category: "unknown" },
      ],
      row: [{ $oid: "507f1f77bcf86cd799439011" }, "{...}", "[3 items]"],
      raw: {},
    };
    expect(isDocumentSentinel(row.row[1])).toBe(true);
    expect(isDocumentSentinel(row.row[2])).toBe(true);
  });
});
