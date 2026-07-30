import { readdirSync, rmSync, writeFileSync } from "node:fs";
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
 * - No override (unset/empty) means the binary falls back to
 *   `dirs::data_local_dir()/table-view` (src-tauri/src/storage/mod.rs
 *   `data_dir_override`) — a developer's real connection store. Wipe nothing.
 * - Only the *contents* of that exact directory are removed. The parent and the
 *   sibling `<dataDir>-fixtures` (e2e/smoke/_helpers.ts `smokeFixtureRoot`,
 *   #1449) hold prepared file-DB fixtures built once per job and must survive.
 * - A missing directory is normal on the first session of a run.
 * - The value is typed by hand now that no script exports it (README 「E2E
 *   Smoke」), so a typo or an unexpanded `${VAR}` can point it at a real
 *   directory. Refusing a denylist of roots does not cover that: the directory
 *   a slip most plausibly lands on is the real store itself
 *   (`~/Library/Application Support/table-view`), which is not a root of
 *   anything. So an existing non-empty directory is emptied only if it carries
 *   the marker a previous reset wrote. Anything else — the real store, a home
 *   subdirectory, a source tree — throws untouched.
 */
const MARKER = ".table-view-smoke-data-dir";

/**
 * Throws unless `dataDir` is safe to empty. Safe means: it does not exist yet,
 * it is empty, or a previous `resetSmokeDataDir` left its marker there.
 */
export function assertDeletableDataDir(
  dataDir: string,
  entries: string[],
): void {
  if (entries.length === 0 || entries.includes(MARKER)) return;
  throw new Error(
    `Refusing to empty "${dataDir}": it has ${entries.length} entries and no ` +
      `${MARKER} marker, so it was not created by a smoke run. Point ` +
      `TABLE_VIEW_TEST_DATA_DIR at a throwaway directory.`,
  );
}

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

  assertDeletableDataDir(dataDir, entries);

  for (const entry of entries) {
    if (entry === MARKER) continue;
    rmSync(resolve(dataDir, entry), { recursive: true, force: true });
  }
  writeFileSync(resolve(dataDir, MARKER), "");
  return dataDir;
}
