// Doc line-length gate.
//
// `scripts/hooks/check-doc-size.sh` caps a whole file's chars. That misses the
// failure this gate owns: a single markdown table cell holding a paragraph.
// Every baseline violation in the measured set is a table row — no non-table
// line exceeds the ceiling — so "line length" here is in practice "table cell
// length".
//
// markdownlint MD013 cannot cover this: its default config excludes tables and
// code blocks, which is exactly where the long lines live.
//
// Two invariants, both compared against the committed baseline in
// `scripts/doc-line-length-targets.json` — the same shape as the coverage
// ratchet. Adding debt therefore requires editing a tracked file, and that edit
// is what fails:
//
//   1. Total over-ceiling lines may only fall. This is what catches new long
//      content, and it stays quiet for pure moves: splitting a doc relocates
//      long rows into new files without changing the total.
//   2. Per-file longest line may only fall, and a file with no baseline entry
//      must have every line at or under the ceiling. Without the max rule,
//      swapping a 6,346-char row for a 6,000-char row keeps the total flat and
//      passes. The no-entry half means a file cleaned up once is permanently
//      protected, which is the actual incentive the ratchet exists to create.
//
// An earlier draft gated on `git diff` instead: any added-or-changed line over
// the ceiling failed unless it existed verbatim in the base revision. That
// rejected legitimate work twice — first every row a doc split moved, then a
// review fix that rewrote one clause inside an already-long grandfathered cell.
// Editing a long cell is not the failure mode; growing or multiplying long cells
// is, and the baseline comparison expresses exactly that.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

type RatchetEntry = {
  path: string;
  over: number;
  maxLen: number;
};

type RatchetTargets = {
  version: number;
  ceiling: number;
  total: number;
  entries: RatchetEntry[];
};

export type FileMeasurement = {
  over: number;
  maxLen: number;
};

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
  for (const line of text.split("\n")) {
    const length = [...line].length;
    if (length > ceiling) over += 1;
    if (length > maxLen) maxLen = length;
  }
  return { over, maxLen };
}

export function findRatchetFailures(
  actual: ReadonlyMap<string, FileMeasurement>,
  targets: RatchetTargets,
): string[] {
  const failures: string[] = [];
  const baseline = new Map(targets.entries.map((e) => [e.path, e]));
  const { ceiling } = targets;

  let total = 0;
  for (const [relativePath, measurement] of actual) {
    total += measurement.over;
    const entry = baseline.get(relativePath);

    if (entry === undefined) {
      if (measurement.over > 0) {
        failures.push(
          `${relativePath}: ${measurement.over} line(s) over ${ceiling} chars in a file with no ratchet entry ` +
            `(longest ${measurement.maxLen}). Split the cell into domain-grouped rows.`,
        );
      }
      continue;
    }

    if (measurement.over > entry.over) {
      failures.push(
        `${relativePath}: ${measurement.over} lines over ${ceiling} chars, baseline allows ${entry.over}. ` +
          `Split the cell instead of raising the target.`,
      );
    }
    if (measurement.maxLen > entry.maxLen) {
      failures.push(
        `${relativePath}: longest line grew to ${measurement.maxLen} chars, baseline ${entry.maxLen}. ` +
          `A long cell may be edited but not lengthened.`,
      );
    }
  }

  if (total > targets.total) {
    failures.push(
      `repo total: ${total} lines over ${ceiling} chars, baseline ${targets.total}. ` +
        `Net new long lines are not accepted; a pure move keeps this total flat.`,
    );
  }

  return failures;
}

export function findStaleTargets(
  actual: ReadonlyMap<string, FileMeasurement>,
  targets: RatchetTargets,
): string[] {
  const stale: string[] = [];
  let total = 0;
  for (const measurement of actual.values()) total += measurement.over;

  for (const entry of targets.entries) {
    const measurement = actual.get(entry.path);
    if (measurement === undefined) {
      stale.push(
        `${entry.path}: baseline entry for a file that no longer exists — remove it.`,
      );
      continue;
    }
    if (measurement.over < entry.over) {
      stale.push(
        `${entry.path}: baseline ${entry.over} but only ${measurement.over} remain — lower it to ${measurement.over}.`,
      );
    }
    if (measurement.maxLen < entry.maxLen) {
      stale.push(
        `${entry.path}: baseline longest ${entry.maxLen} but actual is ${measurement.maxLen} — lower it.`,
      );
    }
  }

  if (total < targets.total) {
    stale.push(
      `repo total: baseline ${targets.total} but only ${total} remain — lower it to ${total}.`,
    );
  }

  return stale;
}

function readTargets(): RatchetTargets {
  const parsed = JSON.parse(
    readFileSync(path.join(repoRoot, targetsPath), "utf8"),
  ) as RatchetTargets;
  if (
    parsed.version !== 2 ||
    typeof parsed.ceiling !== "number" ||
    typeof parsed.total !== "number" ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error("doc line-length target file has an unsupported shape");
  }
  return parsed;
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

function main(): void {
  const targets = readTargets();
  const measured = listMeasuredDocs();
  const actual = new Map<string, FileMeasurement>();
  for (const relativePath of measured) {
    actual.set(
      relativePath,
      measure(
        readFileSync(path.join(repoRoot, relativePath), "utf8"),
        targets.ceiling,
      ),
    );
  }

  const failures = findRatchetFailures(actual, targets);
  const stale = findStaleTargets(actual, targets);

  if (stale.length > 0) {
    console.error("doc:lines ratchet has stale targets:");
    for (const message of stale) console.error(`- ${message}`);
  }
  if (failures.length > 0) {
    console.error("doc:lines failed:");
    for (const message of failures) console.error(`- ${message}`);
  }
  if (failures.length > 0 || stale.length > 0) {
    process.exit(1);
  }

  let total = 0;
  for (const measurement of actual.values()) total += measurement.over;
  console.log(
    `doc:lines ok (ceiling ${targets.ceiling}, ${measured.length} docs, ${total} grandfathered lines)`,
  );
}

if (process.env.DOC_LINE_LENGTH_SKIP_MAIN !== "1") {
  main();
}
