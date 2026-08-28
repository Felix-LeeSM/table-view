import { spawnSync } from "node:child_process";
import {
  chmodSync,
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

// `scripts/check-apt-timeout.mjs` 는 CI 의 `Frontend Checks` 잡에서 도는 blocking
// 게이트다 (.github/workflows/ci.yml). 그 잡은 게이트가 real 트리에 대해 green 인
// 것만 보므로, "apt 스텝에서 `timeout-minutes` 를 떼면 정말 red 가 되는가" 는 아무
// 데서도 안 돌아 본 적이 없는 질문이 된다 — 이 파일이 그 질문을 판다.
//
// 픽스처는 저장소의 진짜 `ci.yml` 을 읽어서 변형한다. 손으로 적은 YAML 로 만들면
// 표기 관례가 갈라지는 날 게이트는 red 인데 이 스위트는 green 인 상태가 된다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-apt-timeout.mjs";
const realCi = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

const trees: string[] = [];
const restores: Array<() => void> = [];

afterEach(() => {
  for (const undo of restores.splice(0)) undo();
  for (const t of trees.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** 읽기 권한을 뺏는다. 정리 때 되돌려야 임시 트리가 지워진다. */
function denyRead(path: string, restoreMode: number): void {
  chmodSync(path, 0o000);
  restores.push(() => chmodSync(path, restoreMode));
}

// root 는 권한 비트를 무시하고 다 읽는다 — 권한 케이스가 컨테이너 안에서 조용히
// 거짓 green 이 되지 않게 건너뛴다 (check-non-blocking-jobs.test.ts 와 같은 이유).
const asRoot = process.getuid?.() === 0;

/** `<tmp>/.github/workflows/` 에 워크플로 파일을 뿌린 트리를 만든다. */
function seed(workflows: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "apt-timeout-"));
  trees.push(root);
  const dir = join(root, ".github/workflows");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(dir, name), body, "utf8");
  }
  return root;
}

