import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyDuckdb, duckdbEnvPath, ensureDuckdbDatabase } from "./duckdb.js";
import { generateAll } from "./generator.js";
import { loadSpec } from "./spec.js";

let tempDir: string;
let originalTableViewDataDir: string | undefined;
let originalDuckdbFixtureDir: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), "fixture-duckdb-"));
  originalTableViewDataDir = process.env.TABLE_VIEW_TEST_DATA_DIR;
  originalDuckdbFixtureDir = process.env.DUCKDB_FIXTURE_DIR;
});

afterEach(() => {
  restoreEnv("TABLE_VIEW_TEST_DATA_DIR", originalTableViewDataDir);
  restoreEnv("DUCKDB_FIXTURE_DIR", originalDuckdbFixtureDir);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("duckdb fixture file lifecycle", () => {
  it("defaults fixture files to the primary worktree tmp directory", () => {
    delete process.env.TABLE_VIEW_TEST_DATA_DIR;
    delete process.env.DUCKDB_FIXTURE_DIR;

    const path = duckdbEnvPath();

    expect(path.directory).toBe(
      resolve(primaryWorktreeRootForTest(), "tmp", "fixtures", "duckdb"),
    );
    expect(path.directory).not.toBe(
      resolve(tmpdir(), "table-view-fixtures", "duckdb"),
    );
    expect(path.directory).not.toContain("Application Support");
  });

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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function primaryWorktreeRootForTest(): string {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return (
    output
      .split(/\r?\n/)
      .find((line) => line.startsWith("worktree "))
      ?.slice("worktree ".length)
      .trim() ?? process.cwd()
  );
}
