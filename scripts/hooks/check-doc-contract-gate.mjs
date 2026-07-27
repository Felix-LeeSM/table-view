#!/usr/bin/env node
/**
 * Structural gate for the always-on `Doc Contract Checks` CI job (#1845).
 *
 * Three invariants, all derived rather than grepped:
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
 * 3. ENUMERATION — "which job is ungated / change-gated / advisory / a required
 *    context" was hand-copied into five prose SOTs with nothing tying any copy
 *    to `ci.yml` or the ruleset. Adding one job therefore meant editing N
 *    documents, and the #1845 round-2 review found three of them stale, one of
 *    them a line above a row this PR had just corrected. So the membership is
 *    DERIVED here from the workflows, and prose may restate it only inside a
 *    `<!-- ci-gates:<kind> -->` block that is checked against the derived set.
 *    Re-enumerating anywhere else is itself the failure — that is what keeps
 *    "residual zero" true after this commit instead of just at it.
 *
 * Where it runs: inside the `doc-contract` job (ungated, so it fires on every
 * PR — which is when a new docs-reading test actually arrives) and from the
 * pre-push router whenever a test file, `package.json`, a vitest config, or a
 * workflow changes.
 *
 * Ceilings, all closed only by registering the `Doc Contract Checks` context in
 * the `pr_to_main` ruleset (which must happen AFTER this workflow is on main):
 *   - Running inside the job it guards, the CI copy cannot catch that job being
 *     switched off. The local pre-push route reaches that case but is not an
 *     enforcement point — hooks can be absent, bypassed, or skipped by a web-UI
 *     or bot commit, and `docs/quality/hook-performance.md` is explicit that CI
 *     is the shared record. Until registration this gate is run-blocking (a red
 *     turns the run red) and merge-advisory.
 *   - Invariant 2 is a subset check, not the list. It needs both signals in one
 *     file, so a doc read through a helper module (`*.test.ts` ->
 *     `helper.ts` -> `readFileSync("docs/…")`) or a vite `?raw` doc import is
 *     invisible to it, as are doc paths that live in JSON fixtures.
 *   - Invariant 2's universe is `vitest list`, so a docs-reading checker that
 *     is not a vitest file is outside it entirely — for instance
 *     scripts/check-eslint-static-policy.ts, which reads the 20
 *     COMPLETION_FEATURE_REFERENCE_DOC_PATHS. Those are covered by a different
 *     route: `pnpm lint` is in REQUIRED_RUNS above, so invariant 1 pins it into
 *     this ungated job. The residual is a docs-reading check reachable from
 *     NEITHER `pnpm test:doc-contracts` NOR `pnpm lint` — a third entry point
 *     would run behind the docs-only skip again, and nothing here detects that.
 *   - Invariant 3 reads Markdown paragraphs and YAML comment blocks. Prose that
 *     asserts gate membership without naming the jobs is out of reach.
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
// Reported early for a clear message. Not the only line of defence: with the
// script gone this string is empty, so every docs-reading file below fails its
// `includes` check too — which is why deleting this guard alone survives
// mutation.
if (!docContractScript) {
  fail("package.json is missing the test:doc-contracts script");
}

// Ask vitest what it collects instead of re-deriving its globs here.
// DOC_CONTRACT_VITEST_CONFIG is a test seam, like CI_WORKFLOW_PATH: it is the
// only way to reach the two states below on a healthy tree.
const listArgs = ["exec", "vitest", "list", "--filesOnly"];
if (process.env.DOC_CONTRACT_VITEST_CONFIG) {
  listArgs.push("--config", process.env.DOC_CONTRACT_VITEST_CONFIG);
}
// No try/catch on purpose: a config that will not load must fail the gate
// rather than silently produce an empty universe.
const collected = execFileSync("pnpm", listArgs, {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
})
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
// Subset check, not the list; see the ceilings in the header comment.
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

// --- 3. enumeration -------------------------------------------------------

// The workflows that publish a PR check context on this repo. `review-gate`
// declares no `name:`, so GitHub uses the job id as the context — which is also
// the spelling the prose uses.
const GATE_WORKFLOWS = [
  WORKFLOW,
  join(ROOT, ".github", "workflows", "e2e-smoke.yml"),
  join(ROOT, ".github", "workflows", "review-gate.yml"),
];

// `Runtime Happy Path (${{ matrix.spec_key }}, …)` reports one context per
// matrix leg; the aggregation job and the prose both use the bare name.
const contextName = (raw, jobId) =>
  typeof raw === "string"
    ? raw
        .replace(/\([^()]*\$\{\{[^)]*\)/g, "")
        .replace(/\$\{\{[^}]*\}\}/g, "")
        .replace(/\s*\(non-blocking\)\s*$/, "")
        .replace(/\s+/g, " ")
        .trim()
    : jobId;

const contexts = new Set();
const ciJobs = Object.entries(workflow?.jobs ?? {});
for (const path of GATE_WORKFLOWS) {
  let doc;
  try {
    doc = parse(readFileSync(path, "utf8"));
  } catch {
    fail(`cannot parse ${path} for the CI gate enumeration`);
    continue;
  }
  for (const [id, definition] of Object.entries(doc?.jobs ?? {})) {
    const name = contextName(definition?.name, id);
    if (name) contexts.add(name);
  }
}

const derived = {
  ungated: ciJobs.filter(([, j]) => !("if" in j)).map(([id]) => id),
  "change-gated": ciJobs
    .filter(([, j]) => String(j?.if ?? "").includes("code_changed"))
    .map(([id]) => id),
  advisory: ciJobs
    .filter(([, j]) => j?.["continue-on-error"] === true)
    .map(([id]) => id),
};
const ciJobIds = new Set(ciJobs.map(([id]) => id));

const sorted = (values) => [...new Set(values)].sort().join(", ");
const BLOCK =
  /<!--\s*ci-gates:\s*([\w-]+)[^>]*-->([\s\S]*?)<!--\s*\/ci-gates\s*-->/g;
const TICKED = /`([^`\n]+)`/g;

const seenKinds = new Map();
// Tracked files only: an untracked scratch note in a working tree is not a SOT
// and must not fail anyone's push. DOC_CONTRACT_SCAN_ONLY replaces that universe
// with an explicit comma-joined list — the test seam, same shape as
// CI_WORKFLOW_PATH above, and the only way to reach the "this kind has no home
// anywhere" and "the list names a context no job produces" states on a healthy
// tree.
const tracked = process.env.DOC_CONTRACT_SCAN_ONLY
  ? process.env.DOC_CONTRACT_SCAN_ONLY.split(",").filter(Boolean)
  : execFileSync("git", ["ls-files", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);

let scanned = 0;
for (const file of tracked) {
  const isMarkdown = file.endsWith(".md");
  const isGateWorkflow =
    file.startsWith(".github/workflows/") && /\.ya?ml$/.test(file);
  if (!isMarkdown && !isGateWorkflow) continue;

  scanned += 1;
  const source = readFileSync(join(ROOT, file), "utf8");

  // Marked blocks: the one place a restatement is allowed, because it is
  // compared against the derived set instead of trusted.
  const marked = [];
  for (const [full, kind, body] of source.matchAll(BLOCK)) {
    marked.push(full);
    const previous = seenKinds.get(kind);
    if (previous) {
      fail(
        `ci-gates:${kind} is declared in both ${previous} and ${file}; ` +
          `a derived enumeration may have exactly one home`,
      );
      continue;
    }
    seenKinds.set(kind, file);

    const ticked = [...body.matchAll(TICKED)].map(([, token]) => token);
    if (kind === "required-contexts") {
      // The ruleset is live GitHub state, so the membership itself is not
      // derivable offline; what IS checkable is that every listed context is a
      // real job context, which is what a job rename silently breaks.
      for (const token of ticked) {
        if (!contexts.has(token)) {
          fail(
            `${file}: ci-gates:required-contexts lists \`${token}\`, which no ` +
              `job in ${GATE_WORKFLOWS.map((p) => p.split(sep).pop()).join("/")} produces`,
          );
        }
      }
      continue;
    }
    if (!(kind in derived)) {
      fail(`${file}: unknown ci-gates kind "${kind}"`);
      continue;
    }
    const listed = sorted(ticked.filter((token) => ciJobIds.has(token)));
    const expected = sorted(derived[kind]);
    if (listed !== expected) {
      fail(
        `${file}: ci-gates:${kind} lists [${listed}] but ${WORKFLOW.split(sep).pop()} ` +
          `derives [${expected}]`,
      );
    }
  }

  // Frozen historical records are allowed to keep the enumeration that was
  // true when they were written.
  if (file.startsWith("docs/archives/")) continue;

  let prose = source;
  for (const block of marked) prose = prose.split(block).join("\n\n");
  // A YAML comment run is that format's paragraph; job `name:` values are not
  // prose and must not count as a restatement of themselves.
  const chunks = isGateWorkflow
    ? prose
        .split("\n")
        .map((line) => (/^\s*#/.test(line) ? line : "\n"))
        .join("\n")
        .split(/\n{2,}/)
    : prose.split(/\n\s*\n/);

  // The document that owns `ci-gates:required-contexts` is the one place the
  // required set may be discussed outside a block; that is its whole job.
  const ownsRequiredList = seenKinds.get("required-contexts") === file;

  for (const chunk of chunks) {
    const named = [...contexts].filter((name) => chunk.includes(name));
    if (named.length >= 3) {
      fail(
        `${file}: a paragraph enumerates ${named.length} CI check contexts ` +
          `(${sorted(named)}). Point at the derived ci-gates block instead`,
      );
      continue;
    }
    // `review-gate` plus a job context is the other shape this drifts in:
    // "required is review-gate + Runtime Happy Path", a two-item composition
    // claim too small for the count above and wrong in
    // .agents/skills/delivery/SKILL.md for months.
    const others = named.filter((name) => name !== "review-gate");
    if (
      !ownsRequiredList &&
      others.length >= 1 &&
      chunk.includes("review-gate")
    ) {
      fail(
        `${file}: a paragraph pairs review-gate with ${sorted(others)} — that ` +
          `is a required-set composition claim; point at the ci-gates block`,
      );
    }
  }
}

for (const kind of [...Object.keys(derived), "required-contexts"]) {
  if (!seenKinds.has(kind)) {
    fail(`no ci-gates:${kind} block exists; the derived enumeration has no home`);
  }
}

if (failures.length > 0) {
  for (const message of failures) console.error(`FAIL: ${message}`);
  process.exit(1);
}

console.log(
  `PASS: doc-contract gate (${collected.length} vitest-collected test files ` +
    `scanned for docs/ reads, ${scanned} markdown/workflow files scanned for ` +
    `re-enumeration of ${contexts.size} derived check contexts)`,
);