function runGate(root?: string) {
  const run = spawnSync("node", root ? [gate, root] : [gate], {
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

/** apt 를 부르는 job 하나. `run:` 본문은 호출 표기만 바꿔 가며 쓴다. */
function aptJob(runBody: string, extraStepKeys = ""): string {
  return [
    "",
    "  probe-apt:",
    "    name: Probe Apt",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Install something",
    ...(extraStepKeys ? [extraStepKeys] : []),
    "        run: |",
    ...runBody.split("\n").map((l) => `          ${l}`),
    "",
  ].join("\n");
}

describe("check-apt-timeout", () => {
  // 통과 케이스는 stderr 가 비었는지도 본다.
  it("passes on the real repo tree", () => {
    const run = runGate();
    expect(run.out).toMatch(
      /^ok: 워크플로 \d+ 개 · job \d+ 개 · step \d+ 개 · apt 스텝 \d+ 개 — 전부 timeout-minutes 를 갖는다/,
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // 판별력 대조군. 진짜 `ci.yml` 에서 스텝 레벨 `timeout-minutes` 를 전부 떼면 apt
  // 스텝이 전부 걸려야 한다 — 안 걸리면 이 게이트는 아무것도 안 재면서 green 인
  // 것이다. 줄 번호를 안 박으므로 ci.yml 이 움직여도 이 케이스는 안 낡는다.
  it("fails once the step-level timeout-minutes are stripped back off", () => {
    const stripped = realCi
      .split("\n")
      // 8칸 = 스텝 레벨. job 레벨(4칸)은 남겨 둔다 — 그것이 스텝을 안 끊는다는 것이
      // 위 케이스가 파는 별개의 사실이다.
      .filter((l) => !/^ {8}timeout-minutes:/.test(l))
      .join("\n");
    expect(stripped).not.toBe(realCi);

    const run = runGate(seed({ "ci.yml": stripped }));
    expect(run.out).toContain("Install Tauri Linux dependencies");
    expect(run.out).toContain("Install libdbus for keyring's Linux backend");
    expect(run.out).toContain(".github/workflows/ci.yml:");
    expect(run.status).toBe(1);
  });

  // 불변식이지 지금 있는 자리들의 목록이 아니다 — apt 를 부르는 새 스텝이 생겨도
  // 자동으로 걸려야 한다. 이 저장소에 다섯 자리가 쌓인 경로가 정확히 이것이다.
  it("fails on a newly added apt step that carries no timeout", () => {
    const run = runGate(
      seed({
        "ci.yml":
          realCi + aptJob("sudo apt-get update\nsudo apt-get install -y jq"),
      }),
    );
    expect(run.out).toContain("job `probe-apt`");
    expect(run.out).toContain("스텝 `Install something`");
    expect(run.out).toContain("timeout 없는 apt 스텝 1 개");
    expect(run.status).toBe(1);
  });

  it("passes the same step once the timeout is there", () => {
    const run = runGate(
      seed({
        "ci.yml":
          realCi +
          aptJob(
            "sudo apt-get update\nsudo apt-get install -y jq",
            "        timeout-minutes: 10",
          ),
      }),
    );
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 가장 그럴듯한 오수리. job 레벨 budget 은 스텝을 안 끊는다 — 매달린 apt 는 그
  // budget 을 다 태우고 job 이 `cancelled` 로 끝난다. 그 상태를 통과시키면 이
  // 게이트가 막으려던 것을 그대로 통과시키는 것이다.
  it("does not accept a job-level timeout-minutes as the step-level one", () => {
    const jobLevel = aptJob(
      "sudo apt-get update\nsudo apt-get install -y jq",
    ).replace(
      "    runs-on: ubuntu-latest",
      "    runs-on: ubuntu-latest\n    timeout-minutes: 25",
    );
    const run = runGate(seed({ "ci.yml": realCi + jobLevel }));
    expect(run.out).toContain("job `probe-apt`");
    expect(run.status).toBe(1);
  });

  // 리터럴 두 개(`apt-get update` · `apt-get install`)로만 재면 같은 명령의 다른
  // 표기가 통째로 빠진다. 아래는 전부 apt 를 실제로 부르는 형태다.
  for (const call of [
    "sudo apt-get update",
    "sudo apt-get install -y jq",
    "sudo apt-get -y install jq",
    "sudo apt update",
    "sudo apt install -y jq",
    "apt-get build-dep -y foo",
    "sudo DEBIAN_FRONTEND=noninteractive apt-get -qq install jq",
  ]) {
    it(`catches the call form: ${call}`, () => {
      const run = runGate(seed({ "ci.yml": realCi + aptJob(call) }));
      expect(run.out).toContain("job `probe-apt`");
      expect(run.status).toBe(1);
    });
  }

  // 반대 방향. apt 를 안 부르는 스텝에까지 요구하면 이 게이트가 모든 스텝에
  // timeout 을 요구하게 된다.
  it("ignores a step with no timeout that does not call apt", () => {
    const run = runGate(
      seed({ "ci.yml": realCi + aptJob("echo hello\nnpm ci") }),
    );
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 바이너리 토큰만 있고 서브커맨드가 없으면 apt 호출이 아니다. 영어 낱말 "apt" 가
  // 산문에 나오는 자리를 잡으면 게이트가 거짓 red 를 낸다.
  it("ignores prose that merely contains the word apt", () => {
    const run = runGate(
      seed({ "ci.yml": realCi + aptJob('echo "an apt name for this script"') }),
    );
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 바이너리 토큰과 서브커맨드가 서로 다른 줄에 있으면 한 호출이 아니다.
  it("does not join an apt token and a subcommand across lines", () => {
    const run = runGate(
      seed({ "ci.yml": realCi + aptJob('echo apt\necho "update done"') }),
    );
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // YAML 주석은 파서가 데이터에서 뺀다. 스텝 위 설명 주석이 apt 를 언급한다고 그
  // 스텝이 apt 스텝이 되면, 이 저장소처럼 스텝마다 사유를 적는 트리에서 거짓 red 가
  // 쏟아진다.
  it("does not treat a YAML comment above a step as an apt call", () => {
    const commented = aptJob("echo hello").replace(
      "      - name: Install something",
      "      # sudo apt-get install -y jq 를 여기서 부르곤 했다\n      - name: Install something",
    );
    const run = runGate(seed({ "ci.yml": realCi + commented }));
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 판정은 `.github/workflows/` 전체다. ci.yml 만 보면 다른 파일에 생긴 위반이 안
  // 걸리는데, 이 이슈가 센 다섯 자리 중 둘이 ci.yml 밖이었다.
  it("covers workflow files other than ci.yml", () => {
    const run = runGate(
      seed({
        "ci.yml": realCi,
        "other.yml": `jobs:${aptJob("sudo apt-get update")}`,
      }),
    );
    expect(run.out).toContain(".github/workflows/other.yml:");
    expect(run.out).toContain("job `probe-apt`");
    expect(run.status).toBe(1);
  });

  // 집계 줄이 통과 경로에만 있으면 반쪽이다. 헤더가 "수치를 인용하려면 이 출력을
  // 써라" 라고 하는데, 위반이 있을 때 숫자가 사라지면 인용할 상태가 없다.
  it("prints the tally on the violation path too", () => {
    const run = runGate(
      seed({ "ci.yml": realCi + aptJob("sudo apt-get update") }),
    );
    expect(run.out).toMatch(
      /집계: 워크플로 \d+ 개 · job \d+ 개 · step \d+ 개 · apt 스텝 \d+ 개/,
    );
    expect(run.status).toBe(1);
  });

  // 아래 다섯은 "훑지 못한 것을 위반 0 으로 통과시키지 않는다" 를 판다. 파서가
  // 아무것도 못 보면서 green 이 되는 것이 이 게이트의 기본 fail-open 이다.
  it("refuses a root with no workflow directory", () => {
    const root = mkdtempSync(join(tmpdir(), "apt-timeout-nodir-"));
    trees.push(root);
    const run = runGate(root);
    expect(run.out).toContain("워크플로 디렉토리를 못 읽었다");
    expect(run.out).toContain("집계:");
    expect(run.status).toBe(2);
  });

  it("refuses a workflow directory with no yml/yaml file", () => {
    const root = seed({});
    writeFileSync(join(root, ".github/workflows/README.md"), "빈 디렉토리\n");
    const run = runGate(root);
    expect(run.out).toContain("워크플로 파일이 0 개다");
    expect(run.status).toBe(2);
  });

  it.skipIf(asRoot)("refuses when a workflow file cannot be read", () => {
    const root = seed({ "ci.yml": realCi });
    const locked = join(root, ".github/workflows/locked.yml");
    writeFileSync(locked, "jobs:\n  a:\n    steps:\n      - run: 'true'\n");
    denyRead(locked, 0o644);
    const run = runGate(root);
    expect(run.out).toContain("못 읽었다");
    expect(run.status).toBe(2);
  });

  it("refuses a workflow file that does not parse as YAML", () => {
    const run = runGate(
      seed({ "ci.yml": realCi, "broken.yml": "jobs:\n  a: [unclosed\n" }),
    );
    expect(run.out).toContain("YAML 로 안 읽힌다");
    expect(run.status).toBe(2);
  });

  // 파일은 읽혔는데 `jobs` 가 없는 경우. 잘린 파일이 "위반 0" 으로 통과하면 그
  // 파일에 무엇이 있었든 안 재고 green 이다.
  it("refuses a workflow file with no jobs mapping", () => {
    const run = runGate(
      seed({
        "ci.yml": realCi,
        "other.yml": "name: CI\non:\n  push:\n    branches: [main]\n",
      }),
    );
    expect(run.out).toContain("`jobs` 매핑이 없다");
    expect(run.status).toBe(2);
  });

  // job 은 읽었는데 step 을 하나도 못 읽었다면 파서가 깨진 것이다. 그 상태로는 apt
  // 판정이 영원히 0 건이라 게이트가 조용히 아무것도 안 지킨다.
  it("refuses a tree where jobs parse but no step does", () => {
    const run = runGate(
      seed({ "ci.yml": "jobs:\n  build:\n    runs-on: ubuntu-latest\n" }),
    );
    expect(run.out).toContain("step 을 0 개 읽었다");
    expect(run.status).toBe(2);
  });
});
