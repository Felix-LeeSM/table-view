// The published behavior contract for `pnpm docs:lines`.
//
// docs/quality/doc-size-ratchet.md embeds `renderContract()` verbatim and
// scripts/__tests__/check-doc-line-length.test.ts fails when the page and this
// output disagree. That is the point: the SOT page cannot describe behavior the
// gate does not have, because the page IS the gate's output. Hand-written
// restatements of the contract drifted in three consecutive review rounds; this
// file is what replaces them.
//
// Every scenario below runs the real `runGate`, so adding a branch to the gate
// without a scenario leaves the branch undocumented, and changing a message
// without regenerating the page turns the doc red.
//
// Regenerate the page block with `pnpm docs:lines:contract`.

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  runGate,
  type FileMeasurement,
  type RatchetEntry,
} from "./check-doc-line-length";

export const CONTRACT_CEILING = 600;

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

function renderScenario(scenario: Scenario): string {
  const outcome = runGate(
    new Map(Object.entries(scenario.tree)),
    {
      version: 3,
      ceiling: CONTRACT_CEILING,
      entries: scenario.baseline,
    },
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
