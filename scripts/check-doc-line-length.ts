// Doc line-length gate.
//
// `scripts/hooks/check-doc-size.sh` caps a whole file's chars. That misses the
// failure this gate owns: a single markdown table cell holding a paragraph.
// Every baseline violation in the measured set is a table row — no non-table
// line exceeds the ceiling — so "line length" here is in practice "table cell
// length".
//
// Nothing else in this repo measures line length. `markdownlint` is not a
// dependency (no config, no lockfile entry), and MD013 would not substitute
// anyway: it has no notion of grandfathering the rows that already exist, which
// is the whole reason this gate can be turned on without a 205-row rewrite.
//
// # The contract is exact match, not "may only fall"
//
// The baseline in `scripts/doc-line-length-targets.json` must describe the
// working tree exactly: same over-ceiling count, same longest line, same total
// excess, per file. Both directions fail. That is deliberate — a baseline that
// silently disagrees with reality is how a ratchet rots — but it means ANY
// change to a long line requires a baseline update in the same commit.
//
// `--update` does that for you, and it is the only thing that enforces
// direction: it refuses to write a baseline whose repo-wide over-count or total
// excess is higher than the one already committed. So debt can be paid down or
// moved between files, and cannot grow.
//
// Three numbers per file, because each closes a hole the others leave open:
//
//   - `over`   — how many lines exceed the ceiling. Catches new long rows.
//   - `maxLen` — the longest line. Without it, swapping the 6,334-char row in
//                known-limitations.md for a 6,000-char one keeps the count flat.
//   - `excess` — summed chars above the ceiling. Without it, a non-longest long
//                line can grow all the way to `maxLen` with count and max both
//                unchanged.
//
// A file with no entry must have every line at or under the ceiling, so a file
// cleaned up once is permanently protected. An entry whose file is gone must be
// removed.
//
// # Two rejected designs, recorded so they are not re-proposed
//
// 1. A `git diff` rule: any added-or-changed line over the ceiling fails unless
//    it existed verbatim in the base revision. It rejected legitimate work
//    twice — every row a doc split moved, and then a review fix that rewrote one
//    clause inside an already-long grandfathered cell. It also needed a base
//    ref, so a shallow-fetch CI checkout with no merge base would silently skip
//    half the gate.
// 2. A "may only fall" rule with no `--update`: reviewable in principle, but it
//    let a paid-down baseline sit above reality indefinitely, and the earlier
//    draft of this file claimed that property while actually implementing exact
//    match. The claim was wrong in both directions: a pure move failed, and an
//    improvement failed.
//
// Deliberate ceiling: hand-editing the baseline upward passes the gate. Nothing
// here can prevent that without a base ref. What it buys is that the raise shows
// up as an explicit diff in a tracked file, which is the same posture as
// `scripts/coverage-ratchet-targets.json`.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type RatchetEntry = {
  path: string;
  over: number;
  maxLen: number;
  excess: number;
};

type RatchetTargets = {
  version: number;
  ceiling: number;
  entries: RatchetEntry[];
};

export type FileMeasurement = {
  over: number;
  maxLen: number;
  excess: number;
};

const TARGETS_VERSION = 3;

const repoRoot =
  process.env.DOC_LINE_LENGTH_REPO_ROOT ??
  execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
const targetsPath =
  process.env.DOC_LINE_LENGTH_TARGETS_PATH ??
  "scripts/doc-line-length-targets.json";

// Mirrors the prune list in scripts/hooks/check-doc-size.sh. Those trees are
// one-shot artifacts (sprint output, archives, vendored mirror, historical
// explorations) that no agent re-reads, so their line shape is not a cost.
const PRUNED_DIRS = new Set([
  "sprints",
  "archives",
  "table_plus",
  "explorations",
]);

export function isMeasuredDoc(relativePath: string): boolean {
  if (!relativePath.startsWith("docs/")) return false;
  if (!relativePath.endsWith(".md")) return false;
  const [, secondSegment] = relativePath.split("/");
  return secondSegment !== undefined && !PRUNED_DIRS.has(secondSegment);
}

/** Code-point lengths, so Korean prose is not charged UTF-8 bytes. */
export function measure(text: string, ceiling: number): FileMeasurement {
  let over = 0;
  let maxLen = 0;
  let excess = 0;
  for (const line of text.split("\n")) {
    const length = [...line].length;
    if (length > ceiling) {
      over += 1;
      excess += length - ceiling;
    }
    if (length > maxLen) maxLen = length;
  }
  return { over, maxLen, excess };
}

function sumMeasurements(actual: ReadonlyMap<string, FileMeasurement>): {
  over: number;
  excess: number;
} {
  let over = 0;
  let excess = 0;
  for (const measurement of actual.values()) {
    over += measurement.over;
    excess += measurement.excess;
  }
  return { over, excess };
}

function sumEntries(entries: readonly RatchetEntry[]): {
  over: number;
  excess: number;
} {
  let over = 0;
  let excess = 0;
  for (const entry of entries) {
    over += entry.over;
    excess += entry.excess;
  }
  return { over, excess };
}

/**
 * Every way the baseline can disagree with the working tree. The direction of
 * the mismatch only changes the remedy printed, never whether it fails: a
 * baseline that no longer describes reality is broken either way.
 */
