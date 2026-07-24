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
