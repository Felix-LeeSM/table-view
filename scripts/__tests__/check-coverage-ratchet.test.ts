import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// `scripts/check-coverage-ratchet.mjs` 는 `Frontend Checks` 잡에서 병합된
// 커버리지를 받아 도는 blocking 게이트다. 그 잡은 게이트가 **실측치에 대해**
// green 인 것만 보므로, "커버리지를 떨어뜨리면 실제로 red 가 되는가" 는 CI 가
// 한 번도 밟지 않는 경로다 — 이 파일이 하락을 씨 뿌려 그 경로를 판다.
// 픽스처는 임시 디렉토리에만 쓰고 repo 트리는 안 건드린다.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const gate = "scripts/check-coverage-ratchet.mjs";

const METRICS = ["statements", "branches", "functions", "lines"] as const;
type Metric = (typeof METRICS)[number];

const trees: string[] = [];
afterEach(() => {
  for (const t of trees.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** 시딩값 그대로인 baseline. 개별 지표만 흔들어 쓴다. */
const SEEDED: Record<Metric, number> = {
  statements: 88.1,
  branches: 80.99,
  functions: 89.13,
  lines: 90.56,
};

/** 두 입력 파일을 있는 그대로 쓴다 — 형식이 깨진 픽스처는 여기로 온다. */
function writeTree(
  summary: unknown,
  baseline: unknown,
): { summaryPath: string; baselinePath: string } {
  const root = mkdtempSync(join(tmpdir(), "coverage-ratchet-"));
  trees.push(root);
  const summaryPath = join(root, "coverage-summary.json");
  const baselinePath = join(root, "coverage-baseline.json");
  writeFileSync(summaryPath, JSON.stringify(summary), "utf8");
  writeFileSync(baselinePath, JSON.stringify(baseline), "utf8");
  return { summaryPath, baselinePath };
}

type MetricEntry = {
  total: number;
  covered: number;
  skipped: number;
  pct?: number;
};

function totalFor(
  pcts: Record<Metric, number>,
  totalPerMetric: number,
): Record<Metric, MetricEntry> {
  return Object.fromEntries(
    METRICS.map((m) => [
      m,
      {
        total: totalPerMetric,
        covered: Math.round((totalPerMetric * pcts[m]) / 100),
        skipped: 0,
        pct: pcts[m],
      },
    ]),
  ) as Record<Metric, MetricEntry>;
}

function seed(
  measured: Partial<Record<Metric, number>>,
  baseline: unknown = SEEDED,
  totalPerMetric = 10_000,
): { summaryPath: string; baselinePath: string } {
  return writeTree(
    { total: totalFor({ ...SEEDED, ...measured }, totalPerMetric) },
    baseline,
  );
}

function runGate(summaryPath: string, baselinePath: string) {
  const run = spawnSync("node", [gate, summaryPath, baselinePath], {
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

describe("check-coverage-ratchet", () => {
  // 시딩 계약: 착수 시점 실측치를 그대로 baseline 에 넣으면 첫 run 이 green 이다.
  it("passes when the measurement equals the baseline", () => {
    const { summaryPath, baselinePath } = seed({});
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).toMatch(/^ok: coverage ratchet 통과/m);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  // 이 게이트의 존재 이유. 네 지표를 하나씩 떨어뜨려 전부 red 가 되는지 본다 —
  // 한 지표만 보고 통과시키면 나머지 셋은 아무도 안 지킨다.
  it.each(METRICS)("fails on a seeded drop in %s", (metric) => {
    // istanbul 의 pct 와 같은 소수점 둘째 자리 값으로 떨어뜨린다. 뺄셈 결과를
    // 그대로 쓰면 88.1 - 1 이 87.10000000000001 로 나와 실측에 없는 자릿수가 된다.
    const dropped = Math.round((SEEDED[metric] - 1) * 100) / 100;
    const { summaryPath, baselinePath } = seed({ [metric]: dropped });
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).toContain(
      `FAIL ${metric}: ${dropped}% < baseline ${SEEDED[metric]}%`,
    );
    expect(run.out).toContain("::error::coverage ratchet");
    expect(run.status).toBe(1);
  });

  // 같은 트리의 CI run 들이 branches covered 1개(0.01%p)만큼 흔들린 것이 실측이다.
  // 그 폭에서 red 가 나면 게이트가 같은 코드에 무작위로 red 를 낸다.
  it("absorbs the measured 0.01%p jitter", () => {
    const { summaryPath, baselinePath } = seed({ branches: 80.98 });
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).toMatch(/^ok: coverage ratchet 통과/m);
    expect(run.status).toBe(0);
  });

  // 허용 오차 0.05%p 의 양 끝. 안쪽은 통과, 한 칸 밖은 red — 비교가 어느 쪽으로
  // 미끄러져도 이 둘 중 하나가 깨진다.
  it("passes at exactly the tolerance edge and fails one step past it", () => {
    const inside = seed({ lines: 90.51 });
    expect(runGate(inside.summaryPath, inside.baselinePath).status).toBe(0);
    const outside = seed({ lines: 90.5 });
    const run = runGate(outside.summaryPath, outside.baselinePath);
    expect(run.out).toContain("FAIL lines: 90.5% < baseline 90.56%");
    expect(run.status).toBe(1);
  });

  // 오름은 red 가 아니라 안내다. 붙여넣을 블록이 안 나오면 톱니를 올릴 계기가
  // 없어져 baseline 이 영원히 시딩값에 머문다.
  it("prints a pasteable next baseline when coverage rises", () => {
    const { summaryPath, baselinePath } = seed({ branches: 82.5 });
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).toContain("::notice::coverage ratchet");
    expect(run.out).toContain("branches 80.99 → 82.5");
    expect(run.out).toContain('"branches": 82.5');
    expect(run.status).toBe(0);
  });

  // 오차 폭만큼 정확히 오른 run 은 오차 안이므로 갱신 안내를 내면 안 된다.
  // `88.15 - 88.1` 이 0.05 가 아니라 0.05000000000001137 이라, 차이를 둘째 자리로
  // 반올림하지 않으면 이 run 이 rises 로 새어 baseline 을 올리라고 안내한다.
  it("stays silent when a metric rises by exactly the tolerance", () => {
    const { summaryPath, baselinePath } = seed({ statements: 88.15 });
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).not.toContain("::notice::");
    expect(run.out).toMatch(/^ok: coverage ratchet 통과/m);
    expect(run.status).toBe(0);
  });

  // 안내 블록은 톱니를 한 방향으로만 움직여야 한다. rises 분기는 한 지표만 올라도
  // 켜지므로, 같은 run 에서 오차 안으로 내려간 지표까지 측정치로 덮으면 안내대로
  // 붙여 커밋한 사람이 그 지표의 바닥을 같이 내린다 — 갱신할 때마다 오차 폭이
  // 새로 열려 침식이 누적된다.
  it("never lowers an untouched metric in the pasteable next baseline", () => {
    const { summaryPath, baselinePath } = seed({
      statements: 88.6,
      lines: 90.52,
    });
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).toContain("::notice::coverage ratchet");
    expect(run.out).toContain('"statements": 88.6');
    expect(run.out).toContain('"lines": 90.56');
    expect(run.status).toBe(0);
  });

  // 아래 셋은 "재지 못한 것을 통과로 세지 않는다" 를 판다. 셋 다 exit 0 으로
  // 미끄러지면 게이트는 커버리지를 아무것도 안 보면서 green 이 된다.
  it("refuses a summary file that is not there", () => {
    const { baselinePath } = seed({});
    const run = runGate(
      join(tmpdir(), "coverage-ratchet-없는파일.json"),
      baselinePath,
    );
    expect(run.out).toContain("coverage summary 를 못 읽었다");
    expect(run.status).toBe(2);
  });

  // istanbul 은 측정 대상이 0 이면 pct 를 100 으로 낸다 — include 글롭이 깨진 날
  // 어떤 baseline 이든 통과해 버리는 자리다.
  it("refuses a summary that measured nothing", () => {
    const { summaryPath, baselinePath } = seed({}, SEEDED, 0);
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).toContain("0개를 쟀다");
    expect(run.status).toBe(2);
  });

  it("refuses a baseline whose metric key is misspelled", () => {
    const { summaryPath, baselinePath } = seed(
      {},
      { ...SEEDED, statements: undefined, statments: 88.1 },
    );
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).toContain("모르는 키가 있다: statments");
    expect(run.status).toBe(2);
  });

  // 위 픽스처는 낯선 키 검사에서 먼저 걸리므로 "지표가 수인가" 분기를 못 판다.
  // 네 지표가 다 있고 값만 수가 아닌 baseline 이 그 분기를 판다.
  it("refuses a baseline whose metric is not a number", () => {
    const { summaryPath, baselinePath } = seed(
      {},
      { ...SEEDED, statements: "88.1" },
    );
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).toContain("baseline 의 statements 이 수가 아니다");
    expect(run.status).toBe(2);
  });

  // `--coverage.reporter=json-summary` 가 빠지면 파일 자체가 안 나오지만, 다른
  // reporter 가 쓴 파일이 이 이름으로 있는 경우엔 `total` 이 없는 채로 읽힌다.
  it("refuses a summary that carries no total", () => {
    const { summaryPath, baselinePath } = writeTree(
      { "src/lib/example.ts": totalFor(SEEDED, 10_000).statements },
      SEEDED,
    );
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).toContain("coverage summary 에 total 이 없다");
    expect(run.status).toBe(2);
  });

  it("refuses a summary whose metric has no pct", () => {
    const total = totalFor(SEEDED, 10_000);
    total.branches.pct = undefined;
    const { summaryPath, baselinePath } = writeTree({ total }, SEEDED);
    const run = runGate(summaryPath, baselinePath);
    expect(run.out).toContain(
      "coverage summary 의 branches.pct 가 수가 아니다",
    );
    expect(run.status).toBe(2);
  });

  // 커밋된 baseline 자체가 게이트의 입력이다. 손으로 고치다 형식이 깨지면
  // 여기서 잡힌다 — CI 에서는 exit 2 로 red 지만 그때는 이미 push 뒤다.
  it("accepts the committed baseline and passes a run that matches it", () => {
    const committed = JSON.parse(
      readFileSync(join(repoRoot, "coverage-baseline.json"), "utf8"),
    ) as Record<string, number>;
    const measured = Object.fromEntries(
      METRICS.map((m) => [m, committed[m]]),
    ) as Record<Metric, number>;
    const { summaryPath } = seed(measured);
    const run = runGate(summaryPath, join(repoRoot, "coverage-baseline.json"));
    expect(run.out).toMatch(/^ok: coverage ratchet 통과/m);
    expect(run.status).toBe(0);
  });

  // 스크립트가 통과해도 CI 가 안 부르면 아무것도 안 지킨다. required 여부 자체는
  // GitHub 라이브 상태라 repo 안에서 못 재지만, "어느 잡의 어느 스텝이 무슨 조건으로
  // 도는가" 는 `ci.yml` 이 다 갖고 있다. 원문 문자열만 보면 `continue-on-error: true`
  // 추가 · `if:` 추가 · 주석 처리 · 다른 잡으로 이동이 넷 다 green 을 유지한 채
  // 게이트를 끈다 — 그래서 파싱해서 본다.
  it("runs the gate unconditionally in Frontend Checks, after the step that writes its input", () => {
    const workflow = parseYaml(
      readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8"),
    ) as {
      jobs: Record<
        string,
        {
          name?: string;
          "continue-on-error"?: unknown;
          steps?: Array<{
            run?: string;
            if?: unknown;
            "continue-on-error"?: unknown;
          }>;
        }
      >;
    };
    const job = Object.values(workflow.jobs).find(
      (j) => j.name === "Frontend Checks",
    );
    expect(job, "no job is named `Frontend Checks`").toBeDefined();
    // 잡 수준 `continue-on-error` 는 red 를 통째로 삼킨다.
    expect(job?.["continue-on-error"]).toBeUndefined();

    const steps = job?.steps ?? [];
    const merge = steps.findIndex((s) =>
      s.run?.includes("--coverage.reporter=json-summary"),
    );
    const ratchet = steps.findIndex((s) => s.run?.includes(`node ${gate}`));
    expect(merge).toBeGreaterThanOrEqual(0);
    // 게이트는 앞 스텝이 쓴 파일을 읽는다 — 순서가 뒤집히면 exit 2 다. 스텝이
    // 통째로 사라지면 -1 이라 이 비교가 잡는다.
    expect(ratchet).toBeGreaterThan(merge);
    // 스텝 수준 modifier 둘은 잡을 green 으로 둔 채 게이트만 끈다.
    expect(steps[ratchet]?.if).toBeUndefined();
    expect(steps[ratchet]?.["continue-on-error"]).toBeUndefined();
  });
});
