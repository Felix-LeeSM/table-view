#!/usr/bin/env node
// check-coverage-ratchet.mjs — 프런트엔드 커버리지 하락 톱니(ratchet) 집행 (#2126).
//
// `vite.config.ts` 의 `coverage.thresholds` 는 절대 바닥이고 실측치는 그 위 2~3%p
// 에 떠 있다 (2026-08-03 main: statements 88.1 대 바닥 85, branches 80.99 대 78,
// functions 89.13 대 87, lines 90.56 대 87). 그 사이 구간은 아무도 안 본다 —
// 커버리지가 2%p 새어도 바닥은 안 깨지므로 게이트는 계속 green 이다. 이 스크립트가
// 그 구간을 막는다: 커밋된 `coverage-baseline.json` 아래로 떨어지면 red.
//
// 사용:
//   node scripts/check-coverage-ratchet.mjs                       # CI 기본 경로
//   node scripts/check-coverage-ratchet.mjs <summary> <baseline>  # 테스트가 쓴다
//
// exit: 0 baseline 이상 · 1 하락 · 2 검사 불성립 (파일/지표 없음, 측정 대상 0)
//
// ## baseline 을 올리는 절차 — 같은 PR 에서 고친다
//
// 커버리지가 baseline 을 넘으면 exit 0 이면서 `::notice::` 로 새 baseline JSON 을
// 통째로 찍는다. 그 블록을 `coverage-baseline.json` 에 그대로 붙여 **같은 PR 에**
// 커밋한다. 별도 PR 로 미루면 그 사이 머지되는 변경이 오른 만큼을 도로 까먹고,
// 톱니는 한 칸도 안 올라간다.
//
// ## baseline 은 CI 의 merged 값이다 — 로컬 통짜 실행과 다르다
//
// `Frontend Tests (shard N/3)` 셋이 blob 을 내고 `Frontend Checks` 가 병합한 값이
// 이 게이트의 입력이다. 그 병합값은 로컬 `vitest run --coverage` 통짜 실행과 분모가
// 다르다 — 같은 트리(73458cbe)에서 통짜는 statements 24,905 / branches 17,829 /
// functions 6,126 / lines 22,071 을 세고 병합은 각각 24,953 / 17,853 / 6,138 /
// 22,119 를 센다. covered 는 네 지표 다 똑같으므로(21,984 / 14,460 / 5,471 /
// 20,032) 차이는 전부 "실행되지 않은 파일" 쪽 분모다. 통짜 값(88.27 / 81.1 / 89.3 /
// 90.76)을 baseline 에 넣으면 CI 는 첫 run 부터 red 다. 로컬에서 다시 재려면 CI 와
// 같은 순서를 밟아라 — `.github/workflows/ci.yml` 의 `frontend-shard` 3개와
// `Frontend Checks` 의 병합 스텝이 그 명령의 SOT 다.
//
// ## 임계값을 그냥 올리지 않고 스크립트를 두는 이유
//
// `vite.config.ts` 의 thresholds 를 실측치까지 올리면 파일 하나 없이 같은 일을 하는
// 것처럼 보이지만 두 가지가 안 된다. ① 아래 TOLERANCE_PCT — vitest thresholds 에는
// 오차 허용이 없어서 실측된 1-branch 흔들림에 red 가 난다. ② 오를 때의 안내 —
// thresholds 는 초과를 알려주지 않으므로 톱니가 올라갈 계기가 안 생긴다.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const METRICS = ["statements", "branches", "functions", "lines"];

// 같은 소스 트리에 대한 CI 병합 실행이 실측으로 흔들린 폭은 branches covered 1개
// (14,459 ↔ 14,460 = 0.01%p) 다. 2026-08-03 main 의 연속 5개 run
// (30817139448 · 30816753894 · 30815720571 · 30812179641 · 30811094911) 이 분모
// 17,853 을 공유하면서 covered 만 갈렸고, 나머지 세 지표의 covered 는 다섯 run 내내
// 고정이었다. 재현: `gh run view <id> --log | grep -E '^Frontend Checks.*(Statements|Branches|Functions|Lines) +:'`.
// 허용 오차는 그 실측 흔들림의 5배로 잡는다 — 0.05%p 는 statements 12개 · branches
// 9개 · functions 3개 · lines 11개에 해당하므로, 뜻있는 회귀는 그대로 잡힌다.
// 오차 없이 잠그면 게이트가 같은 코드에 대해 무작위로 red 가 된다.
const TOLERANCE_PCT = 0.05;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [summaryArg, baselineArg] = process.argv.slice(2);
const summaryPath = resolve(
  repoRoot,
  summaryArg ?? "coverage/coverage-summary.json",
);
const baselinePath = resolve(repoRoot, baselineArg ?? "coverage-baseline.json");

