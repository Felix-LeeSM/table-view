import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// `scripts/check-review-size-cap.sh` 는 두 required workflow 에서 도는 blocking
// 게이트다 — PR body 는 `.github/workflows/ci.yml` 의 `PR Body Contract` 잡,
// scorecard 는 `.github/workflows/review-gate.yml`. 두 자리 모두 게이트가 green
// 인 것만 보므로 "상한을 넘기면 실제로 red 가 되는가" 와 "무엇을 단위로 재는가"
// 는 아무 데서도 안 돌아 본 적이 없는 질문이 된다 — 이 파일이 그 둘을 판다.
// 픽스처는 전부 메모리와 임시 디렉토리에서 만들고 repo 트리는 건드리지 않는다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-review-size-cap.sh";
const MAX = 12_000;

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function runGate(args: string[], input = "") {
  const run = spawnSync("bash", [gate, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60_000,
  });
  return {
    status: run.status,
    stderr: run.stderr ?? "",
    out: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

/** 임시 파일에 문서를 써서 경로를 돌려준다 (FILE 인자 경로용). */
function seed(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "review-size-cap-"));
  dirs.push(dir);
  const path = join(dir, "scorecard.md");
  writeFileSync(path, body, "utf8");
  return path;
}

describe("check-review-size-cap", () => {
  // 통과 케이스는 stderr 가 비었는지도 본다. `out` 은 stdout+stderr 를 이어
  // 붙이므로 bash 가 오류를 stderr 로 뱉어도 `^ok:` 는 그대로 맞는다.
  it("passes a document under the cap", () => {
    const run = runGate(["PR body"], "a".repeat(MAX - 1));
    expect(run.out).toContain(`PR body 11999 chars <= ${MAX}`);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("fails a document over the cap", () => {
    const run = runGate(["PR body"], "a".repeat(MAX + 1));
    expect(run.out).toContain(`FAIL PR body: 12001 chars > ${MAX}`);
    expect(run.out).not.toMatch(/^ok:/);
    expect(run.status).toBe(1);
  });

  // 상한은 "이하" 라서 정각은 통과해야 한다 — 비교가 `>=` 로 미끄러지면 red 다.
  it("passes at exactly the cap", () => {
    const run = runGate(["scorecard 1"], "a".repeat(MAX));
    expect(run.out).toContain(`scorecard 1 12000 chars <= ${MAX}`);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // 리뷰 산출물은 한국어 산문이고 UTF-8 에서 한 글자가 3 byte 다. 아래 문서는
  // 5,000 문자 / 15,000 byte — cap 안이지만 byte 로 재면 12,000 을 한참 넘는다.
  // 게이트가 `wc -c` 로 (또는 LC_ALL=C 아래 `wc -m` 으로) 회귀하면 여기서만
  // red 가 된다. 위의 ASCII 케이스들은 어느 단위로 재든 같은 답이라 단위를
  // 증명하지 못한다.
  it("counts characters, not bytes", () => {
    const body = "가".repeat(5_000);
    expect(Buffer.byteLength(body, "utf8")).toBe(15_000);
    const run = runGate(["scorecard 5281669771"], body);
    expect(run.out).toContain(`scorecard 5281669771 5000 chars <= ${MAX}`);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("reads the document from a FILE argument", () => {
    const over = seed("나".repeat(MAX + 1));
    const run = runGate(["scorecard 1", over]);
    expect(run.out).toContain(`FAIL scorecard 1: 12001 chars > ${MAX}`);
    expect(run.status).toBe(1);
  });

  // 0 문자는 "상한 아래" 가 아니라 "잴 것을 못 받았다" 다 — 호출자가 stdin 을 안
  // 주거나 인자 자리를 헷갈리면 어느 크기의 문서든 0 으로 읽힌다. 통과로 강등하면
  // 그 호출자는 "쟀고 통과했다" 를 믿는다 (스크립트 헤더 「빈 입력은 검사 불성립이다」).
  it("refuses empty input instead of passing it", () => {
    const run = runGate(["PR body"], "");
    expect(run.out).toContain("잰 문서가 0 문자다");
    expect(run.out).not.toMatch(/^ok:/);
    expect(run.status).toBe(2);
  });

  // 이슈 #2374 가 보고한 증상 그대로: 인자 계약이 <LABEL> [FILE] 인데 파일 경로를
  // LABEL 자리에 넣으면 FILE 이 없어 stdin 을 읽고, stdin 이 비면 0 문자가 된다.
  // 20,000 자 문서가 `ok: <경로> 0 chars <= 12000` 으로 통과하던 자리다.
  //
  // exit 는 1(상한 초과)이 아니라 2(검사 불성립)로 박는다 — 이 호출은 문서를 재서
  // 넘긴 것이 아니라 문서를 아예 못 받은 것이고, 스크립트도 위 "refuses empty input"
  // 과 같은 0 문자 분기에서 끊는다. `not.toBe(0)` 로 두면 그 구분이 1 로 미끄러져도
  // 통과해, 호출자가 「줄여라」로 읽고 인자 자리를 안 고친다.
  it("refuses a FILE path put in the LABEL slot with no stdin", () => {
    const over = seed("x".repeat(MAX + 8_000));
    const run = runGate([over], "");
    expect(run.out).not.toMatch(/^ok:/);
    expect(run.status).toBe(2);
  });

  it("refuses a FILE that is not there", () => {
    const run = runGate(["scorecard 1", join(tmpdir(), "없는-scorecard.md")]);
    expect(run.out).toContain("검사할 문서 파일이 없다");
    expect(run.status).toBe(2);
  });

  // LABEL 이 없으면 위반 줄이 무엇을 가리키는지 못 적는다. 인자 하나를 빼먹은
  // 호출이 "이름 없는 통과" 로 지나가지 않게 검사 불성립으로 끊는다.
  it("refuses a call with no LABEL", () => {
    const run = runGate([], "a".repeat(MAX + 1));
    expect(run.out).toContain("문서 이름(LABEL)이 없다");
    expect(run.status).toBe(2);
  });

  // 위 케이스가 전부 green 이어도 workflow 가 스크립트를 안 부르면 게이트는
  // 없는 것과 같다 — 스텝이 지워지거나 이름이 바뀌면 여기서 잡힌다.
  //
  // **주석 줄은 호출로 안 센다.** 두 workflow 다 스크립트 경로를 산문 주석에도
  // 적으므로, 파일 전체에 경로가 있는지만 보면 스텝을 통째로 지우고 주석만 남겨도
  // 통과한다. 「첫 비공백이 `#` 가 아닌 줄」이라는 같은 판정을 형제 가드
  // scripts/check-ci-test-calls.sh 가 먼저 쓴다 (그 헤더 「무엇을 세는가」).
  //
  // 파이프 모양까지 고정하는 이유: 이 게이트는 개행도 한 글자로 세므로 호출자가
  // `printf '%s\n'` 으로 넘기면 문서에 없던 한 글자가 더해지고, 그러면 같은
  // 「12,000」이 호출 자리마다 다른 수가 된다 (#2321).
  it.each([".github/workflows/ci.yml", ".github/workflows/review-gate.yml"])(
    "calls %s's gate outside a comment, with a pipe that adds no characters",
    (workflow) => {
      const calls = readFileSync(join(repoRoot, workflow), "utf8")
        .split("\n")
        .filter((l) => l.includes(gate) && !l.trimStart().startsWith("#"));
      expect(calls).not.toHaveLength(0);
      for (const call of calls) {
        expect(call).toMatch(/printf '%s' "\$\{?\w+\}?"\s*\|\s*bash /);
        expect(call).toContain(gate);
      }
    },
  );

  // 스텝이 호출을 갖고 있어도 **돌지 않으면** 게이트는 없는 것과 같다. review-gate
  // 의 `Stop at review round 3` 은 의도적으로 exit 1 하고, GitHub 은 `if:` 에 아무
  // 것도 안 적힌 뒤 스텝에 암묵 `success()` 를 건다 — 그래서 라운드 3 이상 ·
  // `reflect:done` 없음 구간에서는 cap 스텝이 통째로 skip 됐다. 하필 그 구간의
  // scorecard 가 가장 길다 (issue #2372). 같은 함정을 같은 파일의
  // `Release reflect:done on a new round` 가 이미 `always()` 로 피한다.
  //
  // 통과 형태는 둘 중 하나다 — `if:` 가 `always()` 를 갖거나, 스텝이 그 exit 1
  // **앞**에 온다. `always()` 만 요구하면 자리를 옮기는 처방이 거짓 red 를 맞는다.
  // `Checkout` 도 같이 잠근다: cap 스텝은 그 checkout 이 놓은 스크립트를 부르므로
  // 둘 중 하나만 돌면 남은 쪽이 없는 파일을 찾는다.
  it.each(["Checkout", "Scorecard size cap"])(
    "runs review-gate's %s even after `Stop at review round 3` exits 1",
    (stepName) => {
      const workflow = parseYaml(
        readFileSync(
          join(repoRoot, ".github/workflows/review-gate.yml"),
          "utf8",
        ),
      ) as {
        jobs: Record<string, { steps: { name?: string; if?: string }[] }>;
      };
      const steps = workflow.jobs["review-gate"].steps;
      const names = steps.map((s) => s.name);
      const stopAt = names.indexOf("Stop at review round 3");
      const at = names.indexOf(stepName);
      expect(stopAt).toBeGreaterThanOrEqual(0);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(
        at < stopAt || (steps[at].if ?? "").includes("always()"),
        `${stepName}(#${at}) 이 Stop at review round 3(#${stopAt}) 뒤인데 if: ${JSON.stringify(steps[at].if ?? null)} 에 always() 가 없다 — 그 exit 1 뒤로는 영영 안 돈다`,
      ).toBe(true);
    },
  );
});
