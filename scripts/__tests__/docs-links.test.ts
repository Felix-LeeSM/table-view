import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkDocLinks,
  EXCLUDED_SOURCE_DIRS,
  formatIssue,
  isExternalTarget,
  KNOWN_DEAD_LINKS,
  parseLinks,
  SEEDED_FIXTURE_DIR,
} from "../docs-links";

// Purpose: block internal markdown links whose target does not exist — issue
// #2125, rebuilding the gate PR #2033 removed with `scripts/`.
//
// This file is the gate's only runner. `Frontend Tests (shard N/3)` runs
// `vitest run --shard`, `vite.config.ts`'s `test.exclude` does not exclude
// `scripts/`, and `Frontend Checks` turns a red shard into a red required
// check — so a broken link fails the same lane a broken unit test does.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = `${SEEDED_FIXTURE_DIR}/dead-links.md`;

// Every issue seeded into the fixture, in scan order. Line numbers are part of
// the assertion because a checker that reports the wrong line sends a reader to
// the wrong place; editing the fixture means editing this list.
const SEEDED_ISSUES = [
  `${fixture}:11 -> ./no-such-file.md :: missing target ${SEEDED_FIXTURE_DIR}/no-such-file.md`,
  `${fixture}:12 -> ./target.md#no-such-heading :: missing anchor #no-such-heading in ${SEEDED_FIXTURE_DIR}/target.md`,
  `${fixture}:13 -> ./nested#top :: anchor on non-file target ${SEEDED_FIXTURE_DIR}/nested`,
  `${fixture}:14 -> ../../../../outside-the-repo.md :: missing target ../outside-the-repo.md`,
  `${fixture}:15 -> ./no-such-image.png :: missing target ${SEEDED_FIXTURE_DIR}/no-such-image.png`,
  `${fixture}:16 -> ./no-such-page.md :: missing target ${SEEDED_FIXTURE_DIR}/no-such-page.md`,
  `${fixture}:19 -> ./no-such-reference.md :: missing target ${SEEDED_FIXTURE_DIR}/no-such-reference.md`,
];

function scan(options?: Parameters<typeof checkDocLinks>[1]) {
  return checkDocLinks(repoRoot, options);
}

describe("docs internal link gate", () => {
  it("finds no dead internal link in the repository", () => {
    const report = scan();
    expect(report.issues.map(formatIssue)).toEqual([]);
  });

  // Reason: an enumeration that silently returned nothing would make every
  // assertion above pass while checking no file at all. The floors are far
  // below the measured corpus (172 sources / 791 internal links on
  // f9846aaa) so ordinary doc churn never touches them.
  it("scans the whole repository, not an empty set", () => {
    const report = scan();
    expect(report.sources.length).toBeGreaterThan(150);
    expect(report.linksChecked).toBeGreaterThan(500);
    expect(report.sources).toContain("AGENTS.md");
    expect(report.sources).toContain("memory/index/by-surface.md");
    expect(report.sources).toContain(
      "docs/decisions/0044-e2e-smoke-remote-required/memory.md",
    );
  });

  // Reason: a green scan proves nothing about detection — the seeded fixture is
  // what proves the checker still reports each kind of breakage it claims to
  // cover. Remove any branch in `validate` and this assertion goes red.
  it("reports every dead link seeded into the fixture", () => {
    const report = scan({
      excludedDirs: EXCLUDED_SOURCE_DIRS.filter(
        (dir) => dir !== SEEDED_FIXTURE_DIR,
      ),
      allowlist: [],
    });
    const seeded = report.issues
      .filter((issue) => issue.source.startsWith(`${SEEDED_FIXTURE_DIR}/`))
      .map(formatIssue);
    expect(seeded).toEqual(SEEDED_ISSUES);
  });

  // Reason: the other half of the fixture is the links that must NOT be
  // reported — a checker that flags every anchor would also pass the assertion
  // above. Counting the parse keeps a link from going quiet: a regex that stops
  // matching would drop a live control out of the corpus instead of failing.
  it("leaves the fixture's live links, external URLs and code samples alone", () => {
    const links = parseLinks(readFileSync(resolve(repoRoot, fixture), "utf8"));
    const internal = links.filter((link) => !isExternalTarget(link.rawTarget));
    expect(links).toHaveLength(19);
    expect(internal).toHaveLength(16);
    expect(links.map((link) => link.rawTarget)).not.toContain(
      "./no-such-fenced.md",
    );
    expect(links.map((link) => link.rawTarget)).not.toContain(
      "./no-such-inline.md",
    );
    expect(SEEDED_ISSUES).toHaveLength(7);
  });

  // Reason: an exclusion that filters nothing makes the scan look narrower than
  // it is, and the next reader trusts it. Each entry has to earn its line.
  it.each([...EXCLUDED_SOURCE_DIRS])(
    "exclusion %s is what suppresses a real issue",
    (excluded) => {
      const report = scan({
        excludedDirs: EXCLUDED_SOURCE_DIRS.filter((dir) => dir !== excluded),
        allowlist: [],
      });
      const suppressed = report.issues.filter((issue) =>
        issue.source.startsWith(`${excluded}/`),
      );
      expect(suppressed.length).toBeGreaterThan(0);
    },
  );

  // Reason: the allowlist is the one way to be green while a link is dead, so
  // it is pinned to the exact set of issues the scan still finds. A stale entry
  // fails here, and a new dead link cannot be parked here without this diff.
  it("allowlists exactly the dead links the scan still finds", () => {
    const report = scan({ allowlist: [] });
    expect(
      report.issues.map(({ source, target }) => ({ source, target })),
    ).toEqual(
      KNOWN_DEAD_LINKS.map(({ source, target }) => ({ source, target })),
    );
    for (const known of KNOWN_DEAD_LINKS) {
      expect(known.reason).not.toBe("");
    }
  });
});
