// Tree-wide comment-reference gate. Two rules, one scan:
//
//   1. no line-number citations in comments (#1839, #1853)
//   2. every `path` + `` `symbol` `` / design-doc citation must resolve
//
// Tree-wide, not changed-files: the class this replaces was reintroduced by
// files nobody was touching, and a staged-file gate cannot see those. Runs both
// from `pnpm lint` (CI `Frontend Checks`, which fires on docs-only PRs too
// since #1845) and standalone from pre-commit for fast local feedback.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findLineNumberRefViolations,
  findUnresolvedRefViolations,
  isCommentRefScanPath,
  type CommentRefViolation,
} from "./static-policy/comment-refs";

function trackedFiles(cwd: string): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\0")
    .filter((path) => path.length > 0);
}

function formatViolations(
  title: string,
  violations: readonly CommentRefViolation[],
): string {
  const lines = violations.map((violation) => {
    const span =
      violation.endLine > violation.startLine
        ? `${violation.startLine}-${violation.endLine}`
        : `${violation.startLine}`;
    return `  ${violation.path}:${span}  ${violation.reason}: ${violation.snippet}`;
  });
  return `${title}\n${lines.join("\n")}`;
}

export type CommentRefScan = {
  readonly scannedFiles: number;
  readonly checkedRefs: number;
  readonly lineNumberRefs: readonly CommentRefViolation[];
  readonly unresolvedRefs: readonly CommentRefViolation[];
  readonly unverifiableRefs: readonly CommentRefViolation[];
};

export function scanCommentRefs(cwd: string): CommentRefScan {
  const all = trackedFiles(cwd);
  const scanned = all.filter(isCommentRefScanPath);
  const sources = new Map(
    scanned.map((path) => [path, readFileSync(resolve(cwd, path), "utf8")]),
  );
  const trackedStems = new Set(
    all.map((path) => basename(path, extname(path))),
  );
  const resolution = findUnresolvedRefViolations(sources, all, cwd);
  return {
    scannedFiles: scanned.length,
    checkedRefs: resolution.checked,
    lineNumberRefs: findLineNumberRefViolations(sources, trackedStems),
    unresolvedRefs: resolution.unresolved,
    unverifiableRefs: resolution.unverifiable,
  };
}

export function findCommentRefFailures(cwd: string): string[] {
  const scan = scanCommentRefs(cwd);
  const failures: string[] = [];
  if (scan.lineNumberRefs.length > 0) {
    failures.push(
      formatViolations(
        `comment cites a line number (${scan.lineNumberRefs.length}); cite the symbol or the doc section instead:`,
        scan.lineNumberRefs,
      ),
    );
  }
  if (scan.unresolvedRefs.length > 0) {
    failures.push(
      formatViolations(
        `comment cites something that does not exist (${scan.unresolvedRefs.length}):`,
        scan.unresolvedRefs,
      ),
    );
  }
  return failures;
}

function main() {
  const cwd = process.cwd();
  const scan = scanCommentRefs(cwd);
  const failures = findCommentRefFailures(cwd);
  if (process.argv.includes("--report")) {
    for (const violation of scan.unverifiableRefs) {
      console.log(
        `unverifiable ${violation.path}:${violation.startLine}  ${violation.snippet}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(
      `\nComment-reference policy failed:\n${failures.join("\n\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Comment references OK: ${scan.scannedFiles} files scanned, 0 line-number citations, ${scan.checkedRefs} citations resolved, ${scan.unverifiableRefs.length} unverifiable (shape carries no checkable target).`,
  );
}

if (
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")
) {
  main();
}
