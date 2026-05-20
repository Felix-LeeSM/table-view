import { describe, it, expect } from "vitest";
import {
  type BulkWriteOp,
  type BulkWriteResult,
  type DocumentId,
  documentIdFromRow,
  formatDocumentIdForMql,
  kindOfDocumentId,
  parseObjectIdLiteral,
} from "./documentMutate";

const HEX = "507f1f77bcf86cd799439011";

describe("parseObjectIdLiteral", () => {
  it("lifts a valid canonical-EJSON $oid wrapper into an ObjectId variant", () => {
    const parsed = parseObjectIdLiteral({ $oid: HEX });
    expect(parsed).toEqual({ objectId: HEX });
  });

  it("rejects a wrapper whose hex is not 24 characters", () => {
    expect(parseObjectIdLiteral({ $oid: "not-hex" })).toBeNull();
    expect(parseObjectIdLiteral({ $oid: "1234" })).toBeNull();
  });

  it("returns null for anything that is not a $oid wrapper", () => {
    expect(parseObjectIdLiteral(null)).toBeNull();
    expect(parseObjectIdLiteral("plain")).toBeNull();
    expect(parseObjectIdLiteral(42)).toBeNull();
    expect(parseObjectIdLiteral({ $date: "2024-01-01" })).toBeNull();
    expect(parseObjectIdLiteral({})).toBeNull();
  });
});

describe("documentIdFromRow", () => {
  it("returns null when the row has no _id column", () => {
    expect(documentIdFromRow({ name: "Ada" })).toBeNull();
  });

  it("returns null when _id is null or undefined", () => {
    expect(documentIdFromRow({ _id: null })).toBeNull();
    expect(documentIdFromRow({ _id: undefined })).toBeNull();
  });

  it("extracts ObjectId from a canonical EJSON wrapper", () => {
    expect(documentIdFromRow({ _id: { $oid: HEX } })).toEqual({
      objectId: HEX,
    });
  });

  it("extracts ObjectId from a plain 24-hex string", () => {
    expect(documentIdFromRow({ _id: HEX })).toEqual({ objectId: HEX });
  });

  it("extracts a non-hex string as the String variant", () => {
    expect(documentIdFromRow({ _id: "custom-key" })).toEqual({
      string: "custom-key",
    });
  });

  it("extracts a finite number as the Number variant", () => {
    expect(documentIdFromRow({ _id: 7 })).toEqual({ number: 7 });
  });

  it("returns null for composite or unsupported _id shapes", () => {
    expect(documentIdFromRow({ _id: { nested: true } })).toBeNull();
    expect(documentIdFromRow({ _id: [1, 2] })).toBeNull();
    expect(documentIdFromRow({ _id: Number.NaN })).toBeNull();
    expect(documentIdFromRow({ _id: "" })).toBeNull();
  });
});

describe("formatDocumentIdForMql", () => {
  it('renders ObjectId as mongosh ObjectId("<hex>") literal', () => {
    expect(formatDocumentIdForMql({ objectId: HEX })).toBe(
      `ObjectId("${HEX}")`,
    );
  });

  it("renders String as a double-quoted literal and escapes backslash/quote", () => {
    expect(formatDocumentIdForMql({ string: "plain" })).toBe('"plain"');
    expect(formatDocumentIdForMql({ string: 'a"b' })).toBe('"a\\"b"');
    expect(formatDocumentIdForMql({ string: "c\\d" })).toBe('"c\\\\d"');
  });

  it("renders Number as an unquoted integer literal", () => {
    expect(formatDocumentIdForMql({ number: 42 })).toBe("42");
    expect(formatDocumentIdForMql({ number: -1 })).toBe("-1");
  });

  it("renders Raw as compact JSON of the wrapped payload", () => {
    const id: DocumentId = { raw: { $date: "2024-01-01" } };
    expect(formatDocumentIdForMql(id)).toBe('{"$date":"2024-01-01"}');
  });
});

describe("kindOfDocumentId", () => {
  it("discriminates every variant", () => {
    expect(kindOfDocumentId({ objectId: HEX })).toBe("objectId");
    expect(kindOfDocumentId({ string: "s" })).toBe("string");
    expect(kindOfDocumentId({ number: 1 })).toBe("number");
    expect(kindOfDocumentId({ raw: null })).toBe("raw");
  });
});

describe("wire-format roundtrip sanity", () => {
  // These JSON strings are the exact shapes the Rust serde encoder emits
  // (verified by Rust model shape tests). The
  // TypeScript mirror must accept them verbatim after `JSON.parse`.
  it("deserialises the four Rust-emitted wire shapes", () => {
    const oid = JSON.parse(`{"objectId":"${HEX}"}`) as DocumentId;
    expect(kindOfDocumentId(oid)).toBe("objectId");
    const s = JSON.parse('{"string":"key"}') as DocumentId;
    expect(kindOfDocumentId(s)).toBe("string");
    const n = JSON.parse('{"number":42}') as DocumentId;
    expect(kindOfDocumentId(n)).toBe("number");
    const raw = JSON.parse('{"raw":{"$date":"2024-01-01"}}') as DocumentId;
    expect(kindOfDocumentId(raw)).toBe("raw");
  });
});

