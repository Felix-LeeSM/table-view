import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * #1074 — regression check that the hardcoded-UI-string lint guard actually
 * catches new hardcoding (2026-07-25). Loads the real `eslint.config.js` and
 * lints virtual fixtures, so the test breaks if the rule disappears or its
 * selectors loosen.
 *
 * projectService (typed lint) throws a "not found by the project service"
 * fatal parse on non-existent files outside the tsconfig
 * `include: ["src"]`. So the fixture reuses `src/features/demo/`, which is
 * ignored from typing, so it parses with the syntactic parser (see
 * `ignores: ["src/features/demo/**"]` in eslint.config.js). The demo path
 * sits outside the phased-exempt list
 * (query/schema/search/structure/forms), so the guard is on there.
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
 * Review B1 regression — under flat config, no-restricted-syntax lets the
 * last matching block per file override the whole array. If the cell-domain
 * (datagrid/document/shared) block carries only the JSON.stringify selector,
 * the native-select / getState / i18n guards silently vanish on that surface
 * (#1074 review B1). Re-listing additively restores native-select / getState
 * while i18n stays phased-exempt (Slice 2).
 *
 * Verified via `calculateConfigForFile` — it computes only the final
 * merged/overridden rules that actually apply to a given file, without
 * parsing or type checking, so it stays fast and stable even though the
 * cell-domain .tsx is a projectService (typed) target (type-checking a real
 * file through lintText pushes type program loading past 10s under full
 * vitest parallelism → flaky).
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
    // The .tsx/.ts guard split exists so the .ts hook's
    // (useDataGridEditPendingState) legitimate store.getState() is not
    // false-positived — verify that split still holds.
    const sels = await restrictedSelectorsFor(CELL_DOMAIN_TS);
    expect(sels.some((s) => /getState/.test(s))).toBe(false);
  });
});

/**
 * #1792 — the shape assertions above only check that a selector string
 * *exists* in the config. They never verify esquery actually matches, so a
 * selector with the wrong node type / attribute path (e.g.
 * `JSXOpeningElement[name.value='select']`) still passes — green even though
 * the rule is dead (#1781 review non-blocking). The two cases below lint
 * paths that actually match the cell-domain glob, pinning the *firing*
 * (2026-07-25).
 *
 * Cell-domain paths are typed-lint (projectService) targets, so a
 * non-existent fixture throws a "not found by the project service" fatal
 * parse; typing a real .tsx instead pushes type program loading past 10s
 * under vitest parallelism (see above). overrideConfig drops just this lint
 * to the syntactic parser to dodge both — `no-restricted-syntax` is
 * untouched, so the firing target stays the real config as-is.
 */
const cellDomainEslint = new ESLint({
  cwd: process.cwd(),
  overrideConfig: {
    files: ["**/*.tsx"],
    languageOptions: { parserOptions: { projectService: false } },
    // Parses without type info, so type-aware rules are off (else the rule crashes).
    rules: { "@typescript-eslint/no-deprecated": "off" },
  },
});
const CELL_DOMAIN_FIXTURE = path.resolve(
  "src/components/datagrid/__guard-fixture__/CellDomainGuard.tsx",
);

async function cellDomainMessages(code: string): Promise<string[]> {
  const results = await cellDomainEslint.lintText(code, {
    filePath: CELL_DOMAIN_FIXTURE,
  });
  const messages = results[0]?.messages ?? [];
  // A fatal parse is indistinguishable from zero violations → false negative;
  // fail fast instead.
  const fatal = messages.find((m) => m.fatal);
  if (fatal) throw new Error(`fixture parse failed: ${fatal.message}`);
  return messages
    .filter((m) => m.ruleId === "no-restricted-syntax")
    .map((m) => m.message);
}

describe("cell-domain guard selector firing (#1792)", () => {
  it("reports native <select> in cell-domain code", async () => {
    // Reason: #1792 — catches the regression where the B1 re-listing keeps
    // the selector string but loses real matching (typo / attribute path
    // change). A shape assertion cannot see it.
    const messages = await cellDomainMessages(
      `export const C = () => <select><option>a</option></select>;`,
    );
    expect(messages).toContain(
      "Use <Select> from @components/ui/select instead of native <select>.",
    );
  });

  it("reports raw JSON.stringify in cell-domain code", async () => {
    // Reason: #1792 — no test ever observed CELL_JSON_STRINGIFY_GUARD firing.
    // It is the recurrence guard for the DataGrid freeze, so pin the firing.
    const messages = await cellDomainMessages(
      `export const f = (v: unknown) => JSON.stringify(v);`,
    );
    expect(messages.some((m) => m.includes("safeStringifyCell"))).toBe(true);
  });
});
