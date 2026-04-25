import { describe, it, expect } from "vitest";
import {
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
    expect(parsed).toEqual({ ObjectId: HEX });
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
      ObjectId: HEX,
    });
  });

  it("extracts ObjectId from a plain 24-hex string", () => {
    expect(documentIdFromRow({ _id: HEX })).toEqual({ ObjectId: HEX });
  });

  it("extracts a non-hex string as the String variant", () => {
    expect(documentIdFromRow({ _id: "custom-key" })).toEqual({
      String: "custom-key",
    });
  });

  it("extracts a finite number as the Number variant", () => {
    expect(documentIdFromRow({ _id: 7 })).toEqual({ Number: 7 });
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
    expect(formatDocumentIdForMql({ ObjectId: HEX })).toBe(
      `ObjectId("${HEX}")`,
    );
  });

  it("renders String as a double-quoted literal and escapes backslash/quote", () => {
    expect(formatDocumentIdForMql({ String: "plain" })).toBe('"plain"');
    expect(formatDocumentIdForMql({ String: 'a"b' })).toBe('"a\\"b"');
    expect(formatDocumentIdForMql({ String: "c\\d" })).toBe('"c\\\\d"');
  });

  it("renders Number as an unquoted integer literal", () => {
    expect(formatDocumentIdForMql({ Number: 42 })).toBe("42");
    expect(formatDocumentIdForMql({ Number: -1 })).toBe("-1");
  });

  it("renders Raw as compact JSON of the wrapped payload", () => {
    const id: DocumentId = { Raw: { $date: "2024-01-01" } };
    expect(formatDocumentIdForMql(id)).toBe('{"$date":"2024-01-01"}');
  });
});

describe("kindOfDocumentId", () => {
  it("discriminates every variant", () => {
    expect(kindOfDocumentId({ ObjectId: HEX })).toBe("ObjectId");
    expect(kindOfDocumentId({ String: "s" })).toBe("String");
    expect(kindOfDocumentId({ Number: 1 })).toBe("Number");
    expect(kindOfDocumentId({ Raw: null })).toBe("Raw");
  });
});

describe("wire-format roundtrip sanity", () => {
  // These JSON strings are the exact shapes the Rust serde encoder emits
  // (verified via a scratch cargo project — see Sprint 86 handoff). The
  // TypeScript mirror must accept them verbatim after `JSON.parse`.
  it("deserialises the four Rust-emitted wire shapes", () => {
    const oid = JSON.parse(`{"ObjectId":"${HEX}"}`) as DocumentId;
    expect(kindOfDocumentId(oid)).toBe("ObjectId");
    const s = JSON.parse('{"String":"key"}') as DocumentId;
    expect(kindOfDocumentId(s)).toBe("String");
    const n = JSON.parse('{"Number":42}') as DocumentId;
    expect(kindOfDocumentId(n)).toBe("Number");
    const raw = JSON.parse('{"Raw":{"$date":"2024-01-01"}}') as DocumentId;
    expect(kindOfDocumentId(raw)).toBe("Raw");
  });
});
