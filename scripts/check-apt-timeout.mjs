// check-apt-timeout.mjs — apt 를 부르는 워크플로 스텝에 `timeout-minutes` 를 강제한다 (issue #2502).
//
// apt 는 실패로 끝나지 않고 매달릴 수 있다. 스텝 안의 `for i in 1 2 3` 재시도 래퍼는
// 그 상태를 못 푼다 — 매달린 apt 는 돌아오지 않으니 루프가 2회차에 닿지 못한다(#2495).
// 스텝 timeout 이 없으면 job 이 자기 budget 을 다 태우고 GitHub 이 job 을 취소하므로
// 결론이 `cancelled` 로 남고 뒤 스텝은 `skipped` 가 된다. 실측된 자리가
// `Integration Tests (Docker)` 의 job `95785672544` 이고 3582초 뒤 취소됐다.
//
// 자리를 하나씩 고치는 것으로는 이 유형이 안 죽는다. 새 워크플로나 새 스텝이 apt 를
// 부르면서 `timeout-minutes` 를 빠뜨리면 아무도 안 잡았고, 그렇게 다섯 자리가 쌓였다
// (#2502 가 잰 모집단). 이 게이트가 기본값을 뒤집는다: 안전이 「기억해서 붙이는 것」에서
// 「안 붙이면 CI 가 잡는 것」이 된다.
//
// ## 무엇을 세는가 — 이 규칙이 판정의 전부다
//
//   전수 = `.github/workflows/` 바로 아래 `*.yml` · `*.yaml` 를 YAML 로 파싱해 얻은
//          `jobs` 의 모든 job, 그 job 의 `steps` 배열에 든 모든 매핑
//   apt 스텝 = 그 스텝의 `run` 문자열에서 한 줄 안에 apt 바이너리 토큰(`apt` 또는
//          `apt-get`)과 서브커맨드(`install` · `update` · `upgrade` · `dist-upgrade` ·
//          `full-upgrade` · `build-dep`)가 같이 나오는 것
//   위반 = apt 스텝인데 그 스텝 매핑에 `timeout-minutes` 키가 없는 것
//
// 이 규칙에 안 적힌 성질은 판정에 안 들어간다.
//
// 값은 안 본다 — 키가 있으면 통과다. 얼마가 맞는 값인지는 job 마다 다르고(그 job 의
// budget 아래이면서 그 스텝의 가장 느린 성공 실행 위여야 한다) 파일만 보고는 못
// 정한다. 이 게이트가 막는 것은 키가 통째로 빠지는 것이다.
//
// `run` 안의 셸 주석도 센다. 셸 주석은 `run` 문자열의 일부라 갈라내려면 셸을 파싱해야
// 하는데, 그 대가로 얻는 것은 「apt 를 부른다고 적어 놓고 안 부르는 스텝」을 통과시키는
// 것뿐이다. 반대 방향의 오판(안 부르는데 잡힘)은 `timeout-minutes` 한 줄로 풀리고,
// 놓치는 쪽은 아무도 안 잡는다. `scripts/check-prompt-fail-silently.sh` 가 금지 형태를
// 주석에 인용해도 걸리게 둔 것과 같은 선택이다.
//
// YAML 주석은 반대다 — 파서가 데이터에서 빼므로 이 게이트가 안 본다. 스텝 위에 붙은
// 설명 주석이 apt 를 언급해도 그 스텝은 apt 스텝이 아니다.
//
// 파서를 손으로 안 쓴 이유: 이 저장소는 이미 `yaml` 패키지를 devDependency 로 갖고
// (`scripts/__tests__/check-coverage-ratchet.test.ts` 와
// `scripts/__tests__/check-review-size-cap.test.ts` 가 `ci.yml` 을 그것으로 읽는다),
// 이 검사가 도는 `Frontend Checks` 는 `Install dependencies` 로 그것을 이미 깔아 둔다.
// `python3` + `PyYAML` 은 이 저장소의 워크플로가 한 번도 안 쓰는 의존이라
// (`git grep -n 'python3\|pip install\|PyYAML' -- .github/workflows/` 가 0건) 러너에
// 있다는 보장을 이 저장소가 안 갖는다.
//
// 사용:
//   node scripts/check-apt-timeout.mjs          # 이 repo
//   node scripts/check-apt-timeout.mjs <ROOT>   # 다른 트리 (테스트가 쓴다)
//
// ## 출력 계약 — 모든 종료 경로가 여기를 지난다
//
//   rc 0  stdout  `ok: <집계>`
//   rc 1  stderr  `FAIL <path>:<line>: <사유>` (위반마다) → `집계: <집계>` → `::error::…`
//   rc 2  stderr  `FAIL 검사 불성립: <사유>`            → `집계: <집계>` → `::error::…`
//
// 세 경로가 같은 모양인 이유는 `scripts/check-ci-test-calls.sh` 「출력 계약」과 같다:
// red 를 받은 사람이 가장 먼저 묻는 것이 「내 워크플로가 스캔되긴 했나」인데, 그 답이
// 경로에 따라 사라지면 안 된다. 아직 못 잰 축은 `?` 로 찍고 자리는 남긴다.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const APT_BINARY = String.raw`\bapt(?:-get)?\b`;
const APT_SUBCOMMAND = String.raw`\b(?:install|update|upgrade|dist-upgrade|full-upgrade|build-dep)\b`;
// 한 줄 안에서 둘이 같이 나와야 한다. 줄을 넘겨 세면 `apt` 를 쓰지 않는 스텝이 옆
// 줄의 `update` 하나로 apt 스텝이 된다.
const APT_CALL = new RegExp(`${APT_BINARY}[^\\n]*${APT_SUBCOMMAND}`);

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(here, ".."));
const workflowsDir = join(root, ".github", "workflows");

