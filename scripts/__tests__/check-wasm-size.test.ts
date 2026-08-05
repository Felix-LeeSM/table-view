import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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

// `scripts/check-wasm-size.sh` 는 CI 의 `WASM Size Budget (non-blocking)` 잡이
// wasm-pack 빌드 뒤에 부르는 advisory 게이트다 (.github/workflows/ci.yml). 그
// 잡은 실제 산출물이 예산 안이라는 것만 보므로 "예산을 넘기면 정말 red 가
// 되는가" 는 아무 데서도 안 돌아 본 적이 없는 질문이 된다 — 이 파일이 그
// 질문을 판다. 픽스처는 임시 디렉토리에 씨를 뿌려 만들고 repo 의 체크인된
// 산출물은 건드리지 않는다.
//
// **여기서 실제 산출물 크기를 단언하지 않는다.** 이 파일은 required context 인
// `Frontend Tests (shard N/3)` 안에서 돌기 때문에, 진짜 산출물을 재는 단언을
// 넣으면 advisory 여야 할 예산이 required 잡을 타고 blocking 이 된다 (#2127 은
// advisory 로 못 박았다). 크기 판정은 advisory 잡에만 있고, 여기 있는 것은
// 게이트 로직뿐이다.
//
// 이 스위트가 못 잡는 것 하나: `GZIP_LEVEL` 이 9 에서 다른 값으로 바뀌는 것.
// 9 를 1 로 바꿔도 아래 9 케이스가 전부 통과한다 — 압축 안 되는 픽스처는 어느
// 레벨에서든 예산을 넘고, 잘 되는 픽스처는 어느 레벨에서든 안 넘기 때문이다.
// 레벨을 고정하는 픽스처를 만들려면 gzip 구현(Apple/GNU)마다 다른 정확한 출력
// 크기에 기대야 해서 flaky 해진다. 그 회귀는 job 로그에 찍히는 숫자와 스크립트
// 머리말의 기준값 대조로 잡는다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-wasm-size.sh";

// scripts/check-wasm-size.sh 의 리터럴과 같은 값. 여기서 import 할 수 없으니
// (bash 다) 손으로 맞춘 복제본이고, 어긋나면 아래 초과/통과 케이스가 뜻을
// 잃는다 — 예산을 바꾸면 두 곳을 같이 고친다.
const SQL_BUDGET_BYTES = 122_880;
const MONGO_BUDGET_BYTES = 63_488;

const SQL_REL = "src/lib/sql/wasm/sql_parser_core_bg.wasm";
const MONGO_REL = "src/lib/mongo/wasm/mongosh_parser_core_bg.wasm";

const trees: string[] = [];
const restores: Array<() => void> = [];

afterEach(() => {
  for (const undo of restores.splice(0)) undo();
  for (const t of trees.splice(0)) rmSync(t, { recursive: true, force: true });
});

// root 는 권한 비트를 무시하고 다 읽는다 — 아래 "못 읽는 산출물" 케이스가
// 컨테이너 안에서 조용히 거짓 green 이 되지 않게 건너뛴다.
const asRoot = process.getuid?.() === 0;

/** 산출물 두 벌을 repo 와 같은 상대 경로에 씨 뿌리고 그 루트를 돌려준다. */
function seed(files: Record<string, Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "wasm-size-"));
  trees.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  return root;
}

/**
 * 압축이 거의 안 되는 바이트. gzip 결과가 원본과 비슷해지므로 "gzip 으로 재서
 * 예산을 넘는" 픽스처를 크기 계산 없이 만들 수 있다.
 */
const incompressible = (bytes: number) => randomBytes(bytes);

/** 압축이 극단적으로 잘 되는 바이트 — raw 는 크고 gzip 은 작다. */
const compressible = (bytes: number) => Buffer.alloc(bytes, 0);

/** 예산 안에 확실히 들어가는 작은 산출물. */
const tiny = () => randomBytes(1024);

