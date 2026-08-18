import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `scripts/release/update-homebrew-cask.sh` 회귀 스위트는 bash 로 쓰여 있다 —
// 검사 대상이 셸 스크립트와 워크플로 YAML 이기 때문이다. 그 스위트를 실행하는
// 러너가 repo 에 없어서 여기 붙였다: CI 의 `Frontend Tests (shard N/3)` 잡이
// `vitest run --shard` 를 이미 돌리고, vite.config.ts 의 `test.exclude` 는
// scripts/ 를 빼지 않는다. 아무도 안 돌리는 스위트는 red 가 될 수 없다.
//
// 네트워크를 타지 않는다. 입력은 스위트가 만드는 cask 픽스처와 저장소의
// release.yml 이다.
//
// 같은 형태가 옆에 둘 있다 — scripts/__tests__/cargo-package-version.test.ts
// (#2169) · scripts/__tests__/checksum-sidecars.test.ts (#2207).
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const suite = "scripts/release/update-homebrew-cask.test.sh";

// Purpose: 릴리스 publish 뒤 Homebrew tap 이 자동 갱신되는 경로를 지킨다 — issue #2454 (2026-08-18)
describe("update-homebrew-cask", () => {
  // Reason: cask 가 0.4.1 에 멈춰 세 버전 뒤처졌던 것은 tap 갱신이 사람 손에
  // 달린 수동 절차였기 때문이다. 자동화가 조용히 아무것도 안 하고 green 으로
  // 끝나면 같은 상태가 그대로 돌아온다 — 패턴이 안 맞아도 rc=0 을 내는 치환,
  // 워크플로가 스크립트를 안 부르는 배선, tag push 로 앞당겨진 트리거가 그
  // 형태다 (2026-08-18)
  it("passes its own regression suite, mutation cases included", {
    timeout: 60_000,
  }, () => {
    // spawnSync + status 검사: execFileSync 는 0 이 아닌 종료에서 던지는데 그
    // Error.message 에 stdout 이 안 붙어, 어느 단언에서 깨졌는지가 vitest 출력에서
    // 사라진다 (scripts/__tests__/checksum-sidecars.test.ts 와 같은 이유, issue #2085).
    // 스위트가 읽는 env 스위치를 상속하면 이 래퍼가 green 인 채로 검사가 줄어든다:
    // SKIP_MUTATION 은 변조 케이스와 양성 대조를 통째로 빼고, 나머지 둘은 검사
    // 대상을 저장소의 실제 파일이 아닌 다른 파일로 돌린다.
    const env = { ...process.env };
    delete env.UPDATE_HOMEBREW_CASK_SKIP_MUTATION;
    delete env.UPDATE_HOMEBREW_CASK_SCRIPT;
    delete env.UPDATE_HOMEBREW_CASK_RELEASE_WORKFLOW;
    const run = spawnSync("bash", [suite], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 50_000,
    });
    // 성공 경로에서는 아무것도 출력하지 않는다 — 단언이 깨질 때만 vitest 가 찍는다.
    const report = [
      `bash ${suite}: exit=${run.status} signal=${run.signal} spawnError=${run.error?.message ?? "none"}`,
      `--- child stdout ---\n${run.stdout ?? "(none)"}`,
      `--- child stderr ---\n${run.stderr ?? "(none)"}`,
    ].join("\n");
    // rc 를 같이 단언한다 — SUMMARY 줄만 보면 스위트가 그 줄을 찍은 뒤 죽어도
    // green 이다. 앞자리를 `[1-9]\d*` 로 묶은 것은 `0/0 PASS` 를 막는다: 아무
    // 단언도 안 돈 실행이 이 래퍼를 통과하던 자리다.
    expect(run.status, report).toBe(0);
    expect(run.stdout, report).toMatch(/\nSUMMARY: ([1-9]\d*)\/\1 PASS\n$/);
  });
});
