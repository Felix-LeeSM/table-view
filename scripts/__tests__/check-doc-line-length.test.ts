import { beforeAll, describe, expect, it } from "vitest";

// The script runs `main()` on import; the guard has to be set before the dynamic
// import below so the unit tests do not shell out to git.
process.env.DOC_LINE_LENGTH_SKIP_MAIN = "1";

let isMeasuredDoc: (p: string) => boolean;
let countOverCeiling: (text: string, ceiling: number) => number;
let addedLinesByFile: (
  diff: string,
) => Map<string, { line: string; index: number }[]>;
let findHardCeilingFailures: (
  addedByFile: Map<string, { line: string; index: number }[]>,
  ceiling: number,
  preexisting: ReadonlySet<string>,
) => string[];

beforeAll(async () => {
  const mod = await import("../check-doc-line-length");
  isMeasuredDoc = mod.isMeasuredDoc;
  countOverCeiling = mod.countOverCeiling;
  addedLinesByFile = mod.addedLinesByFile;
  findHardCeilingFailures = mod.findHardCeilingFailures;
});

describe("isMeasuredDoc", () => {
  it("measures live docs and skips the one-shot trees", () => {
    expect(isMeasuredDoc("docs/ROADMAP.md")).toBe(true);
    expect(isMeasuredDoc("docs/product/known-limitations.md")).toBe(true);
    expect(
      isMeasuredDoc("docs/contributor-guide/smoke-matrix/h5-non-rdbms.md"),
    ).toBe(true);

    // Pruned to match scripts/hooks/check-doc-size.sh.
    expect(isMeasuredDoc("docs/sprints/sprint-490/contract.md")).toBe(false);
    expect(isMeasuredDoc("docs/archives/plans/completed-roadmap.md")).toBe(
      false,
    );
    expect(isMeasuredDoc("docs/table_plus/mirror.md")).toBe(false);
    expect(isMeasuredDoc("docs/explorations/idea.md")).toBe(false);
  });

  it("ignores non-docs paths and non-markdown files", () => {
    expect(isMeasuredDoc("README.md")).toBe(false);
    expect(isMeasuredDoc("memory/workflow/git-policy/memory.md")).toBe(false);
    expect(isMeasuredDoc("docs/product/README.txt")).toBe(false);
    expect(isMeasuredDoc("docs")).toBe(false);
  });
});

describe("countOverCeiling", () => {
  it("counts only lines past the ceiling", () => {
    const text = ["a".repeat(601), "b".repeat(600), "c".repeat(4)].join("\n");
    expect(countOverCeiling(text, 600)).toBe(1);
  });

  it("counts code points, so Korean prose is not double-charged", () => {
    // 400 Hangul syllables are 400 chars but 1200 UTF-8 bytes. A byte-based
    // count would fail this line at a 600 ceiling.
    expect(countOverCeiling("가".repeat(400), 600)).toBe(0);
    expect(countOverCeiling("가".repeat(601), 600)).toBe(1);
  });
});

describe("addedLinesByFile", () => {
  it("collects added lines per destination file", () => {
    const diff = [
      "diff --git a/docs/ROADMAP.md b/docs/ROADMAP.md",
      "--- a/docs/ROADMAP.md",
      "+++ b/docs/ROADMAP.md",
      "@@ -1 +1,2 @@",
      "+first added",
      "+second added",
      "-removed line",
      " context line",
    ].join("\n");

    expect(addedLinesByFile(diff).get("docs/ROADMAP.md")).toEqual([
      { line: "first added", index: 1 },
      { line: "second added", index: 2 },
    ]);
  });

  it("skips deletions whose destination is /dev/null", () => {
    const diff = [
      "diff --git a/docs/gone.md b/docs/gone.md",
      "--- a/docs/gone.md",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-old content",
    ].join("\n");

    expect(addedLinesByFile(diff).size).toBe(0);
  });
});

describe("findHardCeilingFailures", () => {
  const ceiling = 600;
  const longRow = `| ${"x".repeat(700)} |`;

  it("fails a newly authored line past the ceiling", () => {
    const failures = findHardCeilingFailures(
      new Map([
        ["docs/product/known-limitations.md", [{ line: longRow, index: 4 }]],
      ]),
      ceiling,
      new Set(),
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("docs/product/known-limitations.md");
    expect(failures[0]).toContain("704 chars");
  });

  it("exempts a long line moved verbatim from the base revision", () => {
    // Regression guard: treating a move as new authorship would make this gate
    // block doc splits, which is the remedy it exists to encourage.
    const failures = findHardCeilingFailures(
      new Map([
        [
          "docs/contributor-guide/smoke-matrix/h5-non-rdbms.md",
          [{ line: longRow, index: 12 }],
        ],
      ]),
      ceiling,
      new Set([longRow]),
    );

    expect(failures).toEqual([]);
  });

  it("fails an edited long line even when a similar one existed before", () => {
    const edited = `${longRow} plus a new clause`;
    const failures = findHardCeilingFailures(
      new Map([["docs/ROADMAP.md", [{ line: edited, index: 2 }]]]),
      ceiling,
      new Set([longRow]),
    );

    expect(failures).toHaveLength(1);
  });

  it("ignores added lines in pruned trees and short added lines", () => {
    const failures = findHardCeilingFailures(
      new Map([
        ["docs/sprints/sprint-1/contract.md", [{ line: longRow, index: 1 }]],
        ["docs/ROADMAP.md", [{ line: "| short |", index: 1 }]],
      ]),
      ceiling,
      new Set(),
    );

    expect(failures).toEqual([]);
  });
});
