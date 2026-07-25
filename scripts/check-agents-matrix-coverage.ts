#!/usr/bin/env node

// AGENTS.md matrix coverage gate (issue #1755).
//
// `AGENTS.md` carries a hand-curated "작업 type → 먼저 read" matrix that routes an
// agent from a task intent to the memory room it should read first. Rooms are
// added to `memory/**` continuously, and `memory/index/by-task.md` is the
// AUTO-generated task→room index (from each room's frontmatter `task:` keys).
// Nothing compares the two, so a room can accrete many task intents and become a
// cross-cutting routing hub while the hand-written matrix silently lags behind.
//
// This gate closes that loop: it counts how many by-task sections reference each
// room (= how many distinct task intents route to it) and fails if a HIGH-
// reference room is absent from the AGENTS.md matrix section.
//
// Threshold (HIGH_REFERENCE_THRESHOLD = 7), kept conservative on purpose:
//   - A room's by-task reference count equals the number of distinct task
//     intents whose routing lands on it. The distribution is long-tailed — most
//     rooms serve 1-3 intents; only a handful are genuine cross-cutting hubs.
//   - 7 is the tightest cutoff that currently isolates exactly the real anomaly
//     (`memory/runbook/pr-merge-gates/memory.md`, 9 — the single most-referenced
//     room in the whole index) while every other 7+ room (`git-policy`, 7) is
//     already in the matrix. Lower cutoffs (4-6) sweep in rooms deliberately
//     routed via by-surface or hub pages (product, state-management, data-source,
//     hooks), turning a signal into chronic false positives that would either
//     bloat the intentionally-lazy matrix or grow an allowlist — the very
//     "growing allowlist means tighten the heuristic" anti-pattern that
//     check-memory-paths.ts warns about.
//
// The row for the most-referenced room (pr-merge-gates) was already added by
// hand in #1762; this gate is the automation that keeps future top-tier hubs
// from silently drifting out of sync the same way.
//
// A tiny ALLOWLIST is the escape hatch for a high-reference room that is
// intentionally NOT a top-level matrix row (reached via by-surface / a hub page
// instead). Keep it tiny and justify each entry — a growing list means the
// threshold or heuristic needs revisiting, not more exceptions.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BY_TASK_INDEX = "memory/index/by-task.md";
const AGENTS_ENTRY = "AGENTS.md";

// The matrix lives under this heading; coverage is scoped to it (not the whole
// file) so a room merely name-dropped in a prose rule does not count as routed.
const MATRIX_HEADING = /작업 type/;

export const HIGH_REFERENCE_THRESHOLD = 7;

// High-reference rooms intentionally kept out of the top-level matrix. Empty on
// purpose today: with the pr-merge-gates row in place (#1762), no 7+ room is missing.
const DEFAULT_ALLOWLIST = new Set<string>([]);

const ROOM_LINK = /\(\.\.\/\.\.\/(memory\/[A-Za-z0-9_./-]+\.md)\)/g;
const MEMORY_PATH = /memory\/[A-Za-z0-9_./-]+\.md/g;

export interface MatrixCoverageIssue {
  room: string;
  count: number;
}

export interface MatrixCoverageResult {
  threshold: number;
  roomsScanned: number;
  coveredCount: number;
  issues: MatrixCoverageIssue[];
}

// Count by-task references per room. Each `### <task>` section lists a room at
// most once, so the total occurrences of a room's link equal the number of task
// intents routing to it.
export function countRoomReferences(
  byTaskMarkdown: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of byTaskMarkdown.matchAll(ROOM_LINK)) {
    const room = match[1];
    if (!room) continue;
    counts.set(room, (counts.get(room) ?? 0) + 1);
  }
  return counts;
}

// Memory rooms reachable from the AGENTS.md matrix section (heading → next `## `).
export function matrixCoveredRooms(agentsMarkdown: string): Set<string> {
  const lines = agentsMarkdown.split(/\r?\n/);
  const covered = new Set<string>();
  let inMatrix = false;

  for (const line of lines) {
    if (/^## /.test(line)) {
      inMatrix = MATRIX_HEADING.test(line);
      continue;
    }
    if (!inMatrix) continue;
    for (const match of line.matchAll(MEMORY_PATH)) covered.add(match[0]);
  }

  return covered;
}

export function checkAgentsMatrixCoverage(
  cwd = process.cwd(),
  threshold: number = HIGH_REFERENCE_THRESHOLD,
  allowlist: Set<string> = DEFAULT_ALLOWLIST,
): MatrixCoverageResult {
  const byTaskPath = resolve(cwd, BY_TASK_INDEX);
  const agentsPath = resolve(cwd, AGENTS_ENTRY);

  const counts =
    existsSync(byTaskPath) &&
    // The index is required to evaluate coverage; a missing index means there is
    // nothing to compare, not a violation.
    existsSync(agentsPath)
      ? countRoomReferences(readFileSync(byTaskPath, "utf8"))
      : new Map<string, number>();
  const covered = existsSync(agentsPath)
    ? matrixCoveredRooms(readFileSync(agentsPath, "utf8"))
    : new Set<string>();

  const issues: MatrixCoverageIssue[] = [];
  for (const [room, count] of counts) {
    if (count < threshold) continue;
    if (covered.has(room)) continue;
    if (allowlist.has(room)) continue;
    issues.push({ room, count });
  }
  issues.sort((a, b) => b.count - a.count || a.room.localeCompare(b.room));

  return {
    threshold,
    roomsScanned: counts.size,
    coveredCount: covered.size,
    issues,
  };
}

function main() {
  const result = checkAgentsMatrixCoverage();
  if (result.issues.length > 0) {
    console.error(
      `agents:matrix failed (${result.issues.length} high-reference room(s) ` +
        `missing from AGENTS.md matrix, threshold >=${result.threshold})`,
    );
    for (const issue of result.issues) {
      console.error(
        `  ${issue.room} :: referenced by ${issue.count} task intents but not routed in AGENTS.md`,
      );
    }
    console.error(
      "Add a `작업 type → 먼저 read` row (or, if intentionally hub-routed, an allowlist entry with a reason).",
    );
    process.exit(1);
  }

  console.log(
    `agents:matrix ok (${result.roomsScanned} rooms scanned, ${result.coveredCount} matrix paths, threshold >=${result.threshold})`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (import.meta.url === pathToFileURL(invokedPath).href) main();
