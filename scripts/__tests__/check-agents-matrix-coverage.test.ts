import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAgentsMatrixCoverage } from "../check-agents-matrix-coverage";

function withFixture(
  files: Record<string, string>,
  run: (cwd: string) => void,
) {
  const cwd = mkdtempSync(join(tmpdir(), "table-view-agents-matrix-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(cwd, path);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content);
    }
    run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// Build a by-task index where `room` is referenced under `count` distinct task
// sections, mirroring scripts/regenerate-indexes.sh output.
function byTaskWith(room: string, count: number, title = "Room"): string {
  const sections = Array.from(
    { length: count },
    (_, i) => `### task-${i}\n\n- [${title}](../../${room})\n`,
  ).join("\n");
  return `# By-task 인덱스\n\n## 작업 → 룰 / 방 매핑\n\n${sections}`;
}

function agentsWith(matrixPaths: string[]): string {
  const rows = matrixPaths.map((p) => `| task | \`${p}\` |`).join("\n");
  return [
    "# Agent Entry",
    "",
    "## 작업 type → 먼저 read",
    "",
    "| 작업 | path |",
    "| --- | --- |",
    rows,
    "",
    "## 강제 룰",
    "",
    "- some prose rule.",
    "",
  ].join("\n");
}

describe("checkAgentsMatrixCoverage", () => {
  it("flags a high-reference room missing from the matrix", () => {
    withFixture(
      {
        "memory/index/by-task.md": byTaskWith(
          "memory/runbook/pr-merge-gates/memory.md",
          9,
        ),
        "AGENTS.md": agentsWith(["memory/workflow/delivery/memory.md"]),
      },
      (cwd) => {
        expect(checkAgentsMatrixCoverage(cwd).issues).toEqual([
          { room: "memory/runbook/pr-merge-gates/memory.md", count: 9 },
        ]);
      },
    );
  });

  it("passes once the room is added to the matrix section", () => {
    withFixture(
      {
        "memory/index/by-task.md": byTaskWith(
          "memory/runbook/pr-merge-gates/memory.md",
          9,
        ),
        "AGENTS.md": agentsWith(["memory/runbook/pr-merge-gates/memory.md"]),
      },
      (cwd) => {
        expect(checkAgentsMatrixCoverage(cwd).issues).toEqual([]);
      },
    );
  });

  it("ignores rooms referenced below the threshold", () => {
    withFixture(
      {
        "memory/index/by-task.md": byTaskWith("memory/product/memory.md", 6),
        "AGENTS.md": agentsWith(["memory/workflow/delivery/memory.md"]),
      },
      (cwd) => {
        expect(checkAgentsMatrixCoverage(cwd).issues).toEqual([]);
      },
    );
  });

  it("does not count a room mentioned only outside the matrix section", () => {
    // Same high-ref room, but the AGENTS.md reference sits under `## 강제 룰`,
    // not the matrix — so it is not considered routed.
    const agents = [
      "# Agent Entry",
      "",
      "## 작업 type → 먼저 read",
      "",
      "| task | `memory/workflow/delivery/memory.md` |",
      "",
      "## 강제 룰",
      "",
      "- see `memory/runbook/pr-merge-gates/memory.md` for merge policy.",
      "",
    ].join("\n");
    withFixture(
      {
        "memory/index/by-task.md": byTaskWith(
          "memory/runbook/pr-merge-gates/memory.md",
          9,
        ),
        "AGENTS.md": agents,
      },
      (cwd) => {
        expect(checkAgentsMatrixCoverage(cwd).issues).toEqual([
          { room: "memory/runbook/pr-merge-gates/memory.md", count: 9 },
        ]);
      },
    );
  });

  it("honors a caller-supplied allowlist", () => {
    withFixture(
      {
        "memory/index/by-task.md": byTaskWith("memory/product/memory.md", 8),
        "AGENTS.md": agentsWith(["memory/workflow/delivery/memory.md"]),
      },
      (cwd) => {
        expect(
          checkAgentsMatrixCoverage(
            cwd,
            7,
            new Set(["memory/product/memory.md"]),
          ).issues,
        ).toEqual([]);
      },
    );
  });

  it("guards the real repo: no high-reference room is missing", () => {
    // Regression guard for the shipped state — keeps AGENTS.md and by-task.md in
    // sync so a newly hub-referenced room cannot land unrouted.
    const result = checkAgentsMatrixCoverage(join(__dirname, "..", ".."));
    expect(result.issues).toEqual([]);
  });
});
