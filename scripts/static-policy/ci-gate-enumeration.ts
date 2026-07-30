/**
 * CI gate enumeration policy (#1845).
 *
 * "Which CI job is ungated / change-gated / advisory / a required context" was
 * hand-copied into five prose SOTs, none of them tied to the workflows or to
 * the ruleset. Adding one job meant editing N documents; the #1845 round-2
 * review found three of them stale, one a line above a row the same PR had
 * just corrected. Fixing those three by hand is what produced the stale set in
 * the first place.
 *
 * So the membership is DERIVED from the workflows here, and prose may restate
 * it only inside a `<!-- ci-gates:<kind> -->` block that this policy compares
 * against the derived set. Re-enumerating anywhere else is the failure — which
 * is what keeps "residual zero" true after the fix, not just at it.
 *
 * This lives in `pnpm lint` rather than a bespoke gate because `pnpm lint` is
 * already the repo's static-policy home and already reads docs/, and because a
 * job gated on `docs_changed` always runs it — `doc-contracts` on a docs-only
 * set since #1991, the `frontend` job on every other set. Either way this runs
 * on exactly the docs-only PRs where a prose enumeration goes stale.
 *
 * Ceiling: it reads Markdown paragraphs and YAML comment blocks. Prose that
 * asserts gate membership without naming any job is out of reach.
 */
import { parse } from "yaml";

// The workflows that publish a PR check context. `review-gate` declares no
// `name:`, so GitHub uses the job id as the context — which is also the
// spelling the prose uses.
export const CI_GATE_WORKFLOW_PATHS = [
  ".github/workflows/ci.yml",
  ".github/workflows/e2e-smoke.yml",
  ".github/workflows/review-gate.yml",
] as const;

// The primary workflow, whose `if:` / `continue-on-error` keys define the
// gated / ungated / advisory split.
const PRIMARY_WORKFLOW = ".github/workflows/ci.yml";

// Frozen historical records keep the enumeration that was true when written.
const EXEMPT_PREFIXES = ["docs/archives/"] as const;

// Three or more contexts in one paragraph is a membership list. Two is a
// comparison ("X runs before Y"), which stays legal.
const ENUMERATION_THRESHOLD = 3;

const BLOCK_RE =
  /<!--\s*ci-gates:\s*([\w-]+)[^>]*-->([\s\S]*?)<!--\s*\/ci-gates\s*-->/g;
