import { beforeAll, describe, expect, it } from "vitest";

// The script runs `main()` on import; the guard has to be set before the dynamic
// import below so the unit tests do not shell out to git.
process.env.DOC_LINE_LENGTH_SKIP_MAIN = "1";

type FileMeasurement = { over: number; maxLen: number };
type Targets = {
  version: number;
  ceiling: number;
  total: number;
  entries: { path: string; over: number; maxLen: number }[];
};

let isMeasuredDoc: (p: string) => boolean;
let measure: (text: string, ceiling: number) => FileMeasurement;
let findRatchetFailures: (
  actual: ReadonlyMap<string, FileMeasurement>,
  targets: Targets,
) => string[];
let findStaleTargets: (
  actual: ReadonlyMap<string, FileMeasurement>,
  targets: Targets,
) => string[];

beforeAll(async () => {
  const mod = await import("../check-doc-line-length");
  isMeasuredDoc = mod.isMeasuredDoc;
  measure = mod.measure;
  findRatchetFailures = mod.findRatchetFailures;
  findStaleTargets = mod.findStaleTargets;
});

const CEILING = 600;

function targets(
  entries: { path: string; over: number; maxLen: number }[],
  total?: number,
): Targets {
  return {
    version: 2,
    ceiling: CEILING,
    total: total ?? entries.reduce((sum, e) => sum + e.over, 0),
    entries,
  };
}

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

describe("measure", () => {
  it("reports the over-ceiling count and the longest line", () => {
    const text = ["a".repeat(700), "b".repeat(601), "c".repeat(4)].join("\n");
    expect(measure(text, CEILING)).toEqual({ over: 2, maxLen: 700 });
  });

  it("counts code points, so Korean prose is not charged UTF-8 bytes", () => {
    // 400 Hangul syllables are 400 chars but 1200 bytes. A byte-based count
    // would fail this line at a 600 ceiling.
    expect(measure("가".repeat(400), CEILING)).toEqual({
      over: 0,
      maxLen: 400,
    });
    expect(measure("가".repeat(601), CEILING).over).toBe(1);
  });
});

describe("findRatchetFailures", () => {
  it("fails a long line in a file with no baseline entry", () => {
    // A file cleaned up once is permanently protected — this is the incentive
    // the ratchet exists to create.
    const failures = findRatchetFailures(
      new Map([["docs/quality/doc-size-ratchet.md", { over: 1, maxLen: 704 }]]),
      targets([]),
    );

    // Both invariants fire here, and that is correct: the file carries debt it
    // has no entry for, and the repo total rose to cover it.
    expect(failures.some((f) => f.includes("no ratchet entry"))).toBe(true);
    expect(failures.some((f) => f.includes("repo total"))).toBe(true);
  });

  it("fails when a file's over-ceiling count rises above its baseline", () => {
    const failures = findRatchetFailures(
      new Map([["docs/ROADMAP.md", { over: 62, maxLen: 2236 }]]),
      targets([{ path: "docs/ROADMAP.md", over: 61, maxLen: 2236 }]),
    );

    expect(failures.some((f) => f.includes("baseline allows 61"))).toBe(true);
  });

  it("fails when the longest line grows even though the count is flat", () => {
    // The swap hole: replacing the 6,334-char row with a 6,400-char one leaves
    // the count unchanged.
    const failures = findRatchetFailures(
      new Map([
        ["docs/product/known-limitations.md", { over: 18, maxLen: 6400 }],
      ]),
      targets([
        { path: "docs/product/known-limitations.md", over: 18, maxLen: 6334 },
      ]),
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("may be edited but not lengthened");
  });

  it("accepts editing a long cell without lengthening it", () => {
    // Regression guard: the first draft gated on `git diff` and rejected a
    // review fix that rewrote one clause inside an already-long cell.
    const failures = findRatchetFailures(
      new Map([
        [
          "docs/contributor-guide/smoke-matrix/h1-data-source.md",
          { over: 9, maxLen: 2880 },
        ],
      ]),
      targets([
        {
          path: "docs/contributor-guide/smoke-matrix/h1-data-source.md",
          over: 9,
          maxLen: 2880,
        },
      ]),
    );

    expect(failures).toEqual([]);
  });

  it("accepts a pure move that keeps the repo total flat", () => {
    // Regression guard: the first draft flagged every row a doc split moved.
    const failures = findRatchetFailures(
      new Map([
        ["docs/contributor-guide/parent.md", { over: 1, maxLen: 700 }],
        ["docs/contributor-guide/band.md", { over: 5, maxLen: 900 }],
      ]),
      targets(
        [
          { path: "docs/contributor-guide/parent.md", over: 1, maxLen: 700 },
          { path: "docs/contributor-guide/band.md", over: 5, maxLen: 900 },
        ],
        6,
      ),
    );

    expect(failures).toEqual([]);
  });

  it("fails when the repo total rises even if every file is within its entry", () => {
    const failures = findRatchetFailures(
      new Map([
        ["docs/a.md", { over: 2, maxLen: 700 }],
        ["docs/b.md", { over: 2, maxLen: 700 }],
      ]),
      targets(
        [
          { path: "docs/a.md", over: 3, maxLen: 700 },
          { path: "docs/b.md", over: 3, maxLen: 700 },
        ],
        3,
      ),
    );

    expect(failures.some((f) => f.includes("repo total"))).toBe(true);
  });
});

describe("findStaleTargets", () => {
  it("requires a target to be lowered once the debt is paid down", () => {
    const stale = findStaleTargets(
      new Map([["docs/ROADMAP.md", { over: 55, maxLen: 1800 }]]),
      targets([{ path: "docs/ROADMAP.md", over: 61, maxLen: 2236 }]),
    );

    expect(stale.some((s) => s.includes("lower it to 55"))).toBe(true);
    expect(stale.some((s) => s.includes("baseline longest 2236"))).toBe(true);
    expect(stale.some((s) => s.includes("repo total"))).toBe(true);
  });

  it("flags a baseline entry whose file is gone", () => {
    const stale = findStaleTargets(
      new Map(),
      targets([{ path: "docs/deleted.md", over: 2, maxLen: 700 }], 0),
    );

    expect(stale.some((s) => s.includes("no longer exists"))).toBe(true);
  });
});
