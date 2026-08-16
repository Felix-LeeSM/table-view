// Issue #2375 — completeness guard for the QueryTab preview-dialog gate.
//
// The bug this closes was not one bad line, it was a *shape*: each write
// surface decided on its own whether to mount the preview by testing the
// analyzer severity against a string literal. Every surface that tested at
// all tested for the WARN tier, `dropIndex` tested for nothing, and none of
// them covered the destructive statements that `decideSafeModeAction`
// deliberately hands back as `allow` on a non-production connection under
// Safe Mode `warn` / `off`. Fixing the call sites one by one leaves the shape
// intact, so the next surface reintroduces the hole the day it is written.
//
// So this file does not carry a list of the call sites. It derives its
// populations from the source tree and asserts:
//
//   A. no preview-mounting file compares a value against the `warn` string
//      literal,
//   B. every preview-mounting file routes through `requiresPreviewDialog`,
//   C. every mongosh dispatch branch that consults the Safe Mode matrix also
//      consults the preview gate.
//
// A file mounts the preview when it calls a `setPending*Warn` setter with a
// payload. A dispatch branch is an `if (parsed.method === "…")` arm of one of
// those files. A is what fails when someone writes a new gate the old way; B
// is what fails when someone writes a new gate in a new file without the
// predicate; C is what fails when someone adds a branch to a file that
// already passes A and B — the form that shipped `dropIndex` with no dialog
// at all, since a file-granular check cannot see a single branch missing.
//
// KNOWN CEILINGS — forms this file does NOT catch, verified by writing each
// one into the source and watching the suite stay green:
//   - a tier test that never names the literal, e.g. comparing the numeric
//     output of a rank helper (`severityRank(analysis.severity) === 1`);
//   - a membership test, e.g. `["warn"].includes(analysis.severity)`, which
//     carries the literal but no comparison operator next to it;
//   - a new gate in an already-covered branch that mounts the preview for the
//     DANGER tier only and so still skips WARN — it passes A, B and C while
//     gating the wrong half;
//   - a decision site outside an `if (parsed.method === "…")` arm, since C's
//     population is those arms. `rdbQueryExecution.ts` has no arms at all and
//     holds B only because it has exactly one `requiresPreviewDialog(` call —
//     that is arity, not structure: adding a second, ungated
//     `setPendingRdbWarn` mount to that file leaves the whole suite green
//     (measured — the file-level `text.includes` in B still sees the first
//     call). And `executeMongoRunCommandIfPresent` in
//     `mongoQueryExecution.ts` sits ahead of the first arm, so its decision
//     site is in the dropped head of the split; it carries no
//     `requiresPreviewDialog(` today and the suite is green, which is the
//     same measurement. What covers that one is its own stricter gate — it
//     routes a non-INFO command to the confirm dialog, not to this preview —
//     so do not "fix" it by routing it through the preview predicate.
// The behavioural tests in `src/components/query/QueryTab.warn-dialog.test.tsx`
// and `src/components/query/QueryTab/useQueryExecution.writeDispatch.test.tsx`
// are what cover those; this file covers the shape.
//
// A consequence of A worth knowing before editing a dispatch file: the check
// reads raw text, so writing the forbidden comparison inside a *comment* in
// one of those files fails the suite too. Describe the tier by name there.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { canEscalateByImpact, requiresPreviewDialog } from "@/lib/safeMode";

// `process.cwd()` is the vitest root (the repo root), the same anchor
// `src/types/dataSourceProfileParity.test.ts` uses.
const SRC_ROOT = resolve(process.cwd(), "src");

