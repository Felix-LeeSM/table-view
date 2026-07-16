import { describe, expect, it } from "vitest";

import { supportsMigrationExport } from "./useMigrationExport";

// Issue #1068 — the SQLite `stream_table_rows` backend is now implemented, so
// the schema-tree migration/dump export controls must surface for SQLite (the
// frontend DDL dialect already supports it). Engines without a streaming
// backend stay gated off (#1048 — no error-on-click).
describe("supportsMigrationExport", () => {
  it("enables migration export for engines with a streaming backend", () => {
    expect(supportsMigrationExport("postgresql")).toBe(true);
    expect(supportsMigrationExport("mysql")).toBe(true);
    expect(supportsMigrationExport("mariadb")).toBe(true);
    expect(supportsMigrationExport("sqlite")).toBe(true);
  });

  it("stays gated off for engines without a streaming backend", () => {
    expect(supportsMigrationExport("duckdb")).toBe(false);
    expect(supportsMigrationExport("mssql")).toBe(false);
    expect(supportsMigrationExport("oracle")).toBe(false);
    expect(supportsMigrationExport(undefined)).toBe(false);
  });
});
