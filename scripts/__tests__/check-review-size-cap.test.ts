import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

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

  // 빈 입력은 통과다 — 이 게이트가 막는 해악은 "너무 길다" 하나뿐이라 0 문자는
  // 못 잰 것이 아니라 실제로 상한 아래다 (스크립트 헤더 「빈 입력은 통과다」).
  it("passes empty input", () => {
    const run = runGate(["PR body"], "");
    expect(run.out).toContain(`PR body 0 chars <= ${MAX}`);
    expect(run.status).toBe(0);
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
  it.each([".github/workflows/ci.yml", ".github/workflows/review-gate.yml"])(
    "is wired into %s",
    (workflow) => {
      const yaml = readFileSync(join(repoRoot, workflow), "utf8");
      expect(yaml).toContain(gate);
    },
  );
});
