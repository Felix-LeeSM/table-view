import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateAll } from "./generator.js";
import { applySqlite } from "./sqlite.js";
import { loadSpec } from "./spec.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), "fixture-sqlite-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("sqlite fixture DDL", () => {
  it("creates the e2e profile with real column length checks and inline foreign keys", async () => {
    const spec = loadSpec("e2e");
    const fileName = "fixture.sqlite";
    const dbPath = resolve(tempDir, fileName);

    await applySqlite(
      { directory: tempDir, fileName: "" },
      fileName,
      spec,
      generateAll(spec),
      () => {},
    );

    const db = new Database(dbPath, { readonly: true });
    try {
      const customers = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'customers'",
        )
        .get() as { sql: string };
      const ordersFks = db
        .prepare("PRAGMA foreign_key_list([orders])")
        .all() as { table: string; from: string; to: string }[];

      expect(customers.sql).toContain("length([full_name]) <= 200");
      expect(customers.sql).not.toContain("length([col])");
      expect(ordersFks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: "customers",
            from: "customer_id",
            to: "id",
          }),
        ]),
      );
    } finally {
      db.close();
    }
  });
});
