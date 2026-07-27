import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildTargets,
  findMismatches,
  findUpdateRefusals,
  isMeasuredDoc,
  measure,
  parseTargets,
  runGate,
  type FileMeasurement,
} from "../check-doc-line-length";
import {
  contractOutputs,
  contractTargets,
  CONTRACT_CEILING,
  renderContract,
} from "../doc-line-length-contract";

// One ceiling, read from the committed baseline. A second literal here is how
// the gate's headline number could change while every doc kept the old one.
const CEILING = CONTRACT_CEILING;
const SOT_PAGE = "docs/quality/doc-size-ratchet.md";
const CHECKED_MARKER =
  "<!-- checked against: pnpm --silent docs:lines:contract -->";

type Entry = {
  path: string;
  over: number;
  maxLen: number;
  excess: number;
};

function targets(entries: Entry[]) {
  return contractTargets(entries);
}

function tree(files: Record<string, FileMeasurement>) {
  return new Map(Object.entries(files));
}

/** A file whose lines all sit at or under the ceiling. */
const clean: FileMeasurement = { over: 0, maxLen: 100, excess: 0 };

const m = (over: number, maxLen: number, excess: number): FileMeasurement => ({
  over,
  maxLen,
  excess,
});

/**
 * Every way one file can sit relative to its baseline entry. Crossed with
 * itself this reaches both remedies, both directions, all three fields, the
 * missing-entry and orphaned-entry paths, and both `--update` outcomes —
 * without anyone listing an output string by hand.
 */
const FILE_STATES: { entry?: FileMeasurement; file?: FileMeasurement }[] = [
  {},
  { entry: m(2, 900, 500), file: m(2, 900, 500) }, // exact match
  { entry: m(2, 900, 500), file: m(3, 1000, 700) }, // every number rises
  { entry: m(2, 900, 500), file: m(3, 900, 700) }, // count and excess rise only
  { entry: m(2, 900, 500), file: m(1, 700, 300) }, // every number falls
  { entry: m(2, 900, 500), file: m(0, 120, 0) }, // paid off
  { entry: m(1, 1200, 600), file: m(1, 700, 100) }, // longest falls hard
  { entry: m(1, 700, 100), file: m(1, 1000, 400) }, // longest rises alone
  { entry: m(2, 900, 500) }, // entry whose file is gone
  { file: m(2, 900, 500) }, // new debt, no entry
  { file: m(9, 900, 2000) }, // enough new debt to force the split remedy
  { file: m(0, 120, 0) }, // clean, no entry
];

const PATHS = ["docs/a.md", "docs/b.md"] as const;

/** Everything `runGate` prints across the cross-product of FILE_STATES. */
function probeOutputs(): string[] {
  const outputs: string[] = [];
  for (const first of FILE_STATES) {
    for (const second of FILE_STATES) {
      const states = [first, second];
      const entries = states.flatMap((state, index) =>
        state.entry ? [{ path: PATHS[index], ...state.entry }] : [],
      );
      const actual = new Map(
        states.flatMap((state, index) =>
          state.file ? ([[PATHS[index], state.file]] as const) : [],
        ),
      );
      for (const mode of ["check", "update"] as const) {
        outputs.push(runGate(actual, contractTargets(entries), mode).text);
      }
    }
  }
  return outputs;
}

/** Distinct printed lines with the varying parts blanked out. */
function shapes(texts: string[]): string[] {
  return [
    ...new Set(
      texts
        .flatMap((text) => text.split("\n"))
        .map((line) =>
          line.replace(/docs\/[\w.-]+\.md/g, "PATH").replace(/\d+/g, "N"),
        ),
    ),
  ].sort();
}

