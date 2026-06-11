import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

export const SMOKE_ROUTING_DECISIONS_PATH =
  "e2e/fixtures/smoke-routing-decisions.json";

const ALLOWED_TIERS = [
  "unit-only",
  "integration-backed",
  "dormant E2E",
  "blocking E2E",
] as const;

type SmokeTier = (typeof ALLOWED_TIERS)[number];

type SmokeRoutingSources = {
  readonly smokeScript: string;
  readonly workflow: string;
  readonly seedScript: string;
};

export type SmokeRoutingDecision = {
  readonly id: string;
  readonly fixture: string;
  readonly specs: readonly string[];
  readonly specKeys: readonly string[];
  readonly seedTargets: readonly string[];
  readonly tier: SmokeTier;
  readonly wiredInSmokeScript: boolean;
  readonly runtimeCost: string;
  readonly flakeRisk: string;
  readonly cacheImpact: string;
  readonly failureArtifacts: string;
  readonly supportClaimImpact: string;
  readonly action: string;
};

type SmokeRoutingDecisionFile = {
  readonly $schema: "smoke-routing-decisions@1";
  readonly issue: 753;
  readonly routingSources: SmokeRoutingSources;
  readonly allowedTiers: readonly SmokeTier[];
  readonly rows: readonly SmokeRoutingDecision[];
};

export type SmokeMatrixEntry = {
  readonly specKey: string;
  readonly spec: string;
};

export type SmokeRoutingValidationResult = {
  readonly decisions: SmokeRoutingDecisionFile;
  readonly smokeScriptMatrix: readonly SmokeMatrixEntry[];
  readonly workflowMatrix: readonly SmokeMatrixEntry[];
  readonly blockingDecisionMatrix: readonly SmokeMatrixEntry[];
  readonly errors: readonly string[];
};

const allowedTierSet: ReadonlySet<string> = new Set(ALLOWED_TIERS);

export function loadSmokeRoutingDecisions(
  cwd = process.cwd(),
): SmokeRoutingDecisionFile {
  return JSON.parse(
    readFileSync(resolve(cwd, SMOKE_ROUTING_DECISIONS_PATH), "utf8"),
  ) as SmokeRoutingDecisionFile;
}

