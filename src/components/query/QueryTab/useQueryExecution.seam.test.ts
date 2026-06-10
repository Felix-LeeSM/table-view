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

describe("useQueryExecution Mongo seam", () => {
  it("routes Mongo parser and runCommand dispatch through the local seam module", () => {
    const hookSource = readLocalSource("./useQueryExecution.ts");

    expect(hookSource).toContain('from "./mongoQueryExecution"');
    for (const forbiddenImport of [
      "@lib/mongo/mongoshParser",
      "@lib/mongo/mongoSafety",
      "@lib/mongo/runCommandParser",
    ]) {
      expect(hookSource).not.toContain(`from "${forbiddenImport}"`);
    }
    for (const forbiddenWrapper of [
      "findDocuments",
      "aggregateDocuments",
      "findOneDocument",
      "countDocuments",
      "estimatedDocumentCount",
      "distinctDocuments",
      "runMongoCommand",
    ]) {
      expect(hookSource).not.toMatch(new RegExp(`\\b${forbiddenWrapper}\\b`));
    }
  });

  it("keeps Mongo query dispatch out of RDB/KV/Search seams", () => {
    const seamSource = readLocalSource("./mongoQueryExecution.ts");
    const documentResultsSource = readLocalSource("./mongoDocumentResults.ts");

    expect(seamSource).toContain("executeMongoQuery");
    expect(seamSource).toContain("parseMongoshExpression");
    expect(seamSource).toContain("runMongoCommand");
    expect(documentResultsSource).toContain("createDocumentResultEnvelope");
    expect(seamSource).not.toContain("executeRdbQuery");
    expect(seamSource).not.toContain("executeKvCommand");
    expect(seamSource).not.toContain("executeSearchQuery");
  });
});
