import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// `scripts/check-non-blocking-jobs.sh` 는 CI 의 `PR Body Contract` 잡에서 도는
// blocking 게이트다 (.github/workflows/ci.yml). 그 잡은 게이트가 real 트리에 대해
// green 인 것만 보므로, "이름과 동작을 어긋나게 만들면 정말 red 가 되는가" 는
// 아무 데서도 안 돌아 본 적이 없는 질문이 된다 — 이 파일이 그 질문을 판다.
//
// 픽스처는 저장소의 진짜 `ci.yml` 을 읽어서 변형한다. 손으로 적은 YAML 로 만들면
// 들여쓰기 관례가 갈라지는 날 게이트는 red 인데 이 스위트는 green 인 상태가 된다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-non-blocking-jobs.sh";
const realCi = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

const trees: string[] = [];

afterEach(() => {
  for (const t of trees.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** `<tmp>/.github/workflows/` 에 워크플로 파일을 뿌린 트리를 만든다. */
function seed(workflows: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "non-blocking-jobs-"));
  trees.push(root);
  const dir = join(root, ".github/workflows");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(dir, name), body, "utf8");
  }
  return root;
}

function runGate(root?: string) {
  const run = spawnSync("bash", root ? [gate, root] : [gate], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
  return {
    status: run.status,
    stderr: run.stderr ?? "",
    out: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

// 이 저장소의 진짜 표기. 잡 키는 2칸, 잡 레벨 키는 4칸이다.
const fakeJob = [
  "",
  "  probe-advisory:",
  "    name: Probe Advisory (non-blocking)",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: noop",
  "        run: 'true'",
  "",
].join("\n");

describe("check-non-blocking-jobs", () => {
  // 통과 케이스는 stderr 가 비었는지도 본다.
  it("passes on the real repo tree", () => {
    const run = runGate();
    expect(run.out).toMatch(
      /^ok: 워크플로 \d+ 개 · job \d+ 개 \(이름 있는 것 \d+ 개\) — \(non-blocking\) job \d+ 개가 다 continue-on-error: true/,
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // 이 저장소가 실제로 그 상태였다. 두 `(non-blocking)` 잡에서 플래그를 떼면 둘 다
  // 걸려야 한다 — 줄 번호를 안 박으므로 ci.yml 이 움직여도 이 케이스는 안 낡는다.
  it("fails when the job-level continue-on-error is stripped back off", () => {
    const stripped = realCi
      .split("\n")
      .filter((l) => l !== "    continue-on-error: true")
      .join("\n");
    expect(stripped).not.toBe(realCi);

    const run = runGate(seed({ "ci.yml": stripped }));
    expect(run.out).toContain("job `wasm-size`");
    expect(run.out).toContain("job `dependency-advisories`");
    expect(run.out).toContain("이름과 동작이 어긋난 job 2 개");
    expect(run.out).toContain(".github/workflows/ci.yml:");
    expect(run.status).toBe(1);
  });

  // 불변식이지 한 잡의 플래그가 아니다 — 접미사를 단 새 잡이 생겨도 자동으로
  // 걸려야 한다.
  it("fails on a newly added (non-blocking) job that carries no flag", () => {
    const run = runGate(seed({ "ci.yml": realCi + fakeJob }));
    expect(run.out).toContain("job `probe-advisory`");
    expect(run.out).toContain("이름과 동작이 어긋난 job 1 개");
    expect(run.status).toBe(1);
  });

  // 가장 그럴듯한 오수리. step 의 `continue-on-error` 는 그 step 하나만 삼키고
  // 잡은 여전히 red 로 끝나므로 불변식을 만족시키면 안 된다.
  it("does not accept a step-level continue-on-error as the job-level flag", () => {
    const stepLevel = fakeJob.replace(
      "        run: 'true'",
      "        run: 'true'\n        continue-on-error: true",
    );
    const run = runGate(seed({ "ci.yml": realCi + stepLevel }));
    expect(run.out).toContain("job `probe-advisory`");
    expect(run.status).toBe(1);
  });

  // 값이 런타임에 정해지면 파일만 보고 이름의 약속을 보장할 수 없다. 아래 문자열은
  // JS 템플릿 리터럴이 아니라 워크플로 YAML 에 그대로 들어가는 GitHub Actions 식
  // 표기다 — 대상이 쓰는 표기를 안 쓰면 이 픽스처가 실제 회귀를 못 잡는다.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Actions 식 표기 그대로
  for (const value of ["false", "${{ github.event_name == 'push' }}"]) {
    it(`does not accept continue-on-error: ${value}`, () => {
      const withValue = fakeJob.replace(
        "    runs-on: ubuntu-latest",
        `    runs-on: ubuntu-latest\n    continue-on-error: ${value}`,
      );
      const run = runGate(seed({ "ci.yml": realCi + withValue }));
      expect(run.out).toContain("job `probe-advisory`");
      expect(run.status).toBe(1);
    });
  }

  // YAML 은 따옴표를 씌워도 같은 값이다. 이 저장소는 안 쓰지만, 따옴표 한 쌍으로
  // 게이트를 통째로 우회할 수 있으면 불변식이 아니다.
  it("catches the quoted name form", () => {
    const quoted = fakeJob.replace(
      "    name: Probe Advisory (non-blocking)",
      '    name: "Probe Advisory (non-blocking)"',
    );
    const run = runGate(seed({ "ci.yml": realCi + quoted }));
    expect(run.out).toContain("job `probe-advisory`");
    expect(run.status).toBe(1);
  });

  it("passes the same job once the job-level flag is there", () => {
    const fixed = fakeJob.replace(
      "    runs-on: ubuntu-latest",
      "    runs-on: ubuntu-latest\n    continue-on-error: true",
    );
    const run = runGate(seed({ "ci.yml": realCi + fixed }));
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 반대 방향은 안 본다. 접미사가 없으면 플래그가 없어도 위반이 아니다 — 안 그러면
  // 이 게이트가 모든 잡에 플래그를 요구하게 된다.
  it("ignores a job without the suffix that has no flag", () => {
    const plain = fakeJob.replace(
      "    name: Probe Advisory (non-blocking)",
      "    name: Probe Advisory",
    );
    const run = runGate(seed({ "ci.yml": realCi + plain }));
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 접미사가 문자열 안에 있을 뿐 이름의 끝이 아니면 판정 대상이 아니다.
  it("only matches the suffix at the end of the name", () => {
    const middle = fakeJob.replace(
      "    name: Probe Advisory (non-blocking)",
      "    name: Probe (non-blocking) Advisory",
    );
    const run = runGate(seed({ "ci.yml": realCi + middle }));
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 아래 넷은 "훑지 못한 것을 위반 0 으로 통과시키지 않는다" 를 판다. 파서가
  // 아무것도 못 보면서 green 이 되는 것이 이 게이트의 기본 fail-open 이다.
  it("refuses a root with no workflow directory", () => {
    const root = mkdtempSync(join(tmpdir(), "non-blocking-jobs-nodir-"));
    trees.push(root);
    const run = runGate(root);
    expect(run.out).toContain("워크플로 디렉토리가 없다");
    expect(run.status).toBe(2);
  });

  it("refuses a workflow directory with no yml/yaml file", () => {
    const root = seed({});
    writeFileSync(join(root, ".github/workflows/README.md"), "빈 디렉토리\n");
    const run = runGate(root);
    expect(run.out).toContain("워크플로 파일이 0 개다");
    expect(run.status).toBe(2);
  });

  // `jobs:` 표기나 들여쓰기 관례가 바뀌면 파서가 0 개를 읽는다. 그때 나가야 하는
  // 답은 통과가 아니다.
  it("refuses a tree where no job parses", () => {
    const run = runGate(
      seed({ "ci.yml": "name: CI\non:\n  push:\n    branches: [main]\n" }),
    );
    expect(run.out).toContain("job 을 0 개 읽었다");
    expect(run.status).toBe(2);
  });

  // job 은 읽었는데 이름을 하나도 못 뽑았다면 이름 추출이 깨진 것이다. 그 상태로는
  // `(non-blocking)` 판정이 영원히 0 건이라 게이트가 조용히 아무것도 안 지킨다.
  it("refuses a tree where jobs parse but no job-level name does", () => {
    const run = runGate(
      seed({
        "ci.yml":
          "jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - name: noop\n        run: 'true'\n",
      }),
    );
    expect(run.out).toContain("이름 추출이 깨졌다");
    expect(run.status).toBe(2);
  });

  // 판정은 `.github/workflows/` 전체다. ci.yml 만 보면 다른 파일에 생긴 위반이
  // 안 걸린다.
  it("covers workflow files other than ci.yml", () => {
    const run = runGate(
      seed({ "ci.yml": realCi, "other.yml": `jobs:${fakeJob}` }),
    );
    expect(run.out).toContain(".github/workflows/other.yml:");
    expect(run.out).toContain("job `probe-advisory`");
    expect(run.status).toBe(1);
  });
});