export function collectSmokeScriptMatrix(
  cwd = process.cwd(),
  scriptPath = "scripts/e2e-smoke-ci.sh",
): SmokeMatrixEntry[] {
  const source = readFileSync(resolve(cwd, scriptPath), "utf8");
  const matrix: SmokeMatrixEntry[] = [];
  const pattern =
    /run_wdio "\$BASE_DATA_DIR\/([^"]+)" "(e2e\/smoke\/[^"]+\.spec\.ts)"/g;

  for (const match of source.matchAll(pattern)) {
    const specKey = match[1];
    const spec = match[2];
    if (!specKey || !spec) continue;
    matrix.push({ specKey, spec });
  }

  return sortMatrix(matrix);
}

export function collectWorkflowMatrix(
  cwd = process.cwd(),
  workflowPath = ".github/workflows/e2e-smoke.yml",
): SmokeMatrixEntry[] {
  const workflow = parseYaml(
    readFileSync(resolve(cwd, workflowPath), "utf8"),
  ) as unknown;
  return sortMatrix([
    ...collectWorkflowJobMatrix(workflow, "e2e-smoke"),
    ...collectWorkflowJobMatrix(workflow, "e2e-smoke-file-backed"),
  ]);
}

export function validateSmokeRoutingDecisions(
  cwd = process.cwd(),
): SmokeRoutingValidationResult {
  const decisions = loadSmokeRoutingDecisions(cwd);
  const smokeScriptMatrix = collectSmokeScriptMatrix(
    cwd,
    decisions.routingSources.smokeScript,
  );
  const workflowMatrix = collectWorkflowMatrix(
    cwd,
    decisions.routingSources.workflow,
  );
  const seedSource = readFileSync(
    resolve(cwd, decisions.routingSources.seedScript),
    "utf8",
  );
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const nonBlockingSpecKeys = new Set<string>();
  const blockingDecisionMatrix = sortMatrix(
    decisions.rows.flatMap((row) => decisionRowMatrix(row, errors)),
  );

  check(
    decisions.$schema === "smoke-routing-decisions@1",
    "decision table schema must be smoke-routing-decisions@1",
    errors,
  );
  check(
    decisions.issue === 753,
    "decision table must belong to issue #753",
    errors,
  );
  check(
    sameValues(decisions.allowedTiers, ALLOWED_TIERS),
    "decision table allowedTiers must match the issue #753 tier contract",
    errors,
  );

  for (const row of decisions.rows) {
    check(!seenIds.has(row.id), `duplicate decision row id: ${row.id}`, errors);
    seenIds.add(row.id);
    check(row.id.length > 0, "decision row id must not be empty", errors);
    check(
      existsSync(resolve(cwd, row.fixture)),
      `${row.id}: fixture path missing: ${row.fixture}`,
      errors,
    );
    check(
      allowedTierSet.has(row.tier),
      `${row.id}: unsupported tier ${row.tier}`,
      errors,
    );
    check(
      row.runtimeCost.length > 0 &&
        row.flakeRisk.length > 0 &&
        row.cacheImpact.length > 0 &&
        row.failureArtifacts.length > 0 &&
        row.supportClaimImpact.length > 0 &&
        row.action.length > 0,
      `${row.id}: cost/risk/artifact/support/action fields are required`,
      errors,
    );

    for (const spec of row.specs) {
      check(
        existsSync(resolve(cwd, spec)),
        `${row.id}: spec/test path missing: ${spec}`,
        errors,
      );
    }

    if (row.tier === "blocking E2E") {
      check(
        row.wiredInSmokeScript,
        `${row.id}: blocking E2E row must be wired in the smoke script`,
        errors,
      );
      check(
        row.specKeys.length === row.specs.length,
        `${row.id}: blocking E2E row must map every spec to a specKey`,
        errors,
      );
      for (const [index, specKey] of row.specKeys.entries()) {
        const spec = row.specs[index];
        check(
          spec === `e2e/smoke/${specKey}.spec.ts`,
          `${row.id}: specKey/path mismatch ${specKey} -> ${spec}`,
          errors,
        );
        checkSeedTargetMapping(seedSource, specKey, row.seedTargets, errors);
      }
    } else {
      check(
        !row.wiredInSmokeScript,
        `${row.id}: non-blocking row must not be marked smoke-wired`,
        errors,
      );
      for (const specKey of row.specKeys) {
        nonBlockingSpecKeys.add(specKey);
      }
    }
  }

  checkUniqueMatrix("smoke script", smokeScriptMatrix, errors);
  checkUniqueMatrix("workflow", workflowMatrix, errors);
  checkUniqueMatrix("decision table", blockingDecisionMatrix, errors);
  checkSameMatrix(
    "smoke script",
    smokeScriptMatrix,
    "workflow",
    workflowMatrix,
    errors,
  );
  checkSameMatrix(
    "decision table",
    blockingDecisionMatrix,
    "smoke script",
    smokeScriptMatrix,
    errors,
  );

  for (const specKey of nonBlockingSpecKeys) {
    check(
      !smokeScriptMatrix.some((entry) => entry.specKey === specKey),
      `non-blocking specKey is wired in smoke script: ${specKey}`,
      errors,
    );
  }

  return {
    decisions,
    smokeScriptMatrix,
    workflowMatrix,
    blockingDecisionMatrix,
    errors,
  };
}

function collectWorkflowJobMatrix(
  workflow: unknown,
  jobName: string,
): SmokeMatrixEntry[] {
  const jobs = asRecord(asRecord(workflow, "workflow").jobs, "workflow.jobs");
  const job = asRecord(jobs[jobName], `workflow.jobs.${jobName}`);
  const strategy = asRecord(job.strategy, `${jobName}.strategy`);
  const matrix = asRecord(strategy.matrix, `${jobName}.strategy.matrix`);
  const include = matrix.include;
  if (!Array.isArray(include)) {
    throw new Error(`${jobName}.strategy.matrix.include must be an array`);
  }

  return include.map((entry, index) => {
    const row = asRecord(entry, `${jobName}.matrix.include[${index}]`);
    const specKey = stringValue(row.spec_key, `${jobName}[${index}].spec_key`);
    const spec = stringValue(row.spec, `${jobName}[${index}].spec`);
    return { specKey, spec };
  });
}

function decisionRowMatrix(
  row: SmokeRoutingDecision,
  errors: string[],
): SmokeMatrixEntry[] {
  if (row.tier !== "blocking E2E") return [];
  return row.specKeys.map((specKey, index) => {
    const spec = row.specs[index];
    if (!spec) {
      errors.push(`${row.id}: missing spec for specKey ${specKey}`);
      return { specKey, spec: "" };
    }
    return { specKey, spec };
  });
}

function checkSeedTargetMapping(
  seedSource: string,
  specKey: string,
  seedTargets: readonly string[],
  errors: string[],
): void {
  const expected = `${propertyKey(specKey)}: [${seedTargets
    .map((target) => `"${target}"`)
    .join(", ")}]`;
  check(
    seedSource.includes(expected),
    `seed-smoke.ts missing specKey mapping: ${expected}`,
    errors,
  );
}

function propertyKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : `"${key}"`;
}

function checkUniqueMatrix(
  label: string,
  matrix: readonly SmokeMatrixEntry[],
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const entry of matrix) {
    const serialized = serializeMatrixEntry(entry);
    check(
      !seen.has(serialized),
      `${label} has duplicate ${serialized}`,
      errors,
    );
    seen.add(serialized);
  }
}

function checkSameMatrix(
  leftLabel: string,
  left: readonly SmokeMatrixEntry[],
  rightLabel: string,
  right: readonly SmokeMatrixEntry[],
  errors: string[],
): void {
  const leftText = serializeMatrix(left);
  const rightText = serializeMatrix(right);
  check(
    leftText === rightText,
    `${leftLabel} matrix differs from ${rightLabel} matrix\n${leftLabel}:\n${leftText}\n${rightLabel}:\n${rightText}`,
    errors,
  );
}

function sortMatrix(matrix: readonly SmokeMatrixEntry[]): SmokeMatrixEntry[] {
  return [...matrix].sort((a, b) =>
    serializeMatrixEntry(a).localeCompare(serializeMatrixEntry(b)),
  );
}

function serializeMatrix(matrix: readonly SmokeMatrixEntry[]): string {
  return sortMatrix(matrix).map(serializeMatrixEntry).join("\n");
}

function serializeMatrixEntry(entry: SmokeMatrixEntry): string {
  return `${entry.specKey} ${entry.spec}`;
}

function sameValues<T extends string>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function check(condition: unknown, message: string, errors: string[]): void {
  if (!condition) errors.push(message);
}

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint && import.meta.url === pathToFileURL(entrypoint).href,
  );
}

if (isCliEntrypoint()) {
  const result = validateSmokeRoutingDecisions();
  if (result.errors.length > 0) {
    process.stderr.write(
      `FAIL: E2E smoke routing decisions drifted\n${result.errors
        .map((error) => `- ${error}`)
        .join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `PASS: ${result.blockingDecisionMatrix.length} blocking E2E smoke routes match fixture promotion decisions.\n`,
    );
  }
}
