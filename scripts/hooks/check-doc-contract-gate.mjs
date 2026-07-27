#!/usr/bin/env node
/**
 * Structural gate for the always-on `Doc Contract Checks` CI job (#1845).
 *
 * Two invariants, both derived rather than grepped:
 *
 * 1. SHAPE — `doc-contract` must stay ungated and blocking. A `grep -F` lock
 *    only sees one spelling, and YAML has several for the same meaning:
 *    `needs: changes` vs a `needs:` block sequence, a job-level `if: false`, a
 *    step-level `if:`. Each of those turns the job into a skip, and GitHub
 *    reports a skipped required check as satisfied — the exact hole this job
 *    exists to close. So the workflow is parsed with the `yaml` dependency and
 *    the assertions run against the document tree, not its formatting.
 *
 * 2. DRIFT — every vitest-collected test that reads `docs/` at runtime has to
 *    be in the `test:doc-contracts` list, or a docs-only PR silently skips it.
 *    The file universe comes from `vitest list --filesOnly`, i.e. vitest's own
 *    resolution of vite.config.ts, so the guard cannot drift from what CI
 *    actually collects. A hand-rolled `find src scripts tests -name '*.test.ts'`
 *    did drift: it missed `*.spec.ts`, `*.test.mts`, and anything outside those
 *    three directories.
 *
 * Where it runs: inside the `doc-contract` job (ungated, so it fires on every
 * PR — which is when a new docs-reading test actually arrives) and from the
 * pre-push router whenever a test file, `package.json`, a vitest config, or a
 * workflow changes. Ceiling: the CI copy cannot catch this job being switched
 * off, because it runs inside that job. Pre-push covers that case — a
 * `.github/workflows/*` change routes through
 * `scripts/hooks/test-ci-workflow-cache.sh`, which calls this script.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW =
  process.env.CI_WORKFLOW_PATH ?? join(ROOT, ".github", "workflows", "ci.yml");

const JOB_ID = "doc-contract";
// Load-bearing: the `pr_to_main` ruleset lists required contexts by job name,
// so a rename silently un-gates main once the context is registered.
const JOB_NAME = "Doc Contract Checks";
const REQUIRED_RUNS = ["pnpm test:doc-contracts", "pnpm lint"];

const failures = [];
const fail = (message) => failures.push(message);

// --- 1. shape -------------------------------------------------------------

const workflow = parse(readFileSync(WORKFLOW, "utf8"));

// A workflow-level path filter would orphan the required contexts
// (expected/missing forever) and keep this job from ever reporting.
for (const [event, config] of Object.entries(workflow?.on ?? {})) {
  if (config === null || typeof config !== "object") continue;
  for (const key of ["paths", "paths-ignore"]) {
    if (key in config) {
      fail(`on.${event}.${key} filters the workflow; required checks orphan`);
    }
  }
}

const runLines = (step) =>
  typeof step?.run === "string"
    ? step.run
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

const job = workflow?.jobs?.[JOB_ID];
if (!job) {
  fail(`jobs.${JOB_ID} is missing from ${WORKFLOW}`);
} else {
  if (job.name !== JOB_NAME) {
    fail(`jobs.${JOB_ID}.name must stay "${JOB_NAME}" (ruleset context name)`);
  }
  if ("needs" in job) {
    fail(
      `jobs.${JOB_ID}.needs must be absent: any dependency lets an upstream ` +
        `skip/failure turn this job into a skip, which the ruleset accepts`,
    );
  }
  if ("if" in job) {
    fail(`jobs.${JOB_ID}.if must be absent: a conditional job can skip`);
  }
  if ("continue-on-error" in job) {
    fail(`jobs.${JOB_ID} is a blocking gate, not advisory`);
  }

  const steps = Array.isArray(job.steps) ? job.steps : [];
  for (const [index, step] of steps.entries()) {
    const label = step?.name ?? `#${index}`;
    if (step && "if" in step) {
      fail(
        `jobs.${JOB_ID} step "${label}" has an \`if:\`; steps must not skip`,
      );
    }
    if (step && "continue-on-error" in step) {
      fail(`jobs.${JOB_ID} step "${label}" swallows its own failure`);
    }
  }
  for (const command of REQUIRED_RUNS) {
    if (!steps.some((step) => runLines(step).includes(command))) {
      fail(`jobs.${JOB_ID} must run \`${command}\``);
    }
  }
}

// --- 2. drift -------------------------------------------------------------

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const docContractScript = pkg.scripts?.["test:doc-contracts"] ?? "";
if (!docContractScript) {
  fail("package.json is missing the test:doc-contracts script");
}

// Ask vitest what it collects instead of re-deriving its globs here.
const collected = execFileSync(
  "pnpm",
  ["exec", "vitest", "list", "--filesOnly"],
  { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
)
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(line))
  .map((line) => line.split(sep).join("/").replace(/^\.\//, ""));

// Vacuity guard: an empty collection would make every assertion below pass.
if (collected.length === 0) {
  fail("`vitest list --filesOnly` collected no test files");
}

// Two signals in one file: an fs read API and a literal that resolves under
// docs/. That covers the notations a single regex missed — a backtick path,
// `path.join("docs", …)`, `"./docs/…"`, `join(ROOT, "docs/…")` — and prettier's
// wrap of `readFileSync(\n  "docs/…")`, since the file is matched as a whole.
// Fixture-driven contracts whose doc paths live in JSON (e.g.
// tests/fixtures/unsupported_boundary_contracts.json) carry neither signal in
// source and stay manual entries, so this is a subset check, not the list.
const FS_READ =
  /\b(readFileSync|readdirSync|readFile|readdir|globSync|existsSync|statSync)\b/;
const DOCS_PATH_LITERAL = /(["'`])\.{0,2}\/?docs(\/|\1)/;

for (const file of collected) {
  const source = readFileSync(join(ROOT, file), "utf8");
  if (!FS_READ.test(source) || !DOCS_PATH_LITERAL.test(source)) continue;
  if (!docContractScript.includes(file)) {
    fail(
      `${file} reads docs/ at runtime but is not in the test:doc-contracts ` +
        `script, so a docs-only PR would skip it`,
    );
  }
}

if (failures.length > 0) {
  for (const message of failures) console.error(`FAIL: ${message}`);
  process.exit(1);
}

console.log(
  `PASS: doc-contract gate (${collected.length} vitest-collected files scanned)`,
);
