// Sprint 227 — unit tests for the canonical PG type list + filter.
//
// Date: 2026-05-06.
//
// Why this file exists:
// - Locks AC-227-03 testable assertion ("typing `int` filters
//   suggestions to `integer`/`bigint`/`smallint`/`interval`") at the
//   list-source layer so the modal's combobox cases can stay focused
//   on rendering / keyboard nav rather than filter semantics.
// - Pins the canonical-list cardinality at ≥ 25 entries (spec
//   AC-227-03 lower bound).
import { describe, it, expect } from "vitest";
import {
  POSTGRES_COMMON_TYPES,
  filterPostgresTypes,
  expandParametricDefault,
  PARAMETRIC_TYPE_DEFAULTS,
} from "./postgresTypes";

describe("postgresTypes", () => {
  it("ships at least 25 canonical entries (AC-227-03)", () => {
    expect(POSTGRES_COMMON_TYPES.length).toBeGreaterThanOrEqual(25);
  });

  it("includes the spec exemplar entries verbatim", () => {
    // Spot-check a sampling from the spec's AC-227-03 list to lock
    // ordering-independence of containment.
    for (const t of [
      "serial",
      "bigserial",
      "integer",
      "varchar(255)",
      "timestamptz",
      "double precision",
      "uuid",
      "jsonb",
      "money",
      "tsvector",
      "xml",
    ]) {
      expect(POSTGRES_COMMON_TYPES).toContain(t);
    }
  });

  it("returns the full list when the query is empty / whitespace", () => {
    expect(filterPostgresTypes("")).toEqual([...POSTGRES_COMMON_TYPES]);
    expect(filterPostgresTypes("   ")).toEqual([...POSTGRES_COMMON_TYPES]);
  });

  it("filters case-insensitively by substring ('int' → integer/bigint/smallint/interval)", () => {
    const result = filterPostgresTypes("int");
    expect(result).toEqual(
      expect.arrayContaining(["integer", "bigint", "smallint", "interval"]),
    );
    // Sanity: no entry without "int" leaks through.
    for (const t of result) {
      expect(t.toLowerCase()).toContain("int");
    }
  });

  it("matches uppercase queries (case-insensitive)", () => {
    const result = filterPostgresTypes("TIME");
    expect(result).toEqual(
      expect.arrayContaining(["timestamp", "timestamptz", "time"]),
    );
  });

  it("returns an empty array for a query with no matches", () => {
    expect(filterPostgresTypes("zzz_no_match_zzz")).toEqual([]);
  });

  describe("expandParametricDefault (Sprint 227 hot-fix 2026-05-07)", () => {
    it("expands bare 'varchar' to 'varchar(255)'", () => {
      expect(expandParametricDefault("varchar")).toBe("varchar(255)");
    });

    it("expands bare 'char' to 'char(1)'", () => {
      expect(expandParametricDefault("char")).toBe("char(1)");
    });

    it("expands bare 'numeric' to 'numeric(10,2)'", () => {
      expect(expandParametricDefault("numeric")).toBe("numeric(10,2)");
    });

    it("is idempotent for already-parametric types", () => {
      expect(expandParametricDefault("varchar(255)")).toBe("varchar(255)");
      expect(expandParametricDefault("numeric(10,4)")).toBe("numeric(10,4)");
    });

    it("returns non-parametric types unchanged", () => {
      for (const t of ["integer", "uuid", "jsonb", "boolean", "text"]) {
        expect(expandParametricDefault(t)).toBe(t);
      }
    });

    it("PARAMETRIC_TYPE_DEFAULTS keys are all in the canonical list", () => {
      for (const k of Object.keys(PARAMETRIC_TYPE_DEFAULTS)) {
        expect(POSTGRES_COMMON_TYPES).toContain(k);
      }
    });
  });
});
