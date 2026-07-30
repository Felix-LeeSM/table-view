/**
 * `e2e/support/smoke-data-dir.ts` recursively deletes directory contents, and
 * `e2e/**` is outside vitest's `include`, so its guard is asserted from here.
 *
 * The case that matters is NOT the filesystem root — it is the developer's real
 * app-data store (`~/Library/Application Support/table-view`,
 * src-tauri/src/storage/mod.rs `data_dir_override`). A denylist of roots lets
 * that through, so the guard keys off a marker a previous reset wrote.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertDeletableDataDir,
  resetSmokeDataDir,
} from "../../e2e/support/smoke-data-dir";

const MARKER = ".table-view-smoke-data-dir";
let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(resolve(tmpdir(), "smoke-data-dir-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  delete process.env.TABLE_VIEW_TEST_DATA_DIR;
});

describe("assertDeletableDataDir", () => {
  it("allows an empty directory", () => {
    expect(() => assertDeletableDataDir(scratch, [])).not.toThrow();
  });

  it("allows a directory a previous reset marked", () => {
    expect(() =>
      assertDeletableDataDir(scratch, [MARKER, "connections.json"]),
    ).not.toThrow();
  });

  it("refuses a populated directory with no marker", () => {
    expect(() => assertDeletableDataDir(scratch, ["connections.json"])).toThrow(
      /no \.table-view-smoke-data-dir marker/,
    );
  });
});

describe("resetSmokeDataDir", () => {
  it("returns null and touches nothing when the override is unset", () => {
    expect(resetSmokeDataDir()).toBeNull();
  });

  it("refuses the developer's real store shape instead of emptying it", () => {
    // Same shape as ~/Library/Application Support/table-view: real files, no marker.
    writeFileSync(resolve(scratch, "connections.json"), "[]");
    mkdirSync(resolve(scratch, "prefs"));
    process.env.TABLE_VIEW_TEST_DATA_DIR = scratch;

    expect(() => resetSmokeDataDir()).toThrow(/Refusing to empty/);
    expect(readdirSync(scratch).sort()).toEqual(["connections.json", "prefs"]);
  });

  it("empties a marked directory and keeps the marker", () => {
    writeFileSync(resolve(scratch, MARKER), "");
    writeFileSync(resolve(scratch, "connections.json"), "[]");
    mkdirSync(resolve(scratch, "prefs"));
    process.env.TABLE_VIEW_TEST_DATA_DIR = scratch;

    expect(resetSmokeDataDir()).toBe(scratch);
    expect(readdirSync(scratch)).toEqual([MARKER]);
  });

  it("adopts an empty directory by writing the marker", () => {
    process.env.TABLE_VIEW_TEST_DATA_DIR = scratch;

    expect(resetSmokeDataDir()).toBe(scratch);
    expect(readdirSync(scratch)).toEqual([MARKER]);
  });
});
