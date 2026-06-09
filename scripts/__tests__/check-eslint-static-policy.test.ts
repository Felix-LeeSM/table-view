import { describe, expect, it } from "vitest";
import {
  MAX_LINES_ALLOWLIST,
  findUnexpectedIgnoredFiles,
  isAllowedGeneratedLintIgnore,
  summarizeLintMessages,
} from "../check-eslint-static-policy";

describe("check-eslint-static-policy", () => {
  it("keeps the measured max-lines allowlist explicit", () => {
    expect(MAX_LINES_ALLOWLIST).toHaveLength(22);
    expect(MAX_LINES_ALLOWLIST).toContain(
      "src/components/query/QueryTab/useQueryExecution.ts",
    );
    expect(MAX_LINES_ALLOWLIST).toContain("e2e/smoke/_helpers.ts");
  });

  it("allows only generated wasm lint ignores", () => {
    expect(
      isAllowedGeneratedLintIgnore("src/lib/sql/wasm/sql_parser_core.d.ts"),
    ).toBe(true);
    expect(
      isAllowedGeneratedLintIgnore(
        "src/lib/mongo/wasm/mongosh_parser_core.d.ts",
      ),
    ).toBe(true);
    expect(isAllowedGeneratedLintIgnore("src/components/Foo.tsx")).toBe(false);
  });

  it("reports hidden lint candidates outside the generated allowlist", () => {
    expect(
      findUnexpectedIgnoredFiles([
        "src/lib/sql/wasm/sql_parser_core.d.ts",
        "src/components/Foo.tsx",
      ]),
    ).toEqual(["src/components/Foo.tsx"]);
  });

  it("summarizes max-lines warnings separately from other lint messages", () => {
    const summary = summarizeLintMessages([
      {
        filePath: "src/A.ts",
        messages: [
          { ruleId: "max-lines", severity: 1 },
          { ruleId: "no-console", severity: 2 },
          { ruleId: "no-warning-comments", severity: 1 },
        ],
      },
    ]);

    expect(summary.maxLineWarningPaths).toEqual(["src/A.ts"]);
    expect(summary.errorCount).toBe(1);
    expect(summary.unexpectedWarningRules).toEqual(["no-warning-comments"]);
  });
});
