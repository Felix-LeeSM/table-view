import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  rowsToPlainText,
  rowsToJson,
  rowsToCsv,
  rowsToSqlInsert,
} from "./format";
import type { CopyRowData } from "./format";

// Sprint 238 — `truncateCell` / `CELL_DISPLAY_LIMIT` 테스트 폐기 (AC-238-05).
// CSS ellipsis 로 대체됨.

// ── Copy format utilities ─────────────────────────────────────────────

function makeCopyData(overrides: Partial<CopyRowData> = {}): CopyRowData {
  return {
    columns: ["id", "name"],
    rows: [
      [1, "Alice"],
      [2, "Bob"],
    ],
    schema: "public",
    table: "users",
    ...overrides,
  };
}

describe("rowsToPlainText", () => {
  it("produces tab-separated text with header row", () => {
    const result = rowsToPlainText(makeCopyData());
    const lines = result.split("\n");
    expect(lines[0]).toBe("id\tname");
    expect(lines[1]).toBe("1\tAlice");
    expect(lines[2]).toBe("2\tBob");
  });

  it("handles null values as empty strings", () => {
    const result = rowsToPlainText(makeCopyData({ rows: [[1, null]] }));
    const lines = result.split("\n");
    expect(lines[1]).toBe("1\t");
  });

  it("handles object values by JSON-stringifying them", () => {
    const result = rowsToPlainText(
      makeCopyData({ rows: [[1, { key: "val" }]] }),
    );
    const lines = result.split("\n");
    expect(lines[1]).toBe('1\t{"key":"val"}');
  });

  it("handles empty rows", () => {
    const result = rowsToPlainText(makeCopyData({ rows: [] }));
    const lines = result.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("id\tname");
  });
});

