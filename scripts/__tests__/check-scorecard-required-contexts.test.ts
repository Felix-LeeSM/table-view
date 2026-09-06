import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// `scripts/check-scorecard-required-contexts.sh` 는 review-gate 에서 도는 blocking
// 게이트다 — scorecard 가 non-SUCCESS required context 의 이름을 싣는지 대조한다
// (issue #2443: PR #2415 의 세 라운드가 `Runtime Happy Path` red 를 「전부 pass」로
// 적었다). 판별력은 양쪽에서 증명해야 한다: 이름이 빠진 scorecard 로 red 가 나는 것과
// 담긴 것으로 green 이 나는 것. green 한쪽만으로는 게이트가 아무것도 안 보는 경우와
// 안 갈린다. 픽스처는 전부 메모리와 임시 디렉토리에서 만들고 repo 트리는 건드리지 않는다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-scorecard-required-contexts.sh";
const gatePath = join(repoRoot, gate);
// required 목록의 SOT. 게이트도, 스텝도, 이 테스트의 실물 블록 케이스도 여기서 읽는다.
const memorySot = "memory/runbook/pr-merge-gates/memory.md";
const removedContext = "Detect Change Scope";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function runGate(args: string[]) {
  const run = spawnSync("bash", [gatePath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60_000,
  });
  return {
    status: run.status,
    stderr: run.stderr ?? "",
    out: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

/** 임시 트리를 만들고 스크립트가 받는 세 종류 파일을 쓰는 헬퍼. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "required-contexts-"));
  dirs.push(dir);
  const write = (name: string, body: string) => {
    const path = join(dir, name);
    writeFileSync(path, body, "utf8");
    return path;
  };
  return { dir, write };
}

/** 실물 블록과 같은 모양의 memory 방 조각 — 기계 목록 + 이력 서술이 한 쌍에 있다. */
function memoryDoc(names: string[], withProse = true) {
  const list = names.map((n) => `- \`${n}\``).join("\n");
  const prose = withProse
    ? `\n- 2026-07-05 1차: \`${names[0]}\` · \`옛 이름\`\n- 2026-07-31: \`${removedContext}\` 를 ruleset 과 \`ci.yml\` 양쪽에서 **제거**.\n`
    : "";
  return `<!-- ci-gates:required-contexts -->\n\n<!-- 기계가 읽는 목록 -->\n\n${list}\n${prose}\n<!-- /ci-gates -->\n`;
}

function rollup(entries: Record<string, string | null>[]) {
  return JSON.stringify(
    entries.map((e) =>
      "state" in e
        ? { __typename: "StatusContext", context: e.name, state: e.state }
        : {
            __typename: "CheckRun",
            name: e.name,
            status: e.conclusion === null ? "IN_PROGRESS" : "COMPLETED",
            conclusion: e.conclusion,
          },
    ),
  );
}

const NAMES = [
  "Frontend Checks",
  "Rust Unit And Storage Tests",
  "Integration Tests (Docker)",
  "Runtime Happy Path",
];

describe("check-scorecard-required-contexts", () => {
  it("passes when every scorecard names the failing required context", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write(
      "rollup.json",
      rollup([
        { name: "Frontend Checks", conclusion: "SUCCESS" },
        { name: "Runtime Happy Path", conclusion: "FAILURE" },
      ]),
    );
    const sheet = f.write(
      "sheet.md",
      "## Scorecard\n| required context | 결론 |\n| `Runtime Happy Path` | failure |\n",
    );
    const run = runGate([mem, roll, sheet]);
    expect(run.out).toContain(
      "required 4 종 — rollup non-SUCCESS 1 종, scorecard 1 장, 이름 없는 required 0 종",
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // 이슈의 판별력 요구의 red 쪽 — 이름이 빠지면 반드시 red 다.
  it("fails when the scorecard omits a failing required context's name", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write(
      "rollup.json",
      rollup([
        { name: "Frontend Checks", conclusion: "SUCCESS" },
        { name: "Runtime Happy Path", conclusion: "FAILURE" },
      ]),
    );
    // #2415 라운드 셋이 적은 형태: 「`review-gate` 만 fail, 나머지 전부 pass」 —
    // 빠진 이름을 다른 문구로 대신하지 않는 한 부분 일치는 걸리지 않는다.
    const sheet = f.write(
      "sheet.md",
      "## Scorecard\n`review-gate` 만 fail. 나머지 required 전부 pass.\n",
    );
    const run = runGate([mem, roll, sheet]);
    expect(run.out).toContain(
      "FAIL Runtime Happy Path: rollup 결론이 FAILURE 인데 이름이 그 어느 scorecard 에도 없다",
    );
    expect(run.out).toContain("이름 없는 required 1 종");
    expect(run.out).toContain(
      "::error::scorecard 가 non-SUCCESS required context 의 이름을 안 적었다",
    );
    expect(run.status).toBe(1);
  });

  // 전부 SUCCESS 면 이름을 안 적어도 통과한다 — green PR 의 낡은 형식 scorecard 가
  // 거짓 red 를 맞는 것을 막는 판정이다 (이슈 본문의 대조 조건 그대로).
  it("passes when every required context is SUCCESS even with no names in the scorecard", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write(
      "rollup.json",
      rollup([
        { name: "Frontend Checks", conclusion: "SUCCESS" },
        { name: "Runtime Happy Path", conclusion: "SUCCESS" },
      ]),
    );
    const sheet = f.write("sheet.md", "## Scorecard\nrequired 이름 없음\n");
    const run = runGate([mem, roll, sheet]);
    expect(run.out).toContain("rollup non-SUCCESS 0 종");
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // 결론이 아직 없는(진행 중) CheckRun 도 이름을 대조 대상이다 — null 을 「SUCCESS 가
  // 아니어야 하는 값 없음」으로 흘리면 진행 중 required 가 조용히 대조 밖이 된다.
  it("demands the name of a required context that has no conclusion yet", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write(
      "rollup.json",
      rollup([{ name: "Runtime Happy Path", conclusion: null }]),
    );
    const sheet = f.write("sheet.md", "## Scorecard\n이름 없음\n");
    const run = runGate([mem, roll, sheet]);
    expect(run.out).toContain("rollup 결론이 PENDING 인데");
    expect(run.status).toBe(1);
  });

  // rollup 항목이 꼭 CheckRun 인 것은 아니다 — legacy Status context 는 이름이
  // `.context` 에, 결론이 `.state` 에 앉는다. 그쪽을 안 읽으면 대조가 절반만 돈다.
  it("reads StatusContext entries whose name and conclusion live in other fields", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write(
      "rollup.json",
      rollup([{ name: "Runtime Happy Path", state: "FAILURE" }]),
    );
    const sheet = f.write("sheet.md", "## Scorecard\n이름 없음\n");
    expect(runGate([mem, roll, sheet]).status).toBe(1);
  });

  // 아직 보고 안 한 required 는 대조할 결론이 없다 — ruleset 이 이미 BLOCKED 로 막는
  // 상태라 이름 강제가 아니라 검사 밖이다.
  it("skips required contexts that have no rollup entry", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write(
      "rollup.json",
      rollup([{ name: "Frontend Checks", conclusion: "SUCCESS" }]),
    );
    const sheet = f.write("sheet.md", "## Scorecard\n`Frontend Checks`\n");
    const run = runGate([mem, roll, sheet]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // `review-gate` 는 legacy branch protection 쪽이라 ruleset 블록 밖이다. verdict
  // label 부재의 non-SUCCESS 를 대조에 넣으면 모든 라운드 1 이 red 가 된다 — 그래서
  // 목록을 블록에서 읽는 것이 그 이름을 가르는 유일한 근거다.
  it("ignores review-gate even when it is failing", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write(
      "rollup.json",
      rollup([
        { name: "review-gate", conclusion: "FAILURE" },
        { name: "Runtime Happy Path", conclusion: "SUCCESS" },
      ]),
    );
    const sheet = f.write("sheet.md", "## Scorecard\n이름 없음\n");
    const run = runGate([mem, roll, sheet]);
    expect(run.out).toContain("rollup non-SUCCESS 0 종");
    expect(run.status).toBe(0);
  });

  // 이름이 여러 장 중 한 장이라도 있으면 싣은 것이다 — 대조 단위는 라운드가 아니라 PR 이다.
  it("accepts a name found in any scorecard sheet", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write(
      "rollup.json",
      rollup([{ name: "Runtime Happy Path", conclusion: "FAILURE" }]),
    );
    const earlier = f.write(
      "earlier.md",
      "## Scorecard\n`Runtime Happy Path`\n",
    );
    const latest = f.write("latest.md", "## Scorecard\n이름 없음\n");
    const run = runGate([mem, roll, latest, earlier]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // scorecard 0 장은 하중 부재다 — opened / synchronize 에도 이 게이트가 돌고, 그때
  // "scorecard 가 없다" 는 참이다 (check-review-size-cap.sh 의 「0 장은 통과다」와 같은
  // 판정). 비영 rc 로 끊으면 모든 push 가 red 다.
  it("passes with zero scorecards while still reporting what it measured", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write(
      "rollup.json",
      rollup([{ name: "Runtime Happy Path", conclusion: "FAILURE" }]),
    );
    const run = runGate([mem, roll]);
    expect(run.out).toContain(
      "rollup non-SUCCESS 1 종, scorecard 0 장, 이름 없는 required 0 종",
    );
    expect(run.out).toContain("리뷰가 아직 없다");
    expect(run.status).toBe(0);
  });

  // 빈 장은 「이름이 없다」가 아니라 「잴 것을 못 받았다」다 — 빈 입력을 통과로 읽으면
  // 게이트가 조용히 죽는다 (이슈가 가리킨 check-review-size-cap.sh 의 #2383 전례).
  it("refuses an empty scorecard file instead of passing it", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write("rollup.json", rollup([]));
    const sheet = f.write("sheet.md", "");
    const run = runGate([mem, roll, sheet]);
    expect(run.out).toContain("scorecard 파일이 비어 있다");
    expect(run.status).toBe(2);
  });

  it("refuses a scorecard file that is not there", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write("rollup.json", rollup([]));
    const run = runGate([mem, roll, join(tmpdir(), "없는-scorecard.md")]);
    expect(run.out).toContain("scorecard 파일이 없다");
    expect(run.status).toBe(2);
  });

  // 마커 쌈이 깨진 memory 방은 「빈 목록」이 아니라 검사 불성립이다 — 블록이 옮겨진
  // 날 아무것도 안 재고 green 이 되는 것을 막는다.
  it("refuses a memory doc whose marker pair does not close", () => {
    const f = fixture();
    const mem = f.write(
      "mem.md",
      memoryDoc(NAMES).replace("<!-- /ci-gates -->", ""),
    );
    const roll = f.write("rollup.json", rollup([]));
    const run = runGate([mem, roll]);
    expect(run.out).toContain("마커 쌍이 1 쌍으로 성립하지 않는다");
    expect(run.status).toBe(2);
  });

  it("refuses a memory doc that yields no required names", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc([]));
    const roll = f.write("rollup.json", rollup([]));
    const run = runGate([mem, roll]);
    expect(run.out).toContain("이름을 하나도 못 읽었다");
    expect(run.status).toBe(2);
  });

  // 스텝이 `.statusCheckRollup` 을 안 떼면 통째 오브젝트가 온다 — jq 가 값을 훑어
  // 빈 이름 행을 내고 대조는 아무것도 안 재면서 green 이 된다. 배열만 받는다.
  it("refuses a rollup that is an object instead of the bare array", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write("rollup.json", '{"statusCheckRollup":[]}');
    const run = runGate([mem, roll]);
    expect(run.out).toContain("rollup 파일이 배열이 아니다");
    expect(run.status).toBe(2);
  });

  it("refuses a rollup that is not JSON", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const roll = f.write("rollup.json", "not json");
    expect(runGate([mem, roll]).status).toBe(2);
  });

  it("refuses a rollup file that is not there", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    const run = runGate([mem, join(tmpdir(), "없는-rollup.json")]);
    expect(run.out).toContain("검사할 파일이 없다");
    expect(run.status).toBe(2);
  });

  it("refuses a call with fewer than two arguments", () => {
    const f = fixture();
    const mem = f.write("mem.md", memoryDoc(NAMES));
    expect(runGate([mem]).status).toBe(2);
    expect(runGate([]).status).toBe(2);
  });

  // 파서 규칙의 실물 시험 — 이 블록이 기계 목록과 이력 서술을 한 쌍으로 담는 이유는
  // 제거된 이름(`Detect Change Scope`)이 이력 줄에 backtick 로 남아 있기 때문이다.
  // 서술 줄의 이름이 required 로 읽히면 제거된 context 가 대조 집합에 섞인다.
  it("reads the repo's own block, excluding names that only live in the history prose", () => {
    const f = fixture();
    const roll = f.write(
      "rollup.json",
      rollup([{ name: removedContext, conclusion: "FAILURE" }]),
    );
    const sheet = f.write("sheet.md", "## Scorecard\n이름 없음\n");
    const run = runGate([join(repoRoot, memorySot), roll, sheet]);
    // 제거된 이름은 required 가 아니므로 red 가 아니다. real 블록의 현재 required 중
    // 하나라 red 라면 어느 쪽 판정이든 이 테스트가 아니라 실제 리뷰가 받는다.
    expect(run.out).not.toContain(`FAIL ${removedContext}:`);
    expect(run.out).not.toContain("검사 불성립");
    expect(run.status).toBe(0);
  });

  it("reads names from the repo's own block as the gate would", () => {
    // 같은 규칙을 테스트 쪽에서 다시 적용해 두 벌이 어긋나는지 본다 — 헤더 「required」
    // 절의 규칙 그대로다.
    const body = readFileSync(join(repoRoot, memorySot), "utf8");
    const block = body.slice(
      body.indexOf("<!-- ci-gates:required-contexts -->"),
      body.indexOf("<!-- /ci-gates -->"),
    );
    const names = [...block.matchAll(/^[ \t]*-[ \t]*`([^`]+)`[ \t]*$/gm)].map(
      (m) => m[1],
    );
    expect(names.length).toBeGreaterThanOrEqual(1);
    expect(names).not.toContain(removedContext);
    expect(new Set(names).size).toBe(names.length);
  });

  /** review-gate.yml 의 `review-gate` job 스텝 목록 (이름 · `if:` · `run:`). */
  function reviewGateSteps(): { name?: string; if?: string; run?: string }[] {
    const workflow = parseYaml(
      readFileSync(join(repoRoot, ".github/workflows/review-gate.yml"), "utf8"),
    ) as {
      jobs: Record<
        string,
        { steps: { name?: string; if?: string; run?: string }[] }
      >;
    };
    return workflow.jobs["review-gate"].steps;
  }

  // 스텝이 호출을 갖고 있어도 `Stop at review round 3` 의 exit 1 뒤로 안 돌면 게이트는
  // 없는 것과 같다 — check-review-size-cap.test.ts 가 같은 미끄러짐을 잠근 자리다.
  // `Require review:approved` 앞인 것도 같은 이유다: 뒤에 두면 changes-requested
  // 라운드(승인 label 없음)에서 암묵 success() 가 이 검사를 통째로 skip 시킨다.
  it("runs the scorecard slot gate before approval is required and after the round stop", () => {
    const steps = reviewGateSteps();
    const names = steps.map((s) => s.name);
    const stopAt = names.indexOf("Stop at review round 3");
    const at = names.indexOf("Scorecard names non-success required contexts");
    const approval = names.indexOf("Require review:approved label");
    expect(stopAt).toBeGreaterThanOrEqual(0);
    expect(at, "게이트 스텝이 review-gate.yml 에 없다").toBeGreaterThanOrEqual(
      0,
    );
    expect(approval).toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(stopAt);
    expect(at).toBeLessThan(approval);
    expect(steps[at].if ?? "").toContain("always()");
  });

  // 주석 줄은 호출로 안 센다 — 스텝을 통째로 지우고 주석만 남겨도 green 인 꼼수를 막는
  // 같은 판정이 check-review-size-cap.test.ts 와 check-ci-test-calls.sh 에 있다.
  it("calls the gate script and reads the required list from the memory SOT", () => {
    const step = reviewGateSteps().find(
      (s) => s.name === "Scorecard names non-success required contexts",
    );
    const lines = (step?.run ?? "").split("\n");
    const live = lines.filter((l) => !l.trimStart().startsWith("#"));
    expect(
      live.some((l) => l.includes(`bash ${gate}`)),
      "스텝이 게이트 스크립트를 부르지 않는다",
    ).toBe(true);
    expect(
      live.some((l) => l.includes(`-f ${memorySot}`)),
      `스텝이 ${memorySot} 존재 확인 없이 부른다 — checkout 이 실패하면 rc=127 을 스크립트의 판정으로 오독한다`,
    ).toBe(true);
    // required 목록의 SOT 는 memory 방의 블록 하나다. 가드(존재 확인)와 인자(실제
    // 호출)로 최소 두 번 이름이 나와야 스텝이 그 블록을 읽는 것이다 — 다른 경로를
    // 읽으면 대조 집합이 두 벌이 된다.
    const mentions = live.join("\n").split(memorySot).length - 1;
    expect(
      mentions,
      `스텝이 ${memorySot} 를 가드와 호출 인자로 다루지 않는다 (${mentions} 회)`,
    ).toBeGreaterThanOrEqual(2);
  });
});
