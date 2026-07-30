/**
 * `e2e/fixtures/seed-paths.ts` is the smoke suite's seed lookup, and `e2e/**` is
 * outside vitest's `include`, so its contract is asserted from here.
 *
 * Two things are load-bearing: every declared key resolves to a file that
 * exists, and a missing one fails with the *key* in the message —
 * `seed-smoke.ts` picks the key at runtime, so a bare ENOENT names the path but
 * not the caller that asked for it.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  E2E_SEED_FIXTURE_PATHS,
  readE2eSeedFixture,
} from "../../e2e/fixtures/seed-paths";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("e2e seed fixture paths", () => {
  it.each(Object.entries(E2E_SEED_FIXTURE_PATHS))(
    "%s resolves to a tracked seed file",
    (_key, path) => {
      expect(existsSync(resolve(repoRoot, path))).toBe(true);
    },
  );

  it("names the fixture key when the seed is missing", async () => {
    await expect(
      readE2eSeedFixture("postgresql", resolve(repoRoot, "no-such-root")),
    ).rejects.toThrow(/"postgresql" seed fixture not readable/);
  });
});
