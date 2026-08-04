import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// `scripts/check-ci-test-calls.sh` 는 CI 의 `PR Body Contract` 잡에서 도는
// blocking 게이트다 (.github/workflows/ci.yml). 그 잡은 게이트가 real 트리에
// 대해 green 인 것만 보므로, "미호출 테스트를 새로 넣으면 실제로 red 가 되는가"
// 는 아무 데서도 안 돌아 본 적이 없는 질문이 된다 — 이 파일이 그 질문을 판다.
// 픽스처는 전부 임시 디렉토리에 씨를 뿌려 만들고 repo 트리는 건드리지 않는다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-ci-test-calls.sh";

const trees: string[] = [];

afterEach(() => {
  for (const t of trees.splice(0)) rmSync(t, { recursive: true, force: true });
});

type Tree = {
  /** `src-tauri/tests/` 아래에 만들 파일. 키는 그 디렉토리 기준 상대 경로. */
  tests?: Record<string, string>;
  /**
   * `.github/workflows/ci.yml` 본문. 생략하면 호출 1건짜리 기본 workflow 이고,
   * `null` 이면 `.github/workflows` 디렉토리 자체를 안 만든다.
   */
  workflow?: string | null;
  /** `ci-uncalled-tests.txt` 본문. `null` 이면 파일을 아예 안 만든다. */
  allowlist?: string | null;
};

const DEFAULT_WORKFLOW = `      - name: Run cargo tests
        run: cargo test --manifest-path src-tauri/Cargo.toml --test called_one
`;

