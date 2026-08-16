import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// `scripts/check-prompt-fail-silently.sh` 는 CI 의 `PR Body Contract` 잡에서 도는
// blocking 게이트다 (.github/workflows/ci.yml). 그 잡은 게이트가 real 트리에 대해
// green 인 것만 보므로, "위반을 넣으면 실제로 red 가 되는가" 는 아무 데서도 안
// 돌아 본 적이 없는 질문이 된다 — 이 파일이 그 질문을 판다.
//
// 픽스처 문안은 이 PR 이 실제로 지운 줄과 남긴 줄을 그대로 쓴다. 대상이 안 쓰는
// 표기로 변형을 만들면 가장 흔한 회귀를 못 잡는다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-prompt-fail-silently.sh";

const trees: string[] = [];

afterEach(() => {
  for (const t of trees.splice(0)) rmSync(t, { recursive: true, force: true });
});

/**
 * 임시 git 트리를 만들고 파일을 index 에 올린다. 게이트의 전수는 `git ls-files`
 * 이므로 `git add` 없이는 어떤 픽스처도 안 보인다 — 그러면 거짓 green 이 된다.
 */
function seed(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "prompt-fail-silently-"));
  trees.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, "utf8");
  }
  const git = (...args: string[]) =>
    spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-q");
  // 전역 excludesFile 이 픽스처를 걸러 index 가 비는 것을 막는다.
  git("add", "-f", "-A", ".");
  return root;
}

