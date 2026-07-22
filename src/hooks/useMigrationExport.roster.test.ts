import { describe, expect, it } from "vitest";

import { supportsMigrationExport } from "./useMigrationExport";

// Issue #1068 — the SQLite `stream_table_rows` backend is now implemented, so
// the schema-tree migration/dump export controls must surface for SQLite (the
// frontend DDL dialect already supports it). Issue #1642 wires the same backend
// for SQL Server, so `mssql` promotes too; #1674 wires it for Oracle, so
// `oracle` promotes too. Engines without a streaming backend stay gated off
// (#1048 — no error-on-click).
describe("supportsMigrationExport", () => {
  it("enables migration export for engines with a streaming backend", () => {
    expect(supportsMigrationExport("postgresql")).toBe(true);
    expect(supportsMigrationExport("mysql")).toBe(true);
    expect(supportsMigrationExport("mariadb")).toBe(true);
    expect(supportsMigrationExport("sqlite")).toBe(true);
    // #1642 — MSSQL now has a `stream_table_rows` backend + T-SQL dump dialect.
    expect(supportsMigrationExport("mssql")).toBe(true);
    // #1674 — Oracle now has a `stream_table_rows` backend + Oracle dump dialect.
    expect(supportsMigrationExport("oracle")).toBe(true);
  });

  it("stays gated off for engines without a streaming backend", () => {
    expect(supportsMigrationExport("duckdb")).toBe(false);
    expect(supportsMigrationExport(undefined)).toBe(false);
  });
});
