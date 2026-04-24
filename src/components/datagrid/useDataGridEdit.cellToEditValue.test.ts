import { describe, it, expect } from "vitest";
import {
  cellToEditValue,
  cellToEditString,
  deriveEditorSeed,
  getInputTypeForColumn,
} from "./useDataGridEdit";

describe("cellToEditValue — preserves null/empty-string distinction", () => {
  it("returns null for null cells", () => {
    expect(cellToEditValue(null)).toBeNull();
  });

  it("returns null for undefined cells", () => {
    expect(cellToEditValue(undefined)).toBeNull();
  });

  it("returns empty string for empty-string cells (not null)", () => {
    expect(cellToEditValue("")).toBe("");
    expect(cellToEditValue("")).not.toBeNull();
  });

  it("returns primitive strings as-is", () => {
    expect(cellToEditValue("Alice")).toBe("Alice");
    expect(cellToEditValue("42")).toBe("42");
  });

  it("coerces numbers and booleans to strings", () => {
    expect(cellToEditValue(42)).toBe("42");
    expect(cellToEditValue(0)).toBe("0");
    expect(cellToEditValue(true)).toBe("true");
    expect(cellToEditValue(false)).toBe("false");
  });

  it("pretty-prints objects and arrays as JSON", () => {
    expect(cellToEditValue({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(cellToEditValue([1, 2])).toBe("[\n  1,\n  2\n]");
  });
});

describe("cellToEditString — legacy display helper (NULL → '')", () => {
  it("collapses null to empty string (legacy semantics)", () => {
    expect(cellToEditString(null)).toBe("");
    expect(cellToEditString(undefined)).toBe("");
  });

  it("differs from cellToEditValue specifically on null", () => {
    expect(cellToEditString(null)).toBe("");
    expect(cellToEditValue(null)).toBeNull();
  });

  it("agrees with cellToEditValue on non-null inputs", () => {
    const inputs: unknown[] = ["Alice", "", 42, true, { a: 1 }];
    for (const input of inputs) {
      expect(cellToEditString(input)).toBe(cellToEditValue(input));
    }
  });
});

describe("deriveEditorSeed — type-aware NULL → typed editor flip", () => {
  describe("text-family columns seed with the raw keystroke", () => {
    it("text: 'a' → { seed: 'a', accept: true }", () => {
      expect(deriveEditorSeed("text", "a")).toEqual({
        seed: "a",
        accept: true,
      });
    });

    it("varchar / character varying: seeds with raw key", () => {
      expect(deriveEditorSeed("varchar", "x")).toEqual({
        seed: "x",
        accept: true,
      });
      expect(deriveEditorSeed("character varying", "x")).toEqual({
        seed: "x",
        accept: true,
      });
    });

    it("char / citext / string: seeds with raw key", () => {
      expect(deriveEditorSeed("char", "c")).toEqual({
        seed: "c",
        accept: true,
      });
      expect(deriveEditorSeed("citext", "c")).toEqual({
        seed: "c",
        accept: true,
      });
      expect(deriveEditorSeed("string", "s")).toEqual({
        seed: "s",
        accept: true,
      });
    });

    it("json / jsonb: seeds with raw key (text editor fallback)", () => {
      expect(deriveEditorSeed("json", "{")).toEqual({
        seed: "{",
        accept: true,
      });
      expect(deriveEditorSeed("jsonb", "[")).toEqual({
        seed: "[",
        accept: true,
      });
    });

    it("unknown / fallback types: seeds with raw key", () => {
      expect(deriveEditorSeed("mystery_type", "q")).toEqual({
        seed: "q",
        accept: true,
      });
    });
  });

  describe("integer-family columns accept only integer first chars", () => {
    it("integer + digit → accept seeded", () => {
      expect(deriveEditorSeed("integer", "5")).toEqual({
        seed: "5",
        accept: true,
      });
    });

    it("integer + leading minus → accept seeded", () => {
      expect(deriveEditorSeed("integer", "-")).toEqual({
        seed: "-",
        accept: true,
      });
    });

    it("integer + '.' → reject (no decimals)", () => {
      expect(deriveEditorSeed("integer", ".")).toEqual({
        seed: "",
        accept: false,
      });
    });

    it("integer + letter → reject", () => {
      expect(deriveEditorSeed("integer", "a")).toEqual({
        seed: "",
        accept: false,
      });
      expect(deriveEditorSeed("int4", "x")).toEqual({
        seed: "",
        accept: false,
      });
    });

    it("bigint / smallint / serial all classified as integer", () => {
      expect(deriveEditorSeed("bigint", "1")).toEqual({
        seed: "1",
        accept: true,
      });
      expect(deriveEditorSeed("smallint", "1")).toEqual({
        seed: "1",
        accept: true,
      });
      expect(deriveEditorSeed("SERIAL", "1")).toEqual({
        seed: "1",
        accept: true,
      });
      expect(deriveEditorSeed("bigint", "a")).toEqual({
        seed: "",
        accept: false,
      });
    });
  });

  describe("numeric-family columns accept digits, minus, and decimal point", () => {
    it("numeric + digit → accept", () => {
      expect(deriveEditorSeed("numeric", "3")).toEqual({
        seed: "3",
        accept: true,
      });
    });

    it("numeric + '.' → accept (leading decimal)", () => {
      expect(deriveEditorSeed("numeric", ".")).toEqual({
        seed: ".",
        accept: true,
      });
    });

    it("numeric + '-' → accept", () => {
      expect(deriveEditorSeed("decimal", "-")).toEqual({
        seed: "-",
        accept: true,
      });
    });

    it("numeric + letter → reject", () => {
      expect(deriveEditorSeed("numeric", "a")).toEqual({
        seed: "",
        accept: false,
      });
    });

    it("float / double precision / real classified as numeric", () => {
      expect(deriveEditorSeed("float", "1")).toEqual({
        seed: "1",
        accept: true,
      });
      expect(deriveEditorSeed("double precision", ".")).toEqual({
        seed: ".",
        accept: true,
      });
      expect(deriveEditorSeed("real", "-")).toEqual({
        seed: "-",
        accept: true,
      });
    });
  });

  describe("date / datetime / timestamp / time columns flip to empty typed editor", () => {
    it("date + any key → accept but discard seed", () => {
      expect(deriveEditorSeed("date", "a")).toEqual({
        seed: "",
        accept: true,
      });
      expect(deriveEditorSeed("date", "1")).toEqual({
        seed: "",
        accept: true,
      });
    });

    it("datetime + any key → accept but discard seed", () => {
      expect(deriveEditorSeed("datetime", "a")).toEqual({
        seed: "",
        accept: true,
      });
    });

    it("timestamp / timestamptz → accept but discard seed", () => {
      expect(deriveEditorSeed("timestamp", "a")).toEqual({
        seed: "",
        accept: true,
      });
      expect(deriveEditorSeed("timestamp with time zone", "a")).toEqual({
        seed: "",
        accept: true,
      });
      expect(deriveEditorSeed("timestamptz", "1")).toEqual({
        seed: "",
        accept: true,
      });
    });

    it("time → accept but discard seed", () => {
      expect(deriveEditorSeed("time", "a")).toEqual({
        seed: "",
        accept: true,
      });
    });
  });

  describe("boolean / bool columns accept but discard seed (Sprint 75 coerces)", () => {
    it("boolean + any key → accept empty seed", () => {
      expect(deriveEditorSeed("boolean", "t")).toEqual({
        seed: "",
        accept: true,
      });
      expect(deriveEditorSeed("boolean", "f")).toEqual({
        seed: "",
        accept: true,
      });
      expect(deriveEditorSeed("boolean", "x")).toEqual({
        seed: "",
        accept: true,
      });
    });

    it("bool alias works", () => {
      expect(deriveEditorSeed("bool", "t")).toEqual({
        seed: "",
        accept: true,
      });
    });
  });

  describe("uuid columns accept but discard seed", () => {
    it("uuid + any key → accept empty seed", () => {
      expect(deriveEditorSeed("uuid", "a")).toEqual({
        seed: "",
        accept: true,
      });
      expect(deriveEditorSeed("UUID", "0")).toEqual({
        seed: "",
        accept: true,
      });
    });
  });

  describe("case-insensitivity mirrors getInputTypeForColumn", () => {
    it("INTEGER / Date / Timestamp all normalise", () => {
      expect(deriveEditorSeed("INTEGER", "5")).toEqual({
        seed: "5",
        accept: true,
      });
      // getInputTypeForColumn("date") returns "date"; our classifier must
      // also recognise uppercase "DATE" the same way.
      expect(deriveEditorSeed("DATE", "5")).toEqual({
        seed: "",
        accept: true,
      });
      expect(deriveEditorSeed("Timestamp", "5")).toEqual({
        seed: "",
        accept: true,
      });
    });
  });

  describe("classification stays consistent with getInputTypeForColumn", () => {
    // Cross-check: every type family routes through getInputTypeForColumn for
    // the HTML `<input type>`, and deriveEditorSeed only disagrees on seed,
    // never on "is this a typed editor" vs "is this a text editor" decisions.
    it("date types map to type='date'", () => {
      expect(getInputTypeForColumn("date")).toBe("date");
    });
    it("timestamp types map to type='datetime-local'", () => {
      expect(getInputTypeForColumn("timestamp")).toBe("datetime-local");
      // Note: `getInputTypeForColumn("datetime")` falls through to the
      // `time` branch (substring match on "time") by the existing rule.
      // deriveEditorSeed still treats "datetime" as a datetime family for
      // seeding, which is the intended divergence — seeding cares about
      // "can we seed a literal char?" while the HTML input type is decided
      // by the existing include-order rules. This asymmetry is acceptable
      // because in practice column data_types are "timestamp"/"timestamptz"
      // from Postgres, not "datetime".
    });
    it("time types map to type='time'", () => {
      expect(getInputTypeForColumn("time")).toBe("time");
    });
    it("text fallback is type='text'", () => {
      expect(getInputTypeForColumn("text")).toBe("text");
      expect(getInputTypeForColumn("integer")).toBe("text");
      expect(getInputTypeForColumn("boolean")).toBe("text");
      expect(getInputTypeForColumn("uuid")).toBe("text");
    });
  });
});
