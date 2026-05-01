import { describe, expect, it } from "vitest";
import { buildExportFilename } from "./filename";

// 2026-05-01 — Sprint 181 AC-181-02. The filename helper is pure so we
// inject `now` to keep snapshots deterministic across CI clocks.

const FIXED = new Date(2026, 4, 1, 14, 30, 12); // 2026-05-01 14:30:12 local

describe("buildExportFilename", () => {
  // [AC-181-02a] table context → "<schema>.<table>_<ts>.<ext>"
  it("table context produces schema.table_<ts>.csv", () => {
    expect(
      buildExportFilename(
        { kind: "table", schema: "public", name: "users" },
        "csv",
        FIXED,
      ),
    ).toBe("public.users_20260501-143012.csv");
  });

  // [AC-181-02b] collection context uses bare collection name
  it("collection context uses collection name", () => {
    expect(
      buildExportFilename(
        { kind: "collection", name: "events" },
        "json",
        FIXED,
      ),
    ).toBe("events_20260501-143012.json");
  });

  // [AC-181-02c] query context uses literal "query"
  it("query context uses literal query", () => {
    expect(
      buildExportFilename({ kind: "query", source_table: null }, "sql", FIXED),
    ).toBe("query_20260501-143012.sql");
  });

  // [AC-181-02d] timestamp is deterministic with injected now
  it("timestamp pads single-digit values", () => {
    const earlyMorning = new Date(2026, 0, 3, 4, 5, 9); // 2026-01-03 04:05:09
    expect(
      buildExportFilename(
        { kind: "table", schema: "s", name: "t" },
        "tsv",
        earlyMorning,
      ),
    ).toBe("s.t_20260103-040509.tsv");
  });

  // [AC-181-02] All four formats use their canonical extension
  it("uses canonical extensions for all formats", () => {
    const ctx = { kind: "table" as const, schema: "s", name: "t" };
    expect(buildExportFilename(ctx, "csv", FIXED)).toMatch(/\.csv$/);
    expect(buildExportFilename(ctx, "tsv", FIXED)).toMatch(/\.tsv$/);
    expect(buildExportFilename(ctx, "sql", FIXED)).toMatch(/\.sql$/);
    expect(buildExportFilename(ctx, "json", FIXED)).toMatch(/\.json$/);
  });
});
