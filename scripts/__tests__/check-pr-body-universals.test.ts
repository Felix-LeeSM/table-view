import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// `scripts/check-pr-body-universals.sh` 는 CI 의 `PR Body Contract` 잡에서 도는
// blocking 게이트다 (.github/workflows/ci.yml). 그 잡이 보는 입력은 PR body 라
// 저장소 트리에는 픽스처가 없다 — "위반을 넣으면 실제로 red 가 되는가" 는 여기가
// 아니면 아무 데서도 안 돌아 본다.
//
// 픽스처는 판정 정의(스크립트 헤더)의 각 조항을 하나씩 판다. 조항이 지워지거나
// 창 폭이 바뀌면 그 조항의 케이스가 red 다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-pr-body-universals.sh";

const temps: string[] = [];

afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

function runGate(body: string, viaFile = false) {
  let args = [gate];
  let input: string | undefined = body;
  if (viaFile) {
    const dir = mkdtempSync(join(tmpdir(), "pr-body-universals-"));
    temps.push(dir);
    const path = join(dir, "body.md");
    writeFileSync(path, body, "utf8");
    args = [gate, path];
    input = undefined;
  }
  const run = spawnSync("bash", args, {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    timeout: 60_000,
  });
  return {
    status: run.status,
    out: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

describe("check-pr-body-universals", () => {
  // 이슈 #2228 이 수용 기준으로 못박은 입력 그대로다. 문안을 바꾸면 이 테스트는
  // 더 이상 그 기준을 재지 않는다.
  it("fails the issue's acceptance-criterion body", () => {
    const run = runGate("이 저장소의 모든 어댑터가 전부 같은 경로를 쓴다.\n");
    expect(run.out).toContain(
      "1:이 저장소의 모든 어댑터가 전부 같은 경로를 쓴다.",
    );
    expect(run.out).toContain("전칭 서술 1 줄");
    expect(run.status).toBe(1);
  });

  it("passes the same claim once a command block sits next to it", () => {
    const run = runGate(
      "이 저장소의 모든 어댑터가 전부 같은 경로를 쓴다.\n" +
        "\n" +
        "```bash\n" +
        "git grep -n 'fn connect' -- src-tauri/\n" +
        "```\n",
    );
    expect(run.out).toMatch(/^ok: body 5 줄/);
    expect(run.status).toBe(0);
  });

  // 트리거 여섯 낱말을 하나씩 판다. 목록에서 낱말 하나가 빠지면 그 줄만 red 다 —
  // 여섯을 한 픽스처에 몰아 넣으면 다섯이 남아 통과해서 결손을 못 본다.
  const triggers = ["전부", "유일", "항상", "뿐이다", "빠짐없이", "하나도"];
  for (const word of triggers) {
    it(`flags a bare claim carrying \`${word}\``, () => {
      const run = runGate(`이 경로는 ${word} 같은 어댑터를 쓴다\n`);
      expect(run.out).toContain(`1:이 경로는 ${word} 같은 어댑터를 쓴다`);
      expect(run.status).toBe(1);
    });
  }

  it("leaves a claim without any trigger word alone", () => {
    const run = runGate("어댑터 두 개가 같은 경로를 쓴다. 명령은 안 붙였다.\n");
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 「±6 줄」의 경계를 양쪽에서 고정한다. 창 폭이 바뀌면 둘 중 하나가 red 다.
  it("accepts a command exactly 6 lines away", () => {
    const filler = "산문\n".repeat(5);
    const run = runGate(`\`pnpm test\` 로 잰다\n${filler}이 셋이 전부다\n`);
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  it("rejects a command 7 lines away", () => {
    const filler = "산문\n".repeat(6);
    const run = runGate(`\`pnpm test\` 로 잰다\n${filler}이 셋이 전부다\n`);
    expect(run.out).toContain("8:이 셋이 전부다");
    expect(run.status).toBe(1);
  });

  // 판정 (c). 공백이 든 백틱 조각만 명령으로 센다.
  it("counts an inline span that carries an argument", () => {
    const run = runGate("`pnpm exec vitest run` 이 내는 실패가 하나도 없다\n");
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  it("does not count a one-word identifier span", () => {
    const run = runGate("`sourceGates` 경로를 단언하는 자리가 유일하다\n");
    expect(run.out).toContain("1:`sourceGates`");
    expect(run.status).toBe(1);
  });

  // 정규식 한 방으로 (c) 를 쓰면 서로 다른 두 조각 **사이**의 공백이 맞아 이
  // 산문이 명령으로 세어진다. 그 형태로 되돌아가면 여기가 통과로 뒤집힌다.
  it("does not count two separate spans as one command", () => {
    const run = runGate("`a` 와 `b` 가 전부 같은 경로를 쓴다\n");
    expect(run.out).toContain("1:`a` 와 `b` 가 전부 같은 경로를 쓴다");
    expect(run.status).toBe(1);
  });

  // 인라인 코드가 줄바꿈을 넘어가면 여는 백틱이 있는 줄에는 닫는 백틱이 없다.
  // 그 조각을 안 세면 wrap 된 명령 인용이 통째로 안 세어져 옆 줄이 red 가 된다.
  // 두 번째 줄은 닫는 백틱 뒤에 공백이 없어 그 자체로는 명령 줄이 아니다 —
  // 그래야 이 케이스가 첫 줄의 조항만 판다.
  it("counts a command span that wraps to the next line", () => {
    const run = runGate(
      '어댑터 목록은 `git grep -n "fn connect" --\n' +
        "src-tauri/`가\n" +
        "낸다. 그 어댑터가 전부 같은 경로를 쓴다\n",
    );
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 판정 (b). 펜스 안의 줄은 그 자체가 명령 줄이라, 블록이 창보다 길어도 안쪽
  // 출력에 트리거 낱말이 있다고 red 가 되지 않는다.
  it("treats lines inside a fenced block as command lines", () => {
    const run = runGate(
      `\`\`\`\n${"출력\n".repeat(8)}실패는 하나도 없었다\n${"출력\n".repeat(8)}\`\`\`\n`,
    );
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  it("reads the body from a file argument", () => {
    const run = runGate("이 방이 유일한 SOT 다\n", true);
    expect(run.out).toContain("1:이 방이 유일한 SOT 다");
    expect(run.status).toBe(1);
  });

  // 마지막 줄이 개행으로 안 끝나면 `read` 루프가 그 줄을 통째로 버린다 — 그러면
  // 그 줄의 위반이 검사되지 않은 채 green 이 된다.
  it("checks a final line that has no trailing newline", () => {
    const run = runGate("앞줄\n이 셋이 전부다");
    expect(run.out).toContain("2:이 셋이 전부다");
    expect(run.status).toBe(1);
  });

  // 아래 둘은 "훑지 못한 것을 위반 0 으로 통과시키지 않는다" 를 판다. 빈 입력을
  // 0 줄 통과로 읽으면 파이프가 끊긴 날 게이트가 아무것도 안 보면서 green 이 된다.
  // 빈 body 를 통과로 볼지는 호출자(ci.yml 스텝)가 정한다.
  it("refuses empty stdin", () => {
    const run = runGate("");
    expect(run.out).toContain("body 가 0 줄이다");
    expect(run.status).toBe(2);
  });

  it("refuses a file argument that is not there", () => {
    const run = spawnSync("bash", [gate, join(tmpdir(), "없는-body-2228.md")], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(`${run.stdout}${run.stderr}`).toContain("검사할 body 파일이 없다");
    expect(run.status).toBe(2);
  });

  // ci.yml 의 스텝이 body 를 `printf '%s\n' "$BODY" | bash <gate>` 로 넘긴다.
  // 그 형태에서 stdin 이 실제로 읽히는지 여기서 판다 — 스텝 자체는 CI 밖에서
  // 안 돈다.
  it("runs through the pipeline shape the CI step uses", () => {
    const run = spawnSync(
      "bash",
      ["-c", `printf '%s\\n' "$BODY" | bash ${gate}`],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, BODY: "이 어댑터가 전부 같은 경로를 쓴다" },
        timeout: 60_000,
      },
    );
    expect(`${run.stdout}${run.stderr}`).toContain(
      "1:이 어댑터가 전부 같은 경로를 쓴다",
    );
    expect(run.status).toBe(1);
  });
});
