// Doc line-length gate.
//
// `scripts/hooks/check-doc-size.sh` caps a whole file's chars. That misses the
// failure this gate owns: a single markdown table cell holding a paragraph.
// Every one of the 205 baseline violations is a table row — no non-table line
// in the measured set exceeds the ceiling — so "line length" here is in
// practice "table cell length".
//
// markdownlint MD013 cannot cover this: its default config excludes tables and
// code blocks, which is exactly where the long lines live.
//
// Two rules, because either alone leaves a hole:
//
//   1. Hard ceiling on added/changed lines. A new line over the ceiling fails
//      outright. Without this, swapping a 6,346-char row for a 6,000-char row
//      keeps the count flat and passes.
//   2. Per-file ratchet on the violation count. The baseline is a ceiling that
//      may only fall. Without this, the 205 pre-existing rows would have to be
//      rewritten before the gate could land at all.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

type RatchetEntry = {
  path: string;
  over: number;
};

type RatchetTargets = {
  version: number;
  ceiling: number;
  entries: RatchetEntry[];
};

const repoRoot =
  process.env.DOC_LINE_LENGTH_REPO_ROOT ??
  execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
const targetsPath =
  process.env.DOC_LINE_LENGTH_TARGETS_PATH ??
  "scripts/doc-line-length-targets.json";
const baseRef = process.env.DOC_LINE_LENGTH_BASE_REF ?? "origin/main";

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

export function countOverCeiling(text: string, ceiling: number): number {
  return text.split("\n").filter((line) => [...line].length > ceiling).length;
}

/**
 * Added-or-changed lines from a unified diff. Only `+` body lines count.
 *
 * Callers must exempt lines that already exist verbatim in the base revision:
 * splitting a large doc moves long rows into new files, and treating a move as
 * new authorship would make this gate block the very refactor it exists to
 * encourage.
 */
export function addedLinesByFile(
  diff: string,
): Map<string, { line: string; index: number }[]> {
  const byFile = new Map<string, { line: string; index: number }[]>();
  let current: string | null = null;
  let addedCount = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      current = target === "/dev/null" ? null : target.replace(/^b\//, "");
      addedCount = 0;
      continue;
    }
    if (raw.startsWith("@@")) {
      addedCount = 0;
      continue;
    }
    if (current === null) continue;
    if (raw.startsWith("+")) {
      addedCount += 1;
      const list = byFile.get(current) ?? [];
      list.push({ line: raw.slice(1), index: addedCount });
      byFile.set(current, list);
    }
  }
  return byFile;
}

function readTargets(): RatchetTargets {
  const parsed = JSON.parse(
    readFileSync(path.join(repoRoot, targetsPath), "utf8"),
  ) as RatchetTargets;
  if (
    parsed.version !== 1 ||
    typeof parsed.ceiling !== "number" ||
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

function readDiff(): string {
  try {
    // Two-dot, not three-dot: CI fetches the base with `--depth=1`, which has no
    // merge base for `A...B` to resolve. Two-dot compares the trees directly,
    // which is also the semantic this gate wants — "does this branch introduce a
    // long line relative to the current main tip".
    return execFileSync(
      "git",
      ["diff", "--unified=0", baseRef, "HEAD", "--", "docs"],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    // A missing base ref must not silently disable the hard-ceiling rule in CI.
    if (process.env.DOC_LINE_LENGTH_REQUIRE_BASE === "1") {
      console.error("doc:lines failed:");
      console.error(
        `- ${baseRef} is unavailable; fetch it before running the gate`,
      );
      process.exit(1);
    }
    console.warn(
      `doc:lines — ${baseRef} unavailable, skipping the added-line ceiling rule`,
    );
    return "";
  }
}

/**
 * The hard-ceiling rule. Split out from `main` so the move-exemption semantics
 * are testable without a git fixture.
 *
 * A line fails only when it is over the ceiling AND does not already exist
 * verbatim in the base revision. That exemption is what lets a doc split move
 * long rows into new files; the per-file ratchet still holds the total down.
 */
export function findHardCeilingFailures(
  addedByFile: Map<string, { line: string; index: number }[]>,
  ceiling: number,
  preexisting: ReadonlySet<string>,
): string[] {
  const failures: string[] = [];
  for (const [relativePath, lines] of addedByFile) {
    if (!isMeasuredDoc(relativePath)) continue;
    for (const { line, index } of lines) {
      const length = [...line].length;
      if (length <= ceiling) continue;
      if (preexisting.has(line)) continue;
      failures.push(
        `${relativePath}: added line ${index} is ${length} chars, over the ${ceiling} hard ceiling. ` +
          `Split the cell into domain-grouped rows rather than raising the target.`,
      );
    }
  }
  return failures;
}

/**
 * Every over-ceiling line present in the base revision's measured docs, keyed by
 * exact text. Used to tell a file move apart from new authorship.
 */
function readBaseLongLines(ceiling: number): Set<string> {
  const lines = new Set<string>();
  let listing: string;
  try {
    listing = execFileSync("git", ["ls-tree", "-r", "--name-only", baseRef], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return lines;
  }
  for (const relativePath of listing.split("\n")) {
    if (!isMeasuredDoc(relativePath)) continue;
    let text: string;
    try {
      text = execFileSync("git", ["show", `${baseRef}:${relativePath}`], {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if ([...line].length > ceiling) lines.add(line);
    }
  }
  return lines;
}

function main(): void {
  const targets = readTargets();
  const { ceiling } = targets;
  const baseline = new Map(targets.entries.map((e) => [e.path, e.over]));
  const failures: string[] = [];
  const stale: string[] = [];

  // Rule 2 — per-file ratchet.
  const measured = listMeasuredDocs();
  const actual = new Map<string, number>();
  for (const relativePath of measured) {
    const over = countOverCeiling(
      readFileSync(path.join(repoRoot, relativePath), "utf8"),
      ceiling,
    );
    if (over > 0) actual.set(relativePath, over);
    const allowed = baseline.get(relativePath) ?? 0;
    if (over > allowed) {
      failures.push(
        `${relativePath}: ${over} lines over ${ceiling} chars, allowed ${allowed}. ` +
          `Split the table cell; do not raise the target.`,
      );
    }
  }
  for (const [relativePath, allowed] of baseline) {
    const over = actual.get(relativePath) ?? 0;
    if (over < allowed) {
      stale.push(
        `${relativePath}: target ${allowed} but only ${over} remain — lower the target to ${over}.`,
      );
    }
  }

  // Rule 1 — hard ceiling on newly authored lines.
  failures.push(
    ...findHardCeilingFailures(
      addedLinesByFile(readDiff()),
      ceiling,
      readBaseLongLines(ceiling),
    ),
  );

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

  const total = [...actual.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `doc:lines ok (ceiling ${ceiling}, ${measured.length} docs, ${total} grandfathered lines)`,
  );
}

if (process.env.DOC_LINE_LENGTH_SKIP_MAIN !== "1") {
  main();
}
