import { describe, it, expect } from "vitest";
import { generateSql } from "./sqlGenerator";
import type { TableData } from "@/types/schema";

// Issue #1080 — a NULL row-identity value must produce `col IS NULL`, never
// `col = NULL`. In SQL three-valued logic `x = NULL` evaluates to UNKNOWN and
// matches zero rows, so the edit silently applies to nothing while the commit
// still reports success. Guard both WHERE-clause paths that buildWhereClause
// owns: the primary-key path and the all-column fallback (PK-less tables).

const NULL_PK_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "name",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[null, "Alice"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "",
};

const NO_PK_NULL_DATA: TableData = {
  columns: [
    {
      name: "code",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "name",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[null, "Alice"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "",
};

describe("generateSql — NULL row-identity WHERE (#1080)", () => {
  it("emits `IS NULL` for a NULL primary-key value in UPDATE", () => {
    const edits = new Map<string, string | null>([["0-1", "Bob"]]);
    const statements = generateSql(
      NULL_PK_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "UPDATE public.t SET name = 'Bob' WHERE id IS NULL;",
    );
  });

  it("emits `IS NULL` for a NULL primary-key value in DELETE", () => {
    const statements = generateSql(
      NULL_PK_DATA,
      "public",
      "t",
      new Map(),
      new Set(["row-1-0"]),
      [],
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe("DELETE FROM public.t WHERE id IS NULL;");
  });

  it("emits `IS NULL` for a NULL column in the PK-less all-column fallback", () => {
    const edits = new Map<string, string | null>([["0-1", "Bob"]]);
    const statements = generateSql(
      NO_PK_NULL_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "UPDATE public.t SET name = 'Bob' WHERE code IS NULL AND name = 'Alice';",
    );
  });
});