// A preview mount: `setPendingRdbWarn({...})` / `setPendingMongoWarn({...})`.
// The negative lookahead drops the dismissal calls (`setPendingRdbWarn(null)`)
// in the state owner, which decide nothing.
const PREVIEW_MOUNT = /setPending\w*Warn\s*\(\s*(?!null\b)/;

// Any direct comparison against the `warn` literal: both operand orders and
// the `switch` form. Test files are excluded from the population below, so
// this file may spell the shape out.
const WARN_LITERAL_COMPARISON =
  /[!=]==?\s*["']warn["']|["']warn["']\s*[!=]==?|\bcase\s+["']warn["']\s*:/;

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    if (/\.d\.ts$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function relative(path: string): string {
  return `src/${path
    .slice(SRC_ROOT.length + 1)
    .split(sep)
    .join("/")}`;
}

const previewMountFiles = collectSourceFiles(SRC_ROOT)
  .map((path) => ({ path, text: readFileSync(path, "utf8") }))
  .filter(({ text }) => PREVIEW_MOUNT.test(text));

// One arm of the parser-driven mongosh dispatch table. Splitting on the
// marker gives the arm's body up to the next arm (or EOF for the last one),
// which is the unit a missing gate hides in. The head of the split is the
// file's imports and helpers and carries no arm, so it is dropped.
const DISPATCH_BRANCH = /if \(parsed\.method === "(\w+)"\)/g;

const dispatchBranches = previewMountFiles.flatMap(({ path, text }) => {
  const parts = text.split(DISPATCH_BRANCH);
  const branches: { file: string; method: string; body: string }[] = [];
  // `String.split` with one capture group yields [head, name, body, name,
  // body, …].
  for (let i = 1; i < parts.length; i += 2) {
    branches.push({
      file: relative(path),
      method: parts[i]!,
      body: parts[i + 1] ?? "",
    });
  }
  return branches;
});

describe("preview-dialog gate — shape guard (issue #2375)", () => {
  it("finds the known dispatch surfaces, so an empty sweep cannot pass vacuously", () => {
    const found = previewMountFiles.map(({ path }) => relative(path)).sort();
    // A subset assertion on purpose: it stays true when a surface is added,
    // and fails loudly if the walk stops seeing the tree.
    expect(found).toEqual(
      expect.arrayContaining([
        "src/components/query/QueryTab/mongoQueryExecution.ts",
        "src/components/query/QueryTab/mongoWriteDispatch.ts",
        "src/components/query/QueryTab/rdbQueryExecution.ts",
      ]),
    );
  });

  it("no preview-mounting file compares a value against the warn literal", () => {
    const offenders: string[] = [];
    for (const { path, text } of previewMountFiles) {
      text.split("\n").forEach((line, index) => {
        if (WARN_LITERAL_COMPARISON.test(line)) {
          offenders.push(`${relative(path)}:${index + 1} — ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("every preview-mounting file routes through requiresPreviewDialog", () => {
    const missing = previewMountFiles
      .filter(({ text }) => !text.includes("requiresPreviewDialog("))
      .map(({ path }) => relative(path));
    expect(missing).toEqual([]);
  });

  it("finds the mongosh dispatch branches, so an empty split cannot pass vacuously", () => {
    const found = dispatchBranches.map(({ method }) => method);
    // A subset assertion, like the file-level one above: the roster grows
    // whenever a mongosh method is added, and this fails loudly if the split
    // stops finding arms at all. `dropIndex` is named because it is the arm
    // that shipped with no gate.
    expect(found).toEqual(
      expect.arrayContaining([
        "aggregate",
        "deleteMany",
        "bulkWrite",
        "dropIndex",
      ]),
    );
  });

  it("every dispatch branch that asks the Safe Mode matrix also asks the preview gate", () => {
    const offenders = dispatchBranches
      .filter(
        ({ body }) =>
          body.includes("decideSafeMode(") &&
          !body.includes("requiresPreviewDialog("),
      )
      .map(({ file, method }) => `${file} — ${method}`);
    expect(offenders).toEqual([]);
  });
});

describe("preview-dialog gate — predicates (issue #2375)", () => {
  it("preview[danger] mounts for danger, keeps mounting for warn, skips info", () => {
    expect(requiresPreviewDialog("danger")).toBe(true);
    expect(requiresPreviewDialog("warn")).toBe(true);
    expect(requiresPreviewDialog("info")).toBe(false);
  });

  it("dry-run impact escalation stays on the warn tier alone", () => {
    expect(canEscalateByImpact("warn")).toBe(true);
    expect(canEscalateByImpact("danger")).toBe(false);
    expect(canEscalateByImpact("info")).toBe(false);
  });
});
