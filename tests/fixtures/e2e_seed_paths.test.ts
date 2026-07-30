/**
 * `e2e/fixtures/seed-paths.ts` is the smoke suite's seed lookup, and `e2e/**` is
 * outside vitest's `include`, so its contract is asserted from here.
 *
 * Three things are load-bearing:
 * - every declared key resolves to a *tracked* file (`git ls-files`, not
 *   `existsSync` — an untracked local seed passes on this machine and ENOENTs
 *   on a fresh clone);
 * - every seed file on disk is reachable through the map, so a new DBMS cannot
 *   be seeded by a hand-written path that bypasses it;
 * - a missing seed fails with the *key* in the message — `seed-smoke.ts` picks
 *   the key at runtime, so a bare ENOENT names the path but not the caller.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  E2E_SEED_FIXTURE_PATHS,
  readE2eSeedFixture,
} from "../../e2e/fixtures/seed-paths";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const trackedSeeds = new Set(
  execFileSync("git", ["ls-files", "e2e/fixtures"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => /(^|\/)seed[.\w-]*\.(sql|json)$/.test(p)),
);

describe("e2e seed fixture paths", () => {
  it.each(Object.entries(E2E_SEED_FIXTURE_PATHS))(
    "%s resolves to a tracked seed file",
    (_key, path) => {
      expect(trackedSeeds.has(path)).toBe(true);
    },
  );

  it("routes every tracked seed file through the map", () => {
    const mapped = new Set<string>(Object.values(E2E_SEED_FIXTURE_PATHS));
    expect([...trackedSeeds].filter((p) => !mapped.has(p))).toEqual([]);
  });

  it("names the fixture key when the seed is missing", async () => {
    await expect(
      readE2eSeedFixture("postgresql", resolve(repoRoot, "no-such-root")),
    ).rejects.toThrow(/"postgresql" seed fixture not readable/);
  });
});
