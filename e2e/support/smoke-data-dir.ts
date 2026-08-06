import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Empty the app-data directory the smoke run gave the Tauri binary via
 * `TABLE_VIEW_TEST_DATA_DIR`, returning the directory that was reset (or
 * `null` when nothing was touched).
 *
 * `wdio.smoke.conf.ts` is the only caller.
 *
 * #1836: the data dir used to be wiped once per *spec file*, but
 * `specFileRetries` re-runs a spec in a new session inside the same wdio
 * process with the same `TABLE_VIEW_TEST_DATA_DIR`. Attempt 2 therefore booted
 * against attempt 1's `connections.json` and died in the `create*Connection`
 * helpers on the app's connection-name uniqueness check
 * ("Connection with name '...' already exists") before reaching the spec body.
 * Resetting at the *session* boundary (`beforeSession`) makes a retry start
 * from the same state a first attempt does, and also clears the other
 * persisted state a retry inherits (workspace prefs, safe-mode flags,
 * collapsed groups, datagrid prefs).
 *
 * Deliberately narrow, because this deletes files:
 * - No override (unset/empty) means the binary uses the store it injects at boot,
 *   `dirs::data_local_dir()/table-view` (src-tauri/table-view-core/src/storage/mod.rs
 *   `init_production_data_dir`) — a developer's real connection store. Wipe
 *   nothing. Only a real binary reaches it; a Rust test injects nothing and
 *   errors instead (#2184).
 * - Only the *contents* of that exact directory are removed. The parent and the
 *   sibling `<dataDir>-fixtures` (e2e/smoke/_helpers.ts `smokeFixtureRoot`,
 *   #1449) hold prepared file-DB fixtures built once per job and must survive.
 * - A missing directory is normal on the first session of a run.
 */
export function resetSmokeDataDir(): string | null {
  const dataDir = process.env.TABLE_VIEW_TEST_DATA_DIR;
  if (!dataDir) return null;

  let entries: string[];
  try {
    entries = readdirSync(dataDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  for (const entry of entries) {
    rmSync(resolve(dataDir, entry), { recursive: true, force: true });
  }
  return dataDir;
}
