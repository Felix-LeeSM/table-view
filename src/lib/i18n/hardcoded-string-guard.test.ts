import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";

/**
 * #1074 — 하드코딩 UI 문자열 lint 가드가 실제로 신규 하드코딩을 잡는지 회귀
 * 검증한다 (2026-07-25). 실제 `eslint.config.js` 를 로드해 가상 fixture 를
 * lint 하므로, 규칙이 없어지거나 selector 가 헐거워지면 이 테스트가 깨진다.
 *
 * projectService(typed lint) 는 tsconfig `include: ["src"]` 밖의 실존-없는
 * 파일에서 "not found by the project service" fatal parse 를 낸다. static-policy
 * self-test(`scripts/check-eslint-static-policy.ts`)와 동일하게, typed 에서
 * ignore 된 `src/features/demo/` 경로를 fixture 로 써서 syntactic parser 로
 * 파싱되게 한다 (eslint.config.js 의 `ignores: ["src/features/demo/**"]` 참조).
 * demo 경로는 phased-exempt 목록(query/schema/search/structure/forms) 밖이라
 * 가드가 켜져 있다.
 */
const GUARDED = path.resolve("src/features/demo/HardcodedStringFixture.tsx");
const eslint = new ESLint({ cwd: process.cwd() });

async function guardHits(code: string): Promise<number> {
  const results = await eslint.lintText(code, { filePath: GUARDED });
  const messages = results[0]?.messages ?? [];
  return messages.filter(
    (m) => m.ruleId === "no-restricted-syntax" && /i18n/.test(m.message),
  ).length;
}

describe("i18n hardcoded-string lint guard (#1074)", () => {
  it("flags hardcoded JSXText", async () => {
    expect(
      await guardHits("export const C = () => <div>Hello world</div>;"),
    ).toBeGreaterThan(0);
  });

  it("flags a hardcoded user-facing attribute (placeholder)", async () => {
    expect(
      await guardHits(
        `export const C = () => <input placeholder="Search tables" />;`,
      ),
    ).toBeGreaterThan(0);
  });

  it("passes text routed through t()", async () => {
    expect(
      await guardHits(
        `export const C = ({ t }: { t: (k: string) => string }) => <div>{t("x")}</div>;`,
      ),
    ).toBe(0);
  });

  it("does not flag non-user-facing attributes (className)", async () => {
    expect(
      await guardHits(`export const C = () => <div className="flex gap-2" />;`),
    ).toBe(0);
  });
});

/**
 * 리뷰 B1 회귀 — flat config 에서 no-restricted-syntax 는 파일당 마지막 매칭
 * 블록이 배열 전체를 override 한다. cell-domain(datagrid/document/shared) 블록이
 * JSON.stringify selector 하나만 담고 있으면 native-select / getState / i18n
 * 가드가 그 surface 에서 조용히 사라진다 (#1074 리뷰 B1). additive 재나열로
 * native-select / getState 는 복구하되 i18n 은 phased-exempt(Slice 2)로 둔다.
 *
 * 이 계약을 `calculateConfigForFile` 로 검증한다 — 특정 파일에 실제로 적용되는
 * 병합/override 후 최종 규칙만 계산하고 파싱/타입체크는 하지 않으므로, cell-domain
 * .tsx 가 projectService(typed) 대상이어도 빠르고 안정적이다 (lintText 로 실존
 * 파일을 typed-parse 하면 전체 vitest 병렬 실행에서 type program 로딩이 10s 를
 * 넘겨 flaky).
 */
async function restrictedSelectorsFor(relPath: string): Promise<string[]> {
  const cfg = await eslint.calculateConfigForFile(path.resolve(relPath));
  const rule = (cfg as { rules?: Record<string, unknown> }).rules?.[
    "no-restricted-syntax"
  ];
  if (!Array.isArray(rule)) return [];
  return rule
    .slice(1)
    .map((o) => (o as { selector?: string }).selector)
    .filter((s): s is string => typeof s === "string");
}

const CELL_DOMAIN_TSX = "src/components/datagrid/DataGridTable/DataRow.tsx";
const CELL_DOMAIN_TS = "src/components/datagrid/useDataGridEditPendingState.ts";

describe("cell-domain guard override — B1 regression (#1074)", () => {
  it("keeps native <select> + getState guards in cell-domain .tsx", async () => {
    const sels = await restrictedSelectorsFor(CELL_DOMAIN_TSX);
    expect(sels).toContain("JSXOpeningElement[name.name='select']");
    expect(sels.some((s) => /getState/.test(s))).toBe(true);
  });

  it("keeps i18n JSXText phased-exempt in cell-domain .tsx (Slice 2 backlog)", async () => {
    const sels = await restrictedSelectorsFor(CELL_DOMAIN_TSX);
    expect(sels.some((s) => /JSXText/.test(s))).toBe(false);
  });

  it("does not apply the getState guard to cell-domain .ts logic", async () => {
    // .ts hook(useDataGridEditPendingState)의 정당한 store.getState() 를
    // 오탐하지 않도록 .tsx/.ts 를 분리했다 — 그 분리가 유지되는지 검증.
    const sels = await restrictedSelectorsFor(CELL_DOMAIN_TS);
    expect(sels.some((s) => /getState/.test(s))).toBe(false);
  });
});
