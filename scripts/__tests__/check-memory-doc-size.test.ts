import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// `scripts/check-memory-doc-size.sh` 는 CI 의 `PR Body Contract` 잡에서 도는
// blocking 게이트다 (.github/workflows/ci.yml). 그 잡은 게이트가 real
// `memory/` 트리에 대해 green 인 것만 보므로, "위반을 넣으면 실제로 red 가
// 되는가" 는 아무 데서도 안 돌아 본 적이 없는 질문이 된다 — 이 파일이 그
// 질문을 판다. 픽스처는 전부 임시 디렉토리에 씨를 뿌려 만들고 repo 트리는
// 건드리지 않는다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-memory-doc-size.sh";

const trees: string[] = [];

afterEach(() => {
  for (const t of trees.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** `<tmp>/<name>/memory.md` 한 벌을 씨 뿌리고 그 루트를 돌려준다. */
function seed(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "memory-doc-size-"));
  trees.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, "utf8");
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
    out: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

describe("check-memory-doc-size", () => {
  it("passes on the real memory/ tree", () => {
    const run = runGate();
    expect(run.out).toMatch(/^ok: memory\.md \d+ 개/);
    expect(run.status).toBe(0);
  });

  it("fails on a file over the 200-line cap", () => {
    const root = seed({ "workflow/memory.md": "x\n".repeat(201) });
    const run = runGate(root);
    expect(run.out).toContain("201 lines > 200");
    expect(run.status).toBe(1);
  });

  it("fails on a file over the 12,000-character cap", () => {
    const root = seed({ "workflow/memory.md": `${"a".repeat(12_000)}\n` });
    const run = runGate(root);
    expect(run.out).toContain("12001 chars > 12000");
    expect(run.status).toBe(1);
  });

  // 이 트리의 본문은 한글이고 UTF-8 에서 한 글자가 3 byte 다. 아래 파일은 5,001
  // 문자 / 15,003 byte — cap 안이지만 byte 로 재면 12,000 을 한참 넘는다. 게이트가
  // `wc -c` 로 (또는 LC_ALL=C 아래 `wc -m` 으로) 재도록 회귀하면 여기서만 red 가
  // 된다. 위의 두 초과 케이스는 ASCII 라 어느 단위로 재든 잡히므로 단위를 증명하지
  // 못한다.
  it("counts characters, not bytes", () => {
    const body = `${"가".repeat(5_000)}\n`;
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(12_000);
    const root = seed({ "workflow/memory.md": body });
    const run = runGate(root);
    expect(run.out).toMatch(/^ok: memory\.md 1 개/);
    expect(run.status).toBe(0);
  });

  // 200 줄 · 12,000 문자 정각. 상한은 "이하" 라서 통과해야 한다 — 비교가 `>=` 로
  // 미끄러지면 여기가 red 다.
  it("passes at exactly the caps", () => {
    const body = `${"y".repeat(59)}\n`.repeat(200);
    const root = seed({ "workflow/memory.md": body });
    const run = runGate(root);
    expect(run.out).toMatch(/^ok: memory\.md 1 개/);
    expect(run.status).toBe(0);
  });

  // 검사할 파일이 0 개면 "위반 0 건" 과 구별이 안 된다. 트리가 옮겨지거나
  // 파일명 규약이 바뀐 날 게이트가 아무것도 안 재면서 green 이 되는 fail-open 을
  // 여기서 막는다.
  it("refuses to pass a tree with no memory.md", () => {
    const root = seed({ "workflow/notes.md": "빈 트리\n" });
    const run = runGate(root);
    expect(run.out).toContain("memory.md 가 0 개다");
    expect(run.status).toBe(2);
  });
});
