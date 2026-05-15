// Sprint 323 (2026-05-15) — Slice G.1: BSON canonical type detection
// + coercion helpers.
//
// 작성 이유: Pencil edit 의 raw-string input 을 ObjectId / ISODate /
// Decimal128 / BinData canonical EJSON 형태로 자동 패키징하는 경로의
// happy path + invalid input 케이스를 회귀 가드. F.2 의 plain-string
// commit 흐름과 분리된 path 임.

import { describe, it, expect } from "vitest";
import {
  detectBsonType,
  coerceToEjson,
  ejsonToEditableString,
} from "./bsonTypes";

describe("bsonTypes (Sprint 323 G.1)", () => {
  describe("detectBsonType", () => {
    it("detects $oid wrapper as objectId", () => {
      expect(detectBsonType({ $oid: "65abcdef0123456789abcdef" })).toBe(
        "objectId",
      );
    });

    it("detects $date wrapper as date", () => {
      expect(detectBsonType({ $date: "2026-05-15T12:00:00Z" })).toBe("date");
      // canonical EJSON v2 numberLong wrapped form
      expect(detectBsonType({ $date: { $numberLong: "1715774400000" } })).toBe(
        "date",
      );
    });

    it("detects $numberDecimal as decimal128", () => {
      expect(detectBsonType({ $numberDecimal: "1234.5678" })).toBe(
        "decimal128",
      );
    });

    it("detects $binary as binData", () => {
      expect(
        detectBsonType({ $binary: { base64: "AAAA", subType: "00" } }),
      ).toBe("binData");
    });

    it("returns null for plain objects, scalars, arrays", () => {
      expect(detectBsonType({ name: "Alice" })).toBeNull();
      expect(detectBsonType("plain")).toBeNull();
      expect(detectBsonType(42)).toBeNull();
      expect(detectBsonType(null)).toBeNull();
      expect(detectBsonType([1, 2, 3])).toBeNull();
    });

    it("does not confuse multi-key objects whose first key starts with $", () => {
      expect(detectBsonType({ $oid: "x", extra: 1 })).toBeNull();
    });
  });

  describe("coerceToEjson — objectId", () => {
    it("wraps a valid 24-hex string in $oid", () => {
      const out = coerceToEjson("objectId", "65abcdef0123456789abcdef");
      expect(out).toEqual({ value: { $oid: "65abcdef0123456789abcdef" } });
    });

    it("rejects a too-short / too-long / non-hex string", () => {
      expect(coerceToEjson("objectId", "65abc")).toEqual({
        error: expect.stringMatching(/24-hex/i),
      });
      expect(coerceToEjson("objectId", "65abcdef0123456789abcdefxx")).toEqual({
        error: expect.stringMatching(/24-hex/i),
      });
      expect(coerceToEjson("objectId", "ZZZZZZZZZZZZZZZZZZZZZZZZ")).toEqual({
        error: expect.stringMatching(/24-hex/i),
      });
    });
  });

  describe("coerceToEjson — date", () => {
    it("wraps a parseable ISO string in $date", () => {
      const out = coerceToEjson("date", "2026-05-15T12:00:00Z");
      expect(out).toEqual({ value: { $date: "2026-05-15T12:00:00.000Z" } });
    });

    it("rejects unparseable strings", () => {
      expect(coerceToEjson("date", "not a date")).toEqual({
        error: expect.stringMatching(/ISO 8601|invalid date/i),
      });
    });
  });

  describe("coerceToEjson — decimal128", () => {
    it("wraps a numeric string in $numberDecimal", () => {
      expect(coerceToEjson("decimal128", "1234.5678")).toEqual({
        value: { $numberDecimal: "1234.5678" },
      });
      // Preserves precision (no float casting).
      expect(coerceToEjson("decimal128", "0.1")).toEqual({
        value: { $numberDecimal: "0.1" },
      });
    });

    it("rejects non-numeric strings", () => {
      expect(coerceToEjson("decimal128", "abc")).toEqual({
        error: expect.stringMatching(/numeric/i),
      });
      expect(coerceToEjson("decimal128", "")).toEqual({
        error: expect.stringMatching(/numeric|empty/i),
      });
    });
  });

  describe("coerceToEjson — binData", () => {
    it("wraps a valid base64 string with subType 00 by default", () => {
      const out = coerceToEjson("binData", "AAAA");
      expect(out).toEqual({
        value: { $binary: { base64: "AAAA", subType: "00" } },
      });
    });

    it("rejects non-base64 chars", () => {
      expect(coerceToEjson("binData", "###")).toEqual({
        error: expect.stringMatching(/base64/i),
      });
    });
  });

  describe("ejsonToEditableString — inverse", () => {
    it("ObjectId → hex string", () => {
      expect(
        ejsonToEditableString("objectId", { $oid: "65abcdef0123456789abcdef" }),
      ).toBe("65abcdef0123456789abcdef");
    });

    it("ISODate → ISO string (preserve canonical Z form)", () => {
      expect(
        ejsonToEditableString("date", { $date: "2026-05-15T12:00:00.000Z" }),
      ).toBe("2026-05-15T12:00:00.000Z");
    });

    it("Decimal128 → numeric string", () => {
      expect(
        ejsonToEditableString("decimal128", { $numberDecimal: "0.1" }),
      ).toBe("0.1");
    });

    it("BinData → base64 string", () => {
      expect(
        ejsonToEditableString("binData", {
          $binary: { base64: "AAAA", subType: "00" },
        }),
      ).toBe("AAAA");
    });
  });
});
