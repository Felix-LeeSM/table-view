import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `scripts/review/measure-rounds.sh` 의 회귀 스위트는 bash 로 쓰여 있다
// (mutation harness 가 스크립트 사본을 만들어 자기 자신을 다시 돌린다). 그
// 스위트를 실행하는 러너가 repo 에 없어서 여기 붙였다 — vitest 는 CI
// `Doc Contracts` 잡과 pre-push TS gate 양쪽에서 이미 돌고, 아무도 안 돌리는
// 스위트는 red 가 될 수 없다.
//
// 네트워크를 타지 않는다. 입력은 scripts/review/fixtures/ 의 캡처 한 벌이다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const suite = "scripts/review/test-measure-rounds.sh";

// Purpose: scripts/review/measure-rounds.sh 회귀 스위트를 CI 에 배선 — issue #1856 (2026-07-30)
describe("measure-rounds", () => {
  // Reason: bash 스위트를 실행하는 러너가 repo 에 없었다. 이 파일이 없으면
  // 38개 단언이 아무 데서도 안 돌아 red 가 될 수 없다 (2026-07-30)
  it(
    "passes its own regression suite, mutation cases included",
    { timeout: 120_000 },
    () => {
      // `timeout` 은 필수다. 인자 파싱이 무한 루프로 회귀하면 execFileSync 는
      // 동기라 vitest 의 테스트 timeout 이 못 끊는다.
      const stdout = execFileSync("bash", [suite], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 100_000,
      });
      expect(stdout).toMatch(/\nSUMMARY: (\d+)\/\1 PASS\n$/);
    },
  );
});
