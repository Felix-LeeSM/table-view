// Guards the PG exotic-type showcase (pg-showcase.ts) against silent coverage
// loss. This is a static/offline test — it inspects the generated SQL, not a
// live Postgres. The live apply is exercised by `pnpm fixtures:load development`
// and the dbms-seeds integration path.
import { describe, it, expect } from "vitest";
import { PRELUDE, buildBlocks } from "./pg-showcase.js";

// The bulk-filled data tables (each owns a table named after the block and a
// generate_series fill). `db_objects` is intentionally different: it builds
// views/procs/etc., so it is excluded from the table-shaped assertions.
const TABLE_BLOCKS = [
  "media_assets",
  "warehouses",
  "shipment_windows",
  "pricing",
  "search_docs",
  "access_log",
];

const allSql = (n = 1000) =>
  PRELUDE +
  buildBlocks(n)
    .map((b) => b.sql)
    .join("\n");

describe("pg showcase — prelude", () => {
  it("is idempotent-safe: schema, hstore, guarded enum/domain/composite, seeded rng", () => {
    expect(PRELUDE).toContain("CREATE SCHEMA IF NOT EXISTS showcase");
    expect(PRELUDE).toContain("CREATE EXTENSION IF NOT EXISTS hstore");
    expect(PRELUDE).toMatch(/CREATE TYPE showcase\.mood AS ENUM/);
    expect(PRELUDE).toMatch(/CREATE DOMAIN showcase\.us_zip/);
    expect(PRELUDE).toMatch(/CREATE TYPE showcase\.money_amount AS/);
    expect(PRELUDE).toContain("EXCEPTION WHEN duplicate_object");
    expect(PRELUDE).toContain("setseed");
  });
});

describe("pg showcase — data tables", () => {
  it("every data table drops (CASCADE) before create — re-runnable", () => {
    for (const name of TABLE_BLOCKS) {
      const b = buildBlocks().find((x) => x.name === name)!;
      expect(b.sql).toContain(`DROP TABLE IF EXISTS showcase.${name} CASCADE`);
      expect(b.sql).toContain(`CREATE TABLE showcase.${name}`);
    }
  });

  it("covers the exotic types the portable pipeline misses", () => {
    const sql = allSql();
    for (const type of [
      "bytea",
      "point",
      "polygon",
      "box",
      "cidr",
      "macaddr",
      "tstzrange",
      "numrange",
      "int4range",
      "interval",
      "path",
      "money",
      "numeric(30, 10)",
      "bit(8)",
      "varbit",
      "tsvector",
      "text[]",
      "int[]",
      "uuid[]",
      "hstore",
      "showcase.mood",
      "inet",
      "xml",
    ]) {
      expect(sql, `missing type: ${type}`).toContain(type);
    }
  });

  it("embeds real committed JPEG blobs (no runtime network)", () => {
    const media = buildBlocks().find((b) => b.name === "media_assets")!.sql;
    // base64 of a JPEG starts with the SOI+APP0 marker "/9j/".
    expect(media).toContain("decode('/9j/");
    expect((media.match(/decode\('\/9j\//g) ?? []).length).toBe(3);
  });
});

describe("pg showcase — non-table objects", () => {
  it("creates a view, materialized view, function, procedure, domain + composite", () => {
    const objs = buildBlocks().find((b) => b.name === "db_objects")!.sql;
    expect(objs).toMatch(/CREATE OR REPLACE VIEW showcase\.expensive_pricing/);
    expect(objs).toMatch(
      /CREATE MATERIALIZED VIEW showcase\.warehouse_by_subnet/,
    );
    expect(objs).toMatch(/CREATE OR REPLACE FUNCTION showcase\.asset_count/);
    expect(objs).toMatch(
      /CREATE OR REPLACE PROCEDURE showcase\.refresh_summary/,
    );
    expect(objs).toContain("showcase.us_zip"); // DOMAIN usage
    expect(objs).toContain("showcase.money_amount"); // composite usage
  });
});

describe("pg showcase — volume + edges", () => {
  it("bulk-fills every data table via generate_series with the given row count", () => {
    for (const name of TABLE_BLOCKS) {
      const b = buildBlocks(777).find((x) => x.name === name)!;
      expect(b.sql, `${name} lacks bulk fill`).toContain(
        "generate_series(1, 777)",
      );
    }
  });

  it("keeps deliberate edge rows in every block", () => {
    for (const b of buildBlocks()) {
      expect(b.sql, `${b.name} has no edge row`).toMatch(/'edge-/);
    }
  });

  it("row count is env-overridable (SHOWCASE_ROWS knob)", () => {
    const media0 = buildBlocks(0).find((b) => b.name === "media_assets")!.sql;
    const media5k = buildBlocks(5000).find(
      (b) => b.name === "media_assets",
    )!.sql;
    expect(media0).toContain("generate_series(1, 0)");
    expect(media5k).toContain("generate_series(1, 5000)");
  });
});
