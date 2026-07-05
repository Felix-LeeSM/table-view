import { describe, expect, it } from "vitest";
import type { TableData } from "@/types/schema";
import type { DatabaseType } from "@/types/connection";
import {
  DATA_SOURCE_PROFILES,
  dialectRequiresPrimaryKeyForEdit,
  getDataSourceProfile,
} from "@/types/dataSource";
import { generateSql, type CoerceError } from "./sqlGenerator";

// Issue #1356 — the "which DBMS require a primary key to edit a row (all-column
// WHERE fallback disabled)" rule used to be hand-encoded in three consumers
// (DataGrid gate, sqlGenerator builder, QueryResultGrid). Drift between them
// silently shipped a whole-table UPDATE. These tests pin the single source of
// truth: the `capabilities.edit.requiresPrimaryKeyForEdit` flag.

const PK_REQUIRED: readonly DatabaseType[] = ["sqlite", "mssql", "oracle"];

function tableData(overrides: Partial<TableData> = {}): TableData {
  return {
    columns: [
      {
        name: "id",
        data_type: "INTEGER",
        nullable: false,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "name",
        data_type: "TEXT",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ],
    rows: [[1, "Alice"]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query: "SELECT * FROM t",
    ...overrides,
  };
}

describe("requiresPrimaryKeyForEdit capability (issue #1356)", () => {
  it("flag value matches the PK-required DBMS roster for every profile", () => {
    for (const dbType of Object.keys(DATA_SOURCE_PROFILES) as DatabaseType[]) {
      expect(
        getDataSourceProfile(dbType).capabilities.edit
          .requiresPrimaryKeyForEdit,
      ).toBe(PK_REQUIRED.includes(dbType));
    }
  });

  it("dialectRequiresPrimaryKeyForEdit resolves the flag from the profile", () => {
    expect(dialectRequiresPrimaryKeyForEdit("sqlite")).toBe(true);
    expect(dialectRequiresPrimaryKeyForEdit("mssql")).toBe(true);
    expect(dialectRequiresPrimaryKeyForEdit("oracle")).toBe(true);
    expect(dialectRequiresPrimaryKeyForEdit("postgresql")).toBe(false);
    expect(dialectRequiresPrimaryKeyForEdit("mysql")).toBe(false);
  });

  it("blocks SQLite row writes without a primary key (flag true)", () => {
    const errors: CoerceError[] = [];
    const statements = generateSql(
      tableData(),
      "main",
      "t",
      new Map<string, string | null>([["0-1", "Bob"]]),
      new Set(["row-1-0"]),
      [],
      { dialect: "sqlite", onCoerceError: (e) => errors.push(e) },
    );
    expect(statements).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.message.includes("primary key"))).toBe(true);
  });

  it("keeps the all-column WHERE fallback for PostgreSQL (flag false)", () => {
    const statements = generateSql(
      tableData({ executed_query: "SELECT * FROM public.t" }),
      "public",
      "t",
      new Map<string, string | null>([["0-1", "Bob"]]),
      new Set(),
      [],
      { dialect: "postgresql" },
    );
    expect(statements).toHaveLength(1);
    // Legacy safety net: identifies the row by every column, not a naked UPDATE.
    expect(statements[0]).toContain("WHERE");
    expect(statements[0]).toContain(" AND ");
  });
});