const TICKED_RE = /`([^`\n]+)`/g;

type Derived = {
  readonly contexts: ReadonlySet<string>;
  readonly jobIds: ReadonlySet<string>;
  readonly sets: Readonly<Record<string, readonly string[]>>;
};

/**
 * `Runtime Happy Path (${{ matrix.spec_key }}, …)` reports one context per
 * matrix leg; the aggregation job and the prose both use the bare name.
 */
function contextName(raw: unknown, jobId: string): string {
  if (typeof raw !== "string") return jobId;
  return raw
    .replace(/\([^()]*\$\{\{[^)]*\)/g, "")
    .replace(/\$\{\{[^}]*\}\}/g, "")
    .replace(/\s*\(non-blocking\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveCiGates(
  readWorkflow: (path: string) => string,
): Derived | string {
  const contexts = new Set<string>();
  let primaryJobs: [string, Record<string, unknown>][] = [];

  for (const path of CI_GATE_WORKFLOW_PATHS) {
    let doc: { jobs?: Record<string, Record<string, unknown>> };
    try {
      doc = parse(readWorkflow(path));
    } catch (error) {
      return `${path}: cannot parse for the CI gate enumeration (${String(error)})`;
    }
    const jobs = Object.entries(doc?.jobs ?? {});
    if (path === PRIMARY_WORKFLOW) primaryJobs = jobs;
    for (const [id, definition] of jobs) {
      const name = contextName(definition?.name, id);
      if (name) contexts.add(name);
    }
  }

  if (contexts.size === 0) return "derived zero CI check contexts";

  return {
    contexts,
    jobIds: new Set(primaryJobs.map(([id]) => id)),
    sets: {
      ungated: primaryJobs.filter(([, j]) => !("if" in j)).map(([id]) => id),
      "change-gated": primaryJobs
        .filter(([, j]) => String(j?.if ?? "").includes("code_changed"))
        .map(([id]) => id),
      advisory: primaryJobs
        .filter(([, j]) => j?.["continue-on-error"] === true)
        .map(([id]) => id),
    },
  };
}

const sorted = (values: Iterable<string>) =>
  [...new Set(values)].sort().join(", ");

/**
 * @param docSources repo-relative path -> file text, for every tracked
 *   markdown file and gate workflow.
 */
export function findCiGateEnumerationViolations(
  docSources: ReadonlyMap<string, string>,
  derived: Derived,
): string[] {
  const failures: string[] = [];
  const homes = new Map<string, string>();

  for (const [file, source] of [...docSources.entries()].sort()) {
    const isWorkflow = file.startsWith(".github/workflows/");
    const marked: string[] = [];

    for (const [full, kind, body] of source.matchAll(BLOCK_RE)) {
      marked.push(full);
      const previous = homes.get(kind);
      if (previous) {
        failures.push(
          `${file}: ci-gates:${kind} is also declared in ${previous}; a derived enumeration may have exactly one home.`,
        );
        continue;
      }
      homes.set(kind, file);

      const ticked = [...body.matchAll(TICKED_RE)].map(([, token]) => token);
      if (kind === "required-contexts") {
        // The ruleset is live GitHub state, so membership is not derivable
        // offline. What IS checkable is that every listed context is a real
        // job context — which is exactly what a job rename silently breaks.
        for (const token of ticked) {
          if (!derived.contexts.has(token)) {
            failures.push(
              `${file}: ci-gates:required-contexts lists \`${token}\`, which no job in ${CI_GATE_WORKFLOW_PATHS.join(", ")} produces.`,
            );
          }
        }
        continue;
      }
      const expected = derived.sets[kind];
      if (expected === undefined) {
        failures.push(`${file}: unknown ci-gates kind "${kind}".`);
        continue;
      }
      const listed = sorted(ticked.filter((t) => derived.jobIds.has(t)));
      if (listed !== sorted(expected)) {
        failures.push(
          `${file}: ci-gates:${kind} lists [${listed}] but ${PRIMARY_WORKFLOW} derives [${sorted(expected)}].`,
        );
      }
    }

    if (EXEMPT_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;

    let prose = source;
    for (const block of marked) prose = prose.split(block).join("\n\n");
    // A comment run is a YAML file's paragraph; job `name:` values are not
    // prose and must not count as a restatement of themselves.
    const chunks = isWorkflow
      ? prose
          .split("\n")
          .map((line) => (/^\s*#/.test(line) ? line : "\n"))
          .join("\n")
          .split(/\n{2,}/)
      : prose.split(/\n\s*\n/);

    // The document that owns the required-contexts block is the one place the
    // required set may be discussed outside a block; that is its whole job.
    const ownsRequiredList = homes.get("required-contexts") === file;

    for (const chunk of chunks) {
      const named = [...derived.contexts].filter((n) => chunk.includes(n));
      if (named.length >= ENUMERATION_THRESHOLD) {
        failures.push(
          `${file}: a paragraph enumerates ${named.length} CI check contexts (${sorted(named)}). Point at the derived ci-gates block instead.`,
        );
        continue;
      }
      // `review-gate` plus a job context is the other shape this drifts in:
      // "required is review-gate + Runtime Happy Path", a two-item composition
      // claim too small for the count above and wrong in the delivery skill
      // for months.
      const others = named.filter((n) => n !== "review-gate");
      if (
        !ownsRequiredList &&
        others.length > 0 &&
        chunk.includes("review-gate")
      ) {
        failures.push(
          `${file}: a paragraph pairs review-gate with ${sorted(others)} — that is a required-set composition claim; point at the ci-gates block.`,
        );
      }
    }
  }

  for (const kind of [...Object.keys(derived.sets), "required-contexts"]) {
    if (!homes.has(kind)) {
      failures.push(
        `no ci-gates:${kind} block exists anywhere; the derived enumeration has no home, so nothing is compared against it.`,
      );
    }
  }

  return failures;
}

export function readCiGateEnumerationSources(
  trackedFiles: readonly string[],
  read: (path: string) => string,
): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of trackedFiles) {
    const isMarkdown = file.endsWith(".md");
    const isWorkflow =
      file.startsWith(".github/workflows/") && /\.ya?ml$/.test(file);
    if (!isMarkdown && !isWorkflow) continue;
    sources.set(file, read(file));
  }
  return sources;
}
