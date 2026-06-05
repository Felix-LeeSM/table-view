import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export function defaultFileFixtureDir(kind: "sqlite" | "duckdb"): string {
  if (process.env.TABLE_VIEW_TEST_DATA_DIR) {
    return resolve(process.env.TABLE_VIEW_TEST_DATA_DIR, "fixtures", kind);
  }

  return resolve(primaryWorktreeRoot(), "tmp", "fixtures", kind);
}

function primaryWorktreeRoot(): string {
  const rootFromWorktreeList = gitOutput(["worktree", "list", "--porcelain"])
    .split(/\r?\n/)
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length)
    .trim();
  if (rootFromWorktreeList) return rootFromWorktreeList;

  const rootFromRevParse = gitOutput(["rev-parse", "--show-toplevel"]).trim();
  return rootFromRevParse || process.cwd();
}

function gitOutput(args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}
