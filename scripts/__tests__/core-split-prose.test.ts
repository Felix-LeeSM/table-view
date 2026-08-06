import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CARDINAL,
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
  // 처분표는 PR body 의 손 열거를 대신하는 근거라 fail-open 이 곧 무근거다.
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

  // Reason: 명사 목록에서 `step` 을 빼는 것이 오탐을 없애는 가장 짧은 길이지만,
  // 그러면 이 스윕이 실제로 고친 `without these two steps` 를 놓친다. 잡는 쪽은
  // 넓게 두고 부사구만 처분으로 걷는다 — 양쪽을 같이 잠근다.
  it("keeps counted steps detectable and disposes only the adverbial one", () => {
    expect(
      CARDINAL.test(
        "# db/models/storage/error tree, so without these two steps ~60% of the",
      ),
    ).toBe(true);
    expect(
      classify({
        arm: "C",
        path: "docs/contributor-guide/testing-and-quality.md",
        no: "170",
        evidence: "one step",
        text: "`mongosh-parser-core` sits one step further out — it is not in",
      })?.id,
    ).toBe("C/adverbial-distance");
    expect(
      classify({
        arm: "C",
        path: ".github/workflows/ci.yml",
        no: "460",
        evidence: "two steps",
        text: "# db/models/storage/error tree, so without these two steps ~60% of the",
      }),
    ).toBeNull();
  });

  // Reason: 한국어 수사는 단위 명사 없이 계사로 닫힌다 — 「다섯이다」, 축약형
  // 「하나다」. 단위 명사만 요구하던 동안 그 형태가 통째로 빠졌고, #2161 이 블록에서
  // 한 줄을 지웠는데 그 줄을 세던 문장이 남아도 스윕이 green 이었다.
  // 아래 둘은 각각 이 정규식의 결정 하나씩을 가른다 — 「하나다」는 계사 갈래에 맨
  // `다` 를 넣은 결정을, `x86_64입니다` 는 앞 경계에 `_` 를 넣은 결정을 문다.
  // 「둘 다」로는 못 가른다: 계사 갈래가 수사에 구분자 없이 붙어서, 맨 `다` 가 있든
  // 없든 띄어 쓴 「둘 다」는 안 걸린다 (실측). 그 단언은 어느 설계에서도 통과한다.
  it("detects a Korean numeral closed by a copula, including the short form", () => {
    expect(CARDINAL.test("이 저장소의 검사는 다섯이다.")).toBe(true);
    expect(CARDINAL.test("검사는 넷이고 그중 하나는 rustfmt 다")).toBe(true);
    expect(CARDINAL.test("이 저장소의 검사는 하나다")).toBe(true);
    expect(CARDINAL.test("x86_64입니다")).toBe(false);
  });

  // Reason: 세는 문장은 블록 **앞**에 있고 블록이 길면 cargo 줄의 WINDOW 밖으로
  // 밀린다. `fenceOpenerAbove` 가 무엇을 계산하나와 그것이 `armC` 에서 **불리기는
  // 하나**는 다른 축이다 — 앞 축만 재면 배선을 지워도 아무 신호가 안 난다.
  // 그래서 스윕을 픽스처 저장소에 통째로 돌린다: 배선을 지우면 이 hit 이 사라진다
  // (실측 — `arm_c_closed_count` 1 → 0).
  it("anchors the arm-C window on the fence, wiring included", () => {
    const dir = mkdtempSync(join(tmpdir(), "core-split-prose-"));
    const g = (...argv: string[]) =>
      execFileSync("git", argv, { cwd: dir, encoding: "utf8" });
    try {
      g("init", "-q", "-b", "main", ".");
      g("config", "user.email", "t@example.invalid");
      g("config", "user.name", "t");
      g("config", "commit.gpgsign", "false");
      writeFileSync(join(dir, "seed.txt"), "seed\n");
      g("add", "-A");
      g("commit", "-qm", "seed");
      g("checkout", "-q", "-b", "side");
      writeFileSync(join(dir, "side.txt"), "side\n");
      g("add", "-A");
      g("commit", "-qm", "side");
      g("checkout", "-q", "main");
      g("merge", "-q", "--no-ff", "side", "-m", "merge");
      const merge = g("log", "--merges", "-1", "--format=%H").trim();
      // 세는 문장 :3, 펜스 :5, cargo 줄 :9. |9-3| = 6 > WINDOW, |5-3| = 2 <= WINDOW.
      writeFileSync(
        join(dir, "fixture.md"),
        [
          "# fixture",
          "",
          "이 저장소의 검사는 다섯이다.",
          "",
          "```bash",
          "pnpm lint",
          "pnpm test",
          "pnpm build",
          "cargo fmt --all --check",
          "```",
          "",
        ].join("\n"),
      );
      g("add", "-A");
      g("commit", "-qm", "fixture");

      const run = spawnSync("node", [join(repoRoot, sweep), "--merge", merge], {
        cwd: dir,
        encoding: "utf8",
        timeout: 50_000,
      });
      expect(run.error ?? null).toBeNull();
      expect(run.stdout, `stderr: ${run.stderr}`).toContain("merge=");
      expect(run.stdout).toContain("arm_c_closed_count=1");
      expect(run.stdout).toContain("fixture.md:3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Reason: 다른 게이트의 테스트가 임시 트리에 뿌리는 픽스처 workflow 문자열은
  // 파서 입력이지 실행 지시가 아니다. 면제는 그 파일의 arm B 에만 걸어야 한다 —
  // arm 조건이 풀리면 같은 파일에 생길 경로·개수 주장까지 조용히 덮는다.
  it("exempts only the arm-B cargo text of a gate's test fixtures", () => {
    const fixture = {
      path: "scripts/__tests__/check-ci-test-calls.test.ts",
      no: "141",
    };
    expect(
      classify({
        ...fixture,
        arm: "B",
        evidence: "manifest 미지정",
        text: "      workflow: `      - run: cargo test --test called_one_extra\\n`,",
      })?.id,
    ).toBe("B/gate-test-fixture");
    expect(
      classify({
        ...fixture,
        arm: "A",
        evidence: "src-tauri/src/db",
        text: "// src-tauri/src/db 에 있다",
      }),
    ).toBeNull();
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