/** `.agents/prompts/` 아래 bash 펜스 하나짜리 고정부를 만든다. */
function prompt(body: string): Record<string, string> {
  return {
    ".agents/prompts/role.md": `# role\n\n\`\`\`bash\n${body}\n\`\`\`\n`,
  };
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

describe("check-prompt-fail-silently", () => {
  it("passes on the real repo tree", () => {
    const run = runGate();
    expect(run.out).toMatch(
      /^ok: \.agents\/prompts\/ 추적 파일 \d+ 개의 bash 펜스에 실패를 흘리는 자리 0/,
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // PR #2401 라운드 3 이 지적한 자리 그대로. `head` 의 rc 가 `gh api` 의 rc 를
  // 덮어 조회 실패가 rc 0 으로 지나간다.
  it("fails on the round-3 site — `gh api … | head -1`", () => {
    const root = seed(
      prompt(
        "gh api repos/Felix-LeeSM/table-view/commits/<머지 SHA> --jq '.commit.message' | head -1",
      ),
    );
    const run = runGate(root);
    expect(run.out).toContain(".agents/prompts/role.md:4");
    expect(run.out).toContain("파이프가 `gh` 의 rc 를 가린다");
    expect(run.status).toBe(1);
  });

  // 이슈 #2403 이 재현으로 실은 형태. 겹따옴표 안의 `$( )` 는 다시 명령 문맥이라
  // 여기 든 `|` 는 진짜 파이프다 — 겹따옴표를 통째로 불투명하게 보는 스캐너로
  // 되돌아가면 이 자리가 통과하고, 그것이 이 유형이 실제로 쓰이는 형태다.
  it("fails inside a double-quoted command substitution", () => {
    const root = seed(
      prompt(
        `TITLE="$(gh api repos/Felix-LeeSM/table-view/pulls/999999/commits --jq '.[0].commit.message' 2>/dev/null | head -1)"`,
      ),
    );
    const run = runGate(root);
    expect(run.out).toContain("파이프가 `gh` 의 rc 를 가린다");
    expect(run.status).toBe(1);
  });

  it("fails on `gh pr view … | grep` — the PR body re-check site", () => {
    const root = seed(
      prompt(
        "gh pr view <N> --json body -q .body | grep -n -F -e '<ci.yml 의 -e 목록 그대로>'",
      ),
    );
    const run = runGate(root);
    expect(run.out).toContain("파이프가 `gh` 의 rc 를 가린다");
    expect(run.status).toBe(1);
  });

  it("fails on `if gh … | grep -qx` — the verdict-label site", () => {
    const root = seed(
      prompt(
        `if gh pr view <N> --json labels -q '.labels[].name' | grep -qx "$OLD"; then :; fi`,
      ),
    );
    const run = runGate(root);
    expect(run.out).toContain("파이프가 `gh` 의 rc 를 가린다");
    expect(run.status).toBe(1);
  });

  // 줄의 첫 낱말로 재면 통과해 버리는 형태. 판정은 마지막 명령 구분자 뒤부터가
  // 파이프의 머리라고 본다.
  it("fails when the pipeline head follows a command separator", () => {
    const root = seed(
      prompt(`printf 'a\\n'; gh api repos/o/r/commits | head -1`),
    );
    const run = runGate(root);
    expect(run.out).toContain("파이프가 `gh` 의 rc 를 가린다");
    expect(run.status).toBe(1);
  });

  // PR #2401 라운드 1 이 지적한 자리 그대로 — ABORT 를 적고 `exit 1` 이 없다.
  it("fails on an ABORT that does not exit non-zero", () => {
    const root = seed(
      prompt(
        `case "$CNT" in\n  *) echo "ABORT: 커밋 수를 못 읽어 제목 출처를 못 가른다 ($CNT)" >&2 ;;\nesac`,
      ),
    );
    const run = runGate(root);
    expect(run.out).toContain("ABORT 를 적고 0 아닌 rc 로 안 끝난다");
    expect(run.status).toBe(1);
  });

  it("accepts an ABORT that exits non-zero", () => {
    const root = seed(
      prompt(
        `test "$(git rev-parse --show-toplevel)" = "$CLONE" \\\n  || { echo "ABORT: wrong checkout" >&2; exit 1; }`,
      ),
    );
    const run = runGate(root);
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 산문의 `ABORT` 언급은 가드가 아니다. 이슈 #2403 이 「15자리 대 13자리」로 센
  // 차이가 전부 이것이었다 — 펜스 밖을 세면 멀쩡한 고정부가 영구 red 가 된다.
  it("ignores an ABORT mentioned in prose outside any fence", () => {
    const root = seed({
      ".agents/prompts/role.md":
        "# role\n\nABORT 자리는 각각 다른 실패를 잡는다 — 다른 브랜치 / `fetch` 실패.\n",
    });
    const run = runGate(root);
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 남긴 줄들. 하나라도 걸리면 게이트가 멀쩡한 고정부를 막는다는 뜻이다.
  const kept = [
    {
      label: "printf on the left — the only legitimate pipe at base",
      body: `NEEDLE="$(printf '%s' '<문구>' | LC_ALL=C tr -s '[:space:]' ' ')"`,
    },
    {
      label: "jq program pipe inside single quotes",
      body: `CNT="$(gh pr view <N> --json commits -q '.commits|length')" || CNT=UNREADABLE`,
    },
    {
      label: "jq pipes in a -q selector",
      body: `gh pr view <N> --json statusCheckRollup \\\n  -q '.statusCheckRollup[] | select(.name == "review-gate") | {status, conclusion}'`,
    },
    {
      label: "the replacement verdict-label form",
      body: `LABELS="$(gh pr view <N> --json labels -q '.labels[].name')" || LABELS=UNREADABLE\nif [ "$LABELS" = UNREADABLE ] || printf '%s\\n' "$LABELS" | grep -qx "$OLD"; then :; fi`,
    },
    {
      label: "the replacement first-line read — split moved into --jq",
      body: `gh api repos/Felix-LeeSM/table-view/commits/<머지 SHA> \\\n  --jq '.commit.message | split("\\n")[0]'`,
    },
  ];

  for (const { label, body } of kept) {
    it(`leaves alone: ${label}`, () => {
      const run = runGate(seed(prompt(body)));
      expect(run.out).toMatch(/^ok:/);
      expect(run.status).toBe(0);
    });
  }

  // bash 가 아닌 펜스는 셸이 아니다. 「반환 형식」 블록의 표 구분자 `|` 가 여기로
  // 들어오면 모든 고정부가 영구 red 가 된다.
  it("ignores fences that are not bash", () => {
    const root = seed({
      ".agents/prompts/role.md":
        "# role\n\n```\n- review:approved | review:changes-requested\n| 차원 | 판정 |\n```\n",
    });
    const run = runGate(root);
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 아래 셋은 "훑지 못한 것을 위반 0 으로 통과시키지 않는다" 를 판다.
  it("refuses a tree with no tracked file under .agents/prompts/", () => {
    const root = seed({ "docs/README.md": "빈 트리\n" });
    const run = runGate(root);
    expect(run.out).toContain("추적 파일이 0 개다");
    expect(run.status).toBe(2);
  });

  it("refuses a directory that is not a git work tree", () => {
    const root = mkdtempSync(join(tmpdir(), "prompt-fail-silently-nogit-"));
    trees.push(root);
    mkdirSync(join(root, ".agents/prompts"), { recursive: true });
    writeFileSync(
      join(root, ".agents/prompts/role.md"),
      "```bash\ngh api x | head -1\n```\n",
      "utf8",
    );
    const run = runGate(root);
    expect(run.out).toContain("git 작업 트리가 아니다");
    expect(run.status).toBe(2);
  });

  it("refuses a root that is not there", () => {
    const run = runGate(join(tmpdir(), "prompt-fail-silently-없는경로"));
    expect(run.out).toContain("검사할 디렉토리가 없다");
    expect(run.status).toBe(2);
  });
});
