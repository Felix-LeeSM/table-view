import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

type MetricName = "lines" | "functions" | "branches" | "regions";
type Metrics = Partial<Record<MetricName, number>>;

type RatchetEntry = {
  id: string;
  source: string;
  metrics: Metrics;
};

type RatchetTargets = {
  version: number;
  entries: RatchetEntry[];
};

const repoRoot =
  process.env.COVERAGE_RATCHET_REPO_ROOT ??
  execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
const targetsPath =
  process.env.COVERAGE_RATCHET_TARGETS_PATH ??
  "scripts/coverage-ratchet-targets.json";
const mainRef = process.env.COVERAGE_RATCHET_MAIN_REF ?? "origin/main";

function readText(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readTargetsFromText(text: string): RatchetTargets {
  const parsed = JSON.parse(text) as RatchetTargets;
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("coverage ratchet target file has an unsupported shape");
  }
  return parsed;
}

function readMainTargets(): RatchetTargets | null {
  try {
    const text = execFileSync("git", ["show", `${mainRef}:${targetsPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return readTargetsFromText(text);
  } catch {
    return null;
  }
}

function entriesById(targets: RatchetTargets, label: string) {
  const entries = new Map<string, RatchetEntry>();
  for (const entry of targets.entries) {
    if (entries.has(entry.id)) {
      throw new Error(`duplicate ${label} coverage ratchet entry: ${entry.id}`);
    }
    entries.set(entry.id, entry);
  }
  return entries;
}

function extractNumber(block: string, metric: MetricName): number {
  const match = new RegExp(`${metric}:\\s*(\\d+)`).exec(block);
  if (!match) {
    throw new Error(`missing ${metric} threshold`);
  }
  return Number(match[1]);
}

function extractVitestThresholds(): Metrics {
  const source = readText("vite.config.ts");
  const match = /thresholds:\s*\{([\s\S]*?)\n\s*\}/m.exec(source);
  if (!match) {
    throw new Error("missing Vitest coverage thresholds");
  }
  const block = match[1];
  return {
    lines: extractNumber(block, "lines"),
    functions: extractNumber(block, "functions"),
    branches: extractNumber(block, "branches"),
  };
}

function extractFlag(block: string, name: MetricName): number {
  const match = new RegExp(`--fail-under-${name}\\s+(\\d+)`).exec(block);
  if (!match) {
    throw new Error(`missing --fail-under-${name}`);
  }
  return Number(match[1]);
}

function extractPreCommitRustThresholds(): Metrics {
  const source = readText("lefthook.yml");
  const match = /cargo llvm-cov --lib --summary-only([\s\S]*?)\n\s*glob:/m.exec(
    source,
  );
  if (!match) {
    throw new Error("missing pre-commit Rust coverage thresholds");
  }
  const block = match[1];
  return {
    lines: extractFlag(block, "lines"),
    functions: extractFlag(block, "functions"),
    regions: extractFlag(block, "regions"),
  };
}

function extractPrePushRustThresholds(): Metrics {
  const source = readText("scripts/hooks/pre-push-path-router.sh");
  const match =
    /cargo llvm-cov nextest --profile push[\s\S]*?--fail-under-lines\s+(\d+)[\s\S]*?--fail-under-functions\s+(\d+)[\s\S]*?--fail-under-regions\s+(\d+)/m.exec(
      source,
    );
  if (!match) {
    throw new Error("missing pre-push Rust coverage thresholds");
  }
  return {
    lines: Number(match[1]),
    functions: Number(match[2]),
    regions: Number(match[3]),
  };
}

function actualMetricsFor(id: string): Metrics {
  switch (id) {
    case "frontend.vitest.global":
      return extractVitestThresholds();
    case "rust.pre_commit.tier1":
      return extractPreCommitRustThresholds();
    case "rust.pre_push.integration":
      return extractPrePushRustThresholds();
    default:
      throw new Error(`unknown ratchet entry: ${id}`);
  }
}

const targets = readTargetsFromText(readText(targetsPath));
const mainTargets = readMainTargets();
const targetsById = entriesById(targets, "current");
const mainById = mainTargets
  ? entriesById(mainTargets, mainRef)
  : new Map<string, RatchetEntry>();
const failures: string[] = [];

for (const mainEntry of mainById.values()) {
  const currentEntry = targetsById.get(mainEntry.id);
  if (!currentEntry) {
    failures.push(
      `${mainEntry.id} target is missing from ${targetsPath}; ${mainRef} has this entry`,
    );
    continue;
  }

  for (const [metric, mainValue] of Object.entries(mainEntry.metrics)) {
    const currentValue = currentEntry.metrics[metric as MetricName];
    const label = `${mainEntry.id}.${metric}`;
    if (currentValue === undefined) {
      failures.push(
        `${label} target is missing from ${targetsPath}; ${mainRef}=${mainValue}`,
      );
    } else if (currentValue < mainValue) {
      failures.push(
        `${label} target=${currentValue} is below ${mainRef}=${mainValue}`,
      );
    }
  }
}

for (const entry of targets.entries) {
  const actual = actualMetricsFor(entry.id);
  for (const [metric, targetValue] of Object.entries(entry.metrics)) {
    const metricName = metric as MetricName;
    const actualValue = actual[metricName];
    const label = `${entry.id}.${metric}`;

    if (actualValue !== targetValue) {
      failures.push(
        `${label} target=${targetValue} actual=${actualValue ?? "missing"} source=${entry.source}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Coverage ratchet failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

const mode = mainTargets
  ? `${mainRef} comparison enabled`
  : `bootstrap mode: no ${mainRef} targets`;
console.log(`Coverage ratchet passed (${mode}).`);