// ── Sprint 308 (2026-05-14) — BulkWriteOp / BulkWriteResult ────────────
//
// 작성 이유: Rust `enum BulkWriteOp` 는 serde `tag = "op", rename_all =
// "camelCase"` 로 emit 한다 — wire shape 의 변경은 frontend dispatch 가
// silently fall-through 하는 회귀를 일으키므로 6 variant + 결과 카운터
// 의 round-trip 을 명시적으로 단언한다. fixture 는 Rust 측이 emit 할
// JSON 을 그대로 적어 type-guard + JSON.parse 통과 여부를 확인.

describe("BulkWriteOp wire shape (Sprint 308)", () => {
  it("recognises insertOne variant", () => {
    const wire = '{"op":"insertOne","document":{"name":"alice"}}';
    const parsed = JSON.parse(wire) as BulkWriteOp;
    expect(parsed.op).toBe("insertOne");
    if (parsed.op === "insertOne") {
      expect(parsed.document).toEqual({ name: "alice" });
    }
  });

  it("recognises updateOne with optional upsert", () => {
    const wire =
      '{"op":"updateOne","filter":{"_id":1},"update":{"$set":{"x":2}},"upsert":true}';
    const parsed = JSON.parse(wire) as BulkWriteOp;
    expect(parsed.op).toBe("updateOne");
    if (parsed.op === "updateOne") {
      expect(parsed.filter).toEqual({ _id: 1 });
      expect(parsed.update).toEqual({ $set: { x: 2 } });
      expect(parsed.upsert).toBe(true);
    }
  });

  it("recognises updateMany variant", () => {
    const wire =
      '{"op":"updateMany","filter":{"age":{"$lt":18}},"update":{"$set":{"minor":true}}}';
    const parsed = JSON.parse(wire) as BulkWriteOp;
    expect(parsed.op).toBe("updateMany");
  });

  it("recognises deleteOne variant", () => {
    const wire = '{"op":"deleteOne","filter":{"_id":42}}';
    const parsed = JSON.parse(wire) as BulkWriteOp;
    expect(parsed.op).toBe("deleteOne");
    if (parsed.op === "deleteOne") {
      expect(parsed.filter).toEqual({ _id: 42 });
    }
  });

  it("recognises deleteMany variant", () => {
    const wire = '{"op":"deleteMany","filter":{"status":"archived"}}';
    const parsed = JSON.parse(wire) as BulkWriteOp;
    expect(parsed.op).toBe("deleteMany");
  });

  it("recognises replaceOne with replacement and upsert", () => {
    const wire =
      '{"op":"replaceOne","filter":{"_id":1},"replacement":{"name":"alice"},"upsert":false}';
    const parsed = JSON.parse(wire) as BulkWriteOp;
    expect(parsed.op).toBe("replaceOne");
    if (parsed.op === "replaceOne") {
      expect(parsed.replacement).toEqual({ name: "alice" });
      expect(parsed.upsert).toBe(false);
    }
  });

  it("round-trips through JSON.stringify without losing the discriminator", () => {
    const op: BulkWriteOp = {
      op: "updateOne",
      filter: { _id: 1 },
      update: { $set: { x: 2 } },
    };
    const roundtripped = JSON.parse(JSON.stringify(op)) as BulkWriteOp;
    expect(roundtripped).toEqual(op);
  });
});

describe("BulkWriteResult wire shape (Sprint 308)", () => {
  it("matches the Rust snake_case wire output", () => {
    // Rust struct default-derived (no `rename_all` attribute) — same
    // DocumentId nested values use the enum's camelCase serde tags.
    const wire =
      '{"inserted_count":3,"matched_count":2,"modified_count":1,"deleted_count":4,"upserted_ids":[{"number":99}]}';
    const parsed = JSON.parse(wire) as BulkWriteResult;
    expect(parsed.inserted_count).toBe(3);
    expect(parsed.matched_count).toBe(2);
    expect(parsed.modified_count).toBe(1);
    expect(parsed.deleted_count).toBe(4);
    expect(parsed.upserted_ids).toHaveLength(1);
    expect(parsed.upserted_ids[0]).toEqual({ number: 99 });
  });

  it("handles the empty BulkWriteResult::default() shape", () => {
    const wire =
      '{"inserted_count":0,"matched_count":0,"modified_count":0,"deleted_count":0,"upserted_ids":[]}';
    const parsed = JSON.parse(wire) as BulkWriteResult;
    expect(parsed.inserted_count).toBe(0);
    expect(parsed.upserted_ids).toEqual([]);
  });
});
