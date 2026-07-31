import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `scripts/review/measure-rounds.sh` 의 회귀 스위트는 bash 로 쓰여 있다
// (mutation harness 가 스크립트 사본을 만들어 자기 자신을 다시 돌린다). 그
// 스위트를 실행하는 러너가 repo 에 없어서 여기 붙였다 — CI 의
// `Frontend Tests (shard N/3)` 잡이 `vitest run --shard` 를 이미 돌리고,
// vite.config.ts 의 `test.exclude` 는 scripts/ 를 빼지 않는다. 아무도 안 돌리는
// 스위트는 red 가 될 수 없다.
//
// 네트워크를 타지 않는다. 입력은 scripts/review/fixtures/ 의 캡처 한 벌이다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const suite = "scripts/review/measure-rounds.test.sh";

// Purpose: scripts/review/measure-rounds.sh 회귀 스위트를 CI 에 배선 — issue #1856 (2026-07-30)
describe("measure-rounds", () => {
  // Reason: bash 스위트를 실행하는 러너가 repo 에 없었다. 이 파일이 없으면 그
  // 스위트의 단언이 아무 데서도 안 돌아 red 가 될 수 없다 (2026-07-30)
  it("passes its own regression suite, mutation cases included", {
    timeout: 120_000,
  }, () => {
    // `timeout` 은 필수다. 인자 파싱이 무한 루프로 회귀하면 spawnSync 는
    // 동기라 vitest 의 테스트 timeout 이 못 끊는다.
    //
    // execFileSync 가 아니라 spawnSync 인 이유: 자식이 0 이 아닌 코드로 죽으면
    // execFileSync 는 던지는데, 그 Error.message 에는 stderr 만 붙고 stdout 은
    // `error.stdout` 에만 남아 vitest 출력에서 사라진다. 이 스위트는 `ok` 줄과
    // `SUMMARY` 를 stdout 으로, `FAIL` 상세를 stderr 로 낸다 — 즉 실패 시
    // 어느 단언까지 갔는지가 통째로 증발했다. shard flake 가 이 때문에 로그만으로
    // 진단 불가였다 (issue #2085). spawnSync 는 던지지 않으므로 두 스트림이 다
    // 손에 남는다.
    const run = spawnSync("bash", [suite], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 100_000,
    });
    // 성공 경로에서는 아무것도 출력하지 않는다 — 이 문자열은 단언이 깨질 때만
    // vitest 가 찍는다.
    const report = [
      `bash ${suite}: exit=${run.status} signal=${run.signal} spawnError=${run.error?.message ?? "none"}`,
      `--- child stdout ---\n${run.stdout ?? "(none)"}`,
      `--- child stderr ---\n${run.stderr ?? "(none)"}`,
    ].join("\n");
    expect(run.stdout, report).toMatch(/\nSUMMARY: (\d+)\/\1 PASS\n$/);
  });
});
