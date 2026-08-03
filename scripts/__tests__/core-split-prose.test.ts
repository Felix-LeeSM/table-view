import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classify,
  cwdFromBlock,
  normalizeToken,
  segmentAligned,
} from "../sweep/core-split-prose.mjs";

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

  // Reason: arm B 는 줄 단위라 펜스 블록 첫 줄의 `cd <dir>` 를 못 본다. 그 문맥을
  // 안 읽으면 정상 문서가 미처분 hit 으로 남아 게이트가 red 로 굳는다.
  it("reads the working directory a fenced block sets", () => {
    const block = [
      "```bash",
      "cd src-tauri",
      "cargo llvm-cov nextest --profile push --lib",
      "```",
      "cd src-tauri",
    ];
    expect(cwdFromBlock(block, 3)).toBe("src-tauri");
    // 블록이 닫힌 뒤의 `cd` 는 문맥을 안 세운다.
    expect(cwdFromBlock(block, 5)).toBeNull();
  });

  // Reason: `PATH_TOKEN` 문자셋에 `.` 가 있어서 생략 표기와 문장부호가 토큰에 붙어
  // 온다. 안 벗기면 evidence 가 `git ls-files` 로 안 풀려 처분 규칙이 불발한다.
  it("strips ellipsis and trailing punctuation off a path token", () => {
    expect(normalizeToken(".../db/mysql/connection.rs")).toBe(
      "db/mysql/connection.rs",
    );
    expect(normalizeToken("src-tauri/src/**")).toBe("src-tauri/src");
    // 상대 경로 `../` 는 생략 표기가 아니다 — 건드리지 않는다.
    expect(normalizeToken("../review/memory.md")).toBe("../review/memory.md");
  });

  // Reason: 얕은 체크아웃(`actions/checkout` 기본값 depth 1)에는 그 커밋 객체가
  // 없다. 예전엔 `fatal: bad object` 만 남고 stdout 이 비어서, 게이트가 red 인데
  // 원인이 안 보였다.
  it("names the shallow-clone cause when the merge commit is missing", () => {
    const run = spawnSync(
      "node",
      [sweep, "--check", "--merge", "0".repeat(40)],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 50_000,
      },
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("fetch-depth: 0");
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
    // 죽은 경우를 먼저 가른다 — stdout 이 비면 아래 두 단언은 원인을 못 보여준다
    // (`not.toContain` 은 빈 문자열에서 무조건 통과한다). `merge=` 는 `--check` 가
    // 무조건 내는 첫 줄이라, 이 단언은 "돌기는 했나" 만 묻는다.
    expect(run.error ?? null).toBeNull();
    expect(
      run.stdout,
      `sweep produced no output; stderr: ${run.stderr}`,
    ).toContain("merge=");
    expect(run.stdout).not.toContain("UNCLASSIFIED");
    expect(run.stdout).toContain("unclassified=0");
    expect(run.status).toBe(0);
  });
});