describe("published contract", () => {
  // The gate's behavior used to live as hand-written prose in the SOT page, the
  // script header, the workflow comment and these test comments at once, and
  // every review round found another copy that no longer matched the code. The
  // page now carries real output; these are the assertions that keep it real.
  it("matches the block the SOT page publishes", () => {
    const page = readFileSync(SOT_PAGE, "utf8");
    const block = page
      .split(CHECKED_MARKER)[1]
      ?.match(/```text\n([\s\S]*?)```/);

    expect(block, `${SOT_PAGE} is missing the checked block`).toBeTruthy();
    expect(block?.[1].trimEnd()).toBe(renderContract());
  });

  it("publishes exactly the message shapes the gate can print", () => {
    // Set equality in both directions: an unpublished branch fails here, and so
    // does a scenario that publishes a message the gate can no longer produce.
    expect(shapes(contractOutputs())).toEqual(shapes(probeOutputs()));
  });

  it("publishes the whole-file threshold its sibling gate defaults to", () => {
    // The other row of the page's Scope table names a number this suite does
    // not own. Read it back out of the shell gate so that copy cannot outlive
    // a threshold change either.
    const shell = readFileSync("scripts/hooks/check-doc-size.sh", "utf8");
    const threshold = shell.match(/DOCS_CHAR_THRESHOLD:-(\d+)/)?.[1];

    expect(
      threshold,
      "check-doc-size.sh has no default threshold",
    ).toBeTruthy();
    expect(readFileSync(SOT_PAGE, "utf8")).toContain(
      Number(threshold).toLocaleString("en-US"),
    );
  });

  it("leaves the ceiling to the block, not to the page's prose", () => {
    // A hand-typed ceiling in the surrounding prose is a copy that survives a
    // baseline change. The number may only appear where the gate printed it.
    const page = readFileSync(SOT_PAGE, "utf8");
    const [intro, rest = ""] = page.split(CHECKED_MARKER);
    const prose = intro + rest.replace(/```text\n[\s\S]*?```/, "");

    expect(prose).not.toContain(String(CONTRACT_CEILING));
  });
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
    // 400 Hangul syllables are 400 chars but 1200 UTF-8 bytes, so a byte-based
    // count would fail a line this suite expects to pass.
    expect(measure("가".repeat(400), CEILING)).toEqual({
      over: 0,
      maxLen: 400,
      excess: 0,
    });
    expect(measure("가".repeat(CEILING + 1), CEILING)).toEqual({
      over: 1,
      maxLen: CEILING + 1,
      excess: 1,
    });
  });

  it("counts an astral character once, not as its two UTF-16 units", () => {
    // Hangul is in the BMP, so it cannot tell `[...line].length` apart from
    // `line.length` — both report 400. A surrogate pair can: 400 emoji are 400
    // code points and 800 UTF-16 units, so a `.length` count would invent 200
    // over-ceiling chars in a line that is comfortably inside the budget.
    expect(measure("😀".repeat(400), CEILING)).toEqual({
      over: 0,
      maxLen: 400,
      excess: 0,
    });
    expect(measure("😀".repeat(CEILING + 1), CEILING)).toEqual({
      over: 1,
      maxLen: CEILING + 1,
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

  it("fails a long line in a file with no baseline entry", () => {
    // The first long row in a clean file is a hard stop, and here it is new
    // debt: nothing else in the tree gave a long row up, so `--update` would
    // refuse and splitting is the only remedy.
    const problems = findMismatches(
      tree({ "docs/a.md": { over: 1, maxLen: 704, excess: 104 } }),
      targets([]),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no baseline entry");
    expect(problems[0]).toContain("Split the cell into domain-grouped rows");
  });

  it("tells the author to split when a measurement rises", () => {
    const problems = findMismatches(
      tree({ "docs/a.md": { over: 2, maxLen: 900, excess: 400 } }),
      targets([{ path: "docs/a.md", over: 1, maxLen: 900, excess: 300 }]),
    );

    expect(problems).toHaveLength(2);
    for (const problem of problems) {
      expect(problem).toContain("rose to");
      expect(problem).toContain("Split the cell into domain-grouped rows");
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
      expect(problem).toContain("Record it with `pnpm docs:lines --update`");
      // The split remedy also contains the literal `--update`, so asserting on
      // that alone cannot tell the two remedies apart.
      expect(problem).not.toContain("Split the cell");
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
    // The hole `maxLen` exists to close: trimming the single longest cell while
    // the count and the summed excess stay put is progress, and it has to be
    // recorded rather than absorbed silently.
    const problems = findMismatches(
      tree({ "docs/a.md": { over: 18, maxLen: 6000, excess: 100000 } }),
      targets([{ path: "docs/a.md", over: 18, maxLen: 6334, excess: 100334 }]),
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
    for (const problem of problems) {
      expect(problem).toContain("Record it with `pnpm docs:lines --update`");
      expect(problem).not.toContain("Split the cell");
    }
    expect(problems.filter((p) => p.includes("rose to"))).toEqual([]);
    expect(problems.filter((p) => p.startsWith("docs/parent.md"))).toHaveLength(
      3,
    );
    expect(problems.find((p) => p.startsWith("docs/band.md"))).toContain(
      "no baseline entry",
    );
  });

  it("reports a move into a file that already holds an entry as a move too", () => {
    // The destination here already carries debt, which is the shape a doc split
    // takes whenever rows land in a file that is not clean. A per-file
    // direction check calls this a rise and tells the author to split rows a
    // doc split already split, while `--update` accepts the very same tree.
    // The remedy has to follow the repo totals, not the file's.
    const moved = tree({
      "docs/src.md": { over: 13, maxLen: 900, excess: 4700 },
      "docs/dest.md": { over: 21, maxLen: 900, excess: 7300 },
    });
    const before = targets([
      { path: "docs/src.md", over: 14, maxLen: 900, excess: 5000 },
      { path: "docs/dest.md", over: 20, maxLen: 900, excess: 7000 },
    ]);

    expect(findUpdateRefusals(moved, before)).toEqual([]);

    const problems = findMismatches(moved, before);

    expect(problems).toHaveLength(4);
    for (const problem of problems) expect(problem).toContain("--update");
    expect(problems.filter((p) => p.includes("Split the cell"))).toEqual([]);
    expect(problems.filter((p) => p.includes("rose to"))).toHaveLength(2);
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
    // Same numbers as the consolidation scenario in the published block: 18
    // rows whose excess is 33,054 merged into one cell and trimmed just enough
    // to leave that excess untouched, so only `longest` notices.
    const refusals = findUpdateRefusals(
      tree({ "docs/a.md": { over: 1, maxLen: 33654, excess: 33054 } }),
      targets([{ path: "docs/a.md", over: 18, maxLen: 6334, excess: 33054 }]),
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

  it("rejects a duplicated path instead of doubling its allowance", () => {
    // findMismatches keys entries by path, but totalDebt sums every row, so a
    // duplicate silently raises the ceiling the direction check compares
    // against while every printed number stays the same.
    expect(() =>
      parseTargets({
        version: 3,
        ceiling: CEILING,
        entries: [
          { path: "docs/a.md", over: 1, maxLen: 900, excess: 300 },
          { path: "docs/a.md", over: 1, maxLen: 900, excess: 300 },
        ],
      }),
    ).toThrow(/duplicate entry: docs\/a\.md/);
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