/** 검사 불성립(2)이든 하락(1)이든, 통과가 아닌 종료는 전부 여기를 지난다. */
function abort(code, lines) {
  for (const line of lines) console.error(line);
  process.exit(code);
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    abort(2, [
      `ERROR: ${what} 를 못 읽었다: ${path}`,
      `       ${err.message}`,
      "       검사 불성립은 통과가 아니다 — 파일이 없으면 커버리지를 아무것도 안 재고 green 이 된다.",
    ]);
  }
}

const baseline = readJson(baselinePath, "baseline");

// `//` 는 JSON 에 주석이 없어서 쓰는 자리다. 그 밖의 낯선 키는 통과시키지 않는다 —
// `"statments"` 같은 오타가 들어오면 그 지표는 아래 루프에서 조용히 빠지는 게 아니라
// 여기서 걸려야 한다.
const unknownKeys = Object.keys(baseline).filter(
  (key) => key !== "//" && !METRICS.includes(key),
);
if (unknownKeys.length > 0) {
  abort(2, [
    `ERROR: baseline 에 모르는 키가 있다: ${unknownKeys.join(", ")}`,
    `       허용 키는 ${METRICS.join(" / ")} 와 주석용 "//" 뿐이다 (${baselinePath}).`,
  ]);
}
for (const metric of METRICS) {
  if (!Number.isFinite(baseline[metric])) {
    abort(2, [
      `ERROR: baseline 의 ${metric} 이 수가 아니다: ${JSON.stringify(baseline[metric])}`,
      `       네 지표가 다 있어야 검사가 성립한다 (${baselinePath}).`,
    ]);
  }
}

const summary = readJson(summaryPath, "coverage summary");
const total = summary?.total;
if (!total || typeof total !== "object") {
  abort(2, [
    `ERROR: coverage summary 에 total 이 없다: ${summaryPath}`,
    "       `--coverage.reporter=json-summary` 를 빼면 이 파일이 아예 안 나온다.",
  ]);
}
for (const metric of METRICS) {
  const entry = total[metric];
  if (!Number.isFinite(entry?.pct)) {
    abort(2, [
      `ERROR: coverage summary 의 ${metric}.pct 가 수가 아니다: ${JSON.stringify(entry)}`,
      `       (${summaryPath})`,
    ]);
  }
  // total 0 이면 istanbul 규약상 pct 가 100 이라 어떤 baseline 도 통과한다.
  // include 글롭이 깨져 아무 파일도 안 잡힌 날 게이트가 조용히 green 이 되는 자리다.
  if (!(entry.total > 0)) {
    abort(2, [
      `ERROR: coverage summary 의 ${metric} 이 0개를 쟀다 (total=${JSON.stringify(entry.total)})`,
      "       측정 대상이 0 이면 pct 는 100 으로 나온다 — 통과가 아니라 불성립이다.",
      `       (${summaryPath})`,
    ]);
  }
}

const drops = [];
const rises = [];
for (const metric of METRICS) {
  const measured = total[metric].pct;
  const floor = baseline[metric];
  // 두 값 다 istanbul 이 소수점 둘째 자리로 반올림한 pct 다. 차이를 그 자리에서
  // 다시 반올림해 비교하면 경계에서 부동소수점 오차가 판정을 뒤집지 않는다 —
  // `90.56 - 0.05` 는 90.51 이 아니라 90.50999999999999 다.
  const delta = Math.round((measured - floor) * 100) / 100;
  if (delta < -TOLERANCE_PCT) drops.push({ metric, measured, floor });
  else if (delta > TOLERANCE_PCT) rises.push({ metric, measured, floor });
}

const nextBaseline = JSON.stringify(
  {
    "//": baseline["//"],
    ...Object.fromEntries(METRICS.map((m) => [m, total[m].pct])),
  },
  null,
  2,
);

if (drops.length > 0) {
  abort(1, [
    ...drops.map(
      ({ metric, measured, floor }) =>
        `FAIL ${metric}: ${measured}% < baseline ${floor}% ` +
        `(허용 오차 ${TOLERANCE_PCT}%p, ${total[metric].covered}/${total[metric].total})`,
    ),
    `::error::coverage ratchet: ${drops.length}개 지표가 baseline 아래로 떨어졌다 (위 FAIL 줄). 빠진 커버리지를 테스트로 되채워라 — baseline 을 내려서 통과시키는 것은 톱니를 푸는 것이다. SOT: scripts/check-coverage-ratchet.mjs`,
  ]);
}

if (rises.length > 0) {
  const summaryLine = rises
    .map(({ metric, measured, floor }) => `${metric} ${floor} → ${measured}`)
    .join(", ");
  console.log(
    `::notice::coverage ratchet: baseline 을 올릴 수 있다 (${summaryLine}). 아래 블록을 coverage-baseline.json 에 그대로 붙여 이 PR 에 같이 커밋해라 — 다음 PR 로 미루면 오른 만큼을 도로 잃는다.`,
  );
  console.log(nextBaseline);
}

console.log(
  `ok: coverage ratchet 통과 — ${METRICS.map((m) => `${m} ${total[m].pct}%(baseline ${baseline[m]})`).join(" · ")}`,
);
