import {
  mkdirSync,
  rmSync,
  writeFileSync,
  type MakeDirectoryOptions,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoLegacyE2eSeedFixtures,
  E2E_SEED_FIXTURE_PATHS,
  findLegacyE2eSeedFixtures,
  readE2eSeedFixture,
  resolveE2eSeedFixturePath,
  type E2eSeedFixtureKey,
} from "./e2e-seed-paths.js";

const MOVED_FIXTURE_KEYS = Object.keys(
  E2E_SEED_FIXTURE_PATHS,
) as E2eSeedFixtureKey[];

let tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

describe("E2E seed fixture path resolver", () => {
  it.each(MOVED_FIXTURE_KEYS)(
    "resolves %s to the canonical DBMS/function topology path",
    (key) => {
      expect(resolveE2eSeedFixturePath(key)).toBe(
        E2E_SEED_FIXTURE_PATHS[key].canonical,
      );
    },
  );

  it("keeps the repository free of moved legacy seed paths", () => {
    expect(findLegacyE2eSeedFixtures()).toEqual([]);
    expect(() => assertNoLegacyE2eSeedFixtures()).not.toThrow();
  });

  it("falls back to the legacy path when a dependent branch has not moved yet", async () => {
    const root = tempRoot();
    writeFixture(root, E2E_SEED_FIXTURE_PATHS.postgresql.legacy, "legacy sql");

    expect(resolveE2eSeedFixturePath("postgresql", root)).toBe(
      E2E_SEED_FIXTURE_PATHS.postgresql.legacy,
    );
    await expect(readE2eSeedFixture("postgresql", root)).resolves.toBe(
      "legacy sql",
    );
  });

  it("rejects stale legacy files when canonical and legacy paths both exist", () => {
    const root = tempRoot();
    writeFixture(root, E2E_SEED_FIXTURE_PATHS.mongodb.canonical, "{}");
    writeFixture(root, E2E_SEED_FIXTURE_PATHS.mongodb.legacy, "{}");

    expect(() => resolveE2eSeedFixturePath("mongodb", root)).toThrow(
      /both canonical and legacy seed files/,
    );
  });

  it("reports removal criteria for every temporary legacy fallback", () => {
    for (const paths of Object.values(E2E_SEED_FIXTURE_PATHS)) {
      expect(paths.removalCondition).toContain("#755");
      expect(paths.removalCondition).toContain("milestone #40");
    }
  });
});

function tempRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), "table-view-seed-paths-"));
  tempRoots.push(root);
  return root;
}

function writeFixture(root: string, path: string, contents: string): void {
  mkdirp(dirname(resolve(root, path)));
  writeFileSync(resolve(root, path), contents);
}

function mkdirp(path: string, options: MakeDirectoryOptions = {}): void {
  mkdirSync(path, { ...options, recursive: true });
}
