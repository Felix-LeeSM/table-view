import { describe, expect, it } from "vitest";

import {
  buildTargets,
  findMismatches,
  findUpdateRefusals,
  isMeasuredDoc,
  measure,
  parseTargets,
  type FileMeasurement,
} from "../check-doc-line-length";

const CEILING = 600;

type Entry = {
  path: string;
  over: number;
  maxLen: number;
  excess: number;
};

function targets(entries: Entry[]) {
  return { version: 3, ceiling: CEILING, entries };
}

function tree(files: Record<string, FileMeasurement>) {
  return new Map(Object.entries(files));
}

/** A file whose lines all sit at or under the ceiling. */
const clean: FileMeasurement = { over: 0, maxLen: 100, excess: 0 };

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
  it("reports the count, the longest line, and the summed excess", () => {
    const text = ["a".repeat(700), "b".repeat(601), "c".repeat(4)].join("\n");
    expect(measure(text, CEILING)).toEqual({
      over: 2,
      maxLen: 700,
      excess: 101,
    });
  });

  it("treats the ceiling itself as within budget", () => {
    expect(measure("a".repeat(CEILING), CEILING)).toEqual({
      over: 0,
      maxLen: CEILING,
      excess: 0,
    });
    expect(measure("a".repeat(CEILING + 1), CEILING)).toEqual({
      over: 1,
      maxLen: CEILING + 1,
      excess: 1,
    });
  });

  it("counts code points, so Korean prose is not charged UTF-8 bytes", () => {
    // 400 Hangul syllables are 400 chars but 1200 bytes. A byte-based count
    // would fail this line at a 600 ceiling. This is load-bearing for the real
    // baseline: known-limitations.md's longest row measures 6,334 code points
    // where a byte count reports 6,346.
    expect(measure("가".repeat(400), CEILING)).toEqual({
      over: 0,
      maxLen: 400,
      excess: 0,
    });
    expect(measure("가".repeat(601), CEILING)).toEqual({
      over: 1,
      maxLen: 601,
      excess: 1,
    });
  });
});

