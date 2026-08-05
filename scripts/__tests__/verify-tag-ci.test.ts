import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `release.yml` 의 `verify-tag-ci` 게이트 회귀 스위트는 bash 로 쓰여 있다 —
// 검사 대상이 워크플로 YAML 이고, 게이트의 `run:` 블록을 뽑아 그대로 실행하기
// 때문이다. 그 스위트를 실행하는 러너가 repo 에 없어서 여기 붙였다: CI 의
// `Frontend Tests (shard N/3)` 잡이 `vitest run --shard` 를 이미 돌리고,
// vite.config.ts 의 `test.exclude` 는 scripts/ 를 빼지 않는다. 아무도 안 돌리는
// 스위트는 red 가 될 수 없다.
//
// 네트워크를 타지 않는다. GitHub API 는 스위트가 PATH 앞에 놓는 `gh` 스텁이
// 가로챈다.
//
// 스위트는 mutation 단계에서 워크플로 · 문서 변조본을 만들어 자기 자신을 다시
// 돌린다 (#2180). 아래 timeout 이 그 서브런까지 덮는 값이라, 값을 줄이려면 그
// 단계의 실측을 먼저 봐라. 변조의 근거는 커밋된 기대본
// `scripts/release/fixtures/release-verify-tag-ci-job.txt` 다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const suite = "scripts/release/verify-tag-ci.test.sh";

// Purpose: release.yml 의 태그 SHA CI 게이트를 CI 에 배선 — issue #2168 (2026-08-05)
describe("verify-tag-ci", () => {
  // Reason: 태그는 CI 결과를 안 보고 붙는다. 그 간극을 메우는 게이트가 조용히
  // 무력화돼도(continue-on-error, 실패 경로의 exit 0, 자기 run 제외 누락) 릴리스는
  // green 으로 끝난다 — 이 스위트가 그 편집들을 red 로 만든다 (2026-08-05)
  it("passes its own regression suite, mutation cases included", {
    timeout: 60_000,
  }, () => {
    // spawnSync + status 검사: execFileSync 는 0 이 아닌 종료에서 던지는데 그
    // Error.message 에 stdout 이 안 붙어, 어느 단언에서 깨졌는지가 vitest 출력에서
    // 사라진다 (scripts/__tests__/measure-rounds.test.ts 와 같은 이유, issue #2085).
    const run = spawnSync("bash", [suite], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 50_000,
    });
    // 성공 경로에서는 아무것도 출력하지 않는다 — 단언이 깨질 때만 vitest 가 찍는다.
    const report = [
      `bash ${suite}: exit=${run.status} signal=${run.signal} spawnError=${run.error?.message ?? "none"}`,
      `--- child stdout ---\n${run.stdout ?? "(none)"}`,
      `--- child stderr ---\n${run.stderr ?? "(none)"}`,
    ].join("\n");
    expect(run.stdout, report).toMatch(/\nSUMMARY: (\d+)\/\1 PASS\n$/);
  });
});
