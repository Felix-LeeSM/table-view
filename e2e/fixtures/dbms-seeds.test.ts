import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DBMS_SEED_FILES = [
  ["postgresql", "seed.sql"],
  ["mysql", "seed.mysql.sql"],
  ["mariadb", "seed.mariadb.sql"],
  ["sqlite", "seed.sqlite.sql"],
  ["mssql", "seed.mssql.sql"],
  ["oracle", "seed.oracle.sql"],
] as const;

describe("DBMS-specific E2E seed fixtures", () => {
  it.each(DBMS_SEED_FILES)(
    "%s has a dedicated idempotent SQL seed",
    (_dbms, file) => {
      const sql = readFileSync(resolve("e2e/fixtures", file), "utf-8");
      expect(sql).toContain("Idempotency contract");
      expect(sql).toMatch(/\busers\b/i);
      expect(sql).toMatch(/\borders\b/i);
      expect(sql).toMatch(/\bproducts\b/i);
    },
  );
});