describe("rowsToJson", () => {
  it("produces a JSON array of objects", () => {
    const result = rowsToJson(makeCopyData());
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("handles null values as JSON null", () => {
    const result = rowsToJson(makeCopyData({ rows: [[1, null]] }));
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([{ id: 1, name: null }]);
  });

  it("handles empty rows", () => {
    const result = rowsToJson(makeCopyData({ rows: [] }));
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([]);
  });
});

describe("rowsToCsv", () => {
  it("produces CSV text with header row", () => {
    const result = rowsToCsv(makeCopyData());
    const lines = result.split("\n");
    expect(lines[0]).toBe("id,name");
    expect(lines[1]).toBe("1,Alice");
    expect(lines[2]).toBe("2,Bob");
  });

  it("escapes fields containing commas", () => {
    const result = rowsToCsv(makeCopyData({ rows: [[1, "Bob, Jr."]] }));
    const lines = result.split("\n");
    expect(lines[1]).toBe('1,"Bob, Jr."');
  });

  it("escapes fields containing double quotes", () => {
    const result = rowsToCsv(makeCopyData({ rows: [[1, 'say "hello"']] }));
    const lines = result.split("\n");
    expect(lines[1]).toBe('1,"say ""hello"""');
  });

  it("escapes fields containing newlines", () => {
    const result = rowsToCsv(makeCopyData({ rows: [[1, "line1\nline2"]] }));
    // CSV field with newline is wrapped in quotes
    expect(result).toContain('"line1\nline2"');
  });

  it("handles null values as empty strings", () => {
    const result = rowsToCsv(makeCopyData({ rows: [[1, null]] }));
    const lines = result.split("\n");
    expect(lines[1]).toBe("1,");
  });
});

describe("rowsToSqlInsert", () => {
  it("produces INSERT INTO statements", () => {
    const result = rowsToSqlInsert(makeCopyData());
    expect(result).toContain(
      "INSERT INTO public.users (id, name) VALUES (1, 'Alice');",
    );
    expect(result).toContain(
      "INSERT INTO public.users (id, name) VALUES (2, 'Bob');",
    );
  });

  it("handles null values as NULL", () => {
    const result = rowsToSqlInsert(makeCopyData({ rows: [[1, null]] }));
    expect(result).toBe(
      "INSERT INTO public.users (id, name) VALUES (1, NULL);",
    );
  });

  it("escapes single quotes in string values", () => {
    const result = rowsToSqlInsert(makeCopyData({ rows: [[1, "O'Brien"]] }));
    expect(result).toBe(
      "INSERT INTO public.users (id, name) VALUES (1, 'O''Brien');",
    );
  });

  it("handles numeric values without quotes", () => {
    const result = rowsToSqlInsert(makeCopyData({ rows: [[42, "test"]] }));
    expect(result).toContain("VALUES (42, 'test')");
  });

  it("handles boolean values", () => {
    const result = rowsToSqlInsert({
      columns: ["flag"],
      rows: [[true]],
      schema: "public",
      table: "flags",
    });
    expect(result).toBe("INSERT INTO public.flags (flag) VALUES (true);");
  });

  it("handles empty schema (no prefix)", () => {
    const result = rowsToSqlInsert({
      columns: ["id"],
      rows: [[1]],
      schema: "",
      table: "test",
    });
    expect(result).toBe("INSERT INTO test (id) VALUES (1);");
  });
});

// Sprint 306 (2026-05-14) — BigInt freeze 회귀 가드. 사용자 보고: DataGrid
// 가 mount 직후 굳었고 stacktrace 가 raw `JSON.stringify` 였다 (sprint-305
// 핫픽스). copy/export 경로의 4 함수 모두 cell 값을 직접 만지므로 BigInt /
// Decimal 가 nested 로 들어오는 케이스를 fix.
const BIG = BigInt("9223372036854775807");

describe("rowsToPlainText — BigInt/Decimal (Sprint 306)", () => {
  it("스칼라 BigInt 를 toString 으로 평탄화", () => {
    const result = rowsToPlainText(makeCopyData({ rows: [[1, BIG]] }));
    expect(result.split("\n")[1]).toBe(`1\t${BIG.toString()}`);
  });
  it("nested BigInt 를 포함한 object 도 throw 없이 직렬화", () => {
    const result = rowsToPlainText(makeCopyData({ rows: [[1, { big: BIG }]] }));
    expect(result.split("\n")[1]).toBe(`1\t{"big":"${BIG.toString()}"}`);
  });
  it("Decimal 인스턴스도 toString 으로 평탄화", () => {
    const result = rowsToPlainText(
      makeCopyData({ rows: [[1, new Decimal("12345.678")]] }),
    );
    expect(result.split("\n")[1]).toBe("1\t12345.678");
  });
});

describe("rowsToJson — BigInt/Decimal (Sprint 306)", () => {
  it("BigInt 셀이 있어도 throw 하지 않고 JSON 직렬화", () => {
    expect(() => rowsToJson(makeCopyData({ rows: [[1, BIG]] }))).not.toThrow();
    const parsed = JSON.parse(rowsToJson(makeCopyData({ rows: [[1, BIG]] })));
    expect(parsed[0].name).toBe(BIG.toString());
  });
  it("Decimal 셀도 string 으로 직렬화", () => {
    const result = rowsToJson(
      makeCopyData({ rows: [[1, new Decimal("0.1")]] }),
    );
    const parsed = JSON.parse(result);
    expect(parsed[0].name).toBe("0.1");
  });
});

describe("rowsToCsv — BigInt/Decimal (Sprint 306)", () => {
  it("BigInt 스칼라가 들어와도 throw 없이 CSV 출력", () => {
    const result = rowsToCsv(makeCopyData({ rows: [[1, BIG]] }));
    expect(result.split("\n")[1]).toBe(`1,${BIG.toString()}`);
  });
  it("nested BigInt object 도 throw 없이 출력", () => {
    expect(() =>
      rowsToCsv(makeCopyData({ rows: [[1, { big: BIG }]] })),
    ).not.toThrow();
  });
});

describe("rowsToSqlInsert — BigInt/Decimal (Sprint 306)", () => {
  it("BigInt 는 quote 없이 literal 로 출력 (numeric 타입 호환)", () => {
    const result = rowsToSqlInsert(makeCopyData({ rows: [[1, BIG]] }));
    expect(result).toBe(
      `INSERT INTO public.users (id, name) VALUES (1, ${BIG.toString()});`,
    );
  });
  it("Decimal 은 quote 없이 literal 로 출력", () => {
    const result = rowsToSqlInsert(
      makeCopyData({ rows: [[1, new Decimal("3.14")]] }),
    );
    expect(result).toBe(
      "INSERT INTO public.users (id, name) VALUES (1, 3.14);",
    );
  });
  it("nested BigInt object 도 throw 없이 quoted JSON 으로 출력", () => {
    expect(() =>
      rowsToSqlInsert(makeCopyData({ rows: [[1, { big: BIG }]] })),
    ).not.toThrow();
  });
});
