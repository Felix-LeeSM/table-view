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
//   B. the preview mounts in a file never outnumber its
//      `requiresPreviewDialog(` consults,
//   C. every mongosh dispatch branch that consults the Safe Mode matrix also
//      consults the preview gate.
//
// A file mounts the preview when it calls a `setPending*Warn` setter with a
// payload. A dispatch branch is an `if (parsed.method === "…")` arm of one of
// those files. A is what fails when someone writes a new gate the old way; B
// is what fails when a mount lands without its own consult — a new file, a
// second mount in a file whose single consult used to satisfy a file-level
// text search, or a mount the branch-granular check cannot see: the last
// arm's body runs to EOF, and C drops the head of the split entirely
// (issue #2445 — both positions now fail on the mount count instead). C is
// what fails when someone adds a branch to a file that already passes A and
// B — the form that shipped `dropIndex` with no dialog at all, since a
// file-granular check cannot see a single branch missing.
//
// KNOWN CEILINGS — forms this file does NOT catch, verified by writing each
// one into the source and watching the suite stay green:
//   - a tier test that never names the literal, e.g. adding a rank-helper
//     conjunct (`requiresPreviewDialog(analysis.severity) &&
//     severityRank(analysis.severity) !== 1`) next to a consult, which
//     carries no comparison against the literal and still skips WARN;
//   - a membership test as that same conjunct, e.g.
//     `!["warn"].includes(analysis.severity)`, which carries the literal but
//     no comparison operator next to it;
//   - a consult fed something other than the analyzed severity: B pairs a
//     consult with a mount but does not read what the consult is handed, so
//     `requiresPreviewDialog(analysis.kind === "deleteMany" ? "warn" :
//     "info")` gates the wrong half and still passes A, B and C;
//   - a consult whose result never reaches the mount: B counts text, so
//     computing `needsPreview` in `rdbQueryExecution.ts` and then ignoring
//     it leaves the whole suite green;
//   - a Safe Mode decision site outside an `if (parsed.method === "…")`
//     arm: C's population is those arms and the head of the split is
//     dropped, so a consult placed there that mounts nothing grows neither
//     population. `executeMongoRunCommandIfPresent` in
//     `mongoQueryExecution.ts` sits ahead of the first arm and carries no
//     `requiresPreviewDialog(`, and an extra `decideSafeMode(` consult in
//     that head position leaves the whole suite green (measured); B does
//     not reach it either, since its population is mount-bearing files.
//     What covers `executeMongoRunCommandIfPresent` is its own stricter
//     gate — it routes a non-INFO command to the confirm dialog, not to
//     this preview — so do not "fix" it by routing it through the preview
//     predicate. `rdbQueryExecution.ts` has no arms at all, so C never sees
//     the file; B's file-level mount count is what watches it;
//   - B counts consults in raw text, so a mention inside a *comment* is
//     counted as one — the false-pass side of the raw-text rule (A's is the
//     false-red side, noted at the end of this header). A mount that lands
//     with no real consult satisfies B as soon as a comment in the same
//     file names `requiresPreviewDialog(`: an extra mount plus a comment
//     mention in `mongoQueryExecution.ts` leaves the whole suite green
//     (measured).
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

// Counting form of the mount population for check B. `String.match` with the
// `g` flag ignores and resets `lastIndex`, so reusing one module-level regex
// carries no state between files.
const PREVIEW_MOUNT_GLOBAL = new RegExp(PREVIEW_MOUNT.source, "g");

// Check B counts consults in the same notation the sources write them —
// `requiresPreviewDialog(` with the call paren, so the import statement does
// not count.
const GATE_CONSULT_GLOBAL = /requiresPreviewDialog\(/g;

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

  it("never lets preview mounts outnumber requiresPreviewDialog consults in a file", () => {
    const offenders: string[] = [];
    for (const { path, text } of previewMountFiles) {
      const mounts = text.match(PREVIEW_MOUNT_GLOBAL)?.length ?? 0;
      const consults = text.match(GATE_CONSULT_GLOBAL)?.length ?? 0;
      if (mounts > consults) {
        offenders.push(
          `${relative(path)} — ${mounts} preview mount(s) against ${consults} requiresPreviewDialog consult(s)`,
        );
      }
    }
    expect(offenders).toEqual([]);
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
