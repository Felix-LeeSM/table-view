// Issue #1460 — `supportsDdl(dbType, action)` reads the per-action `ddl.*`
// capability so the four schema-mutation entry points (Create Table / Alter
// Table / Create Index / Drop object) surface only where the wired backend
// adapter can actually execute that DDL. Grounds (adapter code):
//   - PostgreSQL / MySQL / MariaDB / MSSQL / Oracle — every DDL trait method
//     delegates to a real executor → all four true (MSSQL wired by #1071,
//     Oracle by #1072).
//   - SQLite — only `create_table` delegates; drop/rename/alter/index return
//     `sqlite_unsupported(...)` → `createTable` true, the rest false.
//   - DuckDB — the wired production adapter returns `Unsupported` for every DDL
//     trait method → all four false.
//   - Unknown / still-loading dbType — true for every action (same
//     affordance-preserving fallback as `supportsRowEditing`).
import { describe, it, expect } from "vitest";
import { supportsDdl, type DdlCapabilityName } from "./dataSource";

const ACTIONS: readonly DdlCapabilityName[] = [
  "createTable",
  "alterTable",
  "createIndex",
  "dropObject",
];

describe("supportsDdl (#1460)", () => {
  it("claims all four DDL actions for PostgreSQL, the MySQL family, MSSQL, and Oracle", () => {
    for (const dbType of [
      "postgresql",
      "mysql",
      "mariadb",
      "mssql",
      "oracle",
    ] as const) {
      for (const action of ACTIONS) {
        expect(supportsDdl(dbType, action)).toBe(true);
      }
    }
  });

  it("claims only createTable for SQLite (adapter wires create_table alone)", () => {
    expect(supportsDdl("sqlite", "createTable")).toBe(true);
    expect(supportsDdl("sqlite", "alterTable")).toBe(false);
    expect(supportsDdl("sqlite", "createIndex")).toBe(false);
    expect(supportsDdl("sqlite", "dropObject")).toBe(false);
  });

  it("claims no DDL for DuckDB (adapter rejects every DDL call)", () => {
    for (const action of ACTIONS) {
      expect(supportsDdl("duckdb", action)).toBe(false);
    }
  });

  it("returns true for every action while the dbType is unknown / still loading", () => {
    for (const action of ACTIONS) {
      expect(supportsDdl(null, action)).toBe(true);
      expect(supportsDdl(undefined, action)).toBe(true);
    }
  });
});
