import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// `scripts/check-round-narrative.sh` 는 CI 의 `PR Body Contract` 잡에서 도는
// blocking 게이트다 (.github/workflows/ci.yml). 그 잡은 게이트가 real 트리에
// 대해 green 인 것만 보므로, "위반을 넣으면 실제로 red 가 되는가" 는 아무 데서도
// 안 돌아 본 적이 없는 질문이 된다 — 이 파일이 그 질문을 판다.
//
// 픽스처 문안은 이 PR 이 실제로 지운 줄을 그대로 쓴다. 대상이 안 쓰는 표기로
// 변형을 만들면 가장 흔한 회귀를 못 잡는다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-round-narrative.sh";

const trees: string[] = [];

afterEach(() => {
  for (const t of trees.splice(0)) rmSync(t, { recursive: true, force: true });
});

/**
 * 임시 git 트리를 만들고 파일을 index 에 올린다. `git grep` 은 추적 파일만 보므로
 * `git add` 없이는 어떤 픽스처도 안 보인다 — 그러면 거짓 green 이 된다.
 */
function seed(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "round-narrative-"));
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

describe("check-round-narrative", () => {
  // 통과 케이스는 stderr 가 비었는지도 본다. `out` 은 stdout+stderr 를 이어
  // 붙이므로 bash 가 오류를 stderr 로 뱉어도 `^ok:` 는 그대로 맞는다.
  it("passes on the real repo tree", () => {
    const run = runGate();
    expect(run.out).toMatch(/^ok: src\/ src-tauri\/ e2e\/ 추적 파일 \d+ 개/);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // 표기 세 변형을 각각 판다. 처음 판정은 소문자 `round` 하나만 봤고, 그때도
  // 같은 세 경로에 대문자 표기와 한국어 표기가 살아 있었는데 게이트는 green
  // 이었다. 문안은 그때 남아 있던 줄에서 그대로 가져온다 — 대상이 안 쓰는 표기로
  // 변형을 만들면 가장 흔한 회귀를 못 잡는다.
  const notations = [
    {
      label: "lower-case `round N`",
      file: "src/DataGrid.quicklook-focus.test.tsx",
      body: "// Reason: round 2 blocking — the two paths that remove the panel\n",
    },
    {
      label: "sentence-initial `Round N`",
      file: "src/components/datagrid/DataGridTable.selection-contrast.test.tsx",
      body: "// Round 1 of PR #2115 shipped `bg-primary/15`, which improved the default\n",
    },
    {
      label: "Korean `라운드 N`",
      file: "src/lib/schemaGraphTextExport.test.ts",
      body: "  // Reason: 라운드 4 blocking ⑥ — `pk` 로 **시작**하고 뒤에 ASCII\n",
    },
  ];

  for (const { label, file, body } of notations) {
    it(`fails on ${label}`, () => {
      const root = seed({ [file]: body });
      const run = runGate(root);
      expect(run.out).toContain(`${file}:1`);
      expect(run.out).toContain("리뷰 라운드 서사 주석 1 줄");
      expect(run.status).toBe(1);
    });
  }

  // #2108 의 전수 명령은 리터럴이 `review round [0-9]` 라 `review` 낱말이 없는
  // 변형과 `e2e/` 경로를 놓쳤다. 이 픽스처는 그 두 누락을 한 줄에 겹쳐 둔다 —
  // `e2e/` 안이고, wrap 때문에 `review` 가 앞 줄에 남아 이 줄에는 없다. 리터럴
  // 이나 경로가 그때로 되돌아가면 여기가 red 다.
  it("catches a wrapped e2e/ hit that carries no `review` word", () => {
    const root = seed({
      "e2e/smoke/erd-dense.spec.ts":
        " * under tauri-driver — twice, in the first run and the retry (PR #2100 review\n * round 1).\n",
    });
    const run = runGate(root);
    expect(run.out).toContain("e2e/smoke/erd-dense.spec.ts:2");
    expect(run.status).toBe(1);
  });

  it("covers src-tauri/ as well", () => {
    const root = seed({
      "src-tauri/src/commands/mod.rs":
        "    //! 작성 이유 (2026-05-08, spec-first 라운드 2; Sprint 237 P5+ hoist):\n",
    });
    const run = runGate(root);
    expect(run.out).toContain("src-tauri/src/commands/mod.rs:1");
    expect(run.status).toBe(1);
  });

  // `라운드` 를 품은 낱말이 이 트리에 실재한다 — `라운드트립`
  // (src-tauri/tests/mongo_integration.rs) 과 `백그라운드` (src/lib/i18n). 판정은
  // 뒤에 공백+숫자가 붙는지만 보므로 그 낱말 자체로는 안 걸린다.
  it("ignores 라운드트립 / 백그라운드 when no digit follows", () => {
    const root = seed({
      "src/lib/i18n/locales/shared.ts":
        '  asyncError: "백그라운드 작업이 실패했습니다: {{message}}",\n',
      "src-tauri/tests/mongo_integration.rs":
        "/// IPC 페어 라운드트립을 wire-up 한다. 2 개를 만든다.\n",
    });
    const run = runGate(root);
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 판정에는 낱말 경계가 없다. `백그라운드` 는 `라운드` 로 끝나므로 뒤에 숫자가
  // 오면 걸린다 — 오너가 못박은 명령의 성질이지 결함이 아니라서 정규식은 안
  // 건드린다. 위 케이스가 "이 낱말은 안전하다" 로 읽히지 않게 한계를 여기 고정해
  // 둔다. 걸리면 낱말과 숫자를 떼어 쓰면 된다.
  it("does flag 백그라운드 when a digit follows — the pattern has no word boundary", () => {
    const root = seed({
      "src/lib/i18n/locales/shared.ts": "  // 백그라운드 3 개를 띄운다\n",
    });
    const run = runGate(root);
    expect(run.out).toContain("src/lib/i18n/locales/shared.ts:1");
    expect(run.status).toBe(1);
  });

  // 게이트 스텝 이름 `Stop at review round 3` 은 여러 파일이 문자 그대로 들고
  // 있는 커플링 assertion 이라 살아 있어야 한다. 그 자리들은 판정의 세 경로 밖에
  // 있어 예외 목록 없이 빠진다 — 범위를 넓히면 여기가 red 다. 아래 픽스처는 그
  // 자리들의 형태를 흉내 낸 것이지 전수가 아니다.
  it("leaves the `Stop at review round 3` coupling literal alone", () => {
    const root = seed({
      "src/app.ts": "export const ok = 1;\n",
      "scripts/review/measure-rounds.sh": "# Stop at review round 3\n",
      "docs/contributor-guide/pr-review.md":
        "the `Stop at review round 3` step\n",
      "memory/workflow/review/memory.md":
        "`Stop at review round 3` step 이 fail\n",
    });
    const run = runGate(root);
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 배치 적용 회차는 리뷰 라운드가 아니라서 예외로 빼는 대신 개명했다. 개명이
  // 되돌려지면 위의 fail 케이스가 잡고, 개명한 낱말이 잘못 걸리면 여기가 잡는다.
  it("does not flag the renamed `pass N` batch notation", () => {
    const root = seed({
      "src/components/datagrid/useDataGridEdit.mixed-batch.test.ts":
        "    // staged [A,B,C], pass 1 applies A (pruned), pass 2 applies B\n",
    });
    const run = runGate(root);
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // PR·이슈 번호는 회귀 앵커라 유지 대상이다. 게이트가 번호까지 훑기 시작하면
  // 여기가 red 가 된다.
  it("keeps PR and issue number anchors passing", () => {
    const root = seed({
      "src/hooks/useSchemaCache.test.ts":
        "    // Regression from PR #1263: the backend `list_namespaces` returns\n" +
        "    // Reason: #1734 (5) B1 — the restore must not depend on the anchor\n",
    });
    const run = runGate(root);
    expect(run.out).toMatch(/^ok:/);
    expect(run.status).toBe(0);
  });

  // 아래 둘은 "훑지 못한 것을 위반 0 으로 통과시키지 않는다" 를 판다. git grep 은
  // 대상이 없어도 exit 1 (=위반 없음) 을 내므로, 트리가 옮겨진 날 게이트가
  // 아무것도 안 보면서 green 이 되는 fail-open 이 기본 동작이다.
  it("refuses a tree with no tracked file under the three paths", () => {
    const root = seed({ "docs/README.md": "빈 트리\n" });
    const run = runGate(root);
    expect(run.out).toContain("추적 파일이 0 개다");
    expect(run.status).toBe(2);
  });

  it("refuses a directory that is not a git work tree", () => {
    const root = mkdtempSync(join(tmpdir(), "round-narrative-nogit-"));
    trees.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/app.ts"), "// round 2 blocking\n", "utf8");
    const run = runGate(root);
    expect(run.out).toContain("git 작업 트리가 아니다");
    expect(run.status).toBe(2);
  });

  it("refuses a root that is not there", () => {
    const run = runGate(join(tmpdir(), "round-narrative-없는경로"));
    expect(run.out).toContain("검사할 디렉토리가 없다");
    expect(run.status).toBe(2);
  });
});
