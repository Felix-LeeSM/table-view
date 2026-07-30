/**
 * `e2e/fixtures/seed-paths.ts` is the smoke suite's seed registry, and `e2e/**`
 * is outside vitest's `include`, so its contract is asserted from here.
 *
 * What this proves:
 * - every registered key names a file that is both tracked AND readable
 *   (`git ls-files` alone would pass for a file deleted from the working tree);
 * - every tracked seed file under `e2e/fixtures/` is registered, so adding a
 *   DBMS cannot leave its seed out of the list;
 * - `seed-smoke.ts` — the one consumer that is supposed to route through the
 *   registry — holds no literal seed path of its own;
 * - a missing seed fails with the *key* in the message, since `seed-smoke.ts`
 *   picks the key at runtime.
 *
 * What it does NOT prove: the file-DB specs still hold literal paths
 * (e2e/smoke/sqlite.spec.ts, duckdb-fixture.ts, duckdb-schema-filter.spec.ts).
 * Moving one of those seeds breaks them without failing this file.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  E2E_SEED_FIXTURE_PATHS,
  readE2eSeedFixture,
} from "../../e2e/fixtures/seed-paths";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const trackedFixtures = execFileSync("git", ["ls-files", "e2e/fixtures"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter((p) => /\.(sql|json)$/.test(p));

/**
 * Seeds live in the DBMS-first layout `e2e/fixtures/<dbms>/<function>/...`.
 * Matching on a `seed*` basename would let `fixture-seed.sql` or `init.sql`
 * slip past the registry check, so the whole subtree counts.
 */
const trackedSeeds = new Set(
  trackedFixtures.filter((p) => p.split("/").length > 3),
);

/**
 * Files directly under `e2e/fixtures/` predate that layout. Pinning the set
 * means a new root-level file fails here instead of being silently excluded —
 * two are legacy seeds, one is a static matrix product docs read, not a seed.
 */
const ROOT_FIXTURES = [
  "e2e/fixtures/seed.mssql.sql",
  "e2e/fixtures/seed.oracle.sql",
  "e2e/fixtures/valkey.redis-compatibility.json",
];
const ROOT_NON_SEEDS = new Set([
  "e2e/fixtures/valkey.redis-compatibility.json",
]);
for (const p of ROOT_FIXTURES) {
  if (!ROOT_NON_SEEDS.has(p)) trackedSeeds.add(p);
}

describe("e2e seed fixture registry", () => {
  it.each(Object.entries(E2E_SEED_FIXTURE_PATHS))(
    "%s is tracked and readable",
    async (key, path) => {
      expect(trackedSeeds.has(path)).toBe(true);
      await expect(
        readE2eSeedFixture(
          key as keyof typeof E2E_SEED_FIXTURE_PATHS,
          repoRoot,
        ),
      ).resolves.toEqual(expect.any(String));
    },
  );

  it("registers every tracked seed file", () => {
    const registered = new Set<string>(Object.values(E2E_SEED_FIXTURE_PATHS));
    expect([...trackedSeeds].filter((p) => !registered.has(p))).toEqual([]);
  });

  it("pins the pre-layout root fixtures so a new one is not silently skipped", () => {
    expect(
      trackedFixtures.filter((p) => p.split("/").length === 3).sort(),
    ).toEqual([...ROOT_FIXTURES].sort());
  });

  it("keeps seed-smoke.ts free of literal seed paths", () => {
    const source = readFileSync(
      resolve(repoRoot, "e2e/fixtures/seed-smoke.ts"),
      "utf8",
    );
    expect(source.match(/["']e2e\/fixtures\/[^"']+["']/g) ?? []).toEqual([]);
  });

  it("names the fixture key when the seed is missing", async () => {
    await expect(
      readE2eSeedFixture("postgresql", resolve(repoRoot, "no-such-root")),
    ).rejects.toThrow(/"postgresql" seed fixture not readable/);
  });
});
