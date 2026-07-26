// Doc line-length gate: per-line chars in the measured docs, against the
// committed baseline in scripts/doc-line-length-targets.json.
//
// The behavior contract — what each comparison catches, which remedy each
// message names, the rejected designs, the deliberate ceilings — lives in
// docs/quality/doc-size-ratchet.md, and the scenario block on that page is
// `renderContract()` output checked against this file by
// scripts/__tests__/check-doc-line-length.test.ts. Do not restate the contract
// here: a second hand-written copy is what drifted three review rounds running.
//
// What is only true at this file: `runGate` returns the CLI's exact text and
// exit code instead of printing, so the published contract and the shipped
// binary cannot disagree.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type RatchetEntry = {
  path: string;
  over: number;
  maxLen: number;
  excess: number;
};

export type RatchetTargets = {
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

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const targetsPath = "scripts/doc-line-length-targets.json";

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

type RepoTotals = { over: number; excess: number; longest: number };

/**
 * `longest` only counts files that carry debt. A file whose every line is under
 * the ceiling has no over-ceiling line to compare, and charging its longest
 * ordinary line against the baseline would refuse a fully paid-down repo.
 */
function totalDebt(
  rows: Iterable<{ over: number; excess: number; maxLen: number }>,
): RepoTotals {
  let over = 0;
  let excess = 0;
  let longest = 0;
  for (const row of rows) {
    over += row.over;
    excess += row.excess;
    if (row.over > 0 && row.maxLen > longest) longest = row.maxLen;
  }
  return { over, excess, longest };
}

/**
 * Every way the baseline can disagree with the working tree. Both directions
 * fail; the direction only changes the wording.
 *
 * The remedy is decided once per run from the repo totals, never per file. A
 * per-file direction picks the wrong one for a move: the destination "rises"
 * while the repo stays flat, and `--update` accepts that same input.
 */
export function findMismatches(
  actual: ReadonlyMap<string, FileMeasurement>,
  targets: RatchetTargets,
): string[] {
  const problems: string[] = [];
  const baseline = new Map(targets.entries.map((entry) => [entry.path, entry]));
  const { ceiling } = targets;
  const remedy =
    findUpdateRefusals(actual, targets).length > 0
      ? "Split the cell into domain-grouped rows; `pnpm docs:lines --update` refuses while repo debt is higher."
      : "Record it with `pnpm docs:lines --update`.";

  for (const [relativePath, measurement] of actual) {
    const entry = baseline.get(relativePath);

    if (entry === undefined) {
      if (measurement.over > 0) {
        problems.push(
          `${relativePath}: ${measurement.over} line(s) over ${ceiling} chars (longest ${measurement.maxLen}) ` +
            `in a file with no baseline entry. ${remedy}`,
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
      const direction = actualValue > baselineValue ? "rose" : "fell";
      problems.push(
        `${relativePath}: ${field} ${direction} to ${actualValue}, baseline ${baselineValue}. ${remedy}`,
      );
    }
  }

  for (const entry of targets.entries) {
    if (actual.has(entry.path)) continue;
    problems.push(
      `${entry.path}: baseline entry for a file that is no longer measured. ${remedy}`,
    );
  }

  return problems;
}

/**
 * The only direction check in the gate: a baseline rewrite may record less debt
 * than before, or the same debt in different files, but never more. Why all
 * three numbers and not just the two sums is the consolidation scenario in the
 * published contract.
 */
export function findUpdateRefusals(
  actual: ReadonlyMap<string, FileMeasurement>,
  targets: RatchetTargets,
): string[] {
  const next = totalDebt(actual.values());
  const current = totalDebt(targets.entries);
  const refusals: string[] = [];

  for (const [label, nextValue, currentValue] of [
    ["over-ceiling lines", next.over, current.over],
    ["excess chars", next.excess, current.excess],
    ["longest line", next.longest, current.longest],
  ] as const) {
    if (nextValue > currentValue) {
      refusals.push(
        `repo ${label} would rise from ${currentValue} to ${nextValue}.`,
      );
    }
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
  const seen = new Set<string>();
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
    // `findMismatches` keys entries by path and keeps the last one, but
    // `totalDebt` sums every row. A duplicated entry therefore inflates the
    // allowance the direction check compares against without changing any
    // number a reader would look at.
    if (seen.has(entry.path)) {
      throw new Error(
        `doc line-length target file has a duplicate entry: ${entry.path}`,
      );
    }
    seen.add(entry.path);
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

export type GateOutcome = {
  /** Process exit code. */
  code: 0 | 1;
  /** Exactly what the CLI prints — stdout when `code` is 0, stderr otherwise. */
  text: string;
  /** Whether the CLI should rewrite the baseline file. */
  writesBaseline: boolean;
};

/**
 * The whole CLI except the filesystem. Returning the text instead of printing
 * it is what lets `docs/quality/doc-size-ratchet.md` publish real output rather
 * than a hand-written paraphrase of it.
 */
export function runGate(
  actual: ReadonlyMap<string, FileMeasurement>,
  targets: RatchetTargets,
  mode: "check" | "update",
): GateOutcome {
  const totals = totalDebt(actual.values());

  if (mode === "update") {
    const refusals = findUpdateRefusals(actual, targets);
    if (refusals.length > 0) {
      return {
        code: 1,
        writesBaseline: false,
        text: [
          "doc:lines --update refused: debt may not grow.",
          ...refusals.map((refusal) => `- ${refusal}`),
          "Split the offending cell into domain-grouped rows instead.",
        ].join("\n"),
      };
    }
    return {
      code: 0,
      writesBaseline: true,
      text: `doc:lines baseline written (${totals.over} lines over ${targets.ceiling} chars, ${totals.excess} excess chars)`,
    };
  }

  const problems = findMismatches(actual, targets);
  if (problems.length > 0) {
    return {
      code: 1,
      writesBaseline: false,
      text: [
        "doc:lines failed — the baseline no longer matches the docs:",
        ...problems.map((problem) => `- ${problem}`),
      ].join("\n"),
    };
  }

  return {
    code: 0,
    writesBaseline: false,
    text: `doc:lines ok (ceiling ${targets.ceiling}, ${actual.size} docs, ${totals.over} grandfathered lines, ${totals.excess} excess chars)`,
  };
}

function main(): void {
  const targets = readTargets();
  const actual = measureRepo(targets.ceiling);
  const outcome = runGate(
    actual,
    targets,
    process.argv.includes("--update") ? "update" : "check",
  );

  if (outcome.writesBaseline) {
    writeFileSync(
      path.join(repoRoot, targetsPath),
      `${JSON.stringify(buildTargets(actual, targets.ceiling), null, 2)}\n`,
    );
  }
  if (outcome.code === 0) console.log(outcome.text);
  else console.error(outcome.text);
  process.exitCode = outcome.code;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (import.meta.url === pathToFileURL(invokedPath).href) main();
