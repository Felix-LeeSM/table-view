// Issue #1307 — global BigInt JSON serialization patch regression tests.
// RED without `src/lib/bigintJson.ts`: `JSON.stringify` on a BigInt throws
// `TypeError: Do not know how to serialize a BigInt`, which is exactly the
// react-dom dev-logging crash that froze the app on SQLite integer tables.

import { describe, expect, it } from "vitest";

// The patch is installed process-wide by `src/test-setup.ts` (mirroring
// `main.tsx`). Import the module too so this file fails loudly if it ever
// stops installing the prototype method.
import "./bigintJson";

describe("global BigInt.prototype.toJSON patch (issue #1307)", () => {
  it("stringifies a lone BigInt as its decimal string (no throw)", () => {
    expect(() => JSON.stringify(9223372036854775807n)).not.toThrow();
    // JSON.stringify wraps the toJSON() string result in quotes.
    expect(JSON.stringify(9223372036854775807n)).toBe('"9223372036854775807"');
  });

  it("stringifies BigInt-bearing grid rows (the frozen-table shape) losslessly", () => {
    // Mirrors `wrapNumericCells` output: an integer column promoted to BigInt.
    const rows = [
      [9223372036854775807n, "order-1"],
      [18446744073709551615n, "order-2"],
    ];
    expect(() => JSON.stringify(rows)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(rows)) as string[][];
    // Digit-for-digit preserved (ADR 0026 wire format), no float rounding.
    expect(parsed[0]![0]).toBe("9223372036854775807");
    expect(parsed[1]![0]).toBe("18446744073709551615");
  });

  it("emits the decimal string form, matching the ADR 0026 wire token", () => {
    expect(42n.toJSON()).toBe("42");
    expect((-9007199254740993n).toJSON()).toBe("-9007199254740993");
  });
});