function runGate(root: string) {
  const run = spawnSync("bash", [gate, root], {
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

describe("check-wasm-size", () => {
  it("passes when both artifacts sit under budget", () => {
    const run = runGate(seed({ [SQL_REL]: tiny(), [MONGO_REL]: tiny() }));
    expect(run.out).toContain("ok: parser WASM 2 개 다 gzip 예산 안");
    expect(run.status).toBe(0);
  });

  it("fails on a SQL artifact over the gzip budget", () => {
    const run = runGate(
      seed({
        [SQL_REL]: incompressible(SQL_BUDGET_BYTES + 8_192),
        [MONGO_REL]: tiny(),
      }),
    );
    expect(run.out).toContain(`FAIL ${SQL_REL}`);
    expect(run.out).toContain(`> budget ${SQL_BUDGET_BYTES} bytes`);
    expect(run.status).toBe(1);
  });

  it("fails on a Mongo artifact over the gzip budget", () => {
    const run = runGate(
      seed({
        [SQL_REL]: tiny(),
        [MONGO_REL]: incompressible(MONGO_BUDGET_BYTES + 8_192),
      }),
    );
    expect(run.out).toContain(`FAIL ${MONGO_REL}`);
    expect(run.out).toContain(`> budget ${MONGO_BUDGET_BYTES} bytes`);
    expect(run.status).toBe(1);
  });

  // 한쪽이 걸리면 거기서 멈추는 게이트는 나머지 산출물의 현재 크기를 로그에
  // 안 남긴다 — 예산을 다시 잡을 때 필요한 숫자가 사라진다.
  it("reports both artifacts even when the first one is over", () => {
    const run = runGate(
      seed({
        [SQL_REL]: incompressible(SQL_BUDGET_BYTES + 8_192),
        [MONGO_REL]: incompressible(MONGO_BUDGET_BYTES + 8_192),
      }),
    );
    expect(run.out).toContain(`FAIL ${SQL_REL}`);
    expect(run.out).toContain(`FAIL ${MONGO_REL}`);
    expect(run.out).toContain("초과 2 건");
    expect(run.status).toBe(1);
  });

  // 예산의 단위는 gzip 이다. 아래 SQL 픽스처는 raw 로 재면 예산의 8배지만
  // gzip 하면 1 KiB 도 안 된다 — 비교가 raw 로 미끄러지면 여기서만 red 가
  // 되고, 초과 케이스들은 (raw 든 gzip 이든 넘으므로) 단위를 증명하지 못한다.
  it("budgets gzip bytes, not raw bytes", () => {
    const run = runGate(
      seed({
        [SQL_REL]: compressible(SQL_BUDGET_BYTES * 8),
        [MONGO_REL]: tiny(),
      }),
    );
    expect(run.out).toMatch(/SQL wasm: raw=983040 bytes gzip=\d{3,4} bytes/);
    expect(run.status).toBe(0);
  });

  // 아래 셋은 "재지 못한 것을 예산 안으로 통과시키지 않는다" 를 판다. 산출물이
  // 없거나 0 byte 면 어떤 예산도 통과하므로, 빌드가 죽은 날 게이트가 조용히
  // green 이 되는 fail-open 경로다.
  it("refuses to pass when an artifact is missing", () => {
    const run = runGate(seed({ [SQL_REL]: tiny() }));
    expect(run.out).toContain(`Mongo WASM 산출물이 없다: ${MONGO_REL}`);
    expect(run.out).not.toMatch(/^ok:/m);
    expect(run.status).toBe(2);
  });

  it("refuses to pass a zero-byte artifact", () => {
    const run = runGate(
      seed({ [SQL_REL]: Buffer.alloc(0), [MONGO_REL]: tiny() }),
    );
    expect(run.out).toContain("SQL WASM 이 0 byte 다");
    expect(run.out).not.toMatch(/^ok:/m);
    expect(run.status).toBe(2);
  });

  // 파일은 있는데 못 읽는 경우. 스크립트에 `set -e` 가 없어서 실패한 명령
  // 치환은 빈 문자열이 되고 `[ "" -gt 122880 ]` 은 rc 2 로 그냥 지나간다 —
  // 이 단언이 없으면 그 경로가 `ok:` + exit 0 으로 끝난다.
  it.skipIf(asRoot)("refuses to pass an unreadable artifact", () => {
    const root = seed({ [SQL_REL]: tiny(), [MONGO_REL]: tiny() });
    const locked = join(root, SQL_REL);
    chmodSync(locked, 0o000);
    restores.push(() => chmodSync(locked, 0o644));
    const run = runGate(root);
    expect(run.out).toContain("SQL WASM 크기를 못 쟀다");
    expect(run.out).not.toMatch(/^ok:/m);
    expect(run.status).toBe(2);
  });

  it("refuses a root that is not there", () => {
    const run = runGate(join(tmpdir(), "wasm-size-없는경로"));
    expect(run.out).toContain("검사할 디렉토리가 없다");
    expect(run.status).toBe(2);
  });
});
