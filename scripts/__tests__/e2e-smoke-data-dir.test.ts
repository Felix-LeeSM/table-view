import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSmokeDataDir } from "../e2e-smoke-data-dir.js";

// Purpose: smoke retry state reset — issue #1836 (2026-07-26).
// `specFileRetries: 1` re-runs a spec in a new session but keeps the same
// `TABLE_VIEW_TEST_DATA_DIR`, so attempt 2 booted against attempt 1's
// connections.json and always died in `create*Connection` with
// "Connection with name '...' already exists". The reset runs from
// `beforeSession` in wdio.smoke.conf.ts, which is destructive, so both the
// wipe and every no-wipe guard are pinned here.
describe("resetSmokeDataDir", () => {
  let sandbox: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    sandbox = mkdtempSync(resolve(tmpdir(), "smoke-data-dir-"));
    originalDataDir = process.env.TABLE_VIEW_TEST_DATA_DIR;
  });

  afterEach(() => {
    if (originalDataDir === undefined)
      delete process.env.TABLE_VIEW_TEST_DATA_DIR;
    else process.env.TABLE_VIEW_TEST_DATA_DIR = originalDataDir;
    rmSync(sandbox, { recursive: true, force: true });
  });

  // Reason: #1836 — a retry inherited attempt 1's persisted connections, so the
  // save dialog raised the uniqueness validation error before the spec started.
  it("empties the directory named by TABLE_VIEW_TEST_DATA_DIR", () => {
    const dataDir = resolve(sandbox, "redis-key-detail-panel");
    mkdirSync(resolve(dataDir, "prefs"), { recursive: true });
    writeFileSync(
      resolve(dataDir, "connections.json"),
      '{"connections":[{"name":"E2E Redis Detail"}],"groups":[]}',
    );
    writeFileSync(resolve(dataDir, "prefs", "datagrid.json"), "{}");
    process.env.TABLE_VIEW_TEST_DATA_DIR = dataDir;

    expect(resetSmokeDataDir()).toBe(dataDir);

    expect(existsSync(dataDir)).toBe(true);
    expect(readdirSync(dataDir)).toEqual([]);
  });

  // Reason: #1449/#1836 — SQLite/DuckDB fixtures live in the sibling
  // `<dataDir>-fixtures` dir (scripts/fixtures/paths.ts, e2e/smoke/_helpers.ts)
  // and are prepared once per job; wiping them would break file-DB specs.
  it("leaves the sibling -fixtures directory and the parent untouched", () => {
    const dataDir = resolve(sandbox, "sqlite");
    const fixturesDir = resolve(sandbox, "sqlite-fixtures", "sqlite");
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(resolve(dataDir, "connections.json"), "{}");
    writeFileSync(resolve(fixturesDir, "table_view_e2e.sqlite"), "fixture");
    writeFileSync(resolve(sandbox, "sibling-spec-marker"), "keep");
    process.env.TABLE_VIEW_TEST_DATA_DIR = dataDir;

    resetSmokeDataDir();

    expect(existsSync(resolve(fixturesDir, "table_view_e2e.sqlite"))).toBe(
      true,
    );
    expect(existsSync(resolve(sandbox, "sibling-spec-marker"))).toBe(true);
    expect(readdirSync(dataDir)).toEqual([]);
  });

  // Reason: #1836 — with no override the Rust side falls back to
  // `dirs::data_local_dir()/table-view` (src-tauri/src/storage/mod.rs), a real
  // developer connection store. A bare `wdio run wdio.smoke.conf.ts` must not
  // delete anything.
  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("deletes nothing when TABLE_VIEW_TEST_DATA_DIR is %s", (_label, value) => {
    writeFileSync(resolve(sandbox, "connections.json"), "real user data");
    if (value === undefined) delete process.env.TABLE_VIEW_TEST_DATA_DIR;
    else process.env.TABLE_VIEW_TEST_DATA_DIR = value;

    expect(resetSmokeDataDir()).toBeNull();

    expect(existsSync(resolve(sandbox, "connections.json"))).toBe(true);
  });

  // Reason: #1836 — the first session of a run starts before the app has
  // written anything, so a missing directory is normal, not an error.
  it("tolerates a data dir that does not exist yet", () => {
    const dataDir = resolve(sandbox, "never-created");
    process.env.TABLE_VIEW_TEST_DATA_DIR = dataDir;

    expect(() => resetSmokeDataDir()).not.toThrow();
    expect(existsSync(dataDir)).toBe(false);
  });
});
