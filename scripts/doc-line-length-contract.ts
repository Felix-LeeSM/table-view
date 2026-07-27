// The published behavior contract for `pnpm docs:lines`.
//
// This command prints the block; it does not write the page. A human pastes the
// output into docs/quality/doc-size-ratchet.md and
// scripts/__tests__/check-doc-line-length.test.ts fails when the two disagree,
// so the page is *checked* against the gate rather than generated from it. The
// effect is the same one that matters: the page cannot describe behavior the
// gate does not have. Hand-written restatements of the contract drifted in
// three consecutive review rounds; this file is what replaces them.
//
// Every scenario below runs the real `runGate`. The test also enumerates every
// message shape the gate can print over a generated probe space and requires
// the published block to contain exactly that set, so adding a branch without a
// scenario is a test failure, not an undocumented branch.
//
// Reprint the page block with `pnpm --silent docs:lines:contract`.

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  readTargets,
  runGate,
  TARGETS_VERSION,
  type FileMeasurement,
  type RatchetEntry,
  type RatchetTargets,
} from "./check-doc-line-length";

/** Read from the committed baseline so the number has one home. */
export const CONTRACT_CEILING = readTargets().ceiling;

type Scenario = {
  title: string;
  mode: "check" | "update";
  baseline: RatchetEntry[];
  tree: Record<string, FileMeasurement>;
};

const SCENARIOS: Scenario[] = [
  {
    title: "The baseline describes the tree",
    mode: "check",
    baseline: [{ path: "docs/a.md", over: 2, maxLen: 900, excess: 500 }],
    tree: {
      "docs/a.md": { over: 2, maxLen: 900, excess: 500 },
      "docs/b.md": { over: 0, maxLen: 120, excess: 0 },
    },
  },
  {
    title: "A long row is written into a file that has no entry",
    mode: "check",
    baseline: [{ path: "docs/a.md", over: 2, maxLen: 900, excess: 500 }],
    tree: {
      "docs/a.md": { over: 2, maxLen: 900, excess: 500 },
      "docs/b.md": { over: 1, maxLen: 700, excess: 100 },
    },
  },
  {
    title: "A long row grows in a file that has an entry",
    mode: "check",
    baseline: [{ path: "docs/a.md", over: 2, maxLen: 900, excess: 500 }],
    tree: { "docs/a.md": { over: 2, maxLen: 1000, excess: 600 } },
  },
  {
    title: "A row moves between two files that both have entries",
    mode: "check",
    baseline: [
      { path: "docs/a.md", over: 2, maxLen: 900, excess: 500 },
      { path: "docs/b.md", over: 2, maxLen: 900, excess: 500 },
    ],
    tree: {
      "docs/a.md": { over: 1, maxLen: 900, excess: 300 },
      "docs/b.md": { over: 3, maxLen: 900, excess: 700 },
    },
  },
  {
    title: "A row moves into a file that has no entry",
    mode: "check",
    baseline: [{ path: "docs/a.md", over: 2, maxLen: 900, excess: 500 }],
    tree: {
      "docs/a.md": { over: 0, maxLen: 120, excess: 0 },
      "docs/b.md": { over: 2, maxLen: 900, excess: 500 },
    },
  },
  {
    title: "Debt is paid down and an entry's file is gone",
    mode: "check",
    baseline: [
      { path: "docs/a.md", over: 2, maxLen: 900, excess: 500 },
      { path: "docs/gone.md", over: 1, maxLen: 700, excess: 100 },
    ],
    tree: { "docs/a.md": { over: 1, maxLen: 700, excess: 100 } },
  },
  {
    title: "A long row is added while another file is paid down",
    mode: "check",
    baseline: [
      { path: "docs/a.md", over: 2, maxLen: 900, excess: 500 },
      { path: "docs/gone.md", over: 1, maxLen: 700, excess: 100 },
    ],
    tree: {
      "docs/a.md": { over: 1, maxLen: 700, excess: 300 },
      "docs/b.md": { over: 9, maxLen: 900, excess: 2000 },
    },
  },
  {
    title: "A long row multiplies in a file that has an entry",
    mode: "check",
    baseline: [{ path: "docs/a.md", over: 2, maxLen: 900, excess: 500 }],
    tree: { "docs/a.md": { over: 3, maxLen: 900, excess: 700 } },
  },
  {
    title: "A row moves and the destination's longest row grows with it",
    mode: "check",
    baseline: [
      { path: "docs/a.md", over: 1, maxLen: 1200, excess: 600 },
      { path: "docs/b.md", over: 1, maxLen: 700, excess: 100 },
    ],
    tree: {
      "docs/a.md": { over: 1, maxLen: 700, excess: 100 },
      "docs/b.md": { over: 1, maxLen: 1000, excess: 400 },
    },
  },
  {
    title: "--update refuses a tree that adds long rows",
    mode: "update",
    baseline: [{ path: "docs/a.md", over: 2, maxLen: 900, excess: 500 }],
    tree: { "docs/a.md": { over: 3, maxLen: 1000, excess: 700 } },
  },
  {
    title: "--update refuses 18 long rows consolidated into one cell",
    mode: "update",
    baseline: [{ path: "docs/a.md", over: 18, maxLen: 6334, excess: 33054 }],
    tree: { "docs/a.md": { over: 1, maxLen: 33654, excess: 33054 } },
  },
  {
    title: "--update records the move the check above rejected",
    mode: "update",
    baseline: [
      { path: "docs/a.md", over: 2, maxLen: 900, excess: 500 },
      { path: "docs/b.md", over: 2, maxLen: 900, excess: 500 },
    ],
    tree: {
      "docs/a.md": { over: 1, maxLen: 900, excess: 300 },
      "docs/b.md": { over: 3, maxLen: 900, excess: 700 },
    },
  },
];

function describeRows(
  rows: [string, { over: number; maxLen: number; excess: number }][],
): string[] {
  return rows.map(
    ([rowPath, row]) =>
      `#   ${rowPath} over=${row.over} longest=${row.maxLen} excess=${row.excess}`,
  );
}

export function contractTargets(baseline: RatchetEntry[]): RatchetTargets {
  return {
    version: TARGETS_VERSION,
    ceiling: CONTRACT_CEILING,
    entries: baseline,
  };
}

/** Exactly what the gate returns for each published scenario, unformatted. */
export function contractOutputs(): string[] {
  return SCENARIOS.map(
    (scenario) =>
      runGate(
        new Map(Object.entries(scenario.tree)),
        contractTargets(scenario.baseline),
        scenario.mode,
      ).text,
  );
}

function renderScenario(scenario: Scenario): string {
  const outcome = runGate(
    new Map(Object.entries(scenario.tree)),
    contractTargets(scenario.baseline),
    scenario.mode,
  );

  return [
    `# ${scenario.title}`,
    "# baseline:",
    ...describeRows(scenario.baseline.map((entry) => [entry.path, entry])),
    "# tree:",
    ...describeRows(Object.entries(scenario.tree)),
    `$ pnpm docs:lines${scenario.mode === "update" ? " --update" : ""}`,
    outcome.text,
    `exit ${outcome.code}`,
  ].join("\n");
}

export function renderContract(): string {
  return SCENARIOS.map(renderScenario).join("\n\n");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (import.meta.url === pathToFileURL(invokedPath).href) {
  console.log(renderContract());
}
