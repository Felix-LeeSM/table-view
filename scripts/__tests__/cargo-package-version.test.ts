import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `scripts/release/cargo-package-version.sh` 의 회귀 스위트는 bash 로 쓰여 있다
// (mutation harness 가 스크립트 사본을 만들어 자기 자신을 다시 돌리고, 배선
// 단계는 워크플로 YAML 을 읽는다). 그 스위트를 실행하는 러너가 repo 에 없어서
// 여기 붙였다 — CI 의 `Frontend Tests (shard N/3)` 잡이 `vitest run --shard` 를
// 이미 돌리고, vite.config.ts 의 `test.exclude` 는 scripts/ 를 빼지 않는다.
// 아무도 안 돌리는 스위트는 red 가 될 수 없다.
//
// 네트워크를 타지 않는다. 입력은 스위트가 만드는 manifest 픽스처, 저장소의
// `src-tauri/Cargo.toml`, 그리고 배선 단계가 읽는 `auto-tag-release.yml` 과 그
// 태그 스텝의 기대 블록(`scripts/release/fixtures/auto-tag-release-tag-step.txt`)이다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const suite = "scripts/release/cargo-package-version.test.sh";

// Purpose: auto-tag-release.yml 의 src-tauri/Cargo.toml 버전 파싱 회귀 스위트를 CI 에 배선 — issue #2169 (2026-08-05)
describe("cargo-package-version", () => {
  // Reason: bash 스위트를 실행하는 러너가 repo 에 없다. 이 파일이 없으면
  // `[workspace.package]`/따옴표 주석 오매치 단언이 아무 데서도 안 돌아 red 가
  // 될 수 없다 (2026-08-05)
  it("passes its own regression suite, mutation cases included", {
    timeout: 60_000,
  }, () => {
    // execFileSync 가 아니라 spawnSync 인 이유: 자식이 0 이 아닌 코드로 죽으면
    // execFileSync 는 던지고, 그 Error.message 에는 stderr 만 붙어 stdout 의
    // `ok` 줄과 `SUMMARY` 가 vitest 출력에서 사라진다 (issue #2085). spawnSync
    // 는 던지지 않으므로 두 스트림이 다 손에 남는다.
    const run = spawnSync("bash", [suite], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 50_000,
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
