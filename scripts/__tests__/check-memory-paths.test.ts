import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMemoryPaths } from "../check-memory-paths";

function withFixture(
  files: Record<string, string>,
  run: (cwd: string) => void,
) {
  const cwd = mkdtempSync(join(tmpdir(), "table-view-memory-paths-"));
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

describe("checkMemoryPaths", () => {
  it("flags an inline-code citation of a path that no longer exists", () => {
    withFixture(
      {
        "src/real.ts": "export {};",
        "memory/room/memory.md": "type lives in `src/types/gone.ts` now.",
      },
      (cwd) => {
        expect(checkMemoryPaths(cwd).issues).toEqual([
          {
            source: "memory/room/memory.md",
            line: 1,
            target: "src/types/gone.ts",
          },
        ]);
      },
    );
  });

  it("accepts a citation that still resolves on disk", () => {
    withFixture(
      {
        "src/real.ts": "export {};",
        "memory/room/memory.md": "see `src/real.ts` for the shape.",
      },
      (cwd) => {
        const result = checkMemoryPaths(cwd);
        expect(result.issues).toEqual([]);
        expect(result.pathsChecked).toBe(1);
      },
    );
  });

  it("also scans fenced code blocks", () => {
    withFixture(
      {
        "scripts/present.sh": "#!/usr/bin/env bash",
        "memory/room/memory.md": "```bash\nbash scripts/gone.sh --flag\n```",
      },
      (cwd) => {
        expect(checkMemoryPaths(cwd).issues).toMatchObject([
          { source: "memory/room/memory.md", target: "scripts/gone.sh" },
        ]);
      },
    );
  });

  it("ignores shorthands whose first segment is not a top-level repo dir", () => {
    withFixture(
      {
        "src/real.ts": "export {};",
        // `paradigms/memory.md` is a prose nickname, not a repo-root path.
        "memory/room/memory.md":
          "the heuristic lived in `paradigms/memory.md`.",
      },
      (cwd) => {
        const result = checkMemoryPaths(cwd);
        expect(result.issues).toEqual([]);
        expect(result.pathsChecked).toBe(0);
      },
    );
  });

  it("ignores glob patterns, bare filenames, and allowlisted history notes", () => {
    withFixture(
      {
        "src/real.ts": "export {};",
        "docs/keep.md": "# keep",
        "memory/room/memory.md":
          "glob `src-tauri/**/*.rs`, bare `wdio.conf.ts`, template " +
          "`docs/sprints/sprint-N/contract.md` are all skipped.",
      },
      (cwd) => {
        const result = checkMemoryPaths(cwd);
        expect(result.issues).toEqual([]);
        expect(result.pathsChecked).toBe(0);
      },
    );
  });

  it("honors a caller-supplied allowlist", () => {
    withFixture(
      {
        "src/real.ts": "export {};",
        "memory/room/memory.md": "removed on purpose: `src/legacy/removed.ts`.",
      },
      (cwd) => {
        expect(
          checkMemoryPaths(cwd, new Set(["src/legacy/removed.ts"])).issues,
        ).toEqual([]);
      },
    );
  });
});
