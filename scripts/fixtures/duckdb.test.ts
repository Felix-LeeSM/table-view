import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyDuckdb, ensureDuckdbDatabase } from "./duckdb.js";
import { generateAll } from "./generator.js";
import { loadSpec } from "./spec.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), "fixture-duckdb-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("duckdb fixture file lifecycle", () => {
  it("creates a database using the supported duckdb Database API", async () => {
    await ensureDuckdbDatabase(
      { directory: tempDir, fileName: "" },
      "fixture.duckdb",
    );

    expect(existsSync(resolve(tempDir, "fixture.duckdb"))).toBe(true);
  });

  it("applies the e2e profile without ALTER TABLE foreign-key migrations", async () => {
    const spec = loadSpec("e2e");

    await applyDuckdb(
      { directory: tempDir, fileName: "" },
      "fixture.duckdb",
      spec,
      generateAll(spec),
      () => {},
    );

    expect(existsSync(resolve(tempDir, "fixture.duckdb"))).toBe(true);
  });
});
