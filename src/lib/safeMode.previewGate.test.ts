// Issue #2375 — completeness guard for the QueryTab preview-dialog gate.
//
// The bug this closes was not one bad line, it was a *shape*: each write
// surface decided on its own whether to mount the preview by testing the
// analyzer severity against a string literal. Six surfaces agreed on the
// WARN tier and none of them covered the destructive statements that
// `decideSafeModeAction` deliberately hands back as `allow` on a
// non-production connection under Safe Mode `warn` / `off`. Fixing the six
// call sites one by one leaves the shape intact, so a seventh surface
// reintroduces the hole the day it is written.
//
// So this file does not carry a list of the call sites. It derives the
// population from the source tree — every non-test file under `src/` that
// mounts the preview (calls a `setPending*Warn` setter with a payload) — and
// asserts two things about whatever that population turns out to be:
//
//   A. no file in it compares a value against the `warn` string literal, and
//   B. every file in it routes through `requiresPreviewDialog`.
//
// A is what fails when someone writes a new gate the old way; B is what
// fails when someone writes a new gate in a new file without the predicate.
//
// KNOWN CEILINGS — forms this file does NOT catch, verified by writing each
// one into the source and watching the suite stay green:
//   - a tier test that never names the literal, e.g. comparing the numeric
//     output of a rank helper (`severityRank(analysis.severity) === 1`);
//   - a membership test, e.g. `["warn"].includes(analysis.severity)`, which
//     carries the literal but no comparison operator next to it;
//   - a new gate in an already-covered file that mounts the preview for the
//     DANGER tier only and so still skips WARN — the file passes both A and
//     B while gating the wrong half.
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
// `src/types/dataSourceProfileParity.test.ts` uses. `import.meta.url` is not
// a file URL under the jsdom environment these suites run in.
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
