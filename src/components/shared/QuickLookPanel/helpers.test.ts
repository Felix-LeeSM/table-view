import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { formatCellValue } from "./helpers";
import type { ColumnInfo } from "@/types/schema";

// Sprint 306 (2026-05-14) — QuickLook BigInt/Decimal 회귀 가드. sprint-305
// 핫픽스 이전에는 `typeof === "object"` branch 가 raw JSON.stringify 라
// nested BigInt 입력에서 throw → QuickLookPanel mount-time freeze.

function col(overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name: "c",
    data_type: "text",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
    ...overrides,
  };
}

describe("formatCellValue — Sprint 306 BigInt/Decimal", () => {
  it("BigInt scalar → digit string (no JSON.stringify path)", () => {
    expect(formatCellValue(BigInt("9223372036854775807"), col())).toBe(
      "9223372036854775807",
    );
  });

  it("Decimal instance → toString (avoids '{}' from generic branch)", () => {
    expect(formatCellValue(new Decimal("12345.6789"), col())).toBe(
      "12345.6789",
    );
  });

  it("nested BigInt in object → safe-stringified without throw", () => {
    expect(() =>
      formatCellValue({ id: BigInt("9223372036854775807") }, col()),
    ).not.toThrow();
    const formatted = formatCellValue(
      { id: BigInt("9223372036854775807") },
      col(),
    );
    expect(formatted).toContain('"id": "9223372036854775807"');
  });

  it("JSON column string with BigInt-shaped digits stays as parsed JSON text", () => {
    const result = formatCellValue(
      '{"big":"9223372036854775807"}',
      col({
        data_type: "jsonb",
      }),
    );
    expect(result).toContain('"big": "9223372036854775807"');
  });

  it("null → NULL sentinel", () => {
    expect(formatCellValue(null, col())).toBe("NULL");
  });
});