export function findMismatches(
  actual: ReadonlyMap<string, FileMeasurement>,
  targets: RatchetTargets,
): string[] {
  const problems: string[] = [];
  const baseline = new Map(targets.entries.map((entry) => [entry.path, entry]));
  const { ceiling } = targets;

  for (const [relativePath, measurement] of actual) {
    const entry = baseline.get(relativePath);

    if (entry === undefined) {
      if (measurement.over > 0) {
        problems.push(
          `${relativePath}: ${measurement.over} line(s) over ${ceiling} chars (longest ${measurement.maxLen}) ` +
            `in a file with no baseline entry. Split the cell into domain-grouped rows; a file cleaned up once stays clean.`,
        );
      }
      continue;
    }

    for (const [field, actualValue, baselineValue] of [
      ["over-ceiling lines", measurement.over, entry.over],
      ["longest line", measurement.maxLen, entry.maxLen],
      ["excess chars", measurement.excess, entry.excess],
    ] as const) {
      if (actualValue === baselineValue) continue;
      problems.push(
        actualValue > baselineValue
          ? `${relativePath}: ${field} rose to ${actualValue}, baseline ${baselineValue}. ` +
              `Split the cell instead of raising the baseline.`
          : `${relativePath}: ${field} fell to ${actualValue}, baseline ${baselineValue}. ` +
              `Record it with \`pnpm docs:lines --update\`.`,
      );
    }
  }

  for (const entry of targets.entries) {
    if (actual.has(entry.path)) continue;
    problems.push(
      `${entry.path}: baseline entry for a file that is no longer measured. ` +
        `Record it with \`pnpm docs:lines --update\`.`,
    );
  }

  return problems;
}

/**
 * The only direction check in the gate. A baseline rewrite may record less debt
 * than before, or the same debt in different files (a doc split moves long rows
 * without authoring any), but never more.
 */
export function findUpdateRefusals(
  actual: ReadonlyMap<string, FileMeasurement>,
  targets: RatchetTargets,
): string[] {
  const next = sumMeasurements(actual);
  const current = sumEntries(targets.entries);
  const refusals: string[] = [];

  if (next.over > current.over) {
    refusals.push(
      `repo over-ceiling lines would rise from ${current.over} to ${next.over}.`,
    );
  }
  if (next.excess > current.excess) {
    refusals.push(
      `repo excess chars would rise from ${current.excess} to ${next.excess}.`,
    );
  }
  return refusals;
}

export function buildTargets(
  actual: ReadonlyMap<string, FileMeasurement>,
  ceiling: number,
): RatchetTargets {
  const entries = [...actual.entries()]
    .filter(([, measurement]) => measurement.over > 0)
    .map(([entryPath, measurement]) => ({
      path: entryPath,
      over: measurement.over,
      maxLen: measurement.maxLen,
      excess: measurement.excess,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { version: TARGETS_VERSION, ceiling, entries };
}

export function parseTargets(raw: unknown): RatchetTargets {
  const parsed = raw as RatchetTargets;
  if (
    parsed?.version !== TARGETS_VERSION ||
    typeof parsed.ceiling !== "number" ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error("doc line-length target file has an unsupported shape");
  }
  // Without this, a single mistyped key (`maxlen` for `maxLen`) reads back as
  // undefined, every comparison against it is false, and that invariant is
  // silently gone.
  for (const entry of parsed.entries) {
    if (
      typeof entry?.path !== "string" ||
      typeof entry.over !== "number" ||
      typeof entry.maxLen !== "number" ||
      typeof entry.excess !== "number"
    ) {
      throw new Error(
        `doc line-length target entry is malformed: ${JSON.stringify(entry)}`,
      );
    }
  }
  return parsed;
}

function readTargets(): RatchetTargets {
  return parseTargets(
    JSON.parse(readFileSync(path.join(repoRoot, targetsPath), "utf8")),
  );
}

function listMeasuredDocs(): string[] {
  return execFileSync("git", ["ls-files", "docs/**/*.md", "docs/*.md"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.length > 0)
    .filter(isMeasuredDoc)
    .sort();
}

function measureRepo(ceiling: number): Map<string, FileMeasurement> {
  const actual = new Map<string, FileMeasurement>();
  for (const relativePath of listMeasuredDocs()) {
    actual.set(
      relativePath,
      measure(readFileSync(path.join(repoRoot, relativePath), "utf8"), ceiling),
    );
  }
  return actual;
}

function main(): void {
  const targets = readTargets();
  const actual = measureRepo(targets.ceiling);

  if (process.argv.includes("--update")) {
    const refusals = findUpdateRefusals(actual, targets);
    if (refusals.length > 0) {
      console.error("doc:lines --update refused: debt may not grow.");
      for (const refusal of refusals) console.error(`- ${refusal}`);
      console.error(
        "Split the offending cell into domain-grouped rows instead.",
      );
      process.exit(1);
    }
    writeFileSync(
      path.join(repoRoot, targetsPath),
      `${JSON.stringify(buildTargets(actual, targets.ceiling), null, 2)}\n`,
    );
    const totals = sumMeasurements(actual);
    console.log(
      `doc:lines baseline written (${totals.over} lines over ${targets.ceiling} chars, ${totals.excess} excess chars)`,
    );
    return;
  }

  const problems = findMismatches(actual, targets);
  if (problems.length > 0) {
    console.error(
      "doc:lines failed — the baseline no longer matches the docs:",
    );
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }

  const totals = sumMeasurements(actual);
  console.log(
    `doc:lines ok (ceiling ${targets.ceiling}, ${actual.size} docs, ${totals.over} grandfathered lines, ${totals.excess} excess chars)`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (import.meta.url === pathToFileURL(invokedPath).href) main();
