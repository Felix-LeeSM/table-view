import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
   * workspace member crate 이름 → 그 crate 의 `tests/` 아래에 만들 파일.
   * `src-tauri/<이름>/Cargo.toml` 을 같이 뿌린다 — 게이트는 manifest 옆의 `tests`
   * 디렉토리를 스캔 루트로 잡으므로 manifest 가 없으면 그 디렉토리는 안 세어진다.
   */
  members?: Record<string, Record<string, string>>;
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

/**
 * crate 하나를 뿌린다. 게이트는 manifest 의 내용을 안 읽고 `<crate>/Cargo.toml` 이
 * `tests` 옆에 있다는 사실만 보므로 본문은 최소 형태다.
 */
function seedCrate(dir: string, name: string, tests: Record<string, string>) {
  const testsDir = join(dir, "tests");
  mkdirSync(testsDir, { recursive: true });
  writeFileSync(`${dir}/Cargo.toml`, `[package]\nname = "${name}"\n`, "utf8");
  for (const [rel, body] of Object.entries(tests)) {
    const path = join(testsDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, "utf8");
  }
}

function seed({
  tests = {},
  members = {},
  workflow,
  allowlist = "",
}: Tree): string {
  const root = mkdtempSync(join(tmpdir(), "ci-test-calls-"));
  trees.push(root);

  const crates = join(root, "src-tauri");
  seedCrate(crates, "fixture-app", tests);
  for (const [name, files] of Object.entries(members)) {
    seedCrate(join(crates, name), name, files);
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

function runGate(root?: string, env: NodeJS.ProcessEnv = {}) {
  const run = spawnSync("bash", root ? [gate, root] : [gate], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return {
    status: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    out: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

/** 출력에 찍힌 `FAIL <이름>:` 의 이름을 찍힌 차례 그대로 뽑는다. */
function failedNames(out: string): string[] {
  return out
    .split("\n")
    .filter((line) => line.startsWith("FAIL "))
    .map((line) => line.slice("FAIL ".length).split(":")[0]);
}

/**
 * collation 이 `C` 와 실제로 다른 로케일을 이 머신에서 찾는다. glibc 는 설치 안 된
 * 로케일을 조용히 C 로 떨어뜨리므로, 이름만 믿고 돌리면 두 실행이 저절로 같아지면서
 * 아무것도 안 재고 green 이 되는 테스트가 된다 — `sort` 로 판별력을 먼저 증명한다.
 * `Zeta` 는 byte 순서로 `alpha` 앞이고 사전 순서로는 뒤다.
 */
function collatingLocale(): string | null {
  for (const loc of ["en_US.UTF-8", "en_US.utf8", "de_DE.UTF-8"]) {
    const probe = spawnSync("sort", [], {
      input: "Zeta\nalpha\n",
      encoding: "utf8",
      env: { ...process.env, LC_ALL: loc },
    });
    if (probe.status === 0 && probe.stdout === "alpha\nZeta\n") return loc;
  }
  return null;
}
const COLLATING_LOCALE = collatingLocale();

const RUNNING_AS_ROOT =
  typeof process.getuid === "function" && process.getuid() === 0;

// 이 파일의 skip 은 `it.skipIf(조건)` 이 아니라 `ctx.skip(사유)` 로 한다. `skipIf` 는
// 사유를 어디에도 안 남기므로, 러너 이미지가 로케일을 떨어뜨리거나 job 에 `container:`
// 가 붙어 그 축이 통째로 안 재어져도 로그에서 갈라볼 것이 없다. 실측 (vitest 4.1.3):
// CI 가 쓰는 `--reporter=default` 는 파일 줄에 `| N skipped` 까지, `--reporter=verbose`
// 는 `↓ <케이스 이름> [<사유>]` 까지 찍는다.
const ROOT_SKIP =
  "root 로 도는 중 — chmod 000 픽스처는 권한 비트가 무시돼 아무것도 안 잰다";

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

  // 위 픽스처의 이름만 바꾼 형태가 아니다. 이 저장소 `ci.yml` 은 「예전 줄은
  // `--test X` 였다」는 이력 주석을 관례로 남기므로, 주석 안의 `--test <이름>`
  // 을 호출로 세면 진짜 호출을 지우고 주석만 남긴 커밋이 게이트를 green 으로
  // 통과한다 — 게이트가 막으려던 상태 그대로다.
  it("does not count a --test name that only appears in a workflow comment", () => {
    const root = seed({
      tests: { ...CALLED, "guard_grep.rs": "fn main() {}\n" },
      workflow: `${DEFAULT_WORKFLOW}      # 예전엔 cargo test --test guard_grep 였다\n`,
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

  // 아래는 스캔 루트가 앱 패키지 하나가 아니라는 것을 잠근다 (#2336). 루트가
  // `src-tauri/tests` 뿐이던 동안 `src-tauri/tvw/tests/query_url_live.rs` 는
  // 등급 대상 밖이라, 그것을 부르는 `--test` 줄을 지워도 게이트가 green 이었다.
  it("fails a workspace member's test binary that no workflow calls", () => {
    const root = seed({
      tests: CALLED,
      members: { tvw: { "query_url_live.rs": "fn main() {}\n" } },
    });
    const run = runGate(root);
    expect(run.out).toContain("FAIL query_url_live");
    expect(run.out).toContain("ci-uncalled-tests.txt 에 없다");
    expect(run.status).toBe(1);
  });

  it("counts a --test name that selects a member's binary", () => {
    const root = seed({
      tests: CALLED,
      members: { tvw: { "query_url_live.rs": "fn main() {}\n" } },
      workflow: `${DEFAULT_WORKFLOW}      - run: cargo test --manifest-path src-tauri/Cargo.toml -p tvw --test query_url_live\n`,
    });
    const run = runGate(root);
    // `ok: ` 로만 단언하면 member 루트를 아예 안 스캔하는 게이트도 통과한다 — 그때
    // 이 픽스처의 target 은 `called_one` 하나뿐이라 위반이 안 생긴다. 줄을 통째로
    // 못 박아 member 가 세어졌다는 것과 호출로 상쇄됐다는 것을 갈라 놓는다.
    expect(run.out).toBe(
      "ok: 통합 테스트 target 2 종 — CI 호출 2 종, 사유 달린 미호출 allowlist 0 종 (스캔 루트: src-tauri/tests, src-tauri/tvw/tests)\n",
    );
    expect(run.status).toBe(0);
  });

  // 루트만 넓히고 allowlist 판정을 그대로 두면 새 자리가 등록 불가인 채 남는다 —
  // 넓히기 전에는 이 픽스처가 `그런 테스트가 없다` 로 rc 1 이었다.
  it("lets the allowlist carry a member's uncalled binary", () => {
    const root = seed({
      tests: CALLED,
      members: { tvw: { "query_url_live.rs": "fn main() {}\n" } },
      allowlist: "query_url_live\tdocker 필요, 후속 이슈\n",
    });
    const run = runGate(root);
    expect(run.out).toMatch(/^ok: /);
    expect(run.status).toBe(0);
  });

  // 전수는 이름의 집합이다 (스크립트 헤더 「전수」). 호출도 이름으로만 세므로 두
  // 루트에 같은 이름이 있을 때 두 번 세면 집계와 FAIL 줄이 같은 이름을 두 벌 낸다.
  it("counts a target name shared by two roots once", () => {
    const root = seed({
      tests: { ...CALLED, "shared_probe.rs": "fn main() {}\n" },
      members: { tvw: { "shared_probe.rs": "fn main() {}\n" } },
    });
    const run = runGate(root);
    expect(run.out).toContain("통합 테스트 target 2 종");
    expect(failedNames(run.out)).toEqual(["shared_probe"]);
    expect(run.out).toContain("위반 1 건");
    expect(run.status).toBe(1);
  });

  // 집계가 통과 경로에만 있으면 인용할 수 있는 상태가 반쪽이 된다. red 를 받은
  // 사람이 가장 먼저 묻는 것이 "내 crate 가 스캔되긴 했나" 인데 (#2336 이 바로 안
  // 스캔된 루트였다) 그 답이 위반이 있을 때만 사라지면 안 된다. 아래는 수치와 두
  // 루트를 통째로 못 박아, `집계:` 줄이 사라지거나 루트가 하나로 좁아지면 red 다.
  it("prints the tally and the scan roots on the violation path too", () => {
    const root = seed({
      tests: { ...CALLED, "guard_grep.rs": "fn main() {}\n" },
      members: { tvw: { "query_url_live.rs": "fn main() {}\n" } },
    });
    const run = runGate(root);
    expect(run.stderr).toMatch(
      /^집계: 통합 테스트 target 3 종 — CI 호출 1 종, 사유 달린 미호출 allowlist 0 종 \(스캔 루트: src-tauri\/tests, src-tauri\/tvw\/tests\)$/m,
    );
    // rc 1 은 세 줄이 다 stderr 다 (스크립트의 「출력 계약」 블록). stdout 이 비었다는
    // 단언 하나가 `FAIL` · `집계:` · `::error::` 세 자리의 리디렉션을 같이 잠근다.
    expect(run.stdout).toBe("");
    expect(run.status).toBe(1);
  });

  // 스캔 루트는 manifest 옆 `tests` 다. crate 안쪽 `src/**/tests` 는 cargo 가
  // 통합 target 으로 안 보는 모듈 디렉토리이므로 (실물:
  // `src-tauri/table-view-core/src/db/search/tests/`) 여기 있는 파일을 미호출
  // target 으로 세면 안 된다.
  it("does not grade a tests directory that sits inside src/", () => {
    const root = seed({ tests: CALLED, members: { "table-view-core": {} } });
    const moduleTests = join(
      root,
      "src-tauri",
      "table-view-core",
      "src",
      "db",
      "tests",
    );
    mkdirSync(moduleTests, { recursive: true });
    writeFileSync(join(moduleTests, "metadata.rs"), "fn main() {}\n", "utf8");
    const run = runGate(root);
    expect(run.out).toMatch(/^ok: /);
    expect(run.status).toBe(0);
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

  // 아래는 "아무것도 못 쟀는데 위반 0 으로 통과" 를 막는다. 트리가 옮겨지거나
  // `--test` 표기가 통째로 바뀐 날 게이트가 조용히 green 이 되면 안 된다.
  it("refuses a tree whose src-tauri holds no crate manifest", () => {
    const root = seed({ tests: CALLED });
    rmSync(`${root}/src-tauri/Cargo.toml`);
    const run = runGate(root);
    expect(run.out).toContain("tests 디렉토리가 하나도 없다");
    expect(run.status).toBe(2);
  });

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

  // 집계 줄의 `사유 달린 미호출 allowlist N 종` 은 사유가 붙은 항목만 세야 라벨이
  // 참이다. 세는 자리가 사유를 안 보던 동안 `beta`(사유 없음)가 그 수에 들어가,
  // 위반 경로가 「사유 달린 … 2 종」을 찍으면서 사유를 가진 것은 `gamma` 하나였다
  // (#2347 결함 1). 아래는 그 수를 못 박는다.
  //
  // FAIL 줄 차례까지 못 박는 이유: 사유 없는 항목을 `continue` 로 통째로 건너뛰면
  // 수는 맞는데 2 차 루프가 `ci-uncalled-tests.txt 에 없다` 를 한 줄 더 찍어,
  // 파일에 버젓이 있는 이름을 없다고 말하면서 위반을 2 건으로 센다. 그 우회로도
  // red 가 되게 이름 목록을 통째로 비교한다.
  it("counts only reason-carrying entries in the allowlist tally", () => {
    const root = seed({
      tests: {
        ...CALLED,
        "beta.rs": "fn main() {}\n",
        "gamma.rs": "fn main() {}\n",
      },
      allowlist: "beta\ngamma\t사유 있음\n",
    });
    const run = runGate(root);
    expect(run.out).toContain("사유 달린 미호출 allowlist 1 종");
    expect(failedNames(run.out)).toEqual(["beta"]);
    expect(run.out).toContain("위반 1 건");
    expect(run.status).toBe(1);
  });

  // rc 2 도 red 다. 그런데 rc 2 경로에만 `FAIL` 도 `집계:` 도 `::error::` 도 없어서,
  // 검사가 아예 성립 못 한 red 가 셋 중 가장 적게 말하고 있었다 (#2347 결함 2).
  // 아래는 rc 2 를 내는 자리를 전부 같은 계약으로 묶는다 — 새 rc 2 분기가 계약
  // 밖으로 나가면 그 분기를 여기 더하는 순간 red 다.
  const refusals: Record<string, () => string> = {
    "no crate manifest": () => {
      const root = seed({ tests: CALLED });
      rmSync(`${root}/src-tauri/Cargo.toml`);
      return root;
    },
    "no integration test target": () => seed({ tests: {} }),
    "no --test call": () =>
      seed({
        tests: CALLED,
        workflow: "      - run: cargo test\n",
        allowlist: "called_one\t사유\n",
      }),
    "no .github/workflows": () =>
      seed({ tests: CALLED, workflow: null, allowlist: "called_one\t사유\n" }),
    "no allowlist file": () => seed({ tests: CALLED, allowlist: null }),
    "root that is not there": () => join(tmpdir(), "ci-test-calls-없는경로"),
  };

  for (const [label, makeTree] of Object.entries(refusals)) {
    it(`prints FAIL, 집계 and ::error:: on the exit 2 path (${label})`, () => {
      const run = runGate(makeTree());
      expect(run.status).toBe(2);
      expect(run.stderr).toMatch(/^FAIL 검사 불성립: \S/m);
      expect(run.stderr).toMatch(
        /^집계: 통합 테스트 target \S+ 종 — CI 호출 \S+ 종, 사유 달린 미호출 allowlist \S+ 종 \(스캔 루트: .+\)$/m,
      );
      expect(run.stderr).toMatch(/^::error::\S/m);
      // rc 2 의 세 줄도 같은 자리다 — `die()` 하나를 지나므로 이 단언이 여섯 경로를
      // 한 번에 덮는다.
      expect(run.stdout).toBe("");
    });
  }

  // exit 2 가드 중 `find` 실패를 받는 둘은 어느 케이스도 안 밟았다 (#2347 결함 3).
  // 아래 둘이 하나씩 밟는다. 두 메시지가 다 `다 훑지 못했다` 로 끝나므로 어느 가드가
  // 걸렸는지는 그 낱말로 안 갈린다 — `$CRATES_DIR` 가드는 스캔 루트를 모으기 전에 죽어
  // 집계 줄이 `스캔 루트: 미측정` 이고, 스캔 루트 가드는 그 라벨을 이미 갖고 있어 die
  // 메시지가 `스캔 루트(...)` 를 싣는다. 그 두 문면을 단언해 케이스가 서로의 자리를 안
  // 밟게 한다.
  it("refuses a tree whose scan root cannot be read", (ctx) => {
    if (RUNNING_AS_ROOT) ctx.skip(ROOT_SKIP);
    const root = seed({ tests: CALLED });
    const sealed = join(root, "src-tauri", "tests");
    chmodSync(sealed, 0o000);
    try {
      const run = runGate(root);
      expect(run.out).toContain("다 훑지 못했다");
      expect(run.out).toMatch(/^FAIL 검사 불성립: /m);
      expect(run.out).toMatch(/^집계: .*\(스캔 루트: 미측정\)$/m);
      expect(run.status).toBe(2);
    } finally {
      chmodSync(sealed, 0o755);
    }
  });

  // 스캔 루트만 훑는 가드의 실패 경로. `$CRATES_DIR` 를 훑는 find 는 깊이 제한이
  // 없지만 `-name target -prune` 으로 폭이 좁아서, 스캔 루트 아래 못 읽는 `target`
  // 디렉토리를 프룬해 rc 0 으로 지나간다 — 그것을 여는 것은 그 가드의 `-mindepth 2`
  // find 다. 상류를 안 고쳐도 오늘 도달하는 자리라 케이스로 잠근다.
  it("refuses a tree whose scan root holds an unreadable target directory", (ctx) => {
    if (RUNNING_AS_ROOT) ctx.skip(ROOT_SKIP);
    const root = seed({ tests: CALLED });
    const sealed = join(root, "src-tauri", "tests", "target");
    mkdirSync(sealed, { recursive: true });
    chmodSync(sealed, 0o000);
    try {
      const run = runGate(root);
      expect(run.out).toContain(
        "FAIL 검사 불성립: find 가 스캔 루트(src-tauri/tests)를 다 훑지 못했다",
      );
      expect(run.out).toMatch(/^집계: .*\(스캔 루트: src-tauri\/tests\)$/m);
      expect(run.out).toMatch(/^::error::\S/m);
      expect(run.status).toBe(2);
    } finally {
      chmodSync(sealed, 0o755);
    }
  });

  // 출력 순서를 정하는 `sort` 가 로케일에 걸려 있으면 같은 트리가 환경마다 다른
  // 줄을 낸다 (#2347 결함 4). 이슈는 스캔 루트 라벨만 짚었지만 target 이름을 정렬하는
  // 자리도 같은 축이다 — 그쪽은 FAIL 줄 차례를 정한다. 아래 픽스처는 대문자로
  // 시작하는 이름을 넣어 byte 순서와 사전 순서가 갈리게 만들고, 두 자리를 한 번에
  // 잠근다. `alpha` 는 사전 순서로 `Zed`/`Zeta` 앞, byte 순서로는 뒤다.
  it("orders roots and FAIL lines by byte value, not by the ambient locale", (ctx) => {
    if (COLLATING_LOCALE === null) {
      ctx.skip(
        "collation 이 C 와 다른 로케일을 이 머신에서 못 찾았다 — 두 실행이 저절로 같아져 아무것도 안 잰다",
      );
    }
    const root = seed({
      tests: { ...CALLED, "Zeta.rs": "fn main() {}\n" },
      members: {
        Zed: { "zed_probe.rs": "fn main() {}\n" },
        alpha: { "alpha_probe.rs": "fn main() {}\n" },
        tvw: { "tvw_probe.rs": "fn main() {}\n" },
      },
    });
    const underC = runGate(root, { LC_ALL: "C" });
    const underLocale = runGate(root, {
      LC_ALL: COLLATING_LOCALE as string,
    });

    // 둘이 같기만 하면 "양쪽이 똑같이 틀린" 회귀를 놓치므로 차례를 직접 못 박는다.
    expect(underC.out).toContain(
      "(스캔 루트: src-tauri/tests, src-tauri/Zed/tests, src-tauri/alpha/tests, src-tauri/tvw/tests)",
    );
    expect(failedNames(underC.out)).toEqual([
      "Zeta",
      "alpha_probe",
      "tvw_probe",
      "zed_probe",
    ]);
    expect(underLocale.out).toBe(underC.out);
    expect(underLocale.status).toBe(underC.status);
  });
});
