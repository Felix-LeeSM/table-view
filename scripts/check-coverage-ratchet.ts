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

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const targetsPath = "scripts/coverage-ratchet-targets.json";

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
    const text = execFileSync("git", ["show", `origin/main:${targetsPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return readTargetsFromText(text);
  } catch {
    return null;
  }
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
const mainById = new Map(
  mainTargets?.entries.map((entry) => [entry.id, entry]),
);
const failures: string[] = [];

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

    const mainValue = mainById.get(entry.id)?.metrics[metricName];
    if (mainValue !== undefined && targetValue < mainValue) {
      failures.push(
        `${label} target=${targetValue} is below origin/main=${mainValue}`,
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
  ? "origin/main comparison enabled"
  : "bootstrap mode: no origin/main targets";
console.log(`Coverage ratchet passed (${mode}).`);