let filesN = "?";
let jobsN = "?";
let stepsN = "?";
let aptN = "?";
let violations = 0;

const summary = () =>
  `워크플로 ${filesN} 개 · job ${jobsN} 개 · step ${stepsN} 개 · apt 스텝 ${aptN} 개`;

/** 위반 한 건. 찍는 자리와 세는 자리를 한 함수로 묶는다. */
function fail(where, reason) {
  console.error(`FAIL ${where}: ${reason}`);
  violations += 1;
}

/** 검사 불성립. rc 2 로 나가는 자리는 전부 여기를 지난다. */
function die(reason) {
  console.error(`FAIL 검사 불성립: ${reason}`);
  console.error(`집계: ${summary()}`);
  console.error(
    `::error::apt 스텝 timeout 대조가 성립하지 않았다 (위 FAIL 줄): ${reason}`,
  );
  process.exit(2);
}

/** 바이트 오프셋을 1-based 줄 번호로. */
const lineAt = (text, offset) => text.slice(0, offset).split("\n").length;

let entries;
try {
  entries = readdirSync(workflowsDir, { withFileTypes: true });
} catch (err) {
  die(
    `워크플로 디렉토리를 못 읽었다: ${workflowsDir} (${err.code ?? err.message})`,
  );
}

const files = entries
  .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
  .map((e) => join(workflowsDir, e.name))
  .sort();

filesN = files.length;

// 0 개를 「위반 0」으로 통과시키면 트리가 옮겨진 날 게이트가 아무것도 안 재면서 green
// 이 된다. 검사 불성립은 통과가 아니다.
if (filesN === 0) {
  die(
    `${workflowsDir} 에 워크플로 파일이 0 개다 — 트리가 옮겨졌거나 경로가 틀렸다`,
  );
}

jobsN = 0;
stepsN = 0;
aptN = 0;

for (const file of files) {
  // 경로는 ROOT 기준 상대로 찍는다. 절대 경로를 찍으면 Actions annotation 이 러너
  // 경로로, 로컬 실행이 그 머신의 홈 경로로 나와 인용이 이식되지 않는다.
  const rel = relative(root, file);

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    die(`${rel} 을 못 읽었다 (${err.code ?? err.message})`);
  }

  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    die(`${rel} 이 YAML 로 안 읽힌다: ${doc.errors[0].message}`);
  }

  const data = doc.toJS() ?? {};
  const jobs = data.jobs;
  // 워크플로 파일에 `jobs` 가 없으면 GitHub 도 안 받는다. 파일이 잘렸거나 파서가
  // 깨진 것이므로 통과가 아니라 불성립이다.
  if (jobs === null || typeof jobs !== "object" || Array.isArray(jobs)) {
    die(`${rel} 에 \`jobs\` 매핑이 없다 — 파일이 잘렸거나 파서가 깨졌다`);
  }

  for (const [jobName, job] of Object.entries(jobs)) {
    jobsN += 1;
    // 재사용 워크플로를 부르는 job 은 `steps` 가 없다. 이 저장소엔 아직 없지만,
    // 생기는 날 이 게이트가 거짓 red 를 내지 않게 스텝 없는 job 은 그냥 넘긴다.
    const steps = job && typeof job === "object" ? job.steps : undefined;
    if (!Array.isArray(steps)) continue;

    for (const [i, step] of steps.entries()) {
      if (step === null || typeof step !== "object" || Array.isArray(step)) {
        continue;
      }
      stepsN += 1;
      if (typeof step.run !== "string" || !APT_CALL.test(step.run)) continue;
      aptN += 1;
      if (Object.hasOwn(step, "timeout-minutes")) continue;

      const node = doc.getIn(["jobs", jobName, "steps", i]);
      const line = node?.range ? lineAt(text, node.range[0]) : "?";
      const label = typeof step.name === "string" ? step.name : "(이름 없음)";
      fail(
        `${rel}:${line}`,
        `job \`${jobName}\` 의 스텝 \`${label}\` 이 apt 를 부르는데 \`timeout-minutes\` 가 없다`,
      );
    }
  }
}

// job 은 파일마다 있어야 한다 — 위 루프가 파일별로 이미 막는다. step 은 전체로 본다.
if (stepsN === 0) {
  die(
    `워크플로 ${filesN} 개의 job ${jobsN} 개에서 step 을 0 개 읽었다 — 파서가 깨졌다`,
  );
}

if (violations > 0) {
  console.error(`집계: ${summary()}`);
  // `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 체크 화면 맨
  // 위 annotation 이 되고, 로컬에서는 접두어가 그대로 찍히는 한 줄이다.
  console.error(
    `::error::timeout 없는 apt 스텝 ${violations} 개 (위 FAIL 줄). 매달린 apt 는 재시도 래퍼가 못 풀고 job budget 을 통째로 태운다 — 그 job 의 \`timeout-minutes\` 아래이면서 그 스텝의 가장 느린 성공 실행 위인 값을 스텝에 붙여라 (issue #2502).`,
  );
  process.exit(1);
}

console.log(`ok: ${summary()} — 전부 timeout-minutes 를 갖는다`);