describe("findMismatches", () => {
  it("accepts a baseline that describes the docs exactly", () => {
    expect(
      findMismatches(
        tree({
          "docs/a.md": { over: 1, maxLen: 900, excess: 300 },
          "docs/b.md": clean,
        }),
        targets([{ path: "docs/a.md", over: 1, maxLen: 900, excess: 300 }]),
      ),
    ).toEqual([]);
  });

  it("fails a long line in a file with no baseline entry, naming both remedies", () => {
    // The first long row in a clean file is a hard stop. It is not a permanent
    // seal — a doc split legitimately moves rows into a file that had no entry
    // — so the message has to name `--update` too, or it sends the author of a
    // pure move off to re-split rows that are already split.
    const problems = findMismatches(
      tree({ "docs/a.md": { over: 1, maxLen: 704, excess: 104 } }),
      targets([]),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no baseline entry");
    expect(problems[0]).toContain("Split the cell");
    expect(problems[0]).toContain("--update");
  });

  it("tells the author to split when a measurement rises", () => {
    const problems = findMismatches(
      tree({ "docs/a.md": { over: 2, maxLen: 900, excess: 400 } }),
      targets([{ path: "docs/a.md", over: 1, maxLen: 900, excess: 300 }]),
    );

    expect(problems).toHaveLength(2);
    for (const problem of problems) {
      expect(problem).toContain("rose to");
      expect(problem).toContain("Split the cell instead of raising");
    }
  });

  it("tells the author to run --update when a measurement falls", () => {
    // Falling is progress, but a baseline left above reality lets the file
    // drift back up later under an allowance it no longer needs.
    const problems = findMismatches(
      tree({ "docs/a.md": { over: 1, maxLen: 880, excess: 280 } }),
      targets([{ path: "docs/a.md", over: 1, maxLen: 900, excess: 300 }]),
    );

    expect(problems).toHaveLength(2);
    for (const problem of problems) {
      expect(problem).toContain("fell to");
      expect(problem).toContain("--update");
    }
  });

  it("catches a non-longest long line growing while count and max stay flat", () => {
    // The hole `excess` exists to close: with only `over` and `maxLen`, a
    // 601-char row could grow to 899 in a file whose longest row is 900 and
    // every tracked number would be unchanged.
    const problems = findMismatches(
      tree({ "docs/a.md": { over: 2, maxLen: 900, excess: 599 } }),
      targets([{ path: "docs/a.md", over: 2, maxLen: 900, excess: 301 }]),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("excess chars rose to 599");
  });

  it("catches a swap that shortens the longest row while the count stays flat", () => {
    // The hole `maxLen` exists to close, in the direction that matters for
    // known-limitations.md: 6,334 -> 6,000 is progress and must be recorded,
    // not absorbed silently.
    const problems = findMismatches(
      tree({
        "docs/product/known-limitations.md": {
          over: 18,
          maxLen: 6000,
          excess: 100000,
        },
      }),
      targets([
        {
          path: "docs/product/known-limitations.md",
          over: 18,
          maxLen: 6334,
          excess: 100334,
        },
      ]),
    );

    expect(problems.some((p) => p.includes("longest line fell to 6000"))).toBe(
      true,
    );
  });

  it("fails a baseline entry whose file is no longer measured", () => {
    const problems = findMismatches(
      tree({}),
      targets([{ path: "docs/deleted.md", over: 2, maxLen: 700, excess: 200 }]),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no longer measured");
  });

  it("reports a pure move as a baseline to record, not as new debt", () => {
    // The gate does fail here: the baseline no longer describes the tree. What
    // matters is that every message points at `--update` and none accuses the
    // author of writing a long row — the rows already existed. The companion
    // assertion is in findUpdateRefusals.
    const problems = findMismatches(
      tree({
        "docs/parent.md": clean,
        "docs/band.md": { over: 5, maxLen: 900, excess: 600 },
      }),
      targets([{ path: "docs/parent.md", over: 5, maxLen: 900, excess: 600 }]),
    );

    expect(problems).toHaveLength(4);
    for (const problem of problems) expect(problem).toContain("--update");
    expect(problems.filter((p) => p.includes("rose to"))).toEqual([]);
    expect(problems.filter((p) => p.startsWith("docs/parent.md"))).toHaveLength(
      3,
    );
    expect(problems.find((p) => p.startsWith("docs/band.md"))).toContain(
      "no baseline entry",
    );
  });
});

describe("findUpdateRefusals", () => {
  it("records a pure move, since a doc split authors no new long rows", () => {
    // Regression guard. An earlier design failed the smoke-matrix split
    // outright, flagging every row it moved as newly authored — blocking the
    // remedy this gate exists to encourage.
    expect(
      findUpdateRefusals(
        tree({
          "docs/parent.md": clean,
          "docs/band.md": { over: 5, maxLen: 900, excess: 600 },
        }),
        targets([
          { path: "docs/parent.md", over: 5, maxLen: 900, excess: 600 },
        ]),
      ),
    ).toEqual([]);
  });

  it("records an edit that shortens an already-long cell", () => {
    // Regression guard. An earlier design failed a review fix that rewrote one
    // clause inside a grandfathered cell, because the edit changed the line
    // text. Editing a long cell is not the failure mode.
    expect(
      findUpdateRefusals(
        tree({ "docs/a.md": { over: 1, maxLen: 880, excess: 280 } }),
        targets([{ path: "docs/a.md", over: 1, maxLen: 900, excess: 300 }]),
      ),
    ).toEqual([]);
  });

  it("refuses a baseline rewrite that adds a long line", () => {
    const refusals = findUpdateRefusals(
      tree({ "docs/a.md": { over: 2, maxLen: 900, excess: 400 } }),
      targets([{ path: "docs/a.md", over: 1, maxLen: 900, excess: 300 }]),
    );

    expect(refusals.some((r) => r.includes("over-ceiling lines"))).toBe(true);
    expect(refusals.some((r) => r.includes("excess chars"))).toBe(true);
  });

  it("refuses a baseline rewrite that lengthens a long line without adding one", () => {
    const refusals = findUpdateRefusals(
      tree({ "docs/a.md": { over: 2, maxLen: 900, excess: 599 } }),
      targets([{ path: "docs/a.md", over: 2, maxLen: 900, excess: 301 }]),
    );

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("excess chars would rise from 301 to 599");
  });

  it("refuses consolidating many long rows into one giant cell", () => {
    // Both sums read this as progress: the count falls 18 -> 1 and the excess
    // is unchanged. Only `longest` sees it. Without that third check `--update`
    // writes a baseline that findMismatches then rejects on the next run,
    // leaving the two halves of the gate contradicting each other.
    const refusals = findUpdateRefusals(
      tree({
        "docs/product/known-limitations.md": {
          over: 1,
          maxLen: 33654,
          excess: 33054,
        },
      }),
      targets([
        {
          path: "docs/product/known-limitations.md",
          over: 18,
          maxLen: 6334,
          excess: 33054,
        },
      ]),
    );

    expect(refusals).toEqual([
      "repo longest line would rise from 6334 to 33654.",
    ]);
  });

  it("ignores the longest line of files that carry no debt", () => {
    // `longest` is the longest over-ceiling line, not the longest line. A repo
    // paid down to zero still has ordinary prose in it, and charging that
    // against a baseline of 0 would refuse the very commit that clears the
    // last entry.
    expect(
      findUpdateRefusals(
        tree({ "docs/a.md": { over: 0, maxLen: 590, excess: 0 } }),
        targets([]),
      ),
    ).toEqual([]);
  });
});

describe("buildTargets", () => {
  it("records only files carrying debt, sorted by path", () => {
    expect(
      buildTargets(
        tree({
          "docs/z.md": { over: 1, maxLen: 700, excess: 100 },
          "docs/a.md": { over: 2, maxLen: 900, excess: 400 },
          "docs/clean.md": clean,
        }),
        CEILING,
      ),
    ).toEqual({
      version: 3,
      ceiling: CEILING,
      entries: [
        { path: "docs/a.md", over: 2, maxLen: 900, excess: 400 },
        { path: "docs/z.md", over: 1, maxLen: 700, excess: 100 },
      ],
    });
  });
});

describe("parseTargets", () => {
  it("rejects a mistyped entry key instead of silently dropping an invariant", () => {
    // Without the shape check, `maxlen` reads back as undefined, every
    // comparison against it is false, and the longest-line rule is gone with
    // no output at all.
    expect(() =>
      parseTargets({
        version: 3,
        ceiling: CEILING,
        entries: [{ path: "docs/a.md", over: 1, maxlen: 900, excess: 300 }],
      }),
    ).toThrow(/malformed/);
  });

  it("rejects an older baseline version", () => {
    expect(() =>
      parseTargets({ version: 2, ceiling: CEILING, total: 205, entries: [] }),
    ).toThrow(/unsupported shape/);
  });

  it("accepts the committed baseline shape", () => {
    expect(
      parseTargets({
        version: 3,
        ceiling: CEILING,
        entries: [{ path: "docs/a.md", over: 1, maxLen: 900, excess: 300 }],
      }).entries,
    ).toHaveLength(1);
  });
});