function seed({ tests = {}, workflow, allowlist = "" }: Tree): string {
  const root = mkdtempSync(join(tmpdir(), "ci-test-calls-"));
  trees.push(root);

  const testsDir = join(root, "src-tauri", "tests");
  mkdirSync(testsDir, { recursive: true });
  for (const [rel, body] of Object.entries(tests)) {
    const path = join(testsDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, "utf8");
  }

  if (workflow !== null) {
    const workflowsDir = join(root, ".github", "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(join(workflowsDir, "ci.yml"), workflow ?? DEFAULT_WORKFLOW);
  }

  if (allowlist !== null) {
    writeFileSync(join(root, "ci-uncalled-tests.txt"), allowlist, "utf8");
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

/** 가장 흔한 픽스처: 호출되는 테스트 하나 + 이름을 바꿔 가며 쓰는 두 번째. */
const CALLED = { "called_one.rs": "fn main() {}\n" };

describe("check-ci-test-calls", () => {
  it("passes on the real repo tree", () => {
    const run = runGate();
    expect(run.out).toMatch(/^ok: 통합 테스트 target \d+ 종/);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // 이 게이트의 존재 이유. allowlist 에 없는 미호출 테스트가 들어오면 red 다.
  it("fails on a test binary that no workflow calls and no allowlist covers", () => {
    const root = seed({
      tests: { ...CALLED, "guard_grep.rs": "fn main() {}\n" },
    });
    const run = runGate(root);
    expect(run.out).toContain("FAIL guard_grep");
    expect(run.out).toContain("ci-uncalled-tests.txt 에 없다");
    expect(run.status).toBe(1);
  });

  it("passes the same test binary once the allowlist carries a reason", () => {
    const root = seed({
      tests: { ...CALLED, "guard_grep.rs": "fn main() {}\n" },
      allowlist: "# 주석\n\nguard_grep\tdocker 필요, 후속 이슈\n",
    });
    const run = runGate(root);
    expect(run.out).toMatch(/^ok: /);
    expect(run.status).toBe(0);
  });

  // 이름이 workflow 안에 있기만 해도 통과하면, 주석에 이름을 적는 것만으로
  // 게이트가 뚫린다. 호출로 치는 것은 `--test <이름>` 뿐이다.
  it("does not count a name that appears outside a --test argument", () => {
    const root = seed({
      tests: { ...CALLED, "guard_grep.rs": "fn main() {}\n" },
      workflow: `${DEFAULT_WORKFLOW}      # guard_grep 는 언젠가 켠다\n`,
    });
    const run = runGate(root);
    expect(run.out).toContain("FAIL guard_grep");
    expect(run.status).toBe(1);
  });

  // 집합 판정이 부분 일치로 미끄러지면 이름이 다른 호출의 접두사이기만 해도
  // 호출된 것으로 쳐서 통째로 새어 나간다 (`snapshot` 이 `snapshot_atomic` 을
  // 덮는 식). 아래는 그 미끄러짐에서만 red 다.
  it("does not treat a name that is a prefix of a called one as called", () => {
    const root = seed({
      tests: { "called_one_extra.rs": "fn main() {}\n", ...CALLED },
      workflow: `      - run: cargo test --test called_one_extra\n`,
    });
    const run = runGate(root);
    expect(run.out).toContain("FAIL called_one");
    expect(run.out).not.toContain("FAIL called_one_extra");
    expect(run.status).toBe(1);
  });

  // cargo 는 `tests/<dir>/main.rs` 도 통합 테스트 target 으로 자동 인식한다
  // (`cargo metadata` 실측: 빈 디렉토리에 main.rs 를 넣으면 target 이 76→77).
  // 평평한 `*.rs` 만 열거하면 이 형태로 들어온 테스트가 게이트를 통과한다.
  it("enumerates a tests/<dir>/main.rs target too", () => {
    const root = seed({
      tests: { ...CALLED, "nested_probe/main.rs": "fn main() {}\n" },
    });
    const run = runGate(root);
    expect(run.out).toContain("FAIL nested_probe");
    expect(run.status).toBe(1);
  });

  it("fails an allowlist entry with no reason", () => {
    const root = seed({
      tests: { ...CALLED, "guard_grep.rs": "fn main() {}\n" },
      allowlist: "guard_grep\n",
    });
    const run = runGate(root);
    expect(run.out).toContain("사유가 없다");
    expect(run.status).toBe(1);
  });

  // 아래 둘이 allowlist 를 단조 감소로 묶는다. 없으면 죽은 줄이 쌓이는 자리가 된다.
  it("fails an allowlist entry whose test file is gone", () => {
    const root = seed({
      tests: CALLED,
      allowlist: "deleted_long_ago\t사유\n",
    });
    const run = runGate(root);
    expect(run.out).toContain("그런 테스트가 없다");
    expect(run.status).toBe(1);
  });

  it("fails an allowlist entry that CI now calls", () => {
    const root = seed({
      tests: CALLED,
      allowlist: "called_one\t사유\n",
    });
    const run = runGate(root);
    expect(run.out).toContain("이제 CI 가 부르는데");
    expect(run.status).toBe(1);
  });

  it("fails a duplicated allowlist entry", () => {
    const root = seed({
      tests: { ...CALLED, "guard_grep.rs": "fn main() {}\n" },
      allowlist: "guard_grep\t사유\nguard_grep\t같은 이름 또\n",
    });
    const run = runGate(root);
    expect(run.out).toContain("두 번 있다");
    expect(run.status).toBe(1);
  });

  // 아래 넷은 "아무것도 못 쟀는데 위반 0 으로 통과" 를 막는다. 트리가 옮겨지거나
  // `--test` 표기가 통째로 바뀐 날 게이트가 조용히 green 이 되면 안 된다.
  it("refuses a tree with no integration test target", () => {
    const root = seed({ tests: {} });
    const run = runGate(root);
    expect(run.out).toContain("target 이 0 개다");
    expect(run.status).toBe(2);
  });

  it("refuses workflows that call no --test at all", () => {
    const root = seed({
      tests: CALLED,
      workflow:
        "      - run: cargo test --manifest-path src-tauri/Cargo.toml\n",
      allowlist: "called_one\t사유\n",
    });
    const run = runGate(root);
    expect(run.out).toContain("호출이 0 건이다");
    expect(run.status).toBe(2);
  });

  it("refuses a tree with no .github/workflows", () => {
    const root = seed({
      tests: CALLED,
      workflow: null,
      allowlist: "called_one\t사유\n",
    });
    const run = runGate(root);
    expect(run.out).toContain("검사할 디렉토리가 없다");
    expect(run.out).toContain(".github/workflows");
    expect(run.status).toBe(2);
  });

  it("refuses a tree with no allowlist file", () => {
    const root = seed({ tests: CALLED, allowlist: null });
    const run = runGate(root);
    expect(run.out).toContain("allowlist 파일이 없다");
    expect(run.status).toBe(2);
  });

  it("refuses a root that is not there", () => {
    const run = runGate(join(tmpdir(), "ci-test-calls-없는경로"));
    expect(run.out).toContain("검사할 디렉토리가 없다");
    expect(run.status).toBe(2);
  });
});
