import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `release.yml` 의 `Upload SHA256 checksums` 스텝 회귀 스위트는 bash 로 쓰여
// 있다 — 검사 대상이 워크플로 YAML 이고, 스텝의 `run:` 블록을 뽑아 그대로
// 실행하기 때문이다. 그 스위트를 실행하는 러너가 repo 에 없어서 여기 붙였다:
// CI 의 `Frontend Tests (shard N/3)` 잡이 `vitest run --shard` 를 이미 돌리고,
// vite.config.ts 의 `test.exclude` 는 scripts/ 를 빼지 않는다. 아무도 안 돌리는
// 스위트는 red 가 될 수 없다.
//
// 네트워크를 타지 않는다. `gh` 는 스위트가 PATH 앞에 놓는 스텁이 가로챈다.
//
// 스위트는 mutation 단계에서 워크플로 변조본을 만들어 자기 자신을 다시 돌린다.
// 아래 timeout 이 그 서브런까지 덮는 값이라, 값을 줄이려면 그 단계의 실측을 먼저
// 봐라. 변조의 근거는 커밋된 기대본
// `scripts/release/fixtures/release-checksum-step.txt` 다.
//
// 같은 형태가 옆 스텝에 있다 — scripts/__tests__/verify-tag-ci.test.ts (#2168).
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const suite = "scripts/release/checksum-sidecars.test.sh";

// Purpose: Windows 번들에 `.sha256` 사이드카가 안 붙는 것을 CI 에서 잡는다 — issue #2207 (2026-08-11)
describe("checksum-sidecars", () => {
  // Reason: v0.7.0 · v0.7.1 은 `.msi` / `.exe` 를 체크섬 없이 냈는데 릴리스
  // 워크플로는 green 이었다. Git Bash 가 백슬래시 artifactPaths 를 stat 하지
  // 못하고 `[ -f "$f" ] || continue` 가 그 실패를 삼켰다. 같은 형태(조용한
  // 건너뛰기 · 0건 통과 · 경로 변환 제거)를 되돌리는 편집을 이 스위트가 red 로
  // 만든다 (2026-08-11)
  it("passes its own regression suite, mutation cases included", {
    timeout: 60_000,
  }, () => {
    // spawnSync + status 검사: execFileSync 는 0 이 아닌 종료에서 던지는데 그
    // Error.message 에 stdout 이 안 붙어, 어느 단언에서 깨졌는지가 vitest 출력에서
    // 사라진다 (scripts/__tests__/verify-tag-ci.test.ts 와 같은 이유, issue #2085).
    // 스위트가 읽는 두 env 스위치를 상속하면 이 래퍼가 green 인 채로 검사가
    // 줄어든다: SKIP_MUTATION 은 변조 케이스와 양성 대조·픽스처 핀을 통째로
    // 빼고(SUMMARY 가 20/20 이 되는데 아래 정규식은 그것도 통과한다),
    // RELEASE_WORKFLOW 는 검사 대상을 저장소의 release.yml 이 아닌 다른
    // 파일로 돌린다. 러너 환경에 그 값이 서 있어도 여기서는 안 보게 한다.
    const env = { ...process.env };
    delete env.CHECKSUM_SIDECARS_SKIP_MUTATION;
    delete env.CHECKSUM_SIDECARS_RELEASE_WORKFLOW;
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
