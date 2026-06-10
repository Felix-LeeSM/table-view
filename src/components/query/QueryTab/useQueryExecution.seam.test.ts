import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readLocalSource(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

describe("useQueryExecution RDB seam", () => {
  it("routes RDB execution through the local seam module", () => {
    const hookSource = readLocalSource("./useQueryExecution.ts");

    expect(hookSource).toContain('from "./rdbQueryExecution"');
    for (const forbiddenImport of [
      "@lib/sql/sqlUtils",
      "@lib/sql/stripSqlComments",
      "@lib/sql/mysqlScriptingBoundary",
      "@lib/sql/escalateWarnIfLargeImpact",
    ]) {
      expect(hookSource).not.toContain(`from "${forbiddenImport}"`);
    }
  });

  it("keeps RDB routing, dry-run preview, and history side effects out of Mongo/KV/Search seams", () => {
    const seamSource = readLocalSource("./rdbQueryExecution.ts");

    expect(seamSource).toContain("executeRdbQuery");
    expect(seamSource).toContain("executeRdbDryRun");
    expect(seamSource).toContain("recordHistory");
    expect(seamSource).toContain("setPendingRdbWarn");
    expect(seamSource).toContain("setPendingRdbConfirm");
    expect(seamSource).not.toContain("parseMongoshExpression");
    expect(seamSource).not.toContain("executeKvCommand");
    expect(seamSource).not.toContain("executeSearchQuery");
  });
});
