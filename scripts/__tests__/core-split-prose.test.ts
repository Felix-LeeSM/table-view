import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classify, segmentAligned } from "../sweep/core-split-prose.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const sweep = "scripts/sweep/core-split-prose.mjs";

// Purpose: `scripts/sweep/core-split-prose.mjs` 의 처분 게이트를 잠근다 — issue #2092
describe("core-split-prose sweep", () => {
  // Reason: `--check` 가 규칙 없는 hit 에도 0 을 내면 게이트가 통째로 가짜가 된다.
  // 처분표는 PR body 의 손 열거를 대신하는 유일한 근거라 fail-open 이 곧 무근거다.
  it("leaves a hit that matches no rule unclassified", () => {
    expect(
      classify({
        arm: "B",
        path: "docs/PLAN.md",
        no: "1",
        evidence: "manifest 미지정",
        text: "- 백엔드는 `cargo test --lib` 로 돌린다",
      }),
    ).toBeNull();
  });

  // Reason: 위 단언만 있으면 `classify` 가 늘 null 을 내도 green 이다. 실제로
  // 쓰이는 처분 하나가 붙는 것을 같이 잠근다.
  it("classifies an app-crate cargo mention by its enclosing manifest", () => {
    expect(
      classify({
        arm: "B",
        path: "src-tauri/tests/snapshot_perf.rs",
        no: "10",
        evidence: "manifest 미지정",
        text: "//! Test 는 항상 release 모드로 측정해야 의미가 있음. cargo test --release 로",
      })?.id,
    ).toBe("B/enclosing-crate-manifest");
  });

  // Reason: `git grep -F` 는 부분일치라 `db/mod.rs` 가 `commands/rdb/mod.rs` 에도
  // 걸린다. 경계가 풀리면 arm A 가 이동과 무관한 자리로 넘쳐 범위 자체가 못 쓰게 된다.
  it("aligns moved-path terms on segment boundaries", () => {
    expect(
      segmentAligned("src-tauri/src/commands/rdb/mod.rs", "db/mod.rs"),
    ).toBe(false);
    expect(
      segmentAligned("src-tauri/table-view-core/src/db/mod.rs", "db/mod.rs"),
    ).toBe(true);
  });

  // Reason: 처분 규칙은 저장소 상태를 읽는다 (감싸는 crate, tail 이 몇 개로 풀리나).
  // 다음 이동이 규칙 밖 자리를 만들면 여기서 red 가 나야 그때 처분이 붙는다.
  it("has a disposition for every hit in the current tree", {
    timeout: 60_000,
  }, () => {
    // execFileSync 가 아니라 spawnSync 인 이유: `--check` 는 처분 안 된 hit 을
    // stdout 에 `UNCLASSIFIED` 줄로 내고 exit 1 한다. execFileSync 는 그때 던지고
    // Error.message 에 stderr 만 붙여서, 정작 어느 줄이 안 걸렸는지가 사라진다.
    const run = spawnSync("node", [sweep, "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 50_000,
    });
    expect(run.stdout).not.toContain("UNCLASSIFIED");
    expect(run.stdout).toContain("unclassified=0");
    expect(run.status).toBe(0);
  });
});
